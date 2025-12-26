/**
 * AL-E Core Orchestrator
 * 
 * Sistema de orquestación inteligente que reemplaza el flujo chatbot simple.
 * Ejecuta pipeline completo: auth → profile → memories → RAG → tools → model selection → provider
 * 
 * CRÍTICO: NO es un chatbot. Es un sistema orquestado con contexto completo.
 */

import { Request } from 'express';
import { getUserIdentity, buildBrandContext, buildIdentityBlock, UserIdentity } from '../services/userProfile';
import { supabase } from '../db/supabase';
import { retrieveRelevantChunks } from '../services/chunkRetrieval';

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
  
  // Model
  modelSelected: string;
  modelReason?: string;
  
  // System Prompt
  systemPrompt: string;
  
  // Metrics
  memoryCount: number;
  ragHits: number;
  inputTokens: number;
  outputTokens: number;
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
   * STEP 5: Decidir herramienta (tool decision)
   */
  private decideToolUsage(userMessage: string): { toolUsed: string; toolReason?: string } {
    const lowerMsg = userMessage.toLowerCase();
    
    // Detectar intención de búsqueda web
    if (lowerMsg.includes('buscar en internet') || 
        lowerMsg.includes('busca en google') || 
        lowerMsg.includes('web search') ||
        lowerMsg.includes('búsqueda online')) {
      return { 
        toolUsed: 'web_search', 
        toolReason: 'User requested web search explicitly' 
      };
    }
    
    // Detectar Gmail/Calendar
    if (lowerMsg.includes('gmail') || lowerMsg.includes('email') || lowerMsg.includes('correo')) {
      return { 
        toolUsed: 'gmail', 
        toolReason: 'Gmail/email operation detected' 
      };
    }
    
    if (lowerMsg.includes('calendar') || lowerMsg.includes('calendario') || lowerMsg.includes('evento')) {
      return { 
        toolUsed: 'calendar', 
        toolReason: 'Calendar operation detected' 
      };
    }
    
    // Sin herramienta
    return { toolUsed: 'none' };
  }
  
  /**
   * STEP 6: Decidir modelo (model decision)
   */
  private decideModel(userMessage: string, chunks: Array<any>, memories: Array<any>): { modelSelected: string; modelReason?: string } {
    const lowerMsg = userMessage.toLowerCase();
    
    // Code-heavy: usa modelo pro
    if (lowerMsg.includes('código') || 
        lowerMsg.includes('code') || 
        lowerMsg.includes('programming') ||
        lowerMsg.includes('debug') ||
        lowerMsg.includes('refactor')) {
      return {
        modelSelected: 'gpt-4-turbo',
        modelReason: 'Code-heavy task detected'
      };
    }
    
    // Razonamiento largo: usa modelo pro
    if (lowerMsg.includes('explicar') || 
        lowerMsg.includes('analiza') || 
        lowerMsg.includes('reasoning') ||
        lowerMsg.includes('estrategia')) {
      return {
        modelSelected: 'gpt-4-turbo',
        modelReason: 'Long reasoning task'
      };
    }
    
    // Contexto grande (chunks + memories): usa modelo pro
    if (chunks.length > 2 || memories.length > 5) {
      return {
        modelSelected: 'gpt-4-turbo',
        modelReason: 'Large context (chunks + memories)'
      };
    }
    
    // Default: modelo barato
    return {
      modelSelected: 'gpt-3.5-turbo',
      modelReason: 'Standard conversation'
    };
  }
  
  /**
   * STEP 7: Construir system prompt completo
   */
  private buildSystemPrompt(
    userIdentity: UserIdentity | null,
    memories: Array<any>,
    chunks: Array<any>,
    basePrompt: string
  ): string {
    let systemPrompt = basePrompt;
    
    // 1. Brand context (SIEMPRE)
    const brandContext = buildBrandContext();
    systemPrompt += brandContext;
    console.log('[ORCH] ✓ Brand context injected');
    
    // 2. Identity block (usuario)
    const identityBlock = buildIdentityBlock(userIdentity);
    systemPrompt += identityBlock;
    console.log('[ORCH] ✓ Identity block injected');
    
    // 3. Memory block (memorias explícitas)
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
    
    // STEP 1: Auth
    const { isAuthenticated, userId } = await this.checkAuth(request);
    
    // STEP 2: Profile
    const userIdentity = await this.loadProfile(userId, isAuthenticated);
    
    // STEP 3: Memories
    const memories = isAuthenticated 
      ? await this.loadMemories(userId, request.workspaceId, request.projectId)
      : [];
    
    // STEP 4: RAG
    const lastUserMessage = request.messages[request.messages.length - 1]?.content || '';
    const chunks = await this.ragRetrieve(userId, request.workspaceId, request.projectId || 'N/A', lastUserMessage);
    
    // STEP 5: Tool decision
    const { toolUsed, toolReason } = this.decideToolUsage(lastUserMessage);
    
    // STEP 6: Model decision
    const { modelSelected, modelReason } = this.decideModel(lastUserMessage, chunks, memories);
    
    // STEP 7: Build system prompt
    const systemPrompt = this.buildSystemPrompt(userIdentity, memories, chunks, basePrompt);
    
    // Métricas
    const inputTokens = Math.ceil(systemPrompt.length / 4); // Aproximación
    
    // Log obligatorio
    console.log(`[ORCH] auth=${isAuthenticated} user_uuid=${userId} tool_used=${toolUsed} model=${modelSelected} mem_count=${memories.length} rag_hits=${chunks.length} input_tokens=${inputTokens}`);
    
    const elapsed = Date.now() - startTime;
    console.log(`[ORCH] ✓ Orchestration completed in ${elapsed}ms`);
    
    return {
      isAuthenticated,
      userId,
      userIdentity,
      memories,
      chunks,
      toolUsed,
      toolReason,
      modelSelected,
      modelReason,
      systemPrompt,
      memoryCount: memories.length,
      ragHits: chunks.length,
      inputTokens,
      outputTokens: 0 // Se actualiza después de la llamada al modelo
    };
  }
}
