import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabase';
import { env } from '../config/env';
import { isUuid, makeTitleFromText, safeJson, estimateTokens, estimateCost } from '../utils/helpers';
import { OpenAIAssistantProvider } from '../ai/providers/OpenAIAssistantProvider';
import { AssistantRequest } from '../ai/IAssistantProvider';
import { 
  processAttachments, 
  attachmentsToContext, 
  extractImageUrls, 
  Attachment 
} from '../utils/attachments';
import { retrieveRelevantChunks, chunksToContext } from '../services/chunkRetrieval';
import { optionalAuth, getUserId } from '../middleware/auth';
import { 
  downloadAttachments, 
  validateAttachment, 
  type AttachmentMetadata 
} from '../services/attachmentDownload';
import { extractTextFromFiles, type UploadedFile } from '../utils/documentText';
import { getUserIdentity } from '../services/userProfile';

const router = express.Router();
const openaiProvider = new OpenAIAssistantProvider();

/**
 * =====================================================
 * POST /api/ai/chat
 * =====================================================
 * 
 * OBJETIVO: Responder al usuario Y guardar SIEMPRE en Supabase
 * 
 * AUTENTICACIÓN: Opcional (soporta guest mode)
 * - Si hay token válido: usa req.user.id
 * - Si NO hay token: usa userId del body
 * - Si token inválido: 401 (manejado por middleware)
 * 
 * FLUJO:
 * 1. Resolver session_id (crear si no existe)
 * 2. Insertar mensaje del usuario en ae_messages
 * 3. Recuperar conocimiento entrenable (chunks)
 * 4. Llamar a OpenAI
 * 5. Insertar respuesta del assistant en ae_messages
 * 6. Actualizar ae_sessions (last_message_at, total_messages, tokens, cost)
 * 7. (Opcional) Log en ae_requests
 * 8. Responder al frontend
 */
router.post('/chat', optionalAuth, async (req, res) => {
  const startTime = Date.now();
  let sessionId: string | null = null;
  
  try {
    console.log('\n[CHAT] ==================== NUEVA SOLICITUD ====================');
    
    // Obtener userId (autenticado o del body)
    const authenticatedUserId = getUserId(req);
    
    let {
      workspaceId = env.defaultWorkspaceId,
      userId: bodyUserId,
      mode = env.defaultMode,
      sessionId: requestSessionId,
      messages
    } = req.body;
    
    // Prioridad: usuario autenticado > userId del body
    const userId = authenticatedUserId || bodyUserId;
    
    if (req.user) {
      console.log(`[CHAT] Usuario autenticado: ${req.user.id} (${req.user.email})`);
    } else {
      console.log(`[CHAT] Modo guest - userId del body: ${userId || 'N/A'}`);
    }
    
    // ============================================
    // A0) NORMALIZAR MODE + ALIAS
    // ============================================
    
    const allowedModes = new Set(['universal', 'legal', 'medico', 'seguros', 'contabilidad']);
    
    // Alias legacy: "aleon" → "universal"
    if (!mode || typeof mode !== 'string') {
      mode = 'universal';
    }
    mode = mode.toLowerCase().trim();
    if (mode === 'aleon') {
      mode = 'universal';
      console.log(`[CHAT] Modo 'aleon' mapeado a 'universal' (alias legacy)`);
    }
    
    if (!allowedModes.has(mode)) {
      return res.status(400).json({
        error: 'INVALID_MODE',
        message: `Modo inválido: ${mode}. Modos válidos: ${Array.from(allowedModes).join(', ')}`,
        session_id: null,
        memories_to_add: []
      });
    }
    
    // ============================================
    // A1) PROCESAR ATTACHMENTS
    // ============================================
    // Soporta DOS modos:
    // 1. Attachments JSON (URLs de Supabase Storage) - desde AL-EON
    // 2. Attachments legacy (array de URLs directas) - compatibilidad
    
    const attachmentsRaw = (req.body.attachments ?? req.body.files ?? []) as any[];
    const safeAttachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];
    
    // Validación básica
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        answer: 'Error: userId es requerido y debe ser string',
        session_id: null,
        memories_to_add: []
      });
    }
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        answer: 'Error: messages debe ser un array no vacío',
        session_id: null,
        memories_to_add: []
      });
    }
    
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return res.status(400).json({
        answer: 'Error: El último mensaje debe tener role="user"',
        session_id: null,
        memories_to_add: []
      });
    }
    
    const userContent = lastMessage.content;
    console.log(`[CHAT] userId: ${userId}, workspaceId: ${workspaceId}, mode: ${mode}`);
    console.log(`[CHAT] Mensaje: "${userContent.substring(0, 60)}..."`);
    console.log(`[CHAT] Attachments recibidos: ${safeAttachments.length}`);
    
    // ============================================
    // A2) DETECTAR TIPO DE ATTACHMENTS Y PROCESAR
    // ============================================
    
    let attachmentsContext = '';
    let imageUrls: any[] = [];
    
    if (safeAttachments.length > 0) {
      // Detectar si son attachments de Supabase Storage (con bucket/path) o legacy (URLs)
      const firstAttachment = safeAttachments[0];
      const isSupabaseStorage = validateAttachment(firstAttachment);
      
      if (isSupabaseStorage) {
        // MODO NUEVO: Attachments desde Supabase Storage
        console.log(`[ATTACHMENTS] Modo: Supabase Storage (${safeAttachments.length} archivo(s))`);
        
        try {
          // 1. Validar todos los attachments
          const validAttachments: AttachmentMetadata[] = safeAttachments.filter(validateAttachment);
          
          if (validAttachments.length < safeAttachments.length) {
            console.warn(`[ATTACHMENTS] ${safeAttachments.length - validAttachments.length} attachment(s) inválido(s) ignorados`);
          }
          
          // 2. Descargar archivos desde Supabase Storage
          const downloadedFiles = await downloadAttachments(validAttachments);
          
          if (downloadedFiles.length === 0) {
            console.error('[ATTACHMENTS] No se pudo descargar ningún archivo');
          } else {
            // 3. Extraer texto de los archivos descargados
            console.log(`[ATTACHMENTS] Extrayendo texto de ${downloadedFiles.length} archivo(s)...`);
            const extractedDocs = await extractTextFromFiles(downloadedFiles);
            
            // 4. Construir contexto
            if (extractedDocs.length > 0) {
              const docsBlock = extractedDocs
                .map((doc, i) => {
                  const text = (doc.text || '').slice(0, 30000); // Límite 30k chars
                  return `\n[DOCUMENTO ${i + 1}] ${doc.name} (${doc.type})\n${text}\n`;
                })
                .join('\n');
              
              attachmentsContext = `\n\n=== DOCUMENTOS ADJUNTOS ===\n${docsBlock}\n=== FIN DOCUMENTOS ===\n`;
              
              console.log(`[ATTACHMENTS] ✓ Procesados ${extractedDocs.length} documento(s), ${attachmentsContext.length} caracteres de contexto`);
            }
          }
        } catch (err) {
          console.error('[ATTACHMENTS] Error procesando attachments de Supabase Storage:', err);
        }
        
      } else {
        // MODO LEGACY: Attachments con URLs directas (compatibilidad)
        console.log(`[ATTACHMENTS] Modo: Legacy URLs (${safeAttachments.length} attachment(s))`);
        
        const processed = await processAttachments(safeAttachments);
        
        // Log para debug
        processed.forEach(p => {
          console.log(`[ATTACHMENTS] - ${p.name} (${p.type}): ${p.error ? 'ERROR' : 'OK'}`);
        });
        
        // Extraer texto de documentos
        attachmentsContext = attachmentsToContext(processed);
        
        // Extraer URLs de imágenes para visión multimodal
        imageUrls = extractImageUrls(processed);
        
        if (imageUrls.length > 0) {
          console.log(`[ATTACHMENTS] ${imageUrls.length} imagen(es) para visión multimodal`);
        }
      }
    }
    
    // ============================================
    // A3) RESOLVER SESSION_ID
    // ============================================
    
    if (requestSessionId && isUuid(requestSessionId)) {
      // Verificar que existe
      const { data: existingSession } = await supabase
        .from('ae_sessions')
        .select('id')
        .eq('id', requestSessionId)
        .single();
      
      if (existingSession) {
        sessionId = requestSessionId;
        console.log(`[CHAT] Usando sesión existente: ${sessionId}`);
      }
    }
    
    if (!sessionId) {
      // Crear nueva sesión
      const newSessionId = uuidv4();
      const title = makeTitleFromText(userContent, 8);
      
      const { data: newSession, error: sessionError } = await supabase
        .from('ae_sessions')
        .insert({
          id: newSessionId,
          assistant_id: env.assistantId,
          workspace_id: workspaceId,
          mode: mode,
          user_id_old: userId, // Guardar userId string en user_id_old
          user_id_uuid: null, // Por ahora null hasta tener auth real
          title: title,
          last_message_at: new Date().toISOString(),
          total_messages: 0,
          total_tokens: 0,
          estimated_cost: 0,
          metadata: { source: 'aleon' }
        })
        .select('id')
        .single();
      
      if (sessionError) {
        console.error('[DB] ERROR creando sesión:', sessionError);
        throw new Error('No se pudo crear la sesión');
      }
      
      sessionId = newSession.id;
      console.log(`[CHAT] Nueva sesión creada: ${sessionId} - "${title}"`);
    }
    
    // ============================================
    // B) INSERTAR MENSAJE DEL USUARIO
    // ============================================
    
    const userMessageId = uuidv4();
    const userTokens = estimateTokens(userContent);
    
    const { error: userMessageError } = await supabase
      .from('ae_messages')
      .insert({
        id: userMessageId,
        session_id: sessionId,
        role: 'user',
        content: userContent,
        tokens: userTokens,
        cost: 0,
        user_id_uuid: null, // Por ahora null
        metadata: {
          source: 'aleon',
          workspaceId: workspaceId,
          mode: mode,
          userId: userId
        }
      });
    
    if (userMessageError) {
      console.error('[DB] ERROR guardando mensaje user:', userMessageError);
      // NO romper el chat, continuar
    } else {
      console.log(`[DB] ✓ Mensaje user guardado: ${userMessageId}`);
    }
    
    // ============================================
    // C) RECUPERAR CONOCIMIENTO ENTRENABLE (CHUNKS)
    // ============================================
    
    console.log('[CHUNKS] Recuperando conocimiento entrenable...');
    let knowledgeContext = '';
    
    try {
      const chunks = await retrieveRelevantChunks({
        workspaceId,
        userId,
        projectId: req.body.projectId || req.body.project_id,
        limit: 5, // Top 5 fragmentos más relevantes
        minImportance: 0.5,
      });
      
      if (chunks.length > 0) {
        knowledgeContext = chunksToContext(chunks);
        console.log(`[CHUNKS] ✓ ${chunks.length} fragmento(s) recuperado(s)`);
      } else {
        console.log('[CHUNKS] No se encontró conocimiento entrenable');
      }
    } catch (chunkError) {
      console.error('[CHUNKS] Error recuperando chunks:', chunkError);
      // No romper el chat si falla la recuperación
    }
    
    // ============================================
    // D) LLAMAR A OPENAI (CON ATTACHMENTS + CHUNKS)
    // ============================================
    
    console.log('[OPENAI] Enviando request...');
    
    let answer = '';
    let assistantTokens = 0;
    let modelUsed = 'gpt-4';
    
    try {
      // Preparar mensajes con contexto de attachments Y chunks
      let finalMessages = [...messages];
      
      // Si hay conocimiento entrenable, inyectarlo como contexto del sistema
      if (knowledgeContext) {
        // Buscar si ya hay un mensaje system
        const systemMsgIndex = finalMessages.findIndex(m => m.role === 'system');
        
        if (systemMsgIndex >= 0) {
          // Agregar al mensaje system existente
          finalMessages[systemMsgIndex] = {
            ...finalMessages[systemMsgIndex],
            content: finalMessages[systemMsgIndex].content + '\n\n' + knowledgeContext
          };
        } else {
          // Crear nuevo mensaje system al inicio
          finalMessages = [
            {
              role: 'system',
              content: knowledgeContext
            },
            ...finalMessages
          ];
        }
      }
      
      // Si hay documentos adjuntos, agregar contexto al último mensaje del usuario
      if (attachmentsContext) {
        const lastUserMsg = finalMessages[finalMessages.length - 1];
        finalMessages[finalMessages.length - 1] = {
          ...lastUserMsg,
          content: lastUserMsg.content + attachmentsContext
        };
      }
      
      // Si hay imágenes, usar formato multimodal (GPT-4 Vision)
      if (imageUrls.length > 0) {
        const lastUserMsg = finalMessages[finalMessages.length - 1];
        finalMessages[finalMessages.length - 1] = {
          role: 'user',
          content: [
            { type: 'text', text: lastUserMsg.content },
            ...imageUrls
          ]
        };
        modelUsed = 'gpt-4-vision-preview';
      }
      
      // HOTFIX: Obtener identidad del usuario si está autenticado
      let userIdentity = null;
      let identitySource = 'none';
      if (req.user?.id) {
        try {
          userIdentity = await getUserIdentity(req.user.id);
          identitySource = userIdentity ? 'db' : 'fallback';
        } catch (err) {
          console.error('[USER PROFILE] Error loading profile:', err);
          identitySource = 'fallback';
        }
      }
      
      // Logs mínimos (sin PII)
      console.log(`[IDENTITY] hasAuthHeader=${!!req.headers.authorization}, user_uuid=${req.user?.id || 'N/A'}, identity_injected=${!!req.user?.id}, identity_source=${identitySource}`);
      
      const assistantRequest: AssistantRequest = {
        messages: finalMessages,
        mode: mode as any,
        workspaceId: workspaceId,
        userId: userId,
        userIdentity: userIdentity
      };
      
      const response = await openaiProvider.chat(assistantRequest);
      answer = response.content;
      assistantTokens = estimateTokens(answer);
      modelUsed = response.raw?.model || 'gpt-4';
      
      console.log(`[OPENAI] ✓ Respuesta recibida (${assistantTokens} tokens aprox)`);
    } catch (openaiError: any) {
      console.error('[OPENAI] ERROR:', openaiError);
      
      // Intentar guardar el error en ae_requests
      try {
        await supabase.from('ae_requests').insert({
          session_id: sessionId,
          endpoint: '/api/ai/chat',
          method: 'POST',
          status_code: 500,
          response_time: Date.now() - startTime,
          tokens_used: userTokens,
          cost: 0,
          metadata: {
            error: openaiError.message || 'OpenAI error',
            userId: userId
          }
        });
      } catch (logError) {
        console.error('[DB] Error logging request:', logError);
      }
      
      return res.status(500).json({
        answer: 'Error al comunicarse con OpenAI. Por favor intenta de nuevo.',
        session_id: sessionId,
        memories_to_add: []
      });
    }
    
    // ============================================
    // D) INSERTAR MENSAJE DEL ASSISTANT
    // ============================================
    
    const assistantMessageId = uuidv4();
    const totalTokens = userTokens + assistantTokens;
    const estimatedCostValue = estimateCost(userTokens, assistantTokens, modelUsed);
    
    const { error: assistantMessageError } = await supabase
      .from('ae_messages')
      .insert({
        id: assistantMessageId,
        session_id: sessionId,
        role: 'assistant',
        content: answer,
        tokens: assistantTokens,
        cost: estimatedCostValue,
        user_id_uuid: null,
        metadata: {
          source: 'aleon',
          model: modelUsed,
          workspaceId: workspaceId,
          mode: mode
        }
      });
    
    if (assistantMessageError) {
      console.error('[DB] ERROR guardando mensaje assistant:', assistantMessageError);
      // NO romper el chat, continuar
    } else {
      console.log(`[DB] ✓ Mensaje assistant guardado: ${assistantMessageId}`);
    }
    
    // ============================================
    // E) ACTUALIZAR SESIÓN
    // ============================================
    
    try {
      // Primero obtener valores actuales
      const { data: currentSession } = await supabase
        .from('ae_sessions')
        .select('total_messages, total_tokens, estimated_cost')
        .eq('id', sessionId)
        .single();
      
      const currentMessages = currentSession?.total_messages || 0;
      const currentTokens = currentSession?.total_tokens || 0;
      const currentCost = currentSession?.estimated_cost || 0;
      
      const { error: updateError } = await supabase
        .from('ae_sessions')
        .update({
          updated_at: new Date().toISOString(),
          last_message_at: new Date().toISOString(),
          total_messages: currentMessages + 2, // user + assistant
          total_tokens: currentTokens + totalTokens,
          estimated_cost: currentCost + estimatedCostValue
        })
        .eq('id', sessionId);
      
      if (updateError) {
        console.error('[DB] ERROR actualizando sesión:', updateError);
      } else {
        console.log(`[DB] ✓ Sesión actualizada: +2 mensajes, +${totalTokens} tokens`);
      }
    } catch (updateErr) {
      console.error('[DB] Error actualizando sesión:', updateErr);
      // NO romper el chat
    }
    
    // ============================================
    // F) LOG DE REQUEST (RECOMENDADO)
    // ============================================
    
    try {
      const responseTime = Date.now() - startTime;
      
      await supabase.from('ae_requests').insert({
        session_id: sessionId,
        endpoint: '/api/ai/chat',
        method: 'POST',
        status_code: 200,
        response_time: responseTime,
        tokens_used: totalTokens,
        cost: estimatedCostValue,
        metadata: {
          model: modelUsed,
          userId: userId,
          workspaceId: workspaceId,
          mode: mode
        }
      });
      
      console.log(`[DB] ✓ Request logged (${responseTime}ms)`);
    } catch (logError) {
      console.error('[DB] Error logging request:', logError);
      // NO romper el chat
    }
    
    // ============================================
    // G) RESPUESTA AL FRONTEND
    // ============================================
    
    const totalTime = Date.now() - startTime;
    console.log(`[CHAT] ✓ Completado en ${totalTime}ms`);
    console.log('[CHAT] ==================== FIN SOLICITUD ====================\n');
    
    res.json({
      answer: answer,
      session_id: sessionId,
      memories_to_add: []
    });
    
  } catch (error: any) {
    console.error('[CHAT] ERROR CRÍTICO:', error);
    
    res.status(500).json({
      answer: 'Error interno del servidor',
      session_id: sessionId,
      memories_to_add: []
    });
  }
});

/**
 * GET /api/ai/ping
 * Health check
 */
router.get('/ping', (req, res) => {
  res.json({
    status: 'AL-E CORE ONLINE',
    timestamp: new Date().toISOString(),
    version: '2.0-SUPABASE-GUARANTEED'
  });
});

export default router;
