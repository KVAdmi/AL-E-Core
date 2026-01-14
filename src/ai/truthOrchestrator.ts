/**
 * TRUTH ORCHESTRATOR - INTEGRACIÓN CON TRUTH LAYER + AUTHORITY MATRIX
 * 
 * Este módulo integra el orchestrator original con:
 * - Planner (piensa, no habla)
 * - Executor (ejecuta, no inventa)
 * - Governor (valida evidencia, bloquea si falta)
 * - Narrator (solo comunica hechos aprobados)
 * - Authority Engine (enforce permisos A0-A3)
 * 
 * REGLA MADRE: SIN EVIDENCIA = AL-E NO RESPONDE
 */

import { Planner, ExecutionPlan } from './truthLayer/planner';
import { Executor, ExecutionReport } from './truthLayer/executor';
import { Governor, GovernorDecision } from './truthLayer/governor';
import { Narrator, NarrativeResponse } from './truthLayer/narrator';
import { AuthorityEngine, AuthorityContext, createAuthorityEngine } from './authority/authorityEngine';
import { AuthorityLevel } from './authority/authorityMatrix';
import { logger, generateRequestId } from '../utils/logger';

export interface TruthOrchestratorRequest {
  userMessage: string;
  userId: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  userConfirmed?: boolean; // ¿El usuario dio confirmación explícita?
  requestId?: string; // Opcional: correlación externa
  workspaceId?: string; // Workspace context
  route?: string; // Ruta de la API
  channel?: 'web' | 'app' | 'api'; // Canal de entrada
}

export interface TruthOrchestratorResponse {
  content: string;
  wasBlocked: boolean;
  blockReason?: string;
  evidence: any;
  plan: ExecutionPlan;
  governorDecision: GovernorDecision;
  authorityLevel: AuthorityLevel;
  executionTime: number;
  requestId: string; // Para correlación
}

/**
 * TRUTH ORCHESTRATOR - PIPELINE COMPLETO
 */
export class TruthOrchestrator {
  private planner: Planner;
  private executor: Executor;
  private governor: Governor;
  private narrator: Narrator;
  private authorityEngine?: AuthorityEngine;
  
  constructor() {
    this.planner = new Planner();
    this.executor = new Executor();
    this.governor = new Governor();
    this.narrator = new Narrator();
  }
  
  /**
   * INITIALIZE: Cargar authority engine
   */
  async initialize(): Promise<void> {
    this.authorityEngine = await createAuthorityEngine();
    console.log('[TRUTH ORCH] ✅ Authority Engine initialized');
  }
  
  /**
   * ORCHESTRATE: Pipeline completo Planner → Executor → Governor → Narrator
   */
  async orchestrate(request: TruthOrchestratorRequest): Promise<TruthOrchestratorResponse> {
    const startTime = Date.now();
    const requestId = request.requestId || generateRequestId();
    
    // LOG: ai.request.received
    logger.aiRequestReceived({
      request_id: requestId,
      user_id: request.userId,
      workspace_id: request.workspaceId || 'default',
      route: request.route || '/api/ai/truth-chat',
      message_length: request.userMessage.length,
      channel: request.channel || 'api',
    });
    
    console.log('[TRUTH ORCH] ══════════════════════════════════════════════════');
    console.log('[TRUTH ORCH] TRUTH ORCHESTRATOR PIPELINE START');
    console.log('[TRUTH ORCH] Request ID:', requestId);
    console.log('[TRUTH ORCH] User:', request.userId);
    console.log('[TRUTH ORCH] Message:', request.userMessage.substring(0, 100));
    console.log('[TRUTH ORCH] User confirmed:', request.userConfirmed || false);
    console.log('[TRUTH ORCH] ══════════════════════════════════════════════════');
    
    // Asegurar que authority engine está inicializado
    if (!this.authorityEngine) {
      await this.initialize();
    }
    
    // STEP 1: PLANNER - Generar plan de ejecución
    console.log('[TRUTH ORCH] STEP 1: PLANNER');
    const plan = this.planner.plan(request.userMessage);
    
    // LOG: ai.intent.detected
    logger.aiIntentDetected({
      request_id: requestId,
      intent: plan.intent,
      confidence: undefined, // TODO: añadir confidence al planner
      required_tools: plan.requiredTools,
      optional_tools: plan.optionalTools || [],
    });
    
    console.log('[TRUTH ORCH] Plan generated:');
    console.log('[TRUTH ORCH]  - Intent:', plan.intent);
    console.log('[TRUTH ORCH]  - Authority required:', plan.authorityRequired);
    console.log('[TRUTH ORCH]  - Needs confirmation:', plan.requiresConfirmation);
    console.log('[TRUTH ORCH]  - Required tools:', plan.requiredTools);
    
    // STEP 2: AUTHORITY ENGINE - Verificar permisos ANTES de ejecutar
    console.log('[TRUTH ORCH] STEP 2: AUTHORITY ENGINE');
    
    const authorityContext: AuthorityContext = {
      currentLevel: 'A0', // SIEMPRE arranca en A0
      userId: request.userId,
    };
    
    // Detectar confirmación del usuario
    const userConfirmed = request.userConfirmed || 
                          this.authorityEngine!.detectUserConfirmation(request.userMessage);
    
    console.log('[TRUTH ORCH] User confirmation detected:', userConfirmed);
    
    // Enforcement check
    const enforcementResult = this.authorityEngine!.enforce(
      authorityContext,
      plan.requiredTools,
      userConfirmed
    );
    
    // LOG: ai.tools.plan (antes de enforcement)
    const capabilitiesSnapshot = this.authorityEngine!.getCapabilities();
    logger.aiToolsPlan({
      request_id: requestId,
      required_tools: plan.requiredTools,
      tool_count: plan.requiredTools.length,
      runtime_capabilities_snapshot: capabilitiesSnapshot,
    });
    
    // LOG: ai.authority.resolved
    logger.aiAuthorityResolved({
      request_id: requestId,
      authority_current: authorityContext.currentLevel,
      authority_required: plan.authorityRequired,
      confirmation_required: plan.requiresConfirmation,
      user_confirmed: userConfirmed,
      decision: enforcementResult.allowed ? 'approved' : 'blocked',
      reason: enforcementResult.allowed ? undefined : enforcementResult.reason,
    });
    
    if (!enforcementResult.allowed) {
      console.log('[TRUTH ORCH] ❌ AUTHORITY BLOCKED');
      console.log('[TRUTH ORCH] Reason:', enforcementResult.reason);
      
      // Governor decision (blocked por authority)
      const governorDecision: GovernorDecision = {
        status: 'blocked',
        reason: enforcementResult.reason,
        details: enforcementResult.details,
      };
      
      // Narrator (solo puede narrar el bloqueo)
      const narrative = this.narrator.narrate(governorDecision, plan, {
        executions: [],
        allSucceeded: false,
        failedTools: [],
        totalExecutionTime: 0,
      });
      
      const executionTime = Date.now() - startTime;
      
      // LOG: ai.truthgate.verdict (blocked por authority)
      logger.aiTruthgateVerdict({
        request_id: requestId,
        status: 'blocked',
        reason: enforcementResult.reason,
      });
      
      // LOG: ai.response.sent
      logger.aiResponseSent({
        request_id: requestId,
        status: 'blocked',
        response_type: 'blocked',
        latency_ms_total: executionTime,
      });
      
      console.log('[TRUTH ORCH] Pipeline completed (BLOCKED by authority)');
      console.log('[TRUTH ORCH] Total time:', executionTime, 'ms');
      console.log('[TRUTH ORCH] ══════════════════════════════════════════════════');
      
      return {
        content: narrative.content,
        wasBlocked: true,
        blockReason: enforcementResult.reason,
        evidence: narrative.evidence,
        plan,
        governorDecision,
        authorityLevel: authorityContext.currentLevel,
        executionTime,
        requestId,
      };
    }
    
    // Escalar autoridad si es necesario
    const escalatedAuthority = this.authorityEngine!.escalateAuthority(
      authorityContext.currentLevel,
      plan.requiredTools,
      userConfirmed
    );
    
    authorityContext.currentLevel = escalatedAuthority;
    console.log('[TRUTH ORCH] Authority escalated to:', escalatedAuthority);
    
    // STEP 3: EXECUTOR - Ejecutar tools
    console.log('[TRUTH ORCH] STEP 3: EXECUTOR');
    
    // TODO: Extraer parámetros del mensaje del usuario
    // Por ahora, parámetros vacíos (el executor debe manejar esto)
    const toolParameters: Record<string, any> = {};
    
    const executionReport = await this.executor.execute(
      request.userId,
      plan.requiredTools,
      toolParameters
    );
    
    // LOG: ai.tools.execute.result para cada tool
    for (const execution of executionReport.executions) {
      logger.aiToolsExecuteResult({
        request_id: requestId,
        tool_name: execution.tool,
        success: execution.success,
        duration_ms: 0, // TODO: añadir duration al executor
        evidence_ids: execution.evidenceIds,
        output_size_bytes: execution.output ? JSON.stringify(execution.output).length : undefined,
        error_code: execution.error ? 'execution_failed' : undefined,
        error_message: execution.error || undefined,
      });
    }
    
    console.log('[TRUTH ORCH] Execution completed:');
    console.log('[TRUTH ORCH]  - All succeeded:', executionReport.allSucceeded);
    console.log('[TRUTH ORCH]  - Failed tools:', executionReport.failedTools);
    
    // STEP 4: AUTHORITY DOWNGRADE - Si algún tool falló
    if (!executionReport.allSucceeded) {
      const newAuthority = this.authorityEngine!.downgradeOnFailure(executionReport.executions);
      console.log('[TRUTH ORCH] Authority downgraded to:', newAuthority);
      authorityContext.currentLevel = newAuthority;
    }
    
    // STEP 5: GOVERNOR - Validar evidencia
    console.log('[TRUTH ORCH] STEP 4: GOVERNOR');
    
    const governorDecision = this.governor.validate({
      plan,
      executionReport,
      authorityContext,
    });
    
    // LOG: ai.truthgate.verdict
    logger.aiTruthgateVerdict({
      request_id: requestId,
      status: governorDecision.status,
      reason: governorDecision.reason,
      missing_tools: undefined, // TODO: añadir al GovernorDecision
      failed_tools: governorDecision.failedTools,
      claims_blocked: governorDecision.missingEvidence,
    });
    
    console.log('[TRUTH ORCH] Governor decision:', governorDecision.status);
    if (governorDecision.status === 'blocked') {
      console.log('[TRUTH ORCH] Block reason:', governorDecision.reason);
    }
    
    // STEP 6: NARRATOR - Generar respuesta
    console.log('[TRUTH ORCH] STEP 5: NARRATOR');
    
    const narrative = this.narrator.narrate(governorDecision, plan, executionReport);
    
    console.log('[TRUTH ORCH] Narrative generated:');
    console.log('[TRUTH ORCH]  - Was blocked:', narrative.wasBlocked);
    console.log('[TRUTH ORCH]  - Content length:', narrative.content.length);
    
    const executionTime = Date.now() - startTime;
    
    // LOG: ai.response.sent
    logger.aiResponseSent({
      request_id: requestId,
      status: narrative.wasBlocked ? 'blocked' : 'approved',
      response_type: narrative.wasBlocked ? 'blocked' : 'facts',
      evidence_ids_summary: narrative.evidence,
      latency_ms_total: executionTime,
    });
    
    console.log('[TRUTH ORCH] Pipeline completed');
    console.log('[TRUTH ORCH] Total time:', executionTime, 'ms');
    console.log('[TRUTH ORCH] ══════════════════════════════════════════════════');
    
    return {
      content: narrative.content,
      wasBlocked: narrative.wasBlocked,
      blockReason: governorDecision.status === 'blocked' ? governorDecision.reason : undefined,
      evidence: narrative.evidence,
      plan,
      governorDecision,
      authorityLevel: authorityContext.currentLevel,
      executionTime,
      requestId,
    };
  }
}

/**
 * SINGLETON: Instancia global del orchestrator
 */
let truthOrchestratorInstance: TruthOrchestrator | null = null;

export async function getTruthOrchestrator(): Promise<TruthOrchestrator> {
  if (!truthOrchestratorInstance) {
    truthOrchestratorInstance = new TruthOrchestrator();
    await truthOrchestratorInstance.initialize();
  }
  return truthOrchestratorInstance;
}
