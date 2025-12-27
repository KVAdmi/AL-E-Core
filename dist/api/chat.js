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
const attachments_1 = require("../utils/attachments");
const chunkRetrieval_1 = require("../services/chunkRetrieval");
const auth_1 = require("../middleware/auth");
const attachmentDownload_1 = require("../services/attachmentDownload");
const documentText_1 = require("../utils/documentText");
const orchestrator_1 = require("../ai/orchestrator");
const aleon_1 = require("../ai/prompts/aleon");
const router_1 = require("../llm/router");
const noFakeTools_1 = require("../guards/noFakeTools");
const router = express_1.default.Router();
const orchestrator = new orchestrator_1.Orchestrator();
// Anti-duplicado: request_id tracking (30s TTL)
const recentRequests = new Map();
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
        // CRITICAL: Verificar que OpenAI está bloqueado
        const openaiCheck = (0, router_1.verifyOpenAIBlocked)();
        console.log(`[CHAT] OpenAI Status: ${openaiCheck.message}`);
        // Anti-duplicado: request_id
        const request_id = req.body.request_id || (0, uuid_1.v4)();
        const now = Date.now();
        if (recentRequests.has(request_id)) {
            const timestamp = recentRequests.get(request_id);
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
        const authenticatedUserId = (0, auth_1.getUserId)(req);
        let { workspaceId = env_1.env.defaultWorkspaceId, userId: bodyUserId, mode = env_1.env.defaultMode, sessionId: requestSessionId, messages } = req.body;
        // Prioridad: usuario autenticado > userId del body
        const userId = authenticatedUserId || bodyUserId;
        // Resolver user_id_uuid desde JWT (producción real)
        const user_id_uuid = req.user?.id || null;
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
        // A3) RESOLVER SESSION_ID
        // ============================================
        if (requestSessionId && (0, helpers_1.isUuid)(requestSessionId)) {
            // Verificar que existe
            const { data: existingSession } = await supabase_1.supabase
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
                throw new Error('No se pudo crear la sesión');
            }
            sessionId = newSession.id;
            console.log(`[CHAT] Nueva sesión creada: ${sessionId} - "${title}"`);
        }
        // ============================================
        // A4) RECONSTRUIR HISTORIAL DESDE SUPABASE
        // ============================================
        console.log('[CHAT] 📚 Reconstructing conversation history from Supabase...');
        const { data: historyData, error: historyError } = await supabase_1.supabase
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
            ...storedHistory.map((h) => ({ role: h.role, content: h.content })),
            { role: 'user', content: userContent }
        ];
        // IMPORTANTE: Usar historial reconstruido, NO el del frontend
        messages = reconstructedMessages;
        console.log(`[CHAT] 📝 Using reconstructed history: ${messages.length} messages total`);
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
        }
        else {
            console.log(`[DB] ✓ Mensaje user guardado: ${userMessageId}`);
        }
        // ============================================
        // C) RECUPERAR CONOCIMIENTO ENTRENABLE (CHUNKS)
        // ============================================
        console.log('[CHUNKS] Recuperando conocimiento entrenable...');
        let knowledgeContext = '';
        try {
            const chunks = await (0, chunkRetrieval_1.retrieveRelevantChunks)({
                workspaceId,
                userId,
                projectId: req.body.projectId || req.body.project_id,
                limit: 5, // Top 5 fragmentos más relevantes
                minImportance: 0.5,
            });
            if (chunks.length > 0) {
                knowledgeContext = (0, chunkRetrieval_1.chunksToContext)(chunks);
                console.log(`[CHUNKS] ✓ ${chunks.length} fragmento(s) recuperado(s)`);
            }
            else {
                console.log('[CHUNKS] No se encontró conocimiento entrenable');
            }
        }
        catch (chunkError) {
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
        let orchestratorContext = null; // Declarar fuera del try para acceso global
        let llmResponse = null; // Router response
        let providerUsed = 'groq'; // Default
        let fallbackUsed = false;
        let fallbackChain = [];
        let guardrailResult = null; // Guardrail result
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
                }
                else {
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
            }, aleon_1.ALEON_SYSTEM_PROMPT);
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
            // C3) LLAMAR AL ROUTER LLM (SIN OPENAI)
            // ============================================
            console.log(`[CHAT] Calling LLM router with model: ${modelUsed}`);
            llmResponse = await (0, router_1.generate)({
                messages: [
                    { role: 'system', content: orchestratorContext.systemPrompt },
                    ...finalMessages.filter(m => m.role !== 'system').map(m => ({
                        role: m.role,
                        content: m.content
                    }))
                ],
                temperature: 0.7,
                maxTokens: 600, // COST CONTROL
                model: modelUsed
            });
            providerUsed = llmResponse.response.provider_used;
            fallbackUsed = llmResponse.fallbackChain.fallback_used;
            fallbackChain = llmResponse.fallbackChain.attempted;
            console.log(`[CHAT] ✓ LLM response received from ${providerUsed}${fallbackUsed ? ` (fallback from ${fallbackChain.join(' → ')})` : ''}`);
            // ============================================
            // C4) APLICAR GUARDRAIL ANTI-MENTIRAS (MEJORADO)
            // ============================================
            guardrailResult = (0, noFakeTools_1.applyAntiLieGuardrail)(llmResponse.response.text, orchestratorContext.webSearchUsed, orchestratorContext.intent, orchestratorContext.toolFailed);
            if (guardrailResult.sanitized) {
                console.log(`[GUARDRAIL] 🛡️ Response sanitized: ${guardrailResult.reason}`);
            }
            answer = guardrailResult.text;
            assistantTokens = llmResponse.response.tokens_out || (0, helpers_1.estimateTokens)(answer);
            // Actualizar output tokens en context
            orchestratorContext.outputTokens = assistantTokens;
            console.log(`[ORCH] ✓ Response received (${assistantTokens} tokens)`);
            console.log(`[ORCH] Final metrics: auth=${orchestratorContext.isAuthenticated} tool=${orchestratorContext.toolUsed} model=${orchestratorContext.modelSelected} mem=${orchestratorContext.memoryCount} rag=${orchestratorContext.ragHits} web=${orchestratorContext.webSearchUsed} web_results=${orchestratorContext.webResultsCount} in_tokens=${orchestratorContext.inputTokens} out_tokens=${orchestratorContext.outputTokens}`);
        }
        catch (llmError) {
            console.error('[LLM] ERROR:', llmError);
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
                        error: llmError.message || 'LLM error',
                        userId: userId
                    }
                });
            }
            catch (logError) {
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
        // F) LOG DE REQUEST (PRODUCCIÓN - AUDITORÍA COMPLETA)
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
                    // Tools y memoria
                    tool_used: orchestratorContext.toolUsed,
                    tool_failed: orchestratorContext.toolFailed,
                    tool_error: orchestratorContext.toolError || null,
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
router.post('/chat/v2', auth_1.optionalAuth, async (req, res) => {
    const startTime = Date.now();
    let sessionId = null;
    try {
        console.log('\n[CHAT_V2] ==================== NUEVA SOLICITUD ====================');
        // CRITICAL: Verificar que OpenAI está bloqueado
        const openaiCheck = (0, router_1.verifyOpenAIBlocked)();
        console.log(`[CHAT_V2] OpenAI Status: ${openaiCheck.message}`);
        // ============================================
        // 1. VALIDAR PAYLOAD MÍNIMO
        // ============================================
        const { message, sessionId: requestSessionId, workspaceId, meta } = req.body;
        if (!message || typeof message !== 'string') {
            return res.status(400).json({
                error: 'INVALID_PAYLOAD',
                message: 'Campo "message" es requerido y debe ser string',
                session_id: null,
                memories_to_add: []
            });
        }
        // Anti-duplicado: request_id
        const request_id = req.body.request_id || (0, uuid_1.v4)();
        const now = Date.now();
        if (recentRequests.has(request_id)) {
            const timestamp = recentRequests.get(request_id);
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
        const authenticatedUserId = (0, auth_1.getUserId)(req);
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
        const finalWorkspaceId = workspaceId || env_1.env.defaultWorkspaceId;
        if (requestSessionId && (0, helpers_1.isUuid)(requestSessionId)) {
            // Session existente
            sessionId = requestSessionId;
            console.log(`[CHAT_V2] Using existing session: ${sessionId}`);
        }
        else {
            // Crear nueva session
            sessionId = (0, uuid_1.v4)();
            // USAR 'id' (no 'session_id') porque el schema usa id como PK
            const { error: sessionError } = await supabase_1.supabase
                .from('ae_sessions')
                .insert({
                id: sessionId, // PK de la tabla
                user_id: userId,
                workspace_id: finalWorkspaceId,
                mode: 'universal',
                title: 'Nueva conversación',
                last_message_at: new Date().toISOString(),
                meta: {
                    user_id_uuid, // Guardar en meta si no hay columna directa
                    created_by: 'chat_v2'
                }
            });
            if (sessionError) {
                console.error('[CHAT_V2] Error creating session:', sessionError);
                throw new Error('Failed to create session');
            }
            console.log(`[CHAT_V2] ✓ New session created: ${sessionId}`);
        }
        // ============================================
        // 4. RECONSTRUIR CONTEXTO DESDE SUPABASE
        // ============================================
        console.log('[CHAT_V2] 📚 Reconstructing context from Supabase...');
        // 4.1: Cargar historial de mensajes
        const { data: historyData, error: historyError } = await supabase_1.supabase
            .from('ae_messages')
            .select('role, content, created_at')
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
        const { data: memoriesData, error: memoriesError } = await supabase_1.supabase
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
        const userMessageId = (0, uuid_1.v4)();
        const { error: insertUserError } = await supabase_1.supabase
            .from('ae_messages')
            .insert({
            id: userMessageId, // PK
            session_id: sessionId, // FK a ae_sessions(id)
            role: 'user',
            content: message,
            meta: {
                user_id: userId,
                user_id_uuid,
                workspace_id: finalWorkspaceId,
                tokens: (0, helpers_1.estimateTokens)(message)
            },
            created_at: new Date().toISOString()
        });
        if (insertUserError) {
            console.error('[CHAT_V2] Error inserting user message:', insertUserError);
            throw new Error('Failed to save user message');
        }
        console.log(`[CHAT_V2] ✓ User message saved: ${userMessageId}`);
        // ============================================
        // 6. ORQUESTACIÓN (Intent + Tools + LLM)
        // ============================================
        console.log('[CHAT_V2] 🧠 Starting orchestration...');
        // Construir messages array para orchestrator
        const messagesForOrchestrator = [
            ...history.map((h) => ({ role: h.role, content: h.content })),
            { role: 'user', content: message }
        ];
        const orchestratorRequest = {
            userId,
            workspaceId: finalWorkspaceId,
            projectId: null,
            sessionId,
            messages: messagesForOrchestrator,
            attachments: []
        };
        // TIMEOUT DEFENSIVO: 15s para acciones
        const orchestrationPromise = orchestrator.orchestrate(orchestratorRequest, aleon_1.ALEON_SYSTEM_PROMPT);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('ORCHESTRATION_TIMEOUT')), 15000));
        let orchestratorContext;
        try {
            orchestratorContext = await Promise.race([orchestrationPromise, timeoutPromise]);
        }
        catch (error) {
            if (error.message === 'ORCHESTRATION_TIMEOUT') {
                console.warn('[CHAT_V2] ⏱️ Orchestration timeout - returning fallback');
                // Respuesta fallback para acciones lentas
                const fallbackMessage = 'Estoy procesando tu solicitud, te confirmo enseguida.';
                const assistantMessageId = (0, uuid_1.v4)();
                await supabase_1.supabase.from('ae_messages').insert({
                    id: assistantMessageId,
                    session_id: sessionId,
                    role: 'assistant',
                    content: fallbackMessage,
                    meta: {
                        user_id: userId,
                        user_id_uuid,
                        workspace_id: finalWorkspaceId,
                        tokens: (0, helpers_1.estimateTokens)(fallbackMessage),
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
            throw error;
        }
        console.log(`[CHAT_V2] ✓ Orchestration completed`);
        // ============================================
        // 7. LLAMAR AL LLM
        // ============================================
        console.log('[CHAT_V2] 🤖 Calling LLM router...');
        // Preparar messages con system prompt
        const llmMessages = [
            { role: 'system', content: orchestratorContext.systemPrompt },
            ...messagesForOrchestrator
        ];
        const llmResult = await (0, router_1.generate)({
            messages: llmMessages,
            temperature: 0.7,
            maxTokens: 600,
            model: orchestratorContext.modelSelected
        });
        console.log(`[CHAT_V2] ✓ LLM response received from ${llmResult.fallbackChain.final_provider}`);
        // ============================================
        // 8. APLICAR GUARDRAILS
        // ============================================
        const guardrailResult = (0, noFakeTools_1.applyAntiLieGuardrail)(llmResult.response.text, orchestratorContext.webSearchUsed, orchestratorContext.intent, orchestratorContext.toolFailed);
        const finalAnswer = guardrailResult.sanitized
            ? guardrailResult.text
            : llmResult.response.text;
        if (guardrailResult.sanitized) {
            console.log(`[CHAT_V2] 🛡️ Guardrail applied: ${guardrailResult.reason}`);
        }
        // ============================================
        // 9. GUARDAR RESPUESTA DEL ASSISTANT
        // ============================================
        const assistantMessageId = (0, uuid_1.v4)();
        const { error: insertAssistantError } = await supabase_1.supabase
            .from('ae_messages')
            .insert({
            id: assistantMessageId, // PK
            session_id: sessionId, // FK a ae_sessions(id)
            role: 'assistant',
            content: finalAnswer,
            meta: {
                user_id: userId,
                user_id_uuid,
                workspace_id: finalWorkspaceId,
                tokens: llmResult.response.tokens_out || (0, helpers_1.estimateTokens)(finalAnswer),
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
        const totalTokens = (llmResult.response.tokens_in || 0) +
            (llmResult.response.tokens_out || 0);
        // Actualizar last_message_at y metadata (ae_sessions no tiene total_messages/total_tokens como columnas)
        await supabase_1.supabase
            .from('ae_sessions')
            .update({
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            meta: {
                total_tokens: totalTokens,
                total_cost: (0, helpers_1.estimateCost)(totalTokens, orchestratorContext.modelSelected),
                last_model: orchestratorContext.modelSelected,
                last_provider: llmResult.fallbackChain.final_provider
            }
        })
            .eq('id', sessionId); // WHERE id = sessionId (no 'session_id' column)
        // ============================================
        // 11. LOG EN AE_REQUESTS
        // ============================================
        const latency_ms = Date.now() - startTime;
        await supabase_1.supabase.from('ae_requests').insert({
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
            metadata: {
                latency_ms,
                provider: llmResult.fallbackChain.final_provider,
                model: orchestratorContext.modelSelected,
                intent: orchestratorContext.intent?.intent_type,
                action_executed: orchestratorContext.toolUsed !== 'none',
                guardrail_applied: guardrailResult.sanitized
            }
        });
    }
    catch (error) {
        console.error('[CHAT_V2] ❌ Error:', error);
        const latency_ms = Date.now() - startTime;
        // Log error en ae_requests
        if (sessionId) {
            await supabase_1.supabase.from('ae_requests').insert({
                request_id: req.body.request_id || (0, uuid_1.v4)(),
                session_id: sessionId,
                user_id: req.body.userId,
                workspace_id: req.body.workspaceId || env_1.env.defaultWorkspaceId,
                endpoint: '/api/ai/chat/v2',
                method: 'POST',
                status_code: 500,
                latency_ms,
                metadata: {
                    error: error.message,
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
exports.default = router;
