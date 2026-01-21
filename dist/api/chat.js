"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const uuid_1 = require("uuid");
const supabase_1 = require("../db/supabase");
const env_1 = require("../config/env");
const helpers_1 = require("../utils/helpers");
const textCleaners_1 = require("../utils/textCleaners");
const chunkRetrieval_1 = require("../services/chunkRetrieval");
const auth_1 = require("../middleware/auth");
const attachmentDownload_1 = require("../services/attachmentDownload");
const documentText_1 = require("../utils/documentText");
const orchestrator_1 = require("../ai/orchestrator");
const aleon_1 = require("../ai/prompts/aleon");
const router_1 = require("../llm/router");
const noFakeTools_1 = require("../guards/noFakeTools");
const openaiReferee_1 = require("../llm/openaiReferee");
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
        console.log('\n[CHAT] ========================================');
        console.log('[CHAT] 🔵 NUEVA SOLICITUD /chat');
        console.log('[CHAT] ========================================');
        console.log(`[CHAT] 📋 Body keys: ${Object.keys(req.body).join(', ')}`);
        console.log(`[CHAT] 👤 User authenticated: ${req.user ? 'YES' : 'NO'}`);
        if (req.user) {
            console.log(`[CHAT] 👤 User ID: ${req.user.id}`);
        }
        // CRITICAL: Verificar que OpenAI está bloqueado
        const openaiCheck = (0, router_1.verifyOpenAIBlocked)();
        console.log(`[CHAT] 🔒 OpenAI Status: ${openaiCheck.message}`);
        // Anti-duplicado: request_id
        const request_id = req.body.request_id || (0, uuid_1.v4)();
        console.log(`[CHAT] 🆔 Request ID: ${request_id}`);
        const now = Date.now();
        if (recentRequests.has(request_id)) {
            const timestamp = recentRequests.get(request_id);
            if (now - timestamp < 30000) { // 30s
                console.warn(`[CHAT] ⚠️ DUPLICATE REQUEST detectado - request_id: ${request_id}, age: ${now - timestamp}ms`);
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
        let { workspaceId = env_1.env.defaultWorkspaceId, userId: bodyUserId, mode = env_1.env.defaultMode, sessionId: requestSessionId, messages, userEmail, // P0: Multi-user collaboration
        userDisplayName // P0: Multi-user collaboration
         } = req.body;
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
                            // PERSISTIR CONTEXTO EN ae_sessions.metadata para memoria universal
                            if (sessionId || requestSessionId) {
                                const persistSessionId = sessionId || requestSessionId;
                                const filesMetadata = extractedDocs.map(doc => ({
                                    name: doc.name,
                                    type: doc.type,
                                    size: doc.text?.length || 0,
                                    processed_at: new Date().toISOString()
                                }));
                                const { error: updateError } = await supabase_1.supabase
                                    .from('ae_sessions')
                                    .update({
                                    metadata: {
                                        attachments_context: attachmentsContext,
                                        files: filesMetadata,
                                        updated_at: new Date().toISOString()
                                    }
                                })
                                    .eq('id', persistSessionId);
                                if (updateError) {
                                    console.error('[MEMORY] Error persistiendo attachments_context:', updateError);
                                }
                                else {
                                    console.log(`[MEMORY] ✓ Contexto persistido en ae_sessions (${filesMetadata.length} archivo(s))`);
                                }
                            }
                        }
                    }
                }
                catch (err) {
                    console.error('[ATTACHMENTS] Error procesando attachments de Supabase Storage:', err);
                }
            }
            else {
                // MODO UNIFICADO: Attachments con URLs directas
                console.log(`[ATTACHMENTS] Procesando ${safeAttachments.length} attachment(s)...`);
                const { processAttachment } = await Promise.resolve().then(() => __importStar(require('../services/attachmentProcessor')));
                for (let i = 0; i < safeAttachments.length; i++) {
                    const att = safeAttachments[i];
                    try {
                        const url = att.url || att.signedUrl || '';
                        const mimeType = att.type || att.mimeType || 'application/octet-stream';
                        const name = att.name || `archivo_${i + 1}`;
                        if (!url) {
                            console.warn(`[ATTACHMENTS] Attachment ${i + 1} sin URL, skip`);
                            continue;
                        }
                        console.log(`[ATTACHMENTS] ${i + 1}. ${name} (${mimeType})`);
                        const result = await processAttachment(url, mimeType);
                        if (result.success && result.text) {
                            const excerpt = result.text.length > 30000 ? result.text.substring(0, 30000) + '...' : result.text;
                            attachmentsContext += `\n\n[ARCHIVO: ${name}]\nTipo: ${result.type}\n\n${excerpt}\n`;
                            console.log(`[ATTACHMENTS] ✓ ${name}: ${result.text.length} caracteres`);
                        }
                        else {
                            console.error(`[ATTACHMENTS] ✗ ${name}: ${result.error}`);
                            attachmentsContext += `\n\n[ARCHIVO: ${name}]\nError: No pude leer este archivo\n`;
                        }
                    }
                    catch (error) {
                        console.error(`[ATTACHMENTS] Error en attachment ${i + 1}:`, error);
                    }
                }
                if (attachmentsContext) {
                    attachmentsContext = `\n\n═══ ARCHIVOS ADJUNTOS ═══${attachmentsContext}\n═══ FIN ═══\n`;
                    console.log(`[ATTACHMENTS] ✓ Total: ${attachmentsContext.length} caracteres`);
                }
            }
        }
        // ============================================
        // A3) RESOLVER SESSION_ID
        // ============================================
        if (requestSessionId && (0, helpers_1.isUuid)(requestSessionId)) {
            // P0 FIX: Verificar que la sesión pertenece al usuario
            const { data: existingSession } = await supabase_1.supabase
                .from('ae_sessions')
                .select('id, user_id_old, user_id_uuid')
                .eq('id', requestSessionId)
                .single();
            if (existingSession) {
                // Validar ownership: session debe pertenecer al usuario
                const sessionOwner = existingSession.user_id_uuid || existingSession.user_id_old;
                if (sessionOwner !== userId) {
                    console.error(`[CHAT] 🚨 P0 VIOLATION: Usuario ${userId} intentó acceder sesión de ${sessionOwner}`);
                    return res.status(403).json({
                        error: 'FORBIDDEN_SESSION',
                        message: 'Esta sesión pertenece a otro usuario',
                        session_id: null
                    });
                }
                sessionId = requestSessionId;
                console.log(`[CHAT] Usando sesión existente: ${sessionId} (owner: ${userId})`);
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
                // P0 FIX: NO abortar conversación por error de sesión
                // Continuar sin sesión (sessionId = null) → conversación stateless
                console.warn('[DB] ⚠️ Continuando sin sesión (stateless mode)');
                sessionId = null;
            }
            else {
                sessionId = newSession.id;
                console.log(`[CHAT] Nueva sesión creada: ${sessionId} - "${title}"`);
            }
        }
        // ============================================
        // A4) RECONSTRUIR HISTORIAL DESDE SUPABASE
        // ============================================
        console.log('[CHAT] 📚 Reconstructing conversation history from Supabase...');
        // P0 FIX: Filtrar historial SOLO del usuario actual
        const { data: historyData, error: historyError } = await supabase_1.supabase
            .from('ae_messages')
            .select('role, content, created_at, session_id')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true })
            .limit(50); // Últimos 50 mensajes
        if (historyError) {
            console.error('[CHAT] Error loading history:', historyError);
        }
        // P0: Validar que todos los mensajes son del mismo session_id (ya validado arriba)
        // No deberían existir mensajes cross-session aquí porque session_id ya fue validado
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
        let knowledgeSources = []; // Declarar aquí para que esté disponible en la respuesta
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
        // C2) RECUPERAR CONOCIMIENTO VECTORIAL (BGE-M3)
        // ============================================
        console.log('[KNOWLEDGE] Recuperando conocimiento vectorial (BGE-M3)...');
        let vectorKnowledgeContext = '';
        // knowledgeSources ya declarado arriba
        try {
            // Extraer último mensaje del usuario para búsqueda
            const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
            const searchQuery = lastUserMessage?.content || '';
            if (!searchQuery) {
                console.log('[KNOWLEDGE] No hay mensaje del usuario para buscar');
            }
            else {
                // Generar embedding como array (no string)
                const { generateEmbedding } = await Promise.resolve().then(() => __importStar(require('../services/embeddingService')));
                const queryEmbedding = await generateEmbedding(searchQuery);
                const { data: vectorResults, error: vectorError } = await supabase_1.supabase.rpc('search_knowledge', {
                    query_embedding: queryEmbedding,
                    match_threshold: 0.7,
                    match_count: 5
                });
                if (vectorError) {
                    console.error('[KNOWLEDGE] Error en búsqueda vectorial:', vectorError);
                }
                else if (vectorResults && vectorResults.length > 0) {
                    // Formatear contexto documental
                    vectorKnowledgeContext = '\n\n🔍 CONOCIMIENTO DOCUMENTADO (Evidencia Real):\n\n';
                    vectorKnowledgeContext += vectorResults.map((r, i) => {
                        knowledgeSources.push({
                            path: r.source_path,
                            type: r.source_type,
                            score: r.score
                        });
                        return `[Documento ${i + 1}: ${r.source_path}]\n${r.content}\n(Relevancia: ${(r.score * 100).toFixed(1)}%)`;
                    }).join('\n\n---\n\n');
                    console.log(`[KNOWLEDGE] ✓ ${vectorResults.length} documento(s) relevante(s) encontrado(s)`);
                }
                else {
                    console.log('[KNOWLEDGE] No se encontró documentación relevante (threshold 0.7)');
                }
            }
        }
        catch (vectorError) {
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
        let orchestratorContext = null; // Declarar fuera del try para acceso global
        let llmResponse = null; // Router response
        let providerUsed = 'groq'; // Default
        let fallbackUsed = false;
        let fallbackChain = [];
        let guardrailResult = null; // Guardrail result
        // OpenAI Referee variables
        let refereeUsed = false;
        let refereeReason;
        let refereeCost = 0;
        let refereeLatency = 0;
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
                }
                else {
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
            }, aleon_1.ALEON_SYSTEM_PROMPT);
            // POLÍTICA ANTI-MENTIRA: Si es pregunta técnica/específica y NO hay documentación, advertir
            let antiLieWarning = '';
            if (knowledgeSources.length === 0 && !knowledgeContext) {
                // Extraer último mensaje para análisis
                const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
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
            const { getToolsForContext } = await Promise.resolve().then(() => __importStar(require('../ai/tools/toolDefinitions')));
            // Extraer último mensaje de usuario
            const lastUserMessage = [...finalMessages].reverse().find((m) => m.role === 'user');
            const userQuery = lastUserMessage?.content || '';
            // 🔥 DECISIÓN DE TOOLS: Usar los del orchestrator SI los preparó, sino ALL_TOOLS
            const { ALL_TOOLS } = await Promise.resolve().then(() => __importStar(require('../ai/tools/toolDefinitions')));
            const toolsAvailable = orchestratorContext.tools && orchestratorContext.tools.length > 0
                ? orchestratorContext.tools // Usar tools específicos del orchestrator
                : ALL_TOOLS; // Fallback a todos los tools
            console.log(`[CHAT] 🔧 Passing ${toolsAvailable.length} tools to LLM ${orchestratorContext.tools ? '(from orchestrator)' : '(ALL_TOOLS)'}`);
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
            const toolLoopResult = await orchestrator.executeToolLoop(userId, conversationMessages, orchestratorContext.systemPrompt, toolsAvailable, modelUsed, 3 // Max 3 iteraciones
            );
            // Formatear respuesta para compatibilidad con código existente
            llmResponse = {
                response: {
                    text: toolLoopResult.content,
                    tokens_in: 0, // TODO: Calcular tokens reales
                    tokens_out: 0, // TODO: Calcular tokens reales
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
                toolLoopResult.toolExecutions.forEach((te) => {
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
                    llmResponse = await (0, router_1.generate)({
                        messages: extractionMessages,
                        temperature: 0.7,
                        maxTokens: 600,
                        model: modelUsed
                    });
                    providerUsed = llmResponse.response.provider_used;
                    console.log(`[WEB_SEARCH] ✓ Regenerated response without links`);
                }
            }
            // ============================================
            // C3.5) OPENAI REFEREE - Detección de evasiones (P0 CORE)
            // ============================================
            // Detectar si Groq evadió
            const evasionCheck = (0, openaiReferee_1.detectGroqEvasion)(llmResponse.response.text, orchestratorContext.tools !== undefined && orchestratorContext.tools.length > 0, orchestratorContext.toolUsed !== 'none' && !orchestratorContext.toolFailed);
            // Detectar contradicción con evidencia
            const evidenceMismatch = orchestratorContext.toolResult
                ? (0, openaiReferee_1.detectEvidenceMismatch)(llmResponse.response.text, { toolResult: orchestratorContext.toolResult })
                : false;
            const needsReferee = evasionCheck.needsReferee || evidenceMismatch;
            // ✅ FIX 4: Detectar modo voz y BLOQUEAR OpenAI referee
            const isVoiceMode = req.body.voice === true ||
                req.body.mode === 'voice' ||
                req.headers['x-channel'] === 'voice';
            if (needsReferee && process.env.OPENAI_ROLE === 'referee') {
                // ✅ BLOQUEAR OpenAI en voz (SOLO Groq en voz)
                if (isVoiceMode) {
                    console.warn(`[ORCH] ⚠️ REFEREE BLOCKED - Voice mode detected (OpenAI forbidden in voice)`);
                    console.warn(`[ORCH] Using Groq response directly - no OpenAI correction`);
                    // NO invocar referee - usar respuesta de Groq directamente
                }
                else {
                    // Modo texto: permitir referee
                    try {
                        console.log(`[ORCH] ⚖️ OPENAI REFEREE INVOKED - channel=text, reason=${evasionCheck.reason || 'evidence_mismatch'}`);
                        const refereeResult = await (0, openaiReferee_1.invokeOpenAIReferee)({
                            userPrompt: userContent,
                            groqResponse: llmResponse.response.text,
                            toolResults: orchestratorContext.toolResult ? { result: orchestratorContext.toolResult } : undefined,
                            systemState: {
                                tool_used: orchestratorContext.toolUsed,
                                tool_failed: orchestratorContext.toolFailed,
                                web_search: orchestratorContext.webSearchUsed,
                                web_results: orchestratorContext.webResultsCount
                            },
                            detectedIssue: evasionCheck.reason || 'evidence_mismatch'
                        });
                        // Reemplazar respuesta con la del referee
                        llmResponse.response.text = refereeResult.text;
                        refereeUsed = true;
                        refereeReason = refereeResult.reason;
                        refereeCost = refereeResult.cost_estimated_usd;
                        refereeLatency = refereeResult.latency_ms;
                        console.log(`[ORCH] ✅ REFEREE CORRECTED - channel=text, primary_model=groq, fallback_model=openai, fallback_reason=${refereeReason}`);
                    }
                    catch (refereeError) {
                        console.error(`[ORCH] ❌ REFEREE FAILED: ${refereeError.message}`);
                        // Continuar con respuesta de Groq (no bloqueante)
                    }
                }
            }
            // ============================================
            // C4) APLICAR GUARDRAIL ANTI-MENTIRAS (P0 REFUERZO)
            // ============================================
            guardrailResult = (0, noFakeTools_1.applyAntiLieGuardrail)(llmResponse.response.text, orchestratorContext.webSearchUsed, orchestratorContext.intent, orchestratorContext.toolFailed, orchestratorContext.toolError // P0: Pasar código de error OAuth
            );
            if (guardrailResult.sanitized) {
                console.log(`[GUARDRAIL] 🛡️ Response sanitized: ${guardrailResult.reason}`);
            }
            answer = guardrailResult.text;
            // ============================================
            // C4.5) GUARDRAIL ANTI-MENTIRAS CON EVIDENCIA (P0 HOY)
            // ============================================
            const { validateLLMResponse } = await Promise.resolve().then(() => __importStar(require('../services/responseValidator')));
            const { executeAction } = await Promise.resolve().then(() => __importStar(require('../services/actionGateway')));
            // Reconstruir actionResult desde orchestratorContext
            const actionResultFromContext = orchestratorContext.toolUsed !== 'none' ? {
                success: !orchestratorContext.toolFailed,
                action: orchestratorContext.toolUsed,
                evidence: null, // TODO: pasar evidence desde orchestrator
                userMessage: orchestratorContext.toolResult || '',
                reason: orchestratorContext.toolError
            } : undefined;
            const validationResult = validateLLMResponse(answer, orchestratorContext.intent, actionResultFromContext);
            if (!validationResult.valid) {
                console.error(`[RESPONSE_VALIDATOR] ❌ LLM RESPONSE REJECTED: ${validationResult.reason}`);
                answer = validationResult.correctedResponse || answer;
                console.log(`[RESPONSE_VALIDATOR] ✓ Response corrected to: "${answer.substring(0, 100)}..."`);
            }
            assistantTokens = llmResponse.response.tokens_out || (0, helpers_1.estimateTokens)(answer);
            // Actualizar output tokens en context
            orchestratorContext.outputTokens = assistantTokens;
            console.log(`[ORCH] ✓ Response received (${assistantTokens} tokens)`);
            console.log(`[ORCH] Final metrics: auth=${orchestratorContext.isAuthenticated} tool=${orchestratorContext.toolUsed} model=${orchestratorContext.modelSelected} mem=${orchestratorContext.memoryCount} rag=${orchestratorContext.ragHits} web=${orchestratorContext.webSearchUsed} web_results=${orchestratorContext.webResultsCount} in_tokens=${orchestratorContext.inputTokens} out_tokens=${orchestratorContext.outputTokens}`);
        }
        catch (llmError) {
            console.error('[LLM] ERROR:', llmError);
            // P0: Log obligatorio de errores en ae_requests
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
                        error_type: llmError.name || 'LLMError',
                        intent_detected: orchestratorContext?.intent?.intent_type,
                        tool_expected: orchestratorContext?.toolUsed,
                        tool_executed: false,
                        failure_reason: orchestratorContext?.toolError || llmError.message,
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
                    // OpenAI Referee (P0 CORE)
                    referee_used: refereeUsed,
                    referee_reason: refereeReason || null,
                    referee_cost_usd: refereeCost,
                    referee_latency_ms: refereeLatency,
                    // Tokens detallados
                    tokens_in: llmResponse.response.tokens_in || orchestratorContext.inputTokens,
                    tokens_out: llmResponse.response.tokens_out || orchestratorContext.outputTokens,
                    max_output_tokens: orchestratorContext.maxOutputTokens,
                    // Tools y memoria (P0: Observabilidad de fallos)
                    tool_used: orchestratorContext.toolUsed,
                    tool_failed: orchestratorContext.toolFailed,
                    tool_error: orchestratorContext.toolError || null, // P0: LOG OBLIGATORIO para OAuth failures
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
            speak_text: (0, textCleaners_1.markdownToSpeakable)(answer),
            should_speak: (0, textCleaners_1.shouldSpeak)(answer),
            session_id: sessionId,
            memories_to_add: []
        });
    }
    catch (error) {
        console.error('[CHAT] ERROR CRÍTICO:', error);
        res.status(500).json({
            answer: 'Error interno del servidor',
            speak_text: 'Ocurrió un error al procesar tu solicitud.',
            should_speak: true,
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
    // P0: Declarar orchestratorContext EN SCOPE DEL ENDPOINT (fuera del try principal)
    let orchestratorContext = null;
    // P0: Declarar userEmail y userDisplayName en scope del endpoint
    let userEmail;
    let userDisplayName;
    // ✅ FIX 3: Declarar userId en scope del endpoint para memory extraction
    let userId = null;
    let finalWorkspaceId = env_1.env.defaultWorkspaceId;
    let message = ''; // Mensaje del usuario para memory extraction
    let finalAnswer = ''; // Respuesta del assistant para memory extraction
    try {
        // ============================================
        // 1. VALIDAR PAYLOAD MÍNIMO
        // ============================================
        // Extraer message y otros del body
        message = req.body.message;
        const requestSessionId = req.body.sessionId;
        const workspaceId = req.body.workspaceId;
        const meta = req.body.meta;
        // P0: Extraer userEmail y userDisplayName del payload (multi-user collaboration)
        userEmail = req.body.userEmail;
        userDisplayName = req.body.userDisplayName;
        console.log('\n[CHAT_V2] ==================== NUEVA SOLICITUD ====================');
        console.log('[CHAT_V2] 📥 PAYLOAD RECIBIDO DEL FRONTEND:');
        console.log('  - sessionId:', requestSessionId || 'NO_SESSION');
        console.log('  - userId (body):', req.body.userId || 'NOT_IN_BODY');
        console.log('  - message length:', message?.length || 0);
        console.log('  - workspaceId:', workspaceId || 'NOT_PROVIDED');
        console.log('  - hasAttachments:', !!req.body.attachments);
        console.log('  - userEmail:', userEmail || 'NOT_PROVIDED');
        console.log('  - userDisplayName:', userDisplayName || 'NOT_PROVIDED');
        console.log('  - timestamp:', new Date().toISOString());
        console.log('[CHAT_V2] ================================================================');
        // CRITICAL: Verificar que OpenAI está bloqueado
        const openaiCheck = (0, router_1.verifyOpenAIBlocked)();
        console.log(`[CHAT_V2] OpenAI Status: ${openaiCheck.message}`);
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
        userId = authenticatedUserId || req.body.userId; // ← Asignar a variable del scope superior
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
        // 2.5. PROCESAR ATTACHMENTS (DOCUMENTOS)
        // ============================================
        const attachmentsRaw = (req.body.attachments ?? req.body.files ?? []);
        const safeAttachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];
        console.log(`[CHAT_V2] 📎 Attachments recibidos: ${safeAttachments.length}`);
        console.log(`[CHAT_V2] 📎 Attachments raw:`, JSON.stringify(attachmentsRaw));
        let attachmentsContext = '';
        if (safeAttachments.length > 0) {
            try {
                console.log(`[CHAT_V2] 📄 Procesando ${safeAttachments.length} documento(s)...`);
                console.log(`[CHAT_V2] Archivos: ${safeAttachments.map((a) => a.name).join(', ')}`);
                // Descargar archivos desde URLs públicas
                const { downloadAttachments, validateAttachment } = await Promise.resolve().then(() => __importStar(require('../services/attachmentDownload')));
                const { extractTextFromFiles } = await Promise.resolve().then(() => __importStar(require('../utils/documentText')));
                const validAttachments = safeAttachments.filter(validateAttachment);
                if (validAttachments.length > 0) {
                    const downloadedFiles = await downloadAttachments(validAttachments);
                    if (downloadedFiles.length > 0) {
                        const extractedDocs = await extractTextFromFiles(downloadedFiles);
                        if (extractedDocs.length > 0) {
                            const docsBlock = extractedDocs
                                .map((doc, i) => {
                                const text = (doc.text || '').slice(0, 50000); // Límite 50k chars por doc
                                return `\n[DOCUMENTO ${i + 1}] ${doc.name} (${doc.type})\n${'-'.repeat(60)}\n${text}\n`;
                            })
                                .join('\n');
                            attachmentsContext = `\n\n=== DOCUMENTOS CARGADOS ===\n${docsBlock}\n=== FIN DOCUMENTOS ===\n`;
                            console.log(`[CHAT_V2] ✅ Procesados ${extractedDocs.length} documento(s), ${attachmentsContext.length} caracteres`);
                        }
                    }
                }
            }
            catch (err) {
                console.error('[CHAT_V2] ❌ Error procesando attachments:', err);
            }
        }
        // ============================================
        // 3. RESOLVER SESSION (crear si no existe)
        // ============================================
        finalWorkspaceId = workspaceId || env_1.env.defaultWorkspaceId; // ← Asignar a variable del scope superior
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
                assistant_id: 'al-e-core', // P0 CRÍTICO: NOT NULL constraint
                user_id: userId,
                workspace_id: finalWorkspaceId,
                mode: 'universal',
                title: 'Nueva conversación',
                last_message_at: new Date().toISOString(),
                meta: {} // Columna JSONB agregada
            });
            if (sessionError) {
                console.error('[CHAT_V2] Error creating session:', sessionError);
                // P0 FIX: NO abortar conversación por error de sesión
                // Continuar sin sesión (sessionId = null) → conversación stateless
                console.warn('[CHAT_V2] ⚠️ Continuando sin sesión (stateless mode)');
                sessionId = null;
            }
            else {
                console.log(`[CHAT_V2] ✓ New session created: ${sessionId}`);
            }
        }
        // ============================================
        // 4. RECONSTRUIR CONTEXTO DESDE SUPABASE
        // ============================================
        console.log('[CHAT_V2] 📚 Reconstructing context from Supabase...');
        // 4.1: Cargar historial de mensajes (P0: incluir user_email y user_display_name)
        const { data: historyData, error: historyError } = await supabase_1.supabase
            .from('ae_messages')
            .select('role, content, user_email, user_display_name, created_at') // P0: Multi-user
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
            user_email: userEmail || null, // P0: Multi-user collaboration
            user_display_name: userDisplayName || null, // P0: Multi-user collaboration
            metadata: {
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
        // 5.5. RECUPERAR CONOCIMIENTO VECTORIAL (BGE-M3)
        // ============================================
        console.log('[CHAT_V2] 🔍 Recuperando conocimiento vectorial...');
        let vectorKnowledgeContext = '';
        let knowledgeSources = [];
        try {
            const { generateEmbedding } = await Promise.resolve().then(() => __importStar(require('../services/embeddingService')));
            const queryEmbedding = await generateEmbedding(message);
            const { data: vectorResults, error: vectorError } = await supabase_1.supabase.rpc('search_knowledge', {
                query_embedding: queryEmbedding,
                match_threshold: 0.7,
                match_count: 5
            });
            if (vectorError) {
                console.error('[CHAT_V2] Error en búsqueda vectorial:', vectorError);
            }
            else if (vectorResults && vectorResults.length > 0) {
                vectorKnowledgeContext = '\n\n🔍 CONOCIMIENTO DOCUMENTADO (Evidencia Real):\n\n';
                vectorKnowledgeContext += vectorResults.map((r, i) => {
                    knowledgeSources.push({
                        path: r.source_path,
                        type: r.source_type,
                        score: r.score
                    });
                    return `[Documento ${i + 1}: ${r.source_path}]\n${r.content}\n(Relevancia: ${(r.score * 100).toFixed(1)}%)`;
                }).join('\n\n---\n\n');
                console.log(`[CHAT_V2] ✓ ${vectorResults.length} documento(s) relevante(s)`);
            }
            else {
                console.log('[CHAT_V2] No se encontró documentación relevante');
            }
        }
        catch (vectorError) {
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
        let lastUserEmail = null;
        const messagesForOrchestrator = history.map((h) => {
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
        }
        else {
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
        const orchestrationPromise = orchestrator.orchestrate(orchestratorRequest, aleon_1.ALEON_SYSTEM_PROMPT);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('ORCHESTRATION_TIMEOUT')), 15000));
        try {
            orchestratorContext = await Promise.race([orchestrationPromise, timeoutPromise]);
            // Inyectar conocimiento vectorial + attachments + anti-mentira en system prompt
            if (vectorKnowledgeContext || attachmentsContext || antiLieWarning) {
                orchestratorContext.systemPrompt += (vectorKnowledgeContext + attachmentsContext + antiLieWarning);
                if (attachmentsContext) {
                    console.log(`[CHAT_V2] 📎 Contexto de documentos agregado al prompt (${attachmentsContext.length} chars)`);
                }
            }
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
                    speak_text: (0, textCleaners_1.markdownToSpeakable)(fallbackMessage),
                    should_speak: true,
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
            const assistantMessageId = (0, uuid_1.v4)();
            await supabase_1.supabase.from('ae_messages').insert({
                id: assistantMessageId,
                session_id: sessionId,
                role: 'assistant',
                content: answer,
                metadata: {
                    user_id: userId,
                    user_id_uuid,
                    workspace_id: finalWorkspaceId,
                    tokens: (0, helpers_1.estimateTokens)(answer),
                    tool_used: orchestratorContext.toolUsed,
                    direct_tool_response: true // Flag para indicar que NO pasó por LLM
                },
                created_at: new Date().toISOString()
            });
            return res.json({
                answer,
                speak_text: (0, textCleaners_1.markdownToSpeakable)(answer),
                should_speak: (0, textCleaners_1.shouldSpeak)(answer),
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
        const llmResult = await (0, router_1.generate)({
            messages: llmMessages,
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
                const retryLLM = await (0, router_1.generate)({
                    messages: extractionMessages,
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
        const guardrailResult = (0, noFakeTools_1.applyAntiLieGuardrail)(llmResult.response.text, orchestratorContext.webSearchUsed, orchestratorContext.intent, orchestratorContext.toolFailed, orchestratorContext.toolError // P0: Pasar código de error OAuth
        );
        finalAnswer = guardrailResult.sanitized // ← Asignar a variable del scope superior
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
            metadata: {
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
        // 11. LOG EN AE_REQUESTS (P0: Observabilidad completa)
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
                tool_error: orchestratorContext.toolError, // P0: LOG OBLIGATORIO para fallos OAuth/timeout
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
        // 11.5. ✅ FIX 3: GUARDAR MEMORIA NUEVA (PRODUCCIÓN REAL)
        // ============================================
        if (userId && userId !== 'guest') {
            try {
                console.log('[CHAT_V2] 🧠 Extracting memories...');
                const { extractAndSaveMemories } = await Promise.resolve().then(() => __importStar(require('../services/memoryExtractor')));
                await extractAndSaveMemories(userId, finalWorkspaceId, message, // Mensaje original del usuario
                finalAnswer // Respuesta del assistant
                );
            }
            catch (memError) {
                console.error('[CHAT_V2] ❌ Error extracting memories:', memError.message);
                // NO bloquear respuesta si falla memory extraction
            }
        }
        // ============================================
        // 12. RESPONDER AL FRONTEND
        // ============================================
        return res.json({
            answer: finalAnswer,
            speak_text: (0, textCleaners_1.markdownToSpeakable)(finalAnswer),
            should_speak: (0, textCleaners_1.shouldSpeak)(finalAnswer),
            session_id: sessionId,
            memories_to_add: [], // Deprecated - se guarda automáticamente via memoryExtractor
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
    }
    catch (error) {
        console.error('[CHAT_V2] ❌ CRITICAL ERROR:', {
            error: error.message,
            error_type: error.name,
            stack: error.stack?.substring(0, 500),
            intent: orchestratorContext?.intent?.intent_type,
            tool_used: orchestratorContext?.toolUsed,
            tool_failed: orchestratorContext?.toolFailed,
            timestamp: new Date().toISOString(),
            user_id: userId,
            session_id: sessionId
        });
        const latency_ms = Date.now() - startTime;
        // P0: Log obligatorio de errores con contexto completo
        if (sessionId) {
            // Sanitizar error stack para evitar referencias circulares
            const errorMetadata = {
                error: error.message || 'Unknown error',
                error_type: error.name || 'UnknownError',
                intent_detected: orchestratorContext?.intent?.intent_type,
                tool_expected: orchestratorContext?.toolUsed,
                tool_executed: orchestratorContext?.toolUsed !== 'none',
                tool_failed: orchestratorContext?.toolFailed || false,
                failure_reason: error.code === 'ETIMEDOUT' ? 'TIMEOUT' :
                    error.message?.includes('OAUTH') ? 'OAUTH_ERROR' :
                        error.message?.includes('provider') ? 'PROVIDER_TIMEOUT' :
                            error.message?.includes('TOOL_REQUIRED') ? 'TOOL_NOT_EXECUTED' :
                                'UNKNOWN_ERROR',
                stack: typeof error.stack === 'string' ? error.stack.substring(0, 1000) : undefined // Truncar stack
            };
            await supabase_1.supabase.from('ae_requests').insert({
                request_id: req.body.request_id || (0, uuid_1.v4)(),
                session_id: sessionId,
                user_id: req.body.userId,
                workspace_id: req.body.workspaceId || env_1.env.defaultWorkspaceId,
                endpoint: '/api/ai/chat/v2',
                method: 'POST',
                status_code: 500,
                latency_ms,
                metadata: errorMetadata
            });
        }
        return res.status(500).json({
            error: 'INTERNAL_ERROR',
            message: error.message,
            speak_text: 'Ocurrió un error al procesar tu solicitud.',
            should_speak: true,
            session_id: sessionId,
            memories_to_add: []
        });
    }
});
exports.default = router;
