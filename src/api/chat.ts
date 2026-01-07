import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabase';
import { env } from '../config/env';
import { isUuid, makeTitleFromText, safeJson, estimateTokens, estimateCost } from '../utils/helpers';
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
import { Orchestrator } from '../ai/orchestrator';
import { ALEON_SYSTEM_PROMPT } from '../ai/prompts/aleon';
import { generate as llmGenerate, verifyOpenAIBlocked } from '../llm/router';
import { applyAntiLieGuardrail } from '../guards/noFakeTools';

const router = express.Router();
const orchestrator = new Orchestrator();

// Anti-duplicado: request_id tracking (30s TTL)
const recentRequests = new Map<string, number>();

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
    
    // CRITICAL: Verificar que OpenAI está bloqueado
    const openaiCheck = verifyOpenAIBlocked();
    console.log(`[CHAT] OpenAI Status: ${openaiCheck.message}`);
    
    // Anti-duplicado: request_id
    const request_id = req.body.request_id || uuidv4();
    const now = Date.now();
    
    if (recentRequests.has(request_id)) {
      const timestamp = recentRequests.get(request_id)!;
      if (now - timestamp < 30000) { // 30s
        console.warn(`[CHAT] ⚠️ Duplicate request detected: ${request_id}`);
        return res.status(409).json({
          error: 'DUPLICATE_REQUEST',
          message: 'Request already processed recently',
          request_id,
          session_id: null,
          memories_to_add: []
        });
      }
    }
    
    recentRequests.set(request_id, now);
    
    // Cleanup old entries (> 2min)
    for (const [rid, timestamp] of recentRequests.entries()) {
      if (now - timestamp > 120000) {
        recentRequests.delete(rid);
      }
    }
    
    // Obtener userId (autenticado o del body)
    const authenticatedUserId = getUserId(req);
    
    let {
      workspaceId = env.defaultWorkspaceId,
      userId: bodyUserId,
      mode = env.defaultMode,
      sessionId: requestSessionId,
      messages,
      userEmail,  // P0: Multi-user collaboration
      userDisplayName  // P0: Multi-user collaboration
    } = req.body;
    
    // Prioridad: usuario autenticado > userId del body
    const userId = authenticatedUserId || bodyUserId;
    
    // Resolver user_id_uuid desde JWT (producción real)
    const user_id_uuid = req.user?.id || null;
    
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
          user_id_uuid: user_id_uuid, // Production: Resolver desde JWT
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
        // P0 FIX: NO abortar conversación por error de sesión
        // Continuar sin sesión (sessionId = null) → conversación stateless
        console.warn('[DB] ⚠️ Continuando sin sesión (stateless mode)');
        sessionId = null;
      } else {
        sessionId = newSession.id;
        console.log(`[CHAT] Nueva sesión creada: ${sessionId} - "${title}"`);
      }
    }
    
    // ============================================
    // A4) RECONSTRUIR HISTORIAL DESDE SUPABASE
    // ============================================
    
    console.log('[CHAT] 📚 Reconstructing conversation history from Supabase...');
    
    const { data: historyData, error: historyError } = await supabase
      .from('ae_messages')
      .select('role, content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(50); // Últimos 50 mensajes
    
    if (historyError) {
      console.error('[CHAT] Error loading history:', historyError);
    }
    
    const storedHistory = historyData || [];
    console.log(`[CHAT] ✓ Loaded ${storedHistory.length} messages from database`);
    
    // Reconstruir messages array desde historial + nuevo mensaje del usuario
    const reconstructedMessages = [
      ...storedHistory.map((h: any) => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent }
    ];
    
    // IMPORTANTE: Usar historial reconstruido, NO el del frontend
    messages = reconstructedMessages;
    console.log(`[CHAT] 📝 Using reconstructed history: ${messages.length} messages total`);
    
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
        user_id_uuid: user_id_uuid, // Production: Resolver desde JWT
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
    let knowledgeSources: any[] = []; // Declarar aquí para que esté disponible en la respuesta
    
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
    // C2) RECUPERAR CONOCIMIENTO VECTORIAL (BGE-M3)
    // ============================================
    
    console.log('[KNOWLEDGE] Recuperando conocimiento vectorial (BGE-M3)...');
    let vectorKnowledgeContext = '';
    // knowledgeSources ya declarado arriba
    
    try {
      // Extraer último mensaje del usuario para búsqueda
      const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
      const searchQuery = lastUserMessage?.content || '';
      
      if (!searchQuery) {
        console.log('[KNOWLEDGE] No hay mensaje del usuario para buscar');
      } else {
        // Generar embedding como array (no string)
        const { generateEmbedding } = await import('../services/embeddingService');
        const queryEmbedding = await generateEmbedding(searchQuery);
        
        const { data: vectorResults, error: vectorError } = await supabase.rpc('search_knowledge', {
          query_embedding: queryEmbedding,
          match_threshold: 0.7,
          match_count: 5
        });
        
        if (vectorError) {
          console.error('[KNOWLEDGE] Error en búsqueda vectorial:', vectorError);
        } else if (vectorResults && vectorResults.length > 0) {
          // Formatear contexto documental
          vectorKnowledgeContext = '\n\n🔍 CONOCIMIENTO DOCUMENTADO (Evidencia Real):\n\n';
          vectorKnowledgeContext += vectorResults.map((r: any, i: number) => {
            knowledgeSources.push({
              path: r.source_path,
              type: r.source_type,
              score: r.score
            });
            return `[Documento ${i + 1}: ${r.source_path}]\n${r.content}\n(Relevancia: ${(r.score * 100).toFixed(1)}%)`;
          }).join('\n\n---\n\n');
          
          console.log(`[KNOWLEDGE] ✓ ${vectorResults.length} documento(s) relevante(s) encontrado(s)`);
        } else {
          console.log('[KNOWLEDGE] No se encontró documentación relevante (threshold 0.7)');
        }
      }
    } catch (vectorError) {
      console.error('[KNOWLEDGE] Error recuperando documentación:', vectorError);
      // No romper el chat si falla la búsqueda vectorial
    }
    
    // ============================================
    // D) LLAMAR A OPENAI (CON ATTACHMENTS + CHUNKS)
    // ============================================
    
    console.log('[OPENAI] Enviando request...');
    
    let answer = '';
    let assistantTokens = 0;
    let modelUsed = 'gpt-4';
    let orchestratorContext: any = null; // Declarar fuera del try para acceso global
    let llmResponse: any = null; // Router response
    let providerUsed = 'groq'; // Default
    let fallbackUsed = false;
    let fallbackChain: string[] = [];
    let guardrailResult: any = null; // Guardrail result
    
    try {
      // Preparar mensajes con contexto de attachments Y chunks
      let finalMessages = [...messages];
      
      // Combinar conocimiento entrenable + vectorial
      const combinedKnowledge = [knowledgeContext, vectorKnowledgeContext].filter(Boolean).join('\n\n');
      
      // Si hay conocimiento (entrenable o vectorial), inyectarlo como contexto del sistema
      if (combinedKnowledge) {
        // Buscar si ya hay un mensaje system
        const systemMsgIndex = finalMessages.findIndex(m => m.role === 'system');
        
        if (systemMsgIndex >= 0) {
          // Agregar al mensaje system existente
          finalMessages[systemMsgIndex] = {
            ...finalMessages[systemMsgIndex],
            content: finalMessages[systemMsgIndex].content + '\n\n' + combinedKnowledge
          };
        } else {
          // Crear nuevo mensaje system al inicio
          finalMessages = [
            {
              role: 'system',
              content: combinedKnowledge
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
      
      // ============================================
      // C2) ORCHESTRATOR: Pipeline completo + Cost Control
      // ============================================
      
      console.log('[ORCH] Starting orchestration pipeline...');
      
      // COST CONTROL: Limitar historial a 16 mensajes
      const limitedMessages = orchestrator.limitMessageHistory(finalMessages);
      
      orchestratorContext = await orchestrator.orchestrate({
        messages: limitedMessages,
        userId: req.user?.id || userId || 'guest',
        workspaceId: workspaceId,
        projectId: workspaceId, // Usar workspaceId como projectId por ahora
        sessionId: sessionId || undefined,
        mode: mode
      }, ALEON_SYSTEM_PROMPT);
      
      // POLÍTICA ANTI-MENTIRA: Si es pregunta técnica/específica y NO hay documentación, advertir
      let antiLieWarning = '';
      if (knowledgeSources.length === 0 && !knowledgeContext) {
        // Extraer último mensaje para análisis
        const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
        const userQuery = lastUserMessage?.content || '';
        
        // Detectar si es pregunta técnica (contiene palabras clave)
        const technicalKeywords = /cómo funciona|implementación|código|función|endpoint|módulo|sistema|arquitectura|base de datos|api/i;
        if (technicalKeywords.test(userQuery)) {
          antiLieWarning = `

⚠️ ADVERTENCIA CRÍTICA - POLÍTICA ANTI-MENTIRA:
- No se encontró documentación específica sobre este tema
- NO inventes detalles técnicos, implementaciones o código
- Si no tienes evidencia concreta, di claramente: "No tengo documentación específica sobre esto. Necesito que me proporciones el archivo o documento relevante."
- Puedes dar contexto general SOLO si estás 100% seguro
- PROHIBIDO especular sobre implementaciones sin evidencia`;
          
          console.log('[KNOWLEDGE] ⚠️ Pregunta técnica sin documentación - Aplicando política anti-mentira');
        }
      }
      
      // Agregar warning al system prompt si aplica
      if (antiLieWarning) {
        orchestratorContext.systemPrompt += antiLieWarning;
      }
      
      // Usar el system prompt generado por el orchestrator
      const finalMessagesWithSystem = [
        {
          role: 'system',
          content: orchestratorContext.systemPrompt
        },
        ...finalMessages.filter(m => m.role !== 'system')
      ];
      
      // Si hay imágenes, usar formato multimodal (GPT-4 Vision)
      if (imageUrls.length > 0) {
        console.warn('[CHAT] ⚠️ Image URLs detected - multimodal NOT supported in new router yet');
        // TODO: Implementar soporte multimodal en router si se necesita
      }
      
      // Usar modelo decidido por el orchestrator
      modelUsed = orchestratorContext.modelSelected;
      
      // ============================================
      // C3) TOOL CALLING: Preparar herramientas disponibles
      // ============================================
      
      const { getToolsForContext } = await import('../ai/tools/toolDefinitions');
      
      // Extraer último mensaje de usuario
      const lastUserMessage = [...finalMessages].reverse().find((m: any) => m.role === 'user');
      const userQuery = lastUserMessage?.content || '';
      
      // 🔥 HOT FIX: SIEMPRE pasar TODAS las herramientas
      // El LLM decide cuándo usarlas, NO el orchestrator
      const { ALL_TOOLS } = await import('../ai/tools/toolDefinitions');
      const toolsAvailable = ALL_TOOLS;
      
      console.log(`[CHAT] 🔧 HOT FIX: Passing ALL ${toolsAvailable.length} tools to LLM (LLM decides when to use them)`);
      
      // ============================================
      // C4) LLAMAR AL TOOL LOOP (CON FUNCTION CALLING)
      // ============================================
      
      console.log(`[CHAT] Calling LLM with tool loop, model: ${modelUsed}`);
      
      const conversationMessages = [
        ...finalMessages.filter(m => m.role !== 'system').map(m => ({
          role: m.role,
          content: m.content
        }))
      ];
      
      // Usar tool loop del orchestrator
      const toolLoopResult = await orchestrator.executeToolLoop(
        userId,
        conversationMessages,
        orchestratorContext.systemPrompt,
        toolsAvailable,
        modelUsed,
        3  // Max 3 iteraciones
      );
      
      // Formatear respuesta para compatibilidad con código existente
      llmResponse = {
        response: {
          text: toolLoopResult.content,
          tokens_in: 0,  // TODO: Calcular tokens reales
          tokens_out: 0,  // TODO: Calcular tokens reales
          provider_used: 'groq',
          model_used: modelUsed
        },
        fallbackChain: {
          fallback_used: false,
          attempted: []
        }
      };
      
      providerUsed = 'groq';
      fallbackUsed = false;
      fallbackChain = [];
      
      console.log(`[CHAT] ✓ LLM response received with ${toolLoopResult.toolExecutions.length} tool execution(s)`);
      
      // Log tool executions
      if (toolLoopResult.toolExecutions.length > 0) {
        console.log(`[CHAT] 🔧 Tools executed:`);
        toolLoopResult.toolExecutions.forEach((te: any) => {
          console.log(`[CHAT]    - ${te.tool}: ${te.success ? 'SUCCESS' : 'FAILED'}`);
        });
      }
      
      // ============================================
      // C5) P1: EXTRACCIÓN REAL DE DATOS (Web Search)
      // ============================================
      
      // Si usó web search Y la respuesta tiene >3 links, rechazar y regenerar
      if (orchestratorContext.webSearchUsed && orchestratorContext.intent.intent_type === 'time_sensitive') {
        const linkCount = (llmResponse.response.text.match(/https?:\/\//g) || []).length;
        
        if (linkCount > 3) {
          console.log(`[WEB_SEARCH] ⚠️ Response contains ${linkCount} links - REGENERATING with extraction prompt`);
          
          // Re-generar con prompt forzado
          const extractionMessages = [
            { role: 'system', content: `${orchestratorContext.systemPrompt}

⛔ INSTRUCCIÓN CRÍTICA:
- La búsqueda web YA se ejecutó
- Los datos están disponibles en el contexto
- Extrae SOLO datos concretos: precios, fechas, horas, números
- NO devuelvas links
- NO digas "visita este sitio"
- Responde con los DATOS EXTRAÍDOS directamente

Ejemplo bueno: "El dólar está a $20.50 MXN según el último reporte."
Ejemplo malo: "Visita https://... para ver el precio."` },
            ...limitedMessages
          ];
          
          llmResponse = await llmGenerate({
            messages: extractionMessages as any,
            temperature: 0.7,
            maxTokens: 600,
            model: modelUsed
          });
          
          providerUsed = llmResponse.response.provider_used;
          console.log(`[WEB_SEARCH] ✓ Regenerated response without links`);
        }
      }
      
      // ============================================
      // C4) APLICAR GUARDRAIL ANTI-MENTIRAS (P0 REFUERZO)
      // ============================================
      
      guardrailResult = applyAntiLieGuardrail(
        llmResponse.response.text,
        orchestratorContext.webSearchUsed,
        orchestratorContext.intent,
        orchestratorContext.toolFailed,
        orchestratorContext.toolError  // P0: Pasar código de error OAuth
      );
      
      if (guardrailResult.sanitized) {
        console.log(`[GUARDRAIL] 🛡️ Response sanitized: ${guardrailResult.reason}`);
      }
      
      answer = guardrailResult.text;
      
      // ============================================
      // C4.5) GUARDRAIL ANTI-MENTIRAS CON EVIDENCIA (P0 HOY)
      // ============================================
      
      const { validateLLMResponse } = await import('../services/responseValidator');
      const { executeAction } = await import('../services/actionGateway');
      
      // Reconstruir actionResult desde orchestratorContext
      const actionResultFromContext = orchestratorContext.toolUsed !== 'none' ? {
        success: !orchestratorContext.toolFailed,
        action: orchestratorContext.toolUsed,
        evidence: null, // TODO: pasar evidence desde orchestrator
        userMessage: orchestratorContext.toolResult || '',
        reason: orchestratorContext.toolError
      } : undefined;
      
      const validationResult = validateLLMResponse(
        answer,
        orchestratorContext.intent,
        actionResultFromContext
      );
      
      if (!validationResult.valid) {
        console.error(`[RESPONSE_VALIDATOR] ❌ LLM RESPONSE REJECTED: ${validationResult.reason}`);
        answer = validationResult.correctedResponse || answer;
        console.log(`[RESPONSE_VALIDATOR] ✓ Response corrected to: "${answer.substring(0, 100)}..."`);
      }
      
      assistantTokens = llmResponse.response.tokens_out || estimateTokens(answer);
      
      // Actualizar output tokens en context
      orchestratorContext.outputTokens = assistantTokens;
      
      console.log(`[ORCH] ✓ Response received (${assistantTokens} tokens)`);
      console.log(`[ORCH] Final metrics: auth=${orchestratorContext.isAuthenticated} tool=${orchestratorContext.toolUsed} model=${orchestratorContext.modelSelected} mem=${orchestratorContext.memoryCount} rag=${orchestratorContext.ragHits} web=${orchestratorContext.webSearchUsed} web_results=${orchestratorContext.webResultsCount} in_tokens=${orchestratorContext.inputTokens} out_tokens=${orchestratorContext.outputTokens}`);
    } catch (llmError: any) {
      console.error('[LLM] ERROR:', llmError);
      
      // P0: Log obligatorio de errores en ae_requests
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
            error: llmError.message || 'LLM error',
            error_type: llmError.name || 'LLMError',
            intent_detected: orchestratorContext?.intent?.intent_type,
            tool_expected: orchestratorContext?.toolUsed,
            tool_executed: false,
            failure_reason: orchestratorContext?.toolError || llmError.message,
            userId: userId
          }
        });
      } catch (logError) {
        console.error('[DB] Error logging request:', logError);
      }
      
      return res.status(500).json({
        answer: 'Error al comunicarse con el modelo de IA. Por favor intenta de nuevo.',
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
    // F) LOG DE REQUEST (PRODUCCIÓN - AUDITORÍA COMPLETA)
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
          // Request tracking
          request_id: request_id,
          
          // Intent Classification (NUEVO)
          intent_type: orchestratorContext.intent.intent_type,
          intent_confidence: orchestratorContext.intent.confidence,
          answer_mode: orchestratorContext.answerMode,
          
          // Provider y modelo REAL del router
          provider_used: providerUsed,
          model_used: llmResponse.response.model_used,
          fallback_used: fallbackUsed,
          fallback_chain: fallbackChain,
          fallback_reason: fallbackUsed ? llmResponse.fallbackChain.errors[fallbackChain[0]] : null,
          
          // Tokens detallados
          tokens_in: llmResponse.response.tokens_in || orchestratorContext.inputTokens,
          tokens_out: llmResponse.response.tokens_out || orchestratorContext.outputTokens,
          max_output_tokens: orchestratorContext.maxOutputTokens,
          
          // Tools y memoria (P0: Observabilidad de fallos)
          tool_used: orchestratorContext.toolUsed,
          tool_failed: orchestratorContext.toolFailed,
          tool_error: orchestratorContext.toolError || null,  // P0: LOG OBLIGATORIO para OAuth failures
          web_search_used: orchestratorContext.webSearchUsed,
          web_results_count: orchestratorContext.webResultsCount,
          memories_loaded: orchestratorContext.memoryCount,
          rag_hits: orchestratorContext.ragHits,
          
          // Guardrail
          guardrail_sanitized: guardrailResult.sanitized,
          guardrail_reason: guardrailResult.reason || null,
          
          // Performance
          cache_hit: orchestratorContext.cacheHit,
          latency_ms: responseTime,
          
          // Context
          userId: userId,
          workspaceId: workspaceId,
          mode: mode,
          authenticated: orchestratorContext.isAuthenticated
        }
      });
      
      console.log(`[DB] ✓ Request logged (${responseTime}ms) - ${providerUsed}/${llmResponse.response.model_used}`);
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

/**
 * =====================================================
 * POST /api/ai/chat/v2
 * =====================================================
 * 
 * P0 REFACTOR: CORE ES LA ÚNICA FUENTE DE VERDAD
 * 
 * CAMBIOS CRÍTICOS:
 * - Acepta UN SOLO mensaje (no array)
 * - Reconstruye contexto desde Supabase (historial + memories)
 * - Timeout defensivo para acciones (15s)
 * - No confía en historial del frontend
 * 
 * PAYLOAD MÍNIMO:
 * {
 *   message: string,
 *   sessionId: string,
 *   workspaceId?: string,
 *   meta?: object
 * }
 */
router.post('/chat/v2', optionalAuth, async (req, res) => {
  const startTime = Date.now();
  let sessionId: string | null = null;
  
  // P0: Declarar orchestratorContext EN SCOPE DEL ENDPOINT (fuera del try principal)
  let orchestratorContext: any = null;
  
  // P0: Declarar userEmail y userDisplayName en scope del endpoint
  let userEmail: string | undefined;
  let userDisplayName: string | undefined;
  
  try {
    console.log('\n[CHAT_V2] ==================== NUEVA SOLICITUD ====================');
    
    // CRITICAL: Verificar que OpenAI está bloqueado
    const openaiCheck = verifyOpenAIBlocked();
    console.log(`[CHAT_V2] OpenAI Status: ${openaiCheck.message}`);
    
    // ============================================
    // 1. VALIDAR PAYLOAD MÍNIMO
    // ============================================
    
    const { 
      message, 
      sessionId: requestSessionId, 
      workspaceId, 
      meta 
    } = req.body;
    
    // P0: Extraer userEmail y userDisplayName del payload (multi-user collaboration)
    userEmail = req.body.userEmail;
    userDisplayName = req.body.userDisplayName;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        error: 'INVALID_PAYLOAD',
        message: 'Campo "message" es requerido y debe ser string',
        session_id: null,
        memories_to_add: []
      });
    }
    
    // Anti-duplicado: request_id
    const request_id = req.body.request_id || uuidv4();
    const now = Date.now();
    
    if (recentRequests.has(request_id)) {
      const timestamp = recentRequests.get(request_id)!;
      if (now - timestamp < 30000) { // 30s
        console.warn(`[CHAT_V2] ⚠️ Duplicate request detected: ${request_id}`);
        return res.status(409).json({
          error: 'DUPLICATE_REQUEST',
          message: 'Request already processed recently',
          request_id,
          session_id: null,
          memories_to_add: []
        });
      }
    }
    
    recentRequests.set(request_id, now);
    
    // Cleanup old entries
    for (const [rid, timestamp] of recentRequests.entries()) {
      if (now - timestamp > 120000) {
        recentRequests.delete(rid);
      }
    }
    
    // ============================================
    // 2. RESOLVER USER_ID (JWT o body)
    // ============================================
    
    const authenticatedUserId = getUserId(req);
    const userId = authenticatedUserId || req.body.userId;
    const user_id_uuid = req.user?.id || null;
    
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        error: 'MISSING_USER_ID',
        message: 'userId es requerido (JWT o body)',
        session_id: null,
        memories_to_add: []
      });
    }
    
    console.log(`[CHAT_V2] userId: ${userId}, authenticated: ${!!req.user}`);
    
    // ============================================
    // 3. RESOLVER SESSION (crear si no existe)
    // ============================================
    
    const finalWorkspaceId = workspaceId || env.defaultWorkspaceId;
    
    if (requestSessionId && isUuid(requestSessionId)) {
      // Session existente
      sessionId = requestSessionId;
      console.log(`[CHAT_V2] Using existing session: ${sessionId}`);
    } else {
      // Crear nueva session
      sessionId = uuidv4();
      
      // USAR 'id' (no 'session_id') porque el schema usa id como PK
      const { error: sessionError } = await supabase
        .from('ae_sessions')
        .insert({
          id: sessionId,  // PK de la tabla
          assistant_id: 'al-e-core',  // P0 CRÍTICO: NOT NULL constraint
          user_id: userId,
          workspace_id: finalWorkspaceId,
          mode: 'universal',
          title: 'Nueva conversación',
          last_message_at: new Date().toISOString(),
          meta: {}  // Columna JSONB agregada
        });
      
      if (sessionError) {
        console.error('[CHAT_V2] Error creating session:', sessionError);
        // P0 FIX: NO abortar conversación por error de sesión
        // Continuar sin sesión (sessionId = null) → conversación stateless
        console.warn('[CHAT_V2] ⚠️ Continuando sin sesión (stateless mode)');
        sessionId = null;
      } else {
        console.log(`[CHAT_V2] ✓ New session created: ${sessionId}`);
      }
    }
    
    // ============================================
    // 4. RECONSTRUIR CONTEXTO DESDE SUPABASE
    // ============================================
    
    console.log('[CHAT_V2] 📚 Reconstructing context from Supabase...');
    
    // 4.1: Cargar historial de mensajes (P0: incluir user_email y user_display_name)
    const { data: historyData, error: historyError } = await supabase
      .from('ae_messages')
      .select('role, content, user_email, user_display_name, created_at')  // P0: Multi-user
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .limit(50); // Últimos 50 mensajes
    
    if (historyError) {
      console.error('[CHAT_V2] Error loading history:', historyError);
    }
    
    const history = historyData || [];
    console.log(`[CHAT_V2] ✓ Loaded ${history.length} messages from history`);
    if (history.length > 0) {
      console.log(`[CHAT_V2] 📜 History sample - First: "${history[0].content.substring(0, 50)}...", Last: "${history[history.length - 1].content.substring(0, 50)}..."`);
    }
    
    // 4.2: Cargar memories del usuario
    const { data: memoriesData, error: memoriesError } = await supabase
      .from('assistant_memories')
      .select('memory, importance, created_at')
      .or(`user_id_uuid.eq.${userId},user_id.eq.${userId}`)
      .eq('workspace_id', finalWorkspaceId)
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (memoriesError) {
      console.error('[CHAT_V2] Error loading memories:', memoriesError);
    }
    
    const memories = memoriesData || [];
    console.log(`[CHAT_V2] ✓ Loaded ${memories.length} memories`);
    
    // ============================================
    // 5. INSERTAR MENSAJE DEL USUARIO
    // ============================================
    
    const userMessageId = uuidv4();
    const { error: insertUserError } = await supabase
      .from('ae_messages')
      .insert({
        id: userMessageId,  // PK
        session_id: sessionId,  // FK a ae_sessions(id)
        role: 'user',
        content: message,
        user_email: userEmail || null,  // P0: Multi-user collaboration
        user_display_name: userDisplayName || null,  // P0: Multi-user collaboration
        metadata: {  // FIXED: usar 'metadata' en vez de 'meta'
          user_id: userId,
          user_id_uuid,
          workspace_id: finalWorkspaceId,
          tokens: estimateTokens(message)
        },
        created_at: new Date().toISOString()
      });
    
    if (insertUserError) {
      console.error('[CHAT_V2] Error inserting user message:', insertUserError);
      throw new Error('Failed to save user message');
    }
    
    console.log(`[CHAT_V2] ✓ User message saved: ${userMessageId}`);
    
    // ============================================
    // 5.5. RECUPERAR CONOCIMIENTO VECTORIAL (BGE-M3)
    // ============================================
    
    console.log('[CHAT_V2] 🔍 Recuperando conocimiento vectorial...');
    let vectorKnowledgeContext = '';
    let knowledgeSources: any[] = [];
    
    try {
      const { generateEmbedding } = await import('../services/embeddingService');
      const queryEmbedding = await generateEmbedding(message);
      
      const { data: vectorResults, error: vectorError } = await supabase.rpc('search_knowledge', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: 5
      });
      
      if (vectorError) {
        console.error('[CHAT_V2] Error en búsqueda vectorial:', vectorError);
      } else if (vectorResults && vectorResults.length > 0) {
        vectorKnowledgeContext = '\n\n🔍 CONOCIMIENTO DOCUMENTADO (Evidencia Real):\n\n';
        vectorKnowledgeContext += vectorResults.map((r: any, i: number) => {
          knowledgeSources.push({
            path: r.source_path,
            type: r.source_type,
            score: r.score
          });
          return `[Documento ${i + 1}: ${r.source_path}]\n${r.content}\n(Relevancia: ${(r.score * 100).toFixed(1)}%)`;
        }).join('\n\n---\n\n');
        
        console.log(`[CHAT_V2] ✓ ${vectorResults.length} documento(s) relevante(s)`);
      } else {
        console.log('[CHAT_V2] No se encontró documentación relevante');
      }
    } catch (vectorError) {
      console.error('[CHAT_V2] Error recuperando documentación:', vectorError);
    }
    
    // POLÍTICA ANTI-MENTIRA para preguntas técnicas
    let antiLieWarning = '';
    if (knowledgeSources.length === 0) {
      const technicalKeywords = /cómo funciona|implementación|código|función|endpoint|módulo|sistema|arquitectura|base de datos|api/i;
      if (technicalKeywords.test(message)) {
        antiLieWarning = `\n\n⚠️ ADVERTENCIA - POLÍTICA ANTI-MENTIRA: No se encontró documentación específica. NO inventes detalles técnicos. Si no tienes evidencia, di: "No tengo documentación sobre esto. Necesito que me proporciones el archivo relevante."`;
        console.log('[CHAT_V2] ⚠️ Pregunta técnica sin documentación - Aplicando política anti-mentira');
      }
    }
    
    // ============================================
    // 6. ORQUESTACIÓN (Intent + Tools + LLM)
    // ============================================
    
    console.log('[CHAT_V2] 🧠 Starting orchestration...');
    
    // P0: Construir messages array para orchestrator CON NOMBRES DE USUARIO
    let lastUserEmail: string | null = null;
    const messagesForOrchestrator = history.map((h: any) => {
      if (h.role === 'user' && h.user_display_name) {
        // Detectar cambio de usuario
        const userChanged = lastUserEmail && lastUserEmail !== h.user_email;
        lastUserEmail = h.user_email;
        
        if (userChanged) {
          return {
            role: 'user',
            content: `[${h.user_display_name} se une a la conversación]\n${h.user_display_name}: ${h.content}`
          };
        }
        
        return {
          role: 'user',
          content: `${h.user_display_name}: ${h.content}`
        };
      }
      return { role: h.role, content: h.content };
    });
    
    // Agregar mensaje actual con nombre del usuario
    const currentUserName = userDisplayName || userEmail?.split('@')[0] || 'Usuario';
    const currentUserChanged = lastUserEmail && lastUserEmail !== userEmail;
    
    if (currentUserChanged) {
      messagesForOrchestrator.push({
        role: 'user',
        content: `[${currentUserName} se une a la conversación]\n${currentUserName}: ${message}`
      });
    } else {
      messagesForOrchestrator.push({
        role: 'user',
        content: userDisplayName ? `${currentUserName}: ${message}` : message
      });
    }
    
    const orchestratorRequest = {
      userId,
      workspaceId: finalWorkspaceId,
      projectId: null,
      sessionId,
      messages: messagesForOrchestrator,
      attachments: []
    };
    
    // TIMEOUT DEFENSIVO: 15s para acciones
    const orchestrationPromise = orchestrator.orchestrate(orchestratorRequest as any, ALEON_SYSTEM_PROMPT);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('ORCHESTRATION_TIMEOUT')), 15000)
    );
    
    try {
      orchestratorContext = await Promise.race([orchestrationPromise, timeoutPromise]);
      
      // Inyectar conocimiento vectorial + anti-mentira en system prompt
      if (vectorKnowledgeContext || antiLieWarning) {
        orchestratorContext.systemPrompt += (vectorKnowledgeContext + antiLieWarning);
      }
    } catch (error: any) {
      if (error.message === 'ORCHESTRATION_TIMEOUT') {
        console.warn('[CHAT_V2] ⏱️ Orchestration timeout - returning fallback');
        
        // Respuesta fallback para acciones lentas
        const fallbackMessage = 'Estoy procesando tu solicitud, te confirmo enseguida.';
        
        const assistantMessageId = uuidv4();
        await supabase.from('ae_messages').insert({
          id: assistantMessageId,
          session_id: sessionId,
          role: 'assistant',
          content: fallbackMessage,
          meta: {
            user_id: userId,
            user_id_uuid,
            workspace_id: finalWorkspaceId,
            tokens: estimateTokens(fallbackMessage),
            timeout: true
          },
          created_at: new Date().toISOString()
        });
        
        return res.json({
          answer: fallbackMessage,
          session_id: sessionId,
          memories_to_add: [],
          metadata: {
            timeout: true,
            latency_ms: Date.now() - startTime
          }
        });
      }
      
      // Otros errores de orquestación - loguear y lanzar
      console.error('[CHAT_V2] ❌ Orchestration error:', error);
      throw error;
    }
    
    console.log(`[CHAT_V2] ✓ Orchestration completed`);
    
    // ============================================
    // 6.5. P0 CRÍTICO: SI TOOL EXITOSO (Gmail), DEVOLVER DIRECTAMENTE
    // ============================================
    
    // P0 FIX: Si Gmail/Calendar ejecutó OK, NO llamar al LLM (evita alucinaciones)
    if (orchestratorContext.toolUsed === 'check_email' && !orchestratorContext.toolFailed && orchestratorContext.toolResult) {
      console.log('[CHAT_V2] 🔒 Tool exitoso - Devolviendo toolResult directamente (sin LLM)');
      
      // Extraer datos del toolResult (está en formato markdown con separadores)
      const toolResultText = orchestratorContext.toolResult;
      
      // El toolResult tiene formato:
      // ═══════════════════════════════════════════════════════════════
      // ⚠️ RESULTADOS DE GMAIL (DATOS REALES - OBLIGATORIO USAR) ⚠️
      // ...
      // - De: X
      // - Asunto: Y
      // - Fecha: Z
      
      // Construir respuesta limpia para el usuario
      const answer = toolResultText
        .replace(/═+/g, '')
        .replace(/⚠️ RESULTADOS DE GMAIL \(DATOS REALES - OBLIGATORIO USAR\) ⚠️/g, '')
        .replace(/Acabas de ejecutar exitosamente Gmail API\./g, '')
        .replace(/Los siguientes correos fueron obtenidos DIRECTAMENTE de la cuenta del usuario:/g, 'Estos son tus correos recientes:')
        .replace(/INSTRUCCIÓN CRÍTICA:[\s\S]*$/g, '') // Eliminar instrucciones para LLM
        .trim();
      
      // Guardar respuesta en BD
      const assistantMessageId = uuidv4();
      await supabase.from('ae_messages').insert({
        id: assistantMessageId,
        session_id: sessionId,
        role: 'assistant',
        content: answer,
        metadata: {
          user_id: userId,
          user_id_uuid,
          workspace_id: finalWorkspaceId,
          tokens: estimateTokens(answer),
          tool_used: orchestratorContext.toolUsed,
          direct_tool_response: true // Flag para indicar que NO pasó por LLM
        },
        created_at: new Date().toISOString()
      });
      
      return res.json({
        answer,
        session_id: sessionId,
        memories_to_add: [],
        metadata: {
          latency_ms: Date.now() - startTime,
          direct_tool_response: true,
          tool_used: orchestratorContext.toolUsed
        }
      });
    }
    
    // ============================================
    // 7. LLAMAR AL LLM (solo si no fue tool directo)
    // ============================================
    
    console.log('[CHAT_V2] 🤖 Calling LLM router...');
    
    // Preparar messages con system prompt
    const llmMessages = [
      { role: 'system', content: orchestratorContext.systemPrompt },
      ...messagesForOrchestrator
    ];
    
    const llmResult = await llmGenerate({
      messages: llmMessages as any,
      temperature: 0.7,
      maxTokens: 600,
      model: orchestratorContext.modelSelected
    });
    
    console.log(`[CHAT_V2] ✓ LLM response received from ${llmResult.fallbackChain.final_provider}`);
    
    // ============================================
    // 7.5. P1: EXTRACCIÓN REAL DE DATOS (Web Search)
    // ============================================
    
    // Si usó web search Y la respuesta tiene >3 links, rechazar y regenerar
    if (orchestratorContext.webSearchUsed && orchestratorContext.intent?.intent_type === 'time_sensitive') {
      const linkCount = (llmResult.response.text.match(/https?:\/\//g) || []).length;
      
      if (linkCount > 3) {
        console.log(`[WEB_SEARCH] ⚠️ Response contains ${linkCount} links - REGENERATING with extraction prompt`);
        
        // Re-generar con prompt forzado
        const extractionMessages = [
          { 
            role: 'system', 
            content: `${orchestratorContext.systemPrompt}

⛔ INSTRUCCIÓN CRÍTICA:
- La búsqueda web YA se ejecutó
- Los datos están disponibles en el contexto
- Extrae SOLO datos concretos: precios, fechas, horas, números
- NO devuelvas links
- NO digas "visita este sitio"
- Responde con los DATOS EXTRAÍDOS directamente

Ejemplo bueno: "El dólar está a $20.50 MXN según el último reporte."
Ejemplo malo: "Visita https://... para ver el precio."`
          },
          ...messagesForOrchestrator
        ];
        
        const retryLLM = await llmGenerate({
          messages: extractionMessages as any,
          temperature: 0.7,
          maxTokens: 600,
          model: orchestratorContext.modelSelected
        });
        
        // Reemplazar resultado
        llmResult.response.text = retryLLM.response.text;
        llmResult.response.tokens_out = retryLLM.response.tokens_out;
        
        console.log(`[WEB_SEARCH] ✓ Regenerated response without links`);
      }
    }
    
    // ============================================
    // 8. APLICAR GUARDRAILS (P0 REFUERZO)
    // ============================================
    
    const guardrailResult = applyAntiLieGuardrail(
      llmResult.response.text,
      orchestratorContext.webSearchUsed,
      orchestratorContext.intent,
      orchestratorContext.toolFailed,
      orchestratorContext.toolError  // P0: Pasar código de error OAuth
    );
    
    const finalAnswer = guardrailResult.sanitized 
      ? guardrailResult.text 
      : llmResult.response.text;
    
    if (guardrailResult.sanitized) {
      console.log(`[CHAT_V2] 🛡️ Guardrail applied: ${guardrailResult.reason}`);
    }
    
    // ============================================
    // 9. GUARDAR RESPUESTA DEL ASSISTANT
    // ============================================
    
    const assistantMessageId = uuidv4();
    const { error: insertAssistantError } = await supabase
      .from('ae_messages')
      .insert({
        id: assistantMessageId,  // PK
        session_id: sessionId,  // FK a ae_sessions(id)
        role: 'assistant',
        content: finalAnswer,
        metadata: {  // FIXED: usar 'metadata' en vez de 'meta'
          user_id: userId,
          user_id_uuid,
          workspace_id: finalWorkspaceId,
          tokens: llmResult.response.tokens_out || estimateTokens(finalAnswer),
          model: orchestratorContext.modelSelected,
          provider: llmResult.fallbackChain.final_provider
        },
        created_at: new Date().toISOString()
      });
    
    if (insertAssistantError) {
      console.error('[CHAT_V2] Error inserting assistant message:', insertAssistantError);
    }
    
    // ============================================
    // 10. ACTUALIZAR SESSION
    // ============================================
    
    const totalTokens = 
      (llmResult.response.tokens_in || 0) + 
      (llmResult.response.tokens_out || 0);
    
    // Actualizar last_message_at y metadata (ae_sessions no tiene total_messages/total_tokens como columnas)
    await supabase
      .from('ae_sessions')
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        meta: {
          total_tokens: totalTokens,
          total_cost: estimateCost(totalTokens, orchestratorContext.modelSelected),
          last_model: orchestratorContext.modelSelected,
          last_provider: llmResult.fallbackChain.final_provider
        }
      })
      .eq('id', sessionId);  // WHERE id = sessionId (no 'session_id' column)
    
    // ============================================
    // 11. LOG EN AE_REQUESTS (P0: Observabilidad completa)
    // ============================================
    
    const latency_ms = Date.now() - startTime;
    
    await supabase.from('ae_requests').insert({
      request_id,
      session_id: sessionId,
      user_id: userId,
      user_id_uuid,
      workspace_id: finalWorkspaceId,
      endpoint: '/api/ai/chat/v2',
      method: 'POST',
      status_code: 200,
      latency_ms,
      metadata: {
        message_length: message.length,
        intent_type: orchestratorContext.intent?.intent_type,
        action_attempted: orchestratorContext.toolUsed !== 'none',
        action_success: !orchestratorContext.toolFailed,
        tool_error: orchestratorContext.toolError,  // P0: LOG OBLIGATORIO para fallos OAuth/timeout
        provider_used: llmResult.fallbackChain.final_provider,
        model_used: orchestratorContext.modelSelected,
        guardrail_sanitized: guardrailResult.sanitized,
        web_search_used: orchestratorContext.webSearchUsed,
        tokens_total: totalTokens
      }
    });
    
    console.log(`[CHAT_V2] ✓ Request logged - ${latency_ms}ms`);
    console.log('[CHAT_V2] ==================== FIN SOLICITUD ====================\n');
    
    // ============================================
    // 12. RESPONDER AL FRONTEND
    // ============================================
    
    return res.json({
      answer: finalAnswer,
      session_id: sessionId,
      memories_to_add: [], // TODO: Implementar extracción de memories
      sources: knowledgeSources.length > 0 ? knowledgeSources : undefined, // Agregar sources si hay
      metadata: {
        latency_ms,
        provider: llmResult.fallbackChain.final_provider,
        model: orchestratorContext.modelSelected,
        intent: orchestratorContext.intent?.intent_type,
        action_executed: orchestratorContext.toolUsed !== 'none',
        guardrail_applied: guardrailResult.sanitized
      }
    });
    
  } catch (error: any) {
    console.error('[CHAT_V2] ❌ Error:', error);
    
    const latency_ms = Date.now() - startTime;
    
    // P0: Log obligatorio de errores con contexto completo
    if (sessionId) {
      await supabase.from('ae_requests').insert({
        request_id: req.body.request_id || uuidv4(),
        session_id: sessionId,
        user_id: req.body.userId,
        workspace_id: req.body.workspaceId || env.defaultWorkspaceId,
        endpoint: '/api/ai/chat/v2',
        method: 'POST',
        status_code: 500,
        latency_ms,
        metadata: {
          error: error.message,
          error_type: error.name || 'UnknownError',
          intent_detected: orchestratorContext?.intent?.intent_type,
          tool_expected: orchestratorContext?.toolUsed,
          tool_executed: false,
          failure_reason: error.code === 'ETIMEDOUT' ? 'TIMEOUT' : 
                          error.message.includes('OAUTH') ? 'OAUTH_ERROR' :
                          error.message.includes('provider') ? 'PROVIDER_TIMEOUT' :
                          'UNKNOWN_ERROR',
          stack: error.stack
        }
      });
    }
    
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message,
      session_id: sessionId,
      memories_to_add: []
    });
  }
});

export default router;

