import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { processAssistantRequest } from '../services/assistantService';
import { AssistantRequest } from '../ai/IAssistantProvider';
import { saveMemory } from '../memory/memoryService';
import { detectExternalDataIntent } from '../integrations/intentDetector';
import { getExchangeRateUSDToMXN } from '../integrations/externalData';
import { detectLanguage, determineResponseLanguage, generateLanguageInstructions } from '../utils/language';
import { ChatRequest, ChatResponse, AssistantMode } from '../types';
import { db } from '../db/supabase';
import * as os from 'os';

const router = express.Router();

/**
 * GET /api/ai/ping
 * Endpoint de diagnóstico inmediato
 */
router.get('/ping', (req, res) => {
  res.json({ 
    ok: true, 
    message: "AL-E Core vivo", 
    timestamp: Date.now() 
  });
});

/**
 * POST /api/ai/chat
 * Endpoint principal para interactuar con L.U.C.I / AL-E
 * CONTRATO ESTANDARIZADO GPT PRO
 */
router.post('/chat', async (req, res) => {
  console.log("[AL-E CORE] Chat endpoint invocado - GPT PRO");
  const startTime = Date.now();

  try {
    // Extraer y validar payload con soporte para sesiones
    const chatRequest: ChatRequest = {
      workspaceId: req.body.workspaceId || 'default',
      userId: req.body.userId,
      mode: req.body.mode || 'aleon',
      sessionId: req.body.sessionId,
      messages: req.body.messages,
      meta: req.body.meta
    };

    // Validaciones básicas
    if (!chatRequest.userId) {
      return res.status(400).json({
        error: "MISSING_USER_ID",
        message: "userId is required"
      });
    }

    if (!chatRequest.messages || !Array.isArray(chatRequest.messages)) {
      return res.status(400).json({
        error: "INVALID_MESSAGES",
        message: "messages debe ser un array con al menos un mensaje de usuario"
      });
    }

    // Validar que haya al menos un mensaje de usuario
    const hasUserMessage = chatRequest.messages.some(msg => msg.role === 'user');
    if (chatRequest.messages.length === 0 || !hasUserMessage) {
      return res.status(400).json({
        error: "NO_USER_MESSAGE",
        message: "Debe incluir al menos un mensaje con role 'user'"
      });
    }

    // ============================================
    // GESTIÓN DE SESIÓN
    // ============================================
    let sessionId = chatRequest.sessionId;
    
    // Crear nueva sesión si no se proporciona
    if (!sessionId) {
      const session = await db.createSession({
        workspaceId: chatRequest.workspaceId,
        userId: chatRequest.userId,
        mode: chatRequest.mode
      });
      sessionId = session.id;
      console.log('[CHAT] Nueva sesión creada:', sessionId);
    }

    // Guardar mensaje del usuario en la base de datos
    const lastUserMessage = chatRequest.messages
      .filter((m: any) => m.role === 'user')
      .slice(-1)[0];

    if (lastUserMessage) {
      await db.addMessage({
        sessionId,
        role: 'user',
        content: lastUserMessage.content,
        meta: lastUserMessage.meta || {}
      });
    }

    // ============================================
    // DETECCIÓN Y CONFIGURACIÓN DE IDIOMA
    // ============================================
    const userText = lastUserMessage?.content || '';
    const detectedLanguage = detectLanguage(userText);
    const responseLanguage = determineResponseLanguage(
      userText, 
      chatRequest.meta?.responseLanguage
    );
    
    console.log('[LANGUAGE] Detección de idioma:', {
      userText: userText.substring(0, 50) + '...',
      detectedLanguage: detectedLanguage.primaryLanguage,
      confidence: detectedLanguage.confidence,
      responseLanguage,
      override: chatRequest.meta?.responseLanguage
    });

    // ============================================
    // RECUPERAR MEMORIA RELEVANTE (RAG)
    // ============================================
    const relevantMemories = await db.getRelevantMemories(
      chatRequest.workspaceId || 'default',
      chatRequest.userId,
      chatRequest.mode || 'aleon'
    );

    // ============================================
    // PREPARAR CONTEXTO PARA OPENAI
    // ============================================
    const payload: AssistantRequest = {
      workspaceId: chatRequest.workspaceId,
      userId: chatRequest.userId,
      mode: chatRequest.mode || 'aleon',
      messages: chatRequest.messages
    };

    // Agregar instrucciones de idioma al contexto si no es inglés por defecto
    if (responseLanguage !== 'en') {
      const languageInstructions = generateLanguageInstructions(responseLanguage);
      payload.messages = [
        {
          role: 'system',
          content: languageInstructions
        },
        ...payload.messages
      ];
    }

    // Agregar memoria relevante al contexto
    if (relevantMemories.length > 0) {
      const memoryContext = relevantMemories
        .map(m => `[Memoria]: ${m.memory}`)
        .join('\n');
      
      payload.messages.unshift({
        role: 'system',
        content: `Contexto de memorias del usuario:\n${memoryContext}`
      });
    }

    // ============================================
    // DETECCIÓN DE INTENTS PARA DATOS EXTERNOS
    // ============================================
    const externalIntent = detectExternalDataIntent(userText);

    // Si detectamos un intent de datos externos, intentamos resolverlo
    if (externalIntent.type !== 'NONE') {
      console.log('[EXTERNAL_DATA_HANDLER] Intent detectado:', externalIntent.type);

      // INTENT: Tipo de cambio USD/MXN
      if (externalIntent.type === 'EXCHANGE_RATE_USD_MXN') {
        const exchangeRate = await getExchangeRateUSDToMXN();

        if (exchangeRate !== null) {
          // Respuesta directa con datos de la API externa
          console.log('[EXTERNAL_DATA_HANDLER] Respondiendo con tipo de cambio:', exchangeRate);
          
          const answer = `El tipo de cambio actual USD/MXN está aproximadamente en $${exchangeRate.toFixed(2)} pesos mexicanos por dólar. Esta información proviene de una fuente financiera externa actualizada en tiempo real.`;

          return res.json({
            answer,
            displayText: answer,
            actions: [],
            memories_to_add: [],
            source: 'external_api',
            data: { exchangeRate, base: 'USD', target: 'MXN' }
          });
        } else {
          // Si la API falla, continuar con OpenAI pero agregar contexto
          console.log('[EXTERNAL_DATA_HANDLER] API externa falló, continuando con OpenAI');
          // Modificar el último mensaje para indicar que no se pudo obtener datos externos
          payload.messages = [
            ...payload.messages.slice(0, -1),
            {
              role: 'system',
              content: 'NOTA: El usuario preguntó por el tipo de cambio USD/MXN, pero no se pudo obtener información en tiempo real de fuentes externas. Responde de forma general y sugiere consultar fuentes financieras oficiales.'
            },
            lastUserMessage
          ];
        }
      }

      // Otros intents (WEATHER, NEWS, CRYPTO) caen aquí cuando estén implementados
      // Por ahora continúan con el flujo normal de OpenAI
      if (externalIntent.type === 'WEATHER') {
        console.log('[EXTERNAL_DATA_HANDLER] WEATHER intent detectado pero no implementado, usando OpenAI');
      }
      if (externalIntent.type === 'NEWS') {
        console.log('[EXTERNAL_DATA_HANDLER] NEWS intent detectado pero no implementado, usando OpenAI');
      }
      if (externalIntent.type === 'CRYPTO_PRICE') {
        console.log('[EXTERNAL_DATA_HANDLER] CRYPTO_PRICE intent detectado pero no implementado, usando OpenAI');
      }
    }

    // Procesar solicitud con OpenAI (flujo normal o fallback)
    const response = await processAssistantRequest(payload);

    // Reconocimiento simple de acciones basado en texto
    function detectActions(text: string): any[] {
      const actions: any[] = [];
      const t = (text || '').toLowerCase();

      // Citas
      if (/(agend(a|ar)|cita|reunión|appointment)/.test(t)) {
        actions.push({ type: 'CREATE_APPOINTMENT', payload: {} });
      }
      if (/(reprogram(a|ar)|mueve|cambia|update).*(cita|reunión|appointment)/.test(t)) {
        actions.push({ type: 'UPDATE_APPOINTMENT', payload: {} });
      }

      // Tareas
      if (/(tarea|task|pendiente).*(crear|create)/.test(t) || /(crear|create).*(tarea|task)/.test(t)) {
        actions.push({ type: 'CREATE_TASK', payload: {} });
      }
      if (/(actualiza|update|modifica|editar).*(tarea|task)/.test(t)) {
        actions.push({ type: 'UPDATE_TASK', payload: {} });
      }

      // Recordatorios
      if (/(recordatorio|reminder).*(crear|create)/.test(t) || /(crear|create).*(recordatorio|reminder)/.test(t)) {
        actions.push({ type: 'CREATE_REMINDER', payload: {} });
      }
      if (/(actualiza|update|modifica).*(recordatorio|reminder)/.test(t)) {
        actions.push({ type: 'UPDATE_REMINDER', payload: {} });
      }

      // Documentos
      if (/(documento|contrato|informe|reporte).*(gener(a|ar)|create|generate)/.test(t) || /(gener(a|ar)|create|generate).*(documento|contrato|informe|reporte)/.test(t)) {
        actions.push({ type: 'GENERATE_DOCUMENT', payload: {} });
      }

      return actions;
    }

    // Heurística simple de memorias: detectar frases tipo "mi nombre es ...", "vivo en ...", "mi correo es ..."
    function detectMemories(text: string): any[] {
      const memories: any[] = [];
      const matchName = text.match(/mi nombre es\s+([A-Za-zÀ-ÿ'\-\s]+)/i);
      if (matchName) memories.push({ kind: 'user_name', value: matchName[1].trim() });

      const matchCity = text.match(/(vivo en|resido en)\s+([A-Za-zÀ-ÿ'\-\s]+)/i);
      if (matchCity) memories.push({ kind: 'user_city', value: matchCity[2].trim() });

      const matchEmail = text.match(/mi correo es\s+([\w._%+-]+@[\w.-]+\.[A-Za-z]{2,})/i);
      if (matchEmail) memories.push({ kind: 'user_email', value: matchEmail[1].trim() });

      return memories;
    }

    const userLastMsg = (payload.messages || []).filter(m => m.role === 'user').slice(-1)[0];
    const userTextForActions = typeof userLastMsg?.content === 'string' 
      ? userLastMsg.content 
      : '';

    // Extracción de detalles para citas
    function extractAppointmentDetails(userMessage: string) {
      const text = userMessage || '';
      const t = text.trim();

      // Fecha y hora
      let date: string | null = null;
      let time: string | null = null;

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const toYYYYMMDD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

      if (/\bmañana\b/i.test(t)) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        date = toYYYYMMDD(d);
      } else if (/\bhoy\b/i.test(t)) {
        date = toYYYYMMDD(now);
      } else if (/\bpasado mañana\b/i.test(t)) {
        const d = new Date(now);
        d.setDate(d.getDate() + 2);
        date = toYYYYMMDD(d);
      }

      // Hora: HH:mm o formatos comunes "a las 10", "a las 10:30", con am/pm
      const timeMatch = t.match(/\b(\d{1,2})(:(\d{2}))?\b\s*(am|pm)?/i);
      if (timeMatch) {
        let hour = parseInt(timeMatch[1], 10);
        const minute = timeMatch[3] ? parseInt(timeMatch[3], 10) : 0;
        const ampm = timeMatch[4]?.toLowerCase();
        if (ampm === 'pm' && hour < 12) hour += 12;
        if (ampm === 'am' && hour === 12) hour = 0;
        time = `${pad(hour)}:${pad(minute)}`;
      }

      // Ubicación
      let location: string | null = null;
      const locMatch = t.match(/(en\s+|ubicaci[óo]n:\s*)([A-Za-zÀ-ÿ0-9'\-\s]+)/i);
      if (locMatch) {
        location = locMatch[2].trim();
      } else if (/\b(dentista|doctor|cl[ií]nica|oficina)\b/i.test(t)) {
        location = t.match(/\b(dentista|doctor|cl[ií]nica|oficina)\b/i)?.[0] || null;
      }

      // Título y notas
      let title = 'Cita';
      if (/dentista/i.test(t)) title = 'Cita con el dentista';
      else if (/reuni[óo]n/i.test(t)) title = 'Reunión';
      else if (/cita/i.test(t)) title = 'Cita';

      const notes = t;

      return { title, date, time, location, notes };
    }

    // Detectar intención de crear cita y construir acción con detalles
    const actions: any[] = [];
    const appointmentIntent = /(agend(ar|a)\s+(una\s+)?cita|program(ar|a)\s+(una\s+)?reuni[óo]n|cita\s+(mañana|hoy|pasado mañana|el)\b|cita\s+con\s+el\s+dentista)/i.test(userTextForActions);
    if (appointmentIntent) {
      const details = extractAppointmentDetails(userTextForActions);
      actions.push({
        type: 'CREATE_APPOINTMENT',
        payload: {
          title: details.title,
          date: details.date,
          time: details.time,
          location: details.location,
          notes: details.notes
        }
      });
    } else {
      const genericActions = detectActions(userTextForActions + '\n' + (response.content || ''));
      genericActions.forEach(a => actions.push(a));
    }

    const memories_to_add = detectMemories(userTextForActions + '\n' + (response.content || ''));

    // ============================================
    // GUARDAR RESPUESTA DEL ASISTENTE
    // ============================================
    const answerContent = response.content || '';
    
    await db.addMessage({
      sessionId,
      role: 'assistant',
      content: answerContent,
      meta: {
        model: 'gpt-4',
        tokensUsed: response.usage?.total_tokens || 0,
        detectedLanguage: detectedLanguage.primaryLanguage,
        responseLanguage
      }
    });

    // ============================================
    // GUARDAR MEMORIAS DETECTADAS
    // ============================================
    for (const memory of memories_to_add) {
      await db.saveMemory({
        workspaceId: chatRequest.workspaceId || 'default',
        userId: chatRequest.userId,
        mode: chatRequest.mode || 'aleon',
        memory: `${memory.kind}: ${memory.value}`,
        importance: memory.importance || 1,
        memoryType: 'user_fact'
      });
    }

    // ============================================
    // LOGGING DE REQUEST PARA OBSERVABILIDAD
    // ============================================
    const latencyMs = Date.now() - startTime;
    await db.logRequest({
      sessionId,
      userId: chatRequest.userId,
      endpoint: '/api/ai/chat',
      model: 'gpt-4',
      tokensIn: response.usage?.prompt_tokens || 0,
      tokensOut: response.usage?.completion_tokens || 0,
      latencyMs,
      costUsd: (response.usage?.total_tokens || 0) * 0.00003, // Estimación
      statusCode: 200
    });

    // ============================================
    // RESPUESTA ESTANDARIZADA GPT PRO
    // ============================================
    const standardResponse: ChatResponse = {
      answer: answerContent,
      sessionId,
      actions,
      sources: [], // Se llenarán con web search, archivos, etc.
      artifacts: [], // Documentos, imágenes generadas, etc.
      memories_to_add,
      meta: {
        detectedLanguage: detectedLanguage.primaryLanguage,
        responseLanguage,
        model: 'gpt-4',
        tokens: response.usage?.total_tokens || 0,
        cost: (response.usage?.total_tokens || 0) * 0.00003,
        ...(chatRequest.meta?.enableTTS && { audioUrl: null })
      }
    };

    console.log('[CHAT] Respuesta enviada - sesión:', sessionId, 'tokens:', response.usage?.total_tokens);
    
    res.json(standardResponse);

  } catch (error) {
    // Logging de error
    const latencyMs = Date.now() - startTime;
    
    // Intentar obtener sessionId y userId si están disponibles
    let sessionId, userId;
    try {
      sessionId = req.body.sessionId;
      userId = req.body.userId || 'unknown';
    } catch {
      sessionId = undefined;
      userId = 'unknown';
    }
    
    await db.logRequest({
      sessionId,
      userId,
      endpoint: '/api/ai/chat',
      latencyMs,
      statusCode: 500,
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    console.error('[CHAT_ERROR] Error en /api/ai/chat:', error);

    // Respuesta de error estandarizada
    res.status(500).json({
      error: 'CHAT_ERROR',
      message: error instanceof Error ? error.message : 'Error interno en AL-E Core',
      sessionId: sessionId || null,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/ai/ping
 * Endpoint de diagnóstico inmediato
 */
router.get('/ping', async (req, res) => {
  return res.json({
    ok: true,
    message: "AL-E Core vivo",
    timestamp: Date.now()
  });
});

/**
 * GET /api/ai/status
 * Endpoint para verificar el estado del servicio de asistente
 */
router.get('/status', async (req, res) => {
  try {
    res.json({
      status: 'ok',
      service: 'AL-E Assistant',
      version: '1.0.0',
      modes: ['aleon'],  // Solo AL-EON generalista
      provider: 'openai',
      memory: {
        enabled: true,
        connection: 'ok',
        schema: 'public.assistant_memories'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error en status endpoint:', error);
    res.status(500).json({
      status: 'error',
      service: 'AL-E Assistant',
      error: error instanceof Error ? error.message : 'Error desconocido',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/ai/memories
 * Endpoint para verificar memorias guardadas (debug)
 */
router.get('/memories', async (req, res) => {
  try {
    const { workspaceId, userId, mode, limit } = req.query;
    
    const { getRelevantMemories } = await import('../memory/memoryService');
    
    const memories = await getRelevantMemories(
      workspaceId as string || 'default',
      userId as string || 'anonymous',
      mode as string || 'aleon',
      parseInt(limit as string) || 10
    );

    res.json({
      memories,
      count: memories.length,
      query: { workspaceId, userId, mode, limit }
    });
  } catch (error) {
    console.error('Error obteniendo memorias:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Error desconocido'
    });
  }
});

/**
 * GET /api/ai/debugtest
 * Endpoint simple de prueba
 */
router.get('/debugtest', async (req, res) => {
  try {
    res.json({
      message: "Debug test endpoint working",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[DebugTest][ERROR]', err);
    res.status(500).json({
      error: 'Error in debug test'
    });
  }
});

/**
 * GET /api/ai/debug/ip
 * Endpoint de prueba de red simple
 */
router.get('/debug/ip', async (req, res) => {
  try {
    const os = await import('os');
    const networkInterfaces = os.networkInterfaces();
    
    let serverIp = null;
    for (const [name, interfaces] of Object.entries(networkInterfaces)) {
      if (interfaces) {
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            serverIp = iface.address;
            break;
          }
        }
      }
      if (serverIp) break;
    }

    return res.json({
      serverHost: req.hostname,
      serverIp: serverIp,
      publicIp: null
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

/**
 * GET /api/ai/debug/outbound
 * Endpoint para probar conectividad externa
 */
router.get('/debug/outbound', async (req, res) => {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    return res.json({ ok: true, ip: data.ip });
  } catch (err) {
    return res.status(500).json({ 
      ok: false, 
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

/**
 * GET /api/ai/debug/memories
 * Endpoint para debug directo de la tabla assistant_memories
 */
router.get('/debug/memories', async (req, res) => {
  try {
    const { db: pool } = await import('../db/client');

    const result = await pool.query(`
      SELECT id, workspace_id, user_id, mode, memory, importance, created_at
      FROM public.assistant_memories
      ORDER BY created_at DESC
      LIMIT 5;
    `);

    return res.json({ rows: result.rows });
  } catch (err) {
    console.error('[DebugMemories][ERROR]', err);
    return res.status(500).json({
      message: 'Error accessing memories table',
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

/**
 * GET /api/ai/debug/ip
 * Endpoint de prueba de red simple
 */
router.get('/debug/ip', (req, res) => {
  const interfaces = os.networkInterfaces();
  let serverIp = 'unknown';
  
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIp = iface.address;
        break;
      }
    }
  }
  
  res.json({
    serverHost: req.hostname,
    serverIp: serverIp,
    publicIp: null
  });
});

/**
 * GET /api/ai/debug/outbound
 * Prueba de conectividad externa
 */
router.get('/debug/outbound', async (req, res) => {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    res.json({ ok: true, ip: data.ip });
  } catch (err) {
    res.status(500).json({ 
      ok: false, 
      error: err instanceof Error ? err.message : String(err) 
    });
  }
});

export { router as assistantRouter };