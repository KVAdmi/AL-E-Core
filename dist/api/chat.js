"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const supabase_1 = require("../db/supabase");
const env_1 = require("../config/env");
const helpers_1 = require("../utils/helpers");
const OpenAIAssistantProvider_1 = require("../ai/providers/OpenAIAssistantProvider");
const attachments_1 = require("../utils/attachments");
const chunkRetrieval_1 = require("../services/chunkRetrieval");
const auth_1 = require("../middleware/auth");
const contextGuard_1 = require("../utils/contextGuard");
const attachmentDownload_1 = require("../services/attachmentDownload");
const documentText_1 = require("../utils/documentText");
const router = express_1.default.Router();
const openaiProvider = new OpenAIAssistantProvider_1.OpenAIAssistantProvider();
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
router.post('/chat', auth_1.optionalAuth, async (req, res) => {
    const startTime = Date.now();
    let sessionId = null;
    try {
        console.log('\n[CHAT] ==================== NUEVA SOLICITUD ====================');
        // 🔒 GUARDRAIL: Calcular tamaño del request
        const requestContentLength = JSON.stringify(req.body).length;
        const MAX_REQUEST_SIZE = 50000; // 50KB
        console.log(`[GUARDRAIL] Request size: ${requestContentLength} bytes`);
        // Obtener userId (autenticado o del body)
        const authenticatedUserId = (0, auth_1.getUserId)(req);
        let { workspaceId = env_1.env.defaultWorkspaceId, userId: bodyUserId, mode = env_1.env.defaultMode, sessionId: requestSessionId, messages } = req.body;
        // 🔒 GUARDRAIL 1: Validar que messages existe y es array
        if (!Array.isArray(messages)) {
            console.error('[GUARDRAIL] ⚠️ messages no es un array válido');
            return res.status(400).json({
                error: 'INVALID_REQUEST',
                message: 'messages debe ser un array',
                session_id: null,
                memories_to_add: []
            });
        }
        // 🔒 GUARDRAIL 2: Límite estricto de mensajes (protección backend)
        const originalMessagesCount = messages.length;
        let wasTrimmed = false;
        const MAX_MESSAGES = 12;
        if (messages.length > MAX_MESSAGES) {
            console.warn(`[GUARDRAIL] ⚠️ Demasiados mensajes: ${messages.length} → recortando a últimos ${MAX_MESSAGES}`);
            messages = messages.slice(-MAX_MESSAGES); // Últimos 12 mensajes
            wasTrimmed = true;
        }
        // 🔒 GUARDRAIL 3: Si request es muy grande, recortar contenido de mensajes
        if (requestContentLength > MAX_REQUEST_SIZE) {
            console.warn(`[GUARDRAIL] ⚠️ Request muy grande: ${requestContentLength} bytes → recortando contenido`);
            messages = messages.map((msg) => {
                if (typeof msg.content === 'string' && msg.content.length > 2000) {
                    wasTrimmed = true;
                    return {
                        ...msg,
                        content: msg.content.substring(0, 2000) + '... [truncado por backend]'
                    };
                }
                return msg;
            });
        }
        // LOG OBLIGATORIO
        console.log(`[GUARDRAIL] messages_in_request=${originalMessagesCount}, was_trimmed=${wasTrimmed}, final_messages=${messages.length}, request_size=${requestContentLength}`);
        // Prioridad: usuario autenticado > userId del body
        const userId = authenticatedUserId || bodyUserId;
        if (req.user) {
            console.log(`[CHAT] Usuario autenticado: ${req.user.id} (${req.user.email})`);
        }
        else {
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
        const attachmentsRaw = (req.body.attachments ?? req.body.files ?? []);
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
        let imageUrls = [];
        if (safeAttachments.length > 0) {
            // Detectar si son attachments de Supabase Storage (con bucket/path) o legacy (URLs)
            const firstAttachment = safeAttachments[0];
            const isSupabaseStorage = (0, attachmentDownload_1.validateAttachment)(firstAttachment);
            if (isSupabaseStorage) {
                // MODO NUEVO: Attachments desde Supabase Storage
                console.log(`[ATTACHMENTS] Modo: Supabase Storage (${safeAttachments.length} archivo(s))`);
                try {
                    // 1. Validar todos los attachments
                    const validAttachments = safeAttachments.filter(attachmentDownload_1.validateAttachment);
                    if (validAttachments.length < safeAttachments.length) {
                        console.warn(`[ATTACHMENTS] ${safeAttachments.length - validAttachments.length} attachment(s) inválido(s) ignorados`);
                    }
                    // 2. Descargar archivos desde Supabase Storage
                    const downloadedFiles = await (0, attachmentDownload_1.downloadAttachments)(validAttachments);
                    if (downloadedFiles.length === 0) {
                        console.error('[ATTACHMENTS] No se pudo descargar ningún archivo');
                    }
                    else {
                        // 3. Extraer texto de los archivos descargados
                        console.log(`[ATTACHMENTS] Extrayendo texto de ${downloadedFiles.length} archivo(s)...`);
                        const extractedDocs = await (0, documentText_1.extractTextFromFiles)(downloadedFiles);
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
                }
                catch (err) {
                    console.error('[ATTACHMENTS] Error procesando attachments de Supabase Storage:', err);
                }
            }
            else {
                // MODO LEGACY: Attachments con URLs directas (compatibilidad)
                console.log(`[ATTACHMENTS] Modo: Legacy URLs (${safeAttachments.length} attachment(s))`);
                const processed = await (0, attachments_1.processAttachments)(safeAttachments);
                // Log para debug
                processed.forEach(p => {
                    console.log(`[ATTACHMENTS] - ${p.name} (${p.type}): ${p.error ? 'ERROR' : 'OK'}`);
                });
                // Extraer texto de documentos
                attachmentsContext = (0, attachments_1.attachmentsToContext)(processed);
                // Extraer URLs de imágenes para visión multimodal
                imageUrls = (0, attachments_1.extractImageUrls)(processed);
                if (imageUrls.length > 0) {
                    console.log(`[ATTACHMENTS] ${imageUrls.length} imagen(es) para visión multimodal`);
                }
            }
        }
        // ============================================
        // A3) RESOLVER SESSION_ID + VALIDAR OWNERSHIP
        // ============================================
        if (requestSessionId && (0, helpers_1.isUuid)(requestSessionId)) {
            // Verificar que existe Y validar ownership si hay JWT
            const { data: existingSession } = await supabase_1.supabase
                .from('ae_sessions')
                .select('id, user_id_uuid')
                .eq('id', requestSessionId)
                .single();
            if (existingSession) {
                // 🚨 GUARDRAIL DE SEGURIDAD: Validar ownership
                if (req.user?.id && existingSession.user_id_uuid) {
                    if (existingSession.user_id_uuid !== req.user.id) {
                        console.error(`[SECURITY] ⚠️ Usuario ${req.user.id} intentó acceder a sesión de ${existingSession.user_id_uuid}`);
                        return res.status(403).json({
                            error: 'FORBIDDEN',
                            message: 'No tienes acceso a esta sesión',
                            session_id: null,
                            memories_to_add: []
                        });
                    }
                }
                sessionId = requestSessionId;
                console.log(`[CHAT] Usando sesión existente: ${sessionId} (ownership validado)`);
            }
        }
        if (!sessionId) {
            // Crear nueva sesión
            const newSessionId = (0, uuid_1.v4)();
            const title = (0, helpers_1.makeTitleFromText)(userContent, 8);
            const { data: newSession, error: sessionError } = await supabase_1.supabase
                .from('ae_sessions')
                .insert({
                id: newSessionId,
                assistant_id: env_1.env.assistantId,
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
        const userMessageId = (0, uuid_1.v4)();
        const userTokens = (0, helpers_1.estimateTokens)(userContent);
        const { error: userMessageError } = await supabase_1.supabase
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
        }
        else {
            console.log(`[DB] ✓ Mensaje user guardado: ${userMessageId}`);
        }
        // ============================================
        // C) RECUPERAR CONOCIMIENTO ENTRENABLE (CHUNKS)
        // ============================================
        console.log('[CHUNKS] Recuperando conocimiento entrenable...');
        let knowledgeContext = '';
        let chunksRetrieved = 0;
        try {
            const chunks = await (0, chunkRetrieval_1.retrieveRelevantChunks)({
                workspaceId,
                userId,
                projectId: req.body.projectId || req.body.project_id,
                limit: 3, // 🔒 LÍMITE: máximo 3 chunks
                minImportance: 0.5,
            });
            chunksRetrieved = chunks.length;
            if (chunks.length > 0) {
                knowledgeContext = (0, chunkRetrieval_1.chunksToContext)(chunks);
                console.log(`[CHUNKS] ✓ ${chunks.length} fragmento(s) recuperado(s)`);
            }
            else {
                console.log('[CHUNKS] No se encontró conocimiento entrenable');
            }
        }
        catch (chunkError) {
            console.error('[CHUNKS] ⚠️ FAIL-SAFE: Error recuperando chunks, continuando sin ellos:', chunkError);
            // 🛡️ FALLBACK: NO abortar - continuar con chunks = []
            knowledgeContext = '';
            chunksRetrieved = 0;
        }
        // ============================================
        // D) APLICAR CONTEXT GUARD + PREPARAR REQUEST
        // ============================================
        console.log('[OPENAI] Preparando request con context guard...');
        // Determinar si hay identidad inyectada (con JWT)
        const identityInjected = !!req.user?.id;
        const memoryMode = identityInjected
            ? (chunksRetrieved > 0 ? 'auth-full' : 'auth-minimal')
            : 'guest-minimal';
        // Aplicar context guard ANTES de enviar a OpenAI
        const guardResult = (0, contextGuard_1.guardContextWindow)(messages, '', // System prompt manejado por provider
        knowledgeContext, identityInjected);
        // 🔒 LOGS OBLIGATORIOS
        console.log(`[REQUEST CONTEXT] {
  hasAuthHeader: ${!!req.headers.authorization},
  user_uuid: ${req.user?.id || 'N/A'},
  session_id: ${sessionId},
  history_loaded_count: ${guardResult.messages.length},
  chunks_count: ${chunksRetrieved},
  memory_mode: ${memoryMode},
  identity_injected: ${identityInjected},
  model_used: gpt-3.5-turbo-1106,
  output_cap: ${(0, contextGuard_1.getMaxOutputTokens)()},
  context_truncated: ${guardResult.wasTruncated}
}`);
        let answer = '';
        let assistantTokens = 0;
        let modelUsed = 'gpt-3.5-turbo-1106'; // Default
        try {
            // Preparar mensajes finales con context guard aplicado
            let finalMessages = guardResult.messages;
            // Si hay conocimiento entrenable (ya filtrado por context guard), inyectarlo
            if (guardResult.chunks) {
                // Buscar si ya hay un mensaje system
                const systemMsgIndex = finalMessages.findIndex(m => m.role === 'system');
                if (systemMsgIndex >= 0) {
                    // Agregar al mensaje system existente
                    finalMessages[systemMsgIndex] = {
                        ...finalMessages[systemMsgIndex],
                        content: finalMessages[systemMsgIndex].content + '\n\n' + guardResult.chunks
                    };
                }
                else {
                    // Crear nuevo mensaje system al inicio
                    finalMessages = [
                        {
                            role: 'system',
                            content: guardResult.chunks
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
            const assistantRequest = {
                messages: finalMessages,
                mode: mode,
                workspaceId: workspaceId,
                userId: userId,
                userEmail: req.user?.email
            };
            const response = await openaiProvider.chat(assistantRequest);
            answer = response.content;
            assistantTokens = (0, helpers_1.estimateTokens)(answer);
            modelUsed = response.raw?.model || 'gpt-4';
            // 🔒 LOG OBLIGATORIO: tokens reales de OpenAI
            const realInputTokens = response.raw?.usage?.prompt_tokens || 0;
            const realOutputTokens = response.raw?.usage?.completion_tokens || 0;
            const realTotalTokens = response.raw?.usage?.total_tokens || 0;
            console.log(`[REQUEST COMPLETE] {
  input_tokens: ${realInputTokens},
  output_tokens: ${realOutputTokens},
  total_tokens: ${realTotalTokens},
  model_used: ${modelUsed},
  response_length: ${answer.length} chars
}`);
        }
        catch (openaiError) {
            console.error('[OPENAI] ERROR:', openaiError);
            // Intentar guardar el error en ae_requests
            try {
                await supabase_1.supabase.from('ae_requests').insert({
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
            }
            catch (logError) {
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
        const assistantMessageId = (0, uuid_1.v4)();
        const totalTokens = userTokens + assistantTokens;
        const estimatedCostValue = (0, helpers_1.estimateCost)(userTokens, assistantTokens, modelUsed);
        const { error: assistantMessageError } = await supabase_1.supabase
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
        }
        else {
            console.log(`[DB] ✓ Mensaje assistant guardado: ${assistantMessageId}`);
        }
        // ============================================
        // E) ACTUALIZAR SESIÓN
        // ============================================
        try {
            // Primero obtener valores actuales
            const { data: currentSession } = await supabase_1.supabase
                .from('ae_sessions')
                .select('total_messages, total_tokens, estimated_cost')
                .eq('id', sessionId)
                .single();
            const currentMessages = currentSession?.total_messages || 0;
            const currentTokens = currentSession?.total_tokens || 0;
            const currentCost = currentSession?.estimated_cost || 0;
            const { error: updateError } = await supabase_1.supabase
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
            }
            else {
                console.log(`[DB] ✓ Sesión actualizada: +2 mensajes, +${totalTokens} tokens`);
            }
        }
        catch (updateErr) {
            console.error('[DB] Error actualizando sesión:', updateErr);
            // NO romper el chat
        }
        // ============================================
        // F) LOG DE REQUEST (RECOMENDADO)
        // ============================================
        try {
            const responseTime = Date.now() - startTime;
            await supabase_1.supabase.from('ae_requests').insert({
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
        }
        catch (logError) {
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
    }
    catch (error) {
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
exports.default = router;
