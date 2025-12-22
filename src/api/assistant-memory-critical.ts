import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { OpenAIAssistantProvider } from '../ai/providers/OpenAIAssistantProvider';
import { detectLanguage, determineResponseLanguage } from '../utils/language';
import { DatabaseService } from '../db/supabase';
import { ChatRequest, ChatResponse, Message } from '../types';
import { AssistantRequest } from '../ai/IAssistantProvider';

type MessageRole = 'user' | 'assistant' | 'system';
type Language = 'es' | 'en' | 'auto';

const router = express.Router();
const provider = new OpenAIAssistantProvider();
const db = new DatabaseService();

/**
 * ==============================================
 * POLÍTICA DE MEMORIA CRÍTICA - AL-E CORE
 * ==============================================
 * 
 * RESPONSABILIDAD: GARANTIZAR MEMORIA PERSISTENTE
 * 
 * 1. AL-E debe RECORDAR SIEMPRE al usuario
 * 2. La memoria NO depende de tokens ni sesiones
 * 3. OpenAI NO recuerda - AL-E Core SÍ
 * 4. Si AL-E olvida = BUG del backend
 */

interface UserMemoryContext {
  personal: Record<string, any>;
  semantic: Array<{
    content: string;
    importance: number;
    mode: string;
    created_at: string;
  }>;
  recent_sessions: Array<{
    session_id: string;
    title: string;
    workspace_id: string;
    last_message_at: string;
  }>;
}

/**
 * CRÍTICO: Recuperar memoria completa del usuario
 */
async function getUserMemoryContext(userId: string): Promise<UserMemoryContext> {
  try {
    console.log(`[MEMORY-CRITICAL] Recuperando memoria para usuario: ${userId}`);
    
    // Usar función RPC de Supabase
    const memoryResult = await db.executeFunction('get_user_complete_memory', { p_user_id: userId });
    
    if (memoryResult) {
      return memoryResult as UserMemoryContext;
    }
    
    // Fallback: construcción manual de memoria
    const [personal, semantic, sessions] = await Promise.all([
      db.select('ae_user_memory', { user_id: userId }),
      db.select('assistant_memories', { user_id: userId }, { limit: 10, orderBy: 'importance DESC' }),
      db.select('ae_sessions', { user_id: userId, archived: false }, { limit: 5, orderBy: 'last_message_at DESC' })
    ]);
    
    return {
      personal: personal.reduce((acc: any, row: any) => {
        try {
          acc[row.key] = JSON.parse(row.value || '{}');
        } catch {
          acc[row.key] = row.value;
        }
        return acc;
      }, {}),
      semantic: semantic || [],
      recent_sessions: sessions || []
    };
  } catch (error) {
    console.error('[MEMORY-CRITICAL] ERROR recuperando memoria:', error);
    return { personal: {}, semantic: [], recent_sessions: [] };
  }
}

/**
 * CRÍTICO: Construir prompt con memoria completa
 */
function buildMemoryAwarePrompt(
  userMessage: string,
  memoryContext: UserMemoryContext,
  sessionHistory: Message[],
  language: Language
): string {
  const { personal, semantic, recent_sessions } = memoryContext;
  
  const personalInfo = Object.keys(personal).length > 0 
    ? Object.entries(personal).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')
    : 'No hay información personal registrada';
    
  const semanticInfo = semantic.length > 0
    ? semantic.slice(0, 5).map(mem => `• ${mem.content} (importancia: ${mem.importance})`).join('\n')
    : 'No hay memoria semántica previa';
    
  const recentInfo = recent_sessions.length > 0
    ? recent_sessions.slice(0, 3).map(s => `• ${s.title || 'Sin título'}`).join('\n')
    : 'Primera interacción';
    
  const historyInfo = sessionHistory.length > 0
    ? sessionHistory.slice(-3).map(msg => `${msg.role}: ${msg.content}`).join('\n')
    : 'Nueva conversación';
  
  return `Eres AL-E, asistente con memoria persistente que SIEMPRE recuerda al usuario.

MEMORIA PERSONAL (CRÍTICA - NO OLVIDAR):
${personalInfo}

CONTEXTO SEMÁNTICO RELEVANTE:
${semanticInfo}

SESIONES RECIENTES:
${recentInfo}

HISTORIAL ACTUAL:
${historyInfo}

CONSULTA ACTUAL:
${userMessage}

INSTRUCCIONES CRÍTICAS:
1. USA toda la memoria disponible para responder con contexto
2. Si detectas información nueva importante del usuario, devuelve "memories_to_add" 
3. Responde en ${language}
4. Mantén coherencia absoluta con conversaciones previas
5. Si no recuerdas algo que el usuario menciona, es un ERROR del sistema

Formato de respuesta (JSON):
{
  "answer": "tu respuesta contextual",
  "memories_to_add": {"clave": "valor"} // solo si hay información nueva importante
}`;
}

/**
 * CRÍTICO: Guardar memoria personal permanente
 */
async function saveUserMemories(userId: string, memories: Record<string, any>): Promise<void> {
  if (!memories || Object.keys(memories).length === 0) return;
  
  try {
    console.log(`[MEMORY-CRITICAL] Guardando ${Object.keys(memories).length} memorias para ${userId}`);
    
    for (const [key, value] of Object.entries(memories)) {
      // Usar función upsert que creamos en la migración
      await db.executeFunction('upsert_user_memory', {
        p_user_id: userId,
        p_key: key,
        p_value: JSON.stringify(value)
      });
    }
    
    console.log(`[MEMORY-CRITICAL] ✓ Memorias guardadas permanentemente`);
  } catch (error) {
    console.error('[MEMORY-CRITICAL] ERROR guardando memorias:', error);
    throw error; // Es crítico que no falle silenciosamente
  }
}

/**
 * CRÍTICO: Garantizar que existe una sesión válida
 */
async function ensureSession(userId: string, sessionId?: string, workspaceId: string = 'default'): Promise<string> {
  try {
    if (sessionId) {
      // Verificar que la sesión existe
      const existing = await db.select('ae_sessions', { id: sessionId });
      if (existing && existing.length > 0) {
        return sessionId;
      }
    }
    
    // Crear nueva sesión
    const newSessionId = uuidv4();
    await db.insert('ae_sessions', {
      id: newSessionId,
      user_id: userId,
      assistant_id: 'al-e-core',
      workspace_id: workspaceId,
      mode: 'aleon',
      created_at: new Date().toISOString(),
      metadata: {}
    });
    
    console.log(`[SESSION-CRITICAL] Nueva sesión creada: ${newSessionId}`);
    return newSessionId;
  } catch (error) {
    console.error('[SESSION-CRITICAL] Error creando sesión:', error);
    throw error;
  }
}

/**
 * CRÍTICO: Guardar mensaje en base de datos SIEMPRE
 */
async function saveMessage(sessionId: string, role: MessageRole, content: string, metadata: any = {}): Promise<string> {
  try {
    const messageId = uuidv4();
    await db.insert('ae_messages', {
      id: messageId,
      session_id: sessionId,
      role,
      content,
      metadata: JSON.stringify(metadata),
      created_at: new Date().toISOString()
    });
    
    console.log(`[MESSAGE-CRITICAL] Mensaje guardado: ${role} -> ${messageId}`);
    return messageId;
  } catch (error) {
    console.error('[MESSAGE-CRITICAL] ERROR guardando mensaje:', error);
    throw error; // Crítico que no falle
  }
}

/**
 * GET /api/ai/ping
 * Diagnóstico del sistema de memoria
 */
router.get('/ping', (req, res) => {
  res.json({ 
    status: 'AL-E CORE MEMORY SYSTEM ONLINE',
    timestamp: new Date().toISOString(),
    memory_policy: 'CRITICAL - NEVER FORGET',
    version: 'GPT-PRO-MEMORY'
  });
});

/**
 * POST /api/ai/chat
 * ENDPOINT CRÍTICO CON MEMORIA PERSISTENTE GARANTIZADA
 */
router.post('/chat', async (req, res) => {
  let sessionId: string | undefined;
  
  try {
    const startTime = Date.now();
    console.log('\n[CHAT-CRITICAL] ==================== NUEVA SOLICITUD ====================');
    
    const { 
      userId, 
      sessionId: requestSessionId, 
      messages, 
      workspaceId = 'default' 
    } = req.body as ChatRequest;
    
    // Validación crítica
    if (!userId || !messages || messages.length === 0) {
      return res.status(400).json({
        answer: 'Error: userId y messages son obligatorios',
        sessionId: null,
        actions: [],
        sources: [],
        artifacts: []
      });
    }
    
    const userMessage = messages[messages.length - 1];
    if (!userMessage || userMessage.role !== 'user') {
      return res.status(400).json({
        answer: 'Error: El último mensaje debe ser del usuario',
        sessionId: null,
        actions: [],
        sources: [],
        artifacts: []
      });
    }
    
    console.log(`[CHAT-CRITICAL] Usuario: ${userId}, Workspace: ${workspaceId}`);
    
    // 1. GARANTIZAR SESIÓN (CRÍTICO)
    sessionId = await ensureSession(userId, requestSessionId, workspaceId);
    
    // 2. RECUPERAR MEMORIA COMPLETA (CRÍTICO)
    const memoryContext = await getUserMemoryContext(userId);
    console.log(`[MEMORY-CRITICAL] Memoria recuperada:`, {
      personal_keys: Object.keys(memoryContext.personal).length,
      semantic_count: memoryContext.semantic.length,
      recent_sessions: memoryContext.recent_sessions.length
    });
    
    // 3. RECUPERAR HISTORIAL DE SESIÓN
    const sessionMessages = await db.select('ae_messages', 
      { session_id: sessionId }, 
      { orderBy: 'created_at ASC', limit: 20 }
    );
    
    const sessionHistory: Message[] = sessionMessages.map((msg: any) => ({
      role: msg.role as MessageRole,
      content: msg.content
    }));
    
    // 4. DETECTAR IDIOMA
    const language = detectLanguage(userMessage.content);
    const responseLanguage = determineResponseLanguage(userMessage.content);
    console.log(`[LANGUAGE] Detectado: ${language.primaryLanguage} -> Respuesta: ${responseLanguage}`);
    
    // 5. CONSTRUIR PROMPT CON MEMORIA (CRÍTICO)
    const memoryPrompt = buildMemoryAwarePrompt(
      userMessage.content,
      memoryContext,
      sessionHistory,
      (responseLanguage === 'es' || responseLanguage === 'en') ? responseLanguage : 'auto' as Language
    );
    
    // 6. GUARDAR MENSAJE DEL USUARIO (CRÍTICO)
    await saveMessage(sessionId, 'user', userMessage.content, {
      language,
      workspace_id: workspaceId,
      timestamp: new Date().toISOString()
    });
    
    // 7. LLAMADA A OPENAI (único uso de tokens)
    console.log('[OPENAI] Enviando prompt con memoria completa...');
    const assistantRequest: AssistantRequest = {
      messages: [{
        role: 'user',
        content: memoryPrompt
      }],
      mode: 'aleon' as any,
      workspaceId,
      userId
    };
    const response = await provider.chat(assistantRequest);
    
    let aiResponse: any;
    let memoriesToAdd: Record<string, any> = {};
    
    try {
      // Intentar parsear como JSON
      aiResponse = JSON.parse(response.content);
      if (aiResponse.memories_to_add) {
        memoriesToAdd = aiResponse.memories_to_add;
        delete aiResponse.memories_to_add;
      }
    } catch (parseError) {
      // Si no es JSON, usar respuesta directa
      aiResponse = { answer: response.content };
    }
    
    const finalAnswer = aiResponse.answer || response.content;
    
    // 8. GUARDAR RESPUESTA DEL ASISTENTE (CRÍTICO)
    await saveMessage(sessionId, 'assistant', finalAnswer, {
      model: response.raw?.model || 'gpt-4',
      tokens: 0, // No tenemos usage en este provider
      cost: 0,
      language: responseLanguage,
      memories_detected: Object.keys(memoriesToAdd).length
    });
    
    // 9. GUARDAR NUEVA MEMORIA PERSONAL (CRÍTICO)
    if (Object.keys(memoriesToAdd).length > 0) {
      await saveUserMemories(userId, memoriesToAdd);
    }
    
    // 10. RESPUESTA FINAL
    const totalTime = Date.now() - startTime;
    console.log(`[CHAT-CRITICAL] ✓ Completado en ${totalTime}ms`);
    console.log('[CHAT-CRITICAL] ==================== FIN SOLICITUD ====================\n');
    
    const chatResponse: ChatResponse = {
      answer: finalAnswer,
      sessionId,
      actions: [],
      sources: [],
      artifacts: []
    };
    
    res.json(chatResponse);
    
  } catch (error) {
    console.error('[CHAT-CRITICAL] ERROR GRAVE:', error);
    
    const errorResponse: ChatResponse = {
      answer: 'Error en sistema de memoria crítico',
      sessionId: sessionId || null,
      actions: [],
      sources: [],
      artifacts: []
    };
    
    res.status(500).json(errorResponse);
  }
});

export default router;