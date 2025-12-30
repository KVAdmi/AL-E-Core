/**
 * AL-E Core Orchestrator
 * 
 * Sistema de orquestación inteligente que reemplaza el flujo chatbot simple.
 * Ejecuta pipeline completo: auth → profile → memories → RAG → tools → model selection → provider
 * 
 * CRÍTICO: NO es un chatbot. Es un sistema orquestado con contexto completo.
 * 
 * COST CONTROL:
 * - Max output tokens: 600
 * - Max history: 16 messages
 * - Cache: 10 min para requests repetidos
 */

import { Request } from 'express';
import { getUserIdentity, buildBrandContext, buildIdentityBlock, UserIdentity } from '../services/userProfile';
import { supabase } from '../db/supabase';
import { retrieveRelevantChunks } from '../services/chunkRetrieval';
import { webSearch, formatTavilyResults, shouldUseWebSearch, TavilySearchResponse } from '../services/tavilySearch';
import { classifyIntent, generateFallbackContext, IntentClassification } from '../services/intentClassifier';
import crypto from 'crypto';

// ═══════════════════════════════════════════════════════════════
// COST CONTROL CONSTANTS
// ═══════════════════════════════════════════════════════════════

const MAX_OUTPUT_TOKENS = 600;
const MAX_HISTORY_MESSAGES = 16;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

// Production: In-memory cache (Redis migration available if needed)
const responseCache = new Map<string, { response: string; timestamp: number; context: any }>();

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface OrchestratorRequest {
  messages: Array<{ role: string; content: string }>;
  userId: string;
  workspaceId: string;
  projectId?: string;
  sessionId?: string;
  mode?: string;
}

export interface OrchestratorContext {
  // Auth
  isAuthenticated: boolean;
  userId: string;
  
  // Profile
  userIdentity: UserIdentity | null;
  
  // Memory
  memories: Array<{
    id: string;
    content: string;
    type: string;
    importance: number;
  }>;
  
  // RAG
  chunks: Array<{
    content: string;
    source: string;
  }>;
  
  // Intent Classification (NUEVO)
  intent: IntentClassification;
  
  // Tools
  toolUsed: string;
  toolReason?: string;
  toolResult?: string;
  toolFailed: boolean;
  toolError?: string;
  tavilyResponse?: TavilySearchResponse;
  
  // Model
  modelSelected: string;
  modelReason?: string;
  
  // System Prompt
  systemPrompt: string;
  
  // Metrics
  memoryCount: number;
  ragHits: number;
  webSearchUsed: boolean;
  webResultsCount: number;
  cacheHit: boolean;
  inputTokens: number;
  outputTokens: number;
  maxOutputTokens: number;
  
  // Answer Mode (NUEVO)
  answerMode: 'verified' | 'offline_general' | 'offline_with_estimate' | 'stable_knowledge';
}

export interface OrchestratorResponse {
  content: string;
  context: OrchestratorContext;
  raw: any;
}

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR CLASS
// ═══════════════════════════════════════════════════════════════

export class Orchestrator {
  
  /**
   * STEP 1: Verificar autenticación
   */
  private async checkAuth(req: OrchestratorRequest): Promise<{ isAuthenticated: boolean; userId: string }> {
    const isAuthenticated = !!req.userId && req.userId !== 'guest' && req.userId !== 'health-check';
    const userId = req.userId || 'guest';
    
    console.log(`[ORCH] auth=${isAuthenticated}, user_uuid=${userId}`);
    
    return { isAuthenticated, userId };
  }
  
  /**
   * STEP 2: Cargar perfil del usuario
   */
  private async loadProfile(userId: string, isAuthenticated: boolean): Promise<UserIdentity | null> {
    if (!isAuthenticated) {
      console.log('[ORCH] profile=skipped (guest)');
      return null;
    }
    
    try {
      const identity = await getUserIdentity(userId);
      console.log(`[ORCH] profile_loaded=${!!identity}, name=${identity?.name || 'N/A'}`);
      return identity;
    } catch (err) {
      console.error('[ORCH] Error loading profile:', err);
      return null;
    }
  }
  
  /**
   * STEP 3: Cargar memorias explícitas (importance >= 3)
   */
  private async loadMemories(userId: string, workspaceId: string, projectId?: string): Promise<Array<any>> {
    try {
      console.log(`[ORCH] 🔍 Loading memories for userId: ${userId}, workspaceId: ${workspaceId}`);
      
      // Memorias de usuario (buscar en user_id_uuid o user_id)
      const { data: userMemories, error: userError } = await supabase
        .from('assistant_memories')
        .select('id, memory, importance, created_at')
        .eq('workspace_id', workspaceId)
        .or(`user_id_uuid.eq.${userId},user_id.eq.${userId}`)
        .gte('importance', 0.3) // Threshold más bajo para incluir más memorias
        .order('importance', { ascending: false })
        .limit(10);
      
      if (userError) {
        console.error('[ORCH] ❌ Error loading user memories:', userError);
        return [];
      }
      
      console.log(`[ORCH] ✅ Loaded ${userMemories?.length || 0} memories from assistant_memories table`);
      
      // Mapear al formato esperado (memory → content)
      const mappedMemories = (userMemories || []).map(m => ({
        id: m.id,
        content: m.memory, // La columna se llama 'memory' no 'content'
        memory_type: 'user',
        importance: m.importance,
        created_at: m.created_at
      }));
      
      return mappedMemories;
    } catch (err) {
      console.error('[ORCH] ❌ Error in loadMemories:', err);
      return [];
    }
  }
  
  /**
   * STEP 4: RAG - Recuperar chunks relevantes
   */
  private async ragRetrieve(userId: string, workspaceId: string, projectId: string, userMessage: string): Promise<Array<any>> {
    try {
      const chunks = await retrieveRelevantChunks({
        query: userMessage,
        workspaceId,
        userId,
        projectId: projectId || 'N/A',
        limit: 3
      });
      
      console.log(`[ORCH] rag_hits=${chunks.length}`);
      return chunks;
    } catch (err) {
      console.error('[ORCH] Error in RAG retrieval:', err);
      return [];
    }
  }
  
  /**
   * STEP 4.5: Clasificar intención (NUEVO)
   * Determina el tipo de conocimiento requerido y la estrategia de respuesta
   */
  private classifyUserIntent(userMessage: string): IntentClassification {
    console.log(`[ORCH] 📩 Calling classifyIntent with message: "${userMessage.substring(0, 100)}"`);
    const result = classifyIntent(userMessage);
    console.log(`[ORCH] 📊 Intent result: type=${result.intent_type}, confidence=${result.confidence}, tools=${result.tools_required.join(',')}`);
    return result;
  }
  
  /**
   * STEP 5: Decidir herramienta (tool decision) y ejecutarla
   * CRÍTICO: Intent-driven tool execution con fallback resiliente
   */
  private async decideAndExecuteTool(
    userMessage: string,
    intent: IntentClassification,
    userId: string
  ): Promise<{ 
    toolUsed: string; 
    toolReason?: string;
    toolResult?: string;
    toolFailed: boolean;
    toolError?: string;
    tavilyResponse?: TavilySearchResponse;
  }> {
    
    // Si el intent NO requiere tools, skip
    if (intent.tools_required.length === 0) {
      console.log('[ORCH] ℹ️ Intent: stable knowledge - no tools required');
      return {
        toolUsed: 'none',
        toolReason: 'Stable knowledge query',
        toolFailed: false
      };
    }
    
    // ═══════════════════════════════════════════════════════════════
    // TRANSACTIONAL TOOLS (Email Manual + Calendar Interno + Telegram)
    // ═══════════════════════════════════════════════════════════════
    // P0 FIX: Verificar integraciones activas ANTES de responder "No tengo acceso"
    // ═══════════════════════════════════════════════════════════════
    
    if (intent.intent_type === 'transactional') {
      console.log('[ORCH] � Intent: TRANSACTIONAL - Verificando integraciones...');
      
      // Verificar si hay cuentas configuradas (email, calendar, telegram)
      const { checkIntegrations } = await import('../services/integrationChecker');
      const integrations = await checkIntegrations(userId);
      
      console.log('[ORCH] 🔍 Integraciones:', integrations);
      
      // Si NO hay NINGUNA integración configurada
      if (!integrations.hasEmail && !integrations.hasCalendar && !integrations.hasTelegram) {
        return {
          toolUsed: 'none',
          toolReason: 'No integrations configured',
          toolResult: `⚠️ No tienes integraciones configuradas.

Para usar estas funcionalidades:
✅ **Email**: Configura una cuenta SMTP/IMAP en tu perfil
✅ **Calendario**: Ya está disponible (interno de AL-E)
✅ **Telegram**: Conecta tu bot personal

Configura al menos una integración para continuar.`,
          toolFailed: true,
          toolError: 'NO_INTEGRATIONS_CONFIGURED'
        };
      }
      
      // Si HAY integraciones, ejecutar action parser y tools
      const { executeTransactionalAction } = await import('../services/transactionalExecutor');
      return await executeTransactionalAction(userMessage, userId, intent, integrations);
      
    }
    
    // ═══════════════════════════════════════════════════════════════
    // EJECUTAR WEB SEARCH (Tavily)
    // ═══════════════════════════════════════════════════════════════
    
    if (intent.tools_required.includes('web_search')) {
      try {
        console.log('[ORCH] 🔍 Tool: web_search (Tavily) - Intent-driven execution...');
        const searchResponse = await webSearch({
          query: userMessage,
          searchDepth: 'basic',
          maxResults: 5
        });
        
        if (searchResponse.success && searchResponse.results.length > 0) {
          const formattedResults = formatTavilyResults(searchResponse);
          console.log(`[ORCH] ✓ Tavily: ${searchResponse.results.length} resultados obtenidos`);
          
          return {
            toolUsed: 'web_search',
            toolReason: 'Web search executed successfully',
            toolResult: formattedResults,
            toolFailed: false,
            tavilyResponse: searchResponse
          };
          
        } else {
          // Tavily respondió pero sin resultados
          console.warn('[ORCH] ⚠️ Tavily: búsqueda sin resultados');
          
          const fallbackContext = generateFallbackContext(
            intent,
            userMessage,
            'No results found'
          );
          
          return {
            toolUsed: 'web_search',
            toolReason: 'Web search executed but no results found',
            toolResult: fallbackContext,
            toolFailed: true,
            toolError: 'No results found'
          };
        }
        
      } catch (error: any) {
        // Tavily falló completamente (timeout, rate limit, etc.)
        console.error('[ORCH] ❌ Tavily error:', error.message);
        
        const fallbackContext = generateFallbackContext(
          intent,
          userMessage,
          error.message
        );
        
        return {
          toolUsed: 'web_search',
          toolReason: 'Web search attempted but failed',
          toolResult: fallbackContext,
          toolFailed: true,
          toolError: error.message
        };
      }
    }
    
    // Default: no tool executed
    return {
      toolUsed: 'none',
      toolReason: 'No tool execution required',
      toolFailed: false
    };
  }
  
  /**
   * STEP 6: Decidir modelo (model decision)
   * Default: Groq (llama3-70b) - rápido y económico
   * Pro: Groq (mixtral) para large context
   * Fallback: OpenAI si Groq falla
   */
  private decideModel(userMessage: string, chunks: Array<any>, memories: Array<any>): { modelSelected: string; modelReason?: string } {
    const lowerMsg = userMessage.toLowerCase();
    
    // Large context: usa Mixtral (32k context window)
    if (chunks.length > 3 || memories.length > 7) {
      return {
        modelSelected: 'mixtral-8x7b-32768',
        modelReason: 'Large context detected (Groq Mixtral 32k)'
      };
    }
    
    // Default: Llama3 70B (más rápido y capaz)
    return {
      modelSelected: 'llama-3.3-70b-versatile',
      modelReason: 'Standard conversation (Groq Llama3 70B)'
    };
  }
  
  /**
   * STEP 7: Construir system prompt completo
   * CRÍTICO: Tool result va PRIMERO para máxima visibilidad
   */
  private buildSystemPrompt(
    userIdentity: UserIdentity | null,
    memories: Array<any>,
    chunks: Array<any>,
    basePrompt: string,
    toolResult?: string
  ): string {
    let systemPrompt = basePrompt;
    
    // 0. CONTEXTO TEMPORAL ACTUAL (CRÍTICO PARA PREGUNTAS DE FECHA/HORA)
    const now = new Date();
    const mexicoTime = new Intl.DateTimeFormat('es-MX', {
      timeZone: 'America/Mexico_City',
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(now);
    
    systemPrompt += `

═══════════════════════════════════════════════════════════════
CONTEXTO TEMPORAL ACTUAL
═══════════════════════════════════════════════════════════════

Fecha y hora EXACTA en este momento (Mexico City):
${mexicoTime}

INSTRUCCIÓN: Si el usuario pregunta "qué día es hoy" o "qué hora es", usa ESTA información exacta.
NO uses tu conocimiento de entrenamiento. Esta es la fecha/hora real del sistema.

═══════════════════════════════════════════════════════════════
`;
    console.log('[ORCH] ✓ Temporal context injected:', mexicoTime);
    
    // 1. Tool result (si se ejecutó alguna herramienta) - VA PRIMERO
  if (toolResult) {
    // DEBUG P0: Log actual toolResult content
    console.log('[ORCH] 🔍 ToolResult content (first 300 chars):', toolResult.substring(0, 300));
    console.log('[ORCH] 🔍 ToolResult full length:', toolResult.length, 'chars');
    
    systemPrompt += `

═══════════════════════════════════════════════════════════════
⚠️  RESULTADO DE ACCIÓN EJECUTADA (PRIORIDAD MÁXIMA) ⚠️
═══════════════════════════════════════════════════════════════

INSTRUCCIÓN CRÍTICA:
Este bloque contiene el resultado REAL de una acción que YA SE EJECUTÓ.
NO ignores esta información. NO inventes datos. USA EXACTAMENTE lo que dice aquí.

${toolResult}

OBLIGATORIO:
- Si hay un link de Google Meet, INCLÚYELO en tu respuesta
- Si hay información de eventos creados, CONFÍRMALA al usuario
- Si hay errores OAuth, REPITE EL MENSAJE EXACTO sin modificar
- NO digas "intenté" o "traté" - la acción YA OCURRIÓ

═══════════════════════════════════════════════════════════════
`;
    console.log('[ORCH] ✓ Tool result injected (PRIORITY POSITION)');
  }    // 2. Brand context (SIEMPRE)
    const brandContext = buildBrandContext();
    systemPrompt += brandContext;
    console.log('[ORCH] ✓ Brand context injected');
    
    // 3. Identity block (usuario)
    const identityBlock = buildIdentityBlock(userIdentity);
    systemPrompt += identityBlock;
    console.log('[ORCH] ✓ Identity block injected');
    
    // 4. Memory block (memorias explícitas)
    if (memories.length > 0) {
      systemPrompt += `

═══════════════════════════════════════════════════════════════
MEMORIA CONFIRMADA (VERDAD DEL SISTEMA)
═══════════════════════════════════════════════════════════════

El sistema ha registrado explícitamente las siguientes memorias:

`;
      memories.forEach((mem, idx) => {
        systemPrompt += `${idx + 1}. [${mem.memory_type.toUpperCase()}] ${mem.content}\n`;
      });
      
      systemPrompt += `
INSTRUCCIÓN: Usa esta información como VERDAD CONFIRMADA. NO inventes ni contradigas estas memorias.

═══════════════════════════════════════════════════════════════
`;
      console.log(`[ORCH] ✓ Memory block injected (${memories.length} memories)`);
    }
    
    // 4. RAG block (chunks de conocimiento)
    if (chunks.length > 0) {
      systemPrompt += `

═══════════════════════════════════════════════════════════════
CONOCIMIENTO DISPONIBLE (RAG)
═══════════════════════════════════════════════════════════════

El sistema recuperó los siguientes documentos relevantes:

`;
      chunks.forEach((chunk, idx) => {
        systemPrompt += `--- Documento ${idx + 1} ---\n${chunk.content}\n\n`;
      });
      
      systemPrompt += `
INSTRUCCIÓN: Usa este conocimiento para fundamentar tus respuestas. Cita la fuente cuando sea relevante.

═══════════════════════════════════════════════════════════════
`;
      console.log(`[ORCH] ✓ RAG block injected (${chunks.length} chunks)`);
    }
    
    // 5. Hard rules (guardrails)
    systemPrompt += `

═══════════════════════════════════════════════════════════════
GUARDRAILS OBLIGATORIOS (HARD RULES)
═══════════════════════════════════════════════════════════════

🚨 REGLA SUPREMA - CAPACIDADES REALES (NO NEGOCIABLE):
El archivo runtime-capabilities.json define qué capacidades están REALMENTE disponibles:
- mail.send: false ✗ (AWS SES NO CONFIGURADO)
- mail.inbox: false ✗
- calendar.create: true ✓
- calendar.list: true ✓
- calendar.update: true ✓
- calendar.delete: true ✓
- documents.read: false ✗
- web.search: true ✓
- telegram: false ✗

ACLARACIÓN CRÍTICA - CALENDARIO INTERNO:
✅ AL-E TIENE CALENDARIO INTERNO PROPIO
✅ NO DEPENDE DE GOOGLE CALENDAR
✅ NO DEPENDE DE ZOOM COMO INTEGRACIÓN
✅ NO DEPENDE DE NINGÚN SERVICIO EXTERNO

CUANDO EL USUARIO DICE "ZOOM", "MEET", "TEAMS", ETC:
✅ Son SOLO TEXTO DESCRIPTIVO del evento
✅ NO son integraciones que debas verificar
✅ NO son capacidades que debas validar
✅ Agendar "un zoom con IGS" significa: evento con título "Zoom con IGS"

COMPORTAMIENTO CORRECTO PARA CALENDAR.CREATE:
✅ SI calendar.create = true → CREAR EVENTO INTERNO
✅ Usar "Zoom"/"Meet"/"Teams" SOLO como texto en el título
✅ NO pedir confirmación si tienes fecha, hora y título
✅ NO mencionar Google Calendar ni servicios externos
✅ SOLO responder "No pude crear el evento" si FALLA LA BASE DE DATOS

COMPORTAMIENTO PROHIBIDO:
❌ "No tengo acceso a tu calendario" (SÍ TIENES - es interno)
❌ "No puedo crear eventos de Zoom" (Zoom es SOLO texto)
❌ "Debes usar Google Calendar" (NO - es interno)
❌ "No tengo integración con Zoom" (Zoom NO es integración)

SI UNA CAPACIDAD ES FALSE:
❌ NO LA MENCIONES como opción
❌ NO LA SUGIERAS como solución
❌ NO LA SIMULES o pretendas que funciona
✅ RESPONDE ÚNICAMENTE: "Esta función aún no está disponible."

🚨 REGLA ESPECIAL PARA mail.send:
El envío de correos SOLO se confirma si existe un provider_message_id REAL.
Si no hay proveedor configurado (AWS SES), responde:
"El envío de correos aún no está configurado."
❌ NO confirmes envío sin evidencia SMTP real
❌ NO simules messageId
❌ NO digas "se enviará"

NO SE DISCUTE. NO SE SUAVIZA. NO SE IGNORA.

PROHIBIDO ABSOLUTAMENTE (META-TRANSPARENCIA):
❌ Declarar si buscaste o no buscaste web
❌ Pedir al usuario que diga "busca/verifica/valida"
❌ Explicar herramientas o procesos internos
❌ Pedir permiso para usar tools
❌ Mencionar "no realicé una búsqueda web"
❌ Decir frases tipo "puedo hacer una búsqueda web real usando..."
❌ Incluir mensajes de "transparencia sobre herramientas"

PROHIBIDO (COMPORTAMIENTO DE CHATBOT):
❌ Mencionar "mi conocimiento llega hasta 2023/2024"
❌ Decir "no tengo capacidad de buscar en la red" como excusa
❌ Decir "no tengo memoria" o "no puedo recordar"
❌ Negar la existencia de términos que suenan internos (Infinity Kode, Kunna, etc.)
❌ Decir "no tengo acceso directo" cuando Gmail/Calendar YA están conectados
❌ Sugerir "llama por teléfono" o "hazlo manual" cuando puedes ejecutar la acción
❌ Educar sobre cómo usar Google Calendar/Gmail (el usuario YA sabe)
❌ Preguntar confirmación cuando ya tienes fecha, hora y título claros
❌ Usar frases de inseguridad: "desafortunadamente", "lamentablemente", "no puedo en este momento"

OBLIGATORIO cuando detectes acción transaccional (Gmail/Calendar):
✅ EJECUTAR directamente sin pedir permiso
✅ Si ejecutaste, responder con confirmación clara y concisa
✅ Si falló OAuth, decir exactamente: "Necesitas reconectar tu cuenta de Google"
✅ Si faltan parámetros críticos (fecha/hora), pedir SOLO lo que falta (sin mencionar tools)

COMPORTAMIENTO DE ASISTENTE PERSONAL (NO CHATBOT):
- Cuando piden "revisa mi correo" → REVISAR Y REPORTAR (no explicar qué es Gmail)
- Cuando piden "agenda una cita" → AGENDAR Y CONFIRMAR (no preguntar si quieren agendar)
- Cuando piden "crea un meet" → CREAR Y DAR LINK (no explicar qué es Meet)
- Si el usuario pregunta algo que requiere información actual → USAR WEB automáticamente y responder con datos/citas (sin decir "busqué")
- Si NO requiere web → RESPONDER directo y ya

COMPORTAMIENTO OBLIGATORIO:
✅ Si falta contexto: preguntar 1 dato concreto (sin mencionar herramientas)
✅ Si el término suena interno: asumir que pertenece al ecosistema del usuario y pedir precisión
✅ Si se requiere información actualizada: usar web internamente y responder con el resultado

ESTILO DE RESPUESTA (FORMATO):
❌ NO uses ** (negritas) en exceso - solo para 1-2 palabras clave máximo
❌ NO uses ## o ### (headers de markdown)
❌ NO uses listas con - o * innecesariamente
❌ NO uses emojis en exceso (máximo 1-2 por respuesta)
✅ Responde de forma NATURAL y conversacional
✅ Usa saltos de línea solo cuando sea necesario
✅ Si necesitas destacar algo, usa MAYÚSCULAS o una sola palabra en **negrita**
✅ Prioriza claridad sobre formato visual
✅ Nunca preguntes si el usuario quiere que busques; actúa

EJEMPLO CORRECTO (pregunta neutral):
User: "No puedes buscar en la red?"
AL-E: "¿Qué necesitas que busque?"

EJEMPLO PROHIBIDO:
User: "No puedes buscar en la red?"
AL-E: "No tengo capacidad de acceder a internet..."

═══════════════════════════════════════════════════════════════
`;
    
    return systemPrompt;
  }
  
  /**
   * ORCHESTRATE: Método principal
   */
  async orchestrate(request: OrchestratorRequest, basePrompt: string): Promise<OrchestratorContext> {
    const startTime = Date.now();
    console.log('[ORCH] ========== STARTING ORCHESTRATION ==========');
    console.log('[ORCH] User message:', request.messages[request.messages.length - 1]?.content?.substring(0, 100));
    
    // STEP 0: Check cache
    const lastUserMessage = request.messages[request.messages.length - 1]?.content || '';
    const cacheKey = this.generateCacheKey(request.workspaceId, request.userId, lastUserMessage);
    
    const cached = responseCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
      console.log('[ORCH] ✓ Cache HIT - Returning cached response');
      return {
        ...cached.context,
        cacheHit: true,
        outputTokens: cached.context.outputTokens || 0
      };
    }
    
    // STEP 1: Auth
    const { isAuthenticated, userId } = await this.checkAuth(request);
    
    // STEP 2: Profile
    const userIdentity = await this.loadProfile(userId, isAuthenticated);
    
    // STEP 3: Memories
    console.log('[ORCH] STEP 3: Loading memories...');
    const memories = isAuthenticated 
      ? await this.loadMemories(userId, request.workspaceId, request.projectId)
      : [];
    console.log(`[ORCH] STEP 3: ✓ Loaded ${memories.length} memories`);
    
    // STEP 4: RAG
    console.log('[ORCH] STEP 4: RAG retrieval...');
    const chunks = await this.ragRetrieve(userId, request.workspaceId, request.projectId || 'N/A', lastUserMessage);
    console.log(`[ORCH] STEP 4: ✓ Retrieved ${chunks.length} chunks`);
    
    // STEP 4.5: Intent Classification (NUEVO)
    console.log('[ORCH] STEP 4.5: Classifying intent...');
    const intent = this.classifyUserIntent(lastUserMessage);
    console.log(`[ORCH] STEP 4.5: ✓ Intent: ${intent.intent_type}, confidence: ${intent.confidence}, tools: ${intent.tools_required.join(',')}`);
    
    // STEP 5: Tool decision & execution (intent-driven)
    console.log('[ORCH] STEP 5: Tool execution...');
    const { toolUsed, toolReason, toolResult, toolFailed, toolError, tavilyResponse } = 
      await this.decideAndExecuteTool(lastUserMessage, intent, userId);
    console.log(`[ORCH] STEP 5: ✓ Tool: ${toolUsed}, failed: ${toolFailed}`);
    
    // STEP 6: Model decision (ahora Groq by default)
    console.log('[ORCH] STEP 6: Model decision...');
    const { modelSelected, modelReason } = this.decideModel(lastUserMessage, chunks, memories);
    console.log(`[ORCH] STEP 6: ✓ Model: ${modelSelected}`);
    
    // STEP 7: Build system prompt (incluye tool result si existe)
    console.log('[ORCH] STEP 7: Building system prompt...');
    const systemPrompt = this.buildSystemPrompt(userIdentity, memories, chunks, basePrompt, toolResult);
    console.log(`[ORCH] STEP 7: ✓ Prompt built (${systemPrompt.length} chars)`);
    
    // Métricas
    const inputTokens = Math.ceil(systemPrompt.length / 4); // Aproximación
    const webSearchUsed = toolUsed === 'web_search';
    const webSearchSuccess = webSearchUsed && tavilyResponse?.success === true && !toolFailed;
    const webResultsCount = webSearchUsed ? (tavilyResponse?.results.length || 0) : 0;
    
    // Determinar answer mode
    let answerMode: OrchestratorContext['answerMode'];
    if (intent.intent_type === 'stable') {
      answerMode = 'stable_knowledge';
    } else if (webSearchSuccess) {
      answerMode = 'verified';
    } else if (toolFailed && intent.fallback_strategy === 'historical_ranges') {
      answerMode = 'offline_with_estimate';
    } else {
      answerMode = 'offline_general';
    }
    
    // Log obligatorio (incluye intent y answer mode)
    console.log(`[ORCH] auth=${isAuthenticated} intent=${intent.intent_type} answer_mode=${answerMode} tool_used=${toolUsed} tool_failed=${toolFailed} web_search=${webSearchUsed} web_results=${webResultsCount} model=${modelSelected} mem_count=${memories.length} rag_hits=${chunks.length} cache_hit=false input_tokens=${inputTokens} max_output=${MAX_OUTPUT_TOKENS}`);
    
    // ALERTA: Si web_search=true pero web_results=0 Y no es time_sensitive, puede alucinar
    if (webSearchUsed && webResultsCount === 0 && !toolFailed) {
      console.warn('[ORCH] ⚠️ WEB SEARCH SIN RESULTADOS - Alto riesgo de alucinación');
    }
    
    // ALERTA: Si tool falló en time_sensitive, el modelo debe usar fallback strategy
    if (toolFailed && intent.intent_type === 'time_sensitive') {
      console.warn(`[ORCH] ⚠️ TOOL FAILED en time_sensitive - Fallback strategy: ${intent.fallback_strategy}`);
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[ORCH] ✓ Orchestration completed in ${elapsed}ms`);
    
    const context: OrchestratorContext = {
      isAuthenticated,
      userId,
      userIdentity,
      memories,
      chunks,
      intent,
      toolUsed,
      toolReason,
      toolResult,
      toolFailed,
      toolError,
      tavilyResponse,
      modelSelected,
      modelReason,
      systemPrompt,
      memoryCount: memories.length,
      ragHits: chunks.length,
      webSearchUsed,
      webResultsCount,
      cacheHit: false,
      inputTokens,
      outputTokens: 0, // Se actualiza después de la llamada al modelo
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      answerMode
    };
    
    return context;
  }
  
  /**
   * Generar cache key
   */
  private generateCacheKey(workspaceId: string, userId: string, message: string): string {
    const data = `${workspaceId}:${userId}:${message}`;
    return crypto.createHash('md5').update(data).digest('hex');
  }
  
  /**
   * Guardar respuesta en cache
   */
  saveCacheResponse(cacheKey: string, context: OrchestratorContext): void {
    responseCache.set(cacheKey, {
      response: context.systemPrompt,
      timestamp: Date.now(),
      context
    });
    
    // Cleanup: eliminar entradas viejas (> 30 min)
    const now = Date.now();
    for (const [key, value] of responseCache.entries()) {
      if (now - value.timestamp > 30 * 60 * 1000) {
        responseCache.delete(key);
      }
    }
  }
  
  /**
   * Limitar historial de mensajes (cost control)
   */
  limitMessageHistory(messages: Array<any>): Array<any> {
    if (messages.length <= MAX_HISTORY_MESSAGES) {
      return messages;
    }
    
    // Mantener los últimos MAX_HISTORY_MESSAGES mensajes
    const limited = messages.slice(-MAX_HISTORY_MESSAGES);
    console.log(`[ORCH] Message history limited: ${messages.length} → ${limited.length}`);
    return limited;
  }
}
