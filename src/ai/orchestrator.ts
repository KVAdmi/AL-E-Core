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
  
  // Tools
  toolUsed: string;
  toolReason?: string;
  toolResult?: string;
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
      // Memorias de usuario (scope: user)
      const { data: userMemories, error: userError } = await supabase
        .from('assistant_memories')
        .select('id, content, memory_type, importance')
        .eq('owner_user_uuid', userId)
        .eq('scope', 'user')
        .gte('importance', 3)
        .order('importance', { ascending: false })
        .limit(5);
      
      if (userError) {
        console.error('[ORCH] Error loading user memories:', userError);
      }
      
      // Memorias de proyecto (scope: project)
      let projectMemories: any[] = [];
      if (projectId && projectId !== 'N/A') {
        const { data, error: projError } = await supabase
          .from('assistant_memories')
          .select('id, content, memory_type, importance')
          .eq('project_id', projectId)
          .eq('scope', 'project')
          .gte('importance', 3)
          .order('importance', { ascending: false })
          .limit(5);
        
        if (projError) {
          console.error('[ORCH] Error loading project memories:', projError);
        } else {
          projectMemories = data || [];
        }
      }
      
      const allMemories = [...(userMemories || []), ...projectMemories];
      console.log(`[ORCH] mem_count=${allMemories.length} (user:${userMemories?.length || 0}, project:${projectMemories.length})`);
      
      return allMemories;
    } catch (err) {
      console.error('[ORCH] Error in loadMemories:', err);
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
   * STEP 5: Decidir herramienta (tool decision) y ejecutarla
   * CRÍTICO: Si detecta necesidad de web search, ejecuta SIEMPRE (no pregunta al modelo)
   */
  private async decideAndExecuteTool(userMessage: string): Promise<{ 
    toolUsed: string; 
    toolReason?: string;
    toolResult?: string;
    tavilyResponse?: TavilySearchResponse;
  }> {
    // TIER 1: Web Search (Tavily) - DETECCIÓN AGRESIVA
    if (shouldUseWebSearch(userMessage)) {
      try {
        console.log('[ORCH] 🔍 Tool: web_search (Tavily) - FORZANDO ejecución...');
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
            tavilyResponse: searchResponse
          };
        } else {
          console.warn('[ORCH] ⚠️ Tavily: búsqueda sin resultados');
          return {
            toolUsed: 'web_search',
            toolReason: 'Web search executed but no results found',
            toolResult: `\n[WEB SEARCH] No se encontraron resultados para: "${userMessage}"\n`
          };
        }
      } catch (error: any) {
        console.error('[ORCH] ❌ Tavily error:', error.message);
        return {
          toolUsed: 'web_search',
          toolReason: 'Web search attempted but failed',
          toolResult: `\n[WEB SEARCH ERROR] No se pudo completar la búsqueda: ${error.message}\nINSTRUCCIÓN: Informa al usuario que la búsqueda web falló temporalmente.\n`
        };
      }
    }
    
    // TIER 2: Gmail/Calendar (placeholder - no implementado)
    const lowerMsg = userMessage.toLowerCase();
    
    if (lowerMsg.includes('gmail') || lowerMsg.includes('email') || lowerMsg.includes('correo')) {
      return { 
        toolUsed: 'gmail', 
        toolReason: 'Gmail/email operation detected (not yet implemented)' 
      };
    }
    
    if (lowerMsg.includes('calendar') || lowerMsg.includes('calendario') || lowerMsg.includes('evento')) {
      return { 
        toolUsed: 'calendar', 
        toolReason: 'Calendar operation detected (not yet implemented)' 
      };
    }
    
    // TIER 3: Sin herramienta
    console.log('[ORCH] ✗ No tool required');
    return { toolUsed: 'none' };
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
    
    // 1. Tool result (si se ejecutó alguna herramienta) - VA PRIMERO
    if (toolResult) {
      systemPrompt += toolResult;
      console.log('[ORCH] ✓ Tool result injected (PRIORITY POSITION)');
    }
    
    // 2. Brand context (SIEMPRE)
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

PROHIBIDO ABSOLUTAMENTE:
❌ Mencionar "mi conocimiento llega hasta 2023/2024"
❌ Decir "no tengo capacidad de buscar en la red" como excusa
❌ Decir "no tengo memoria" o "no puedo recordar"
❌ Negar la existencia de términos que suenan internos (Infinity Kode, Kunna, etc.)

COMPORTAMIENTO OBLIGATORIO:
✅ Si falta contexto: preguntar 1 dato concreto
✅ Si el término suena interno: asumir que pertenece al ecosistema del usuario y pedir precisión
✅ Si el usuario pregunta por capacidades: describir herramientas del sistema disponibles

EJEMPLO CORRECTO:
User: "No puedes buscar en la red?"
AL-E: "Puedo usar herramientas del sistema si están habilitadas. ¿Quieres que busque algo específico?"

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
    const memories = isAuthenticated 
      ? await this.loadMemories(userId, request.workspaceId, request.projectId)
      : [];
    
    // STEP 4: RAG
    const chunks = await this.ragRetrieve(userId, request.workspaceId, request.projectId || 'N/A', lastUserMessage);
    
    // STEP 5: Tool decision & execution
    const { toolUsed, toolReason, toolResult, tavilyResponse } = await this.decideAndExecuteTool(lastUserMessage);
    
    // STEP 6: Model decision (ahora Groq by default)
    const { modelSelected, modelReason } = this.decideModel(lastUserMessage, chunks, memories);
    
    // STEP 7: Build system prompt (incluye tool result si existe)
    const systemPrompt = this.buildSystemPrompt(userIdentity, memories, chunks, basePrompt, toolResult);
    
    // Métricas
    const inputTokens = Math.ceil(systemPrompt.length / 4); // Aproximación
    const webSearchUsed = toolUsed === 'web_search';
    const webSearchSuccess = webSearchUsed && tavilyResponse?.success === true;
    const webResultsCount = webSearchUsed ? (tavilyResponse?.results.length || 0) : 0;
    
    // Log obligatorio (incluye web_results_count para detectar alucinaciones)
    console.log(`[ORCH] auth=${isAuthenticated} user_uuid=${userId} tool_used=${toolUsed} web_search=${webSearchUsed} web_results=${webResultsCount} model=${modelSelected} mem_count=${memories.length} rag_hits=${chunks.length} cache_hit=false input_tokens=${inputTokens} max_output=${MAX_OUTPUT_TOKENS}`);
    
    // ALERTA: Si web_search=true pero web_results=0, el modelo puede alucinar
    if (webSearchUsed && webResultsCount === 0) {
      console.warn('[ORCH] ⚠️ WEB SEARCH SIN RESULTADOS - Alto riesgo de alucinación');
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[ORCH] ✓ Orchestration completed in ${elapsed}ms`);
    
    const context: OrchestratorContext = {
      isAuthenticated,
      userId,
      userIdentity,
      memories,
      chunks,
      toolUsed,
      toolReason,
      toolResult,
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
      maxOutputTokens: MAX_OUTPUT_TOKENS
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
