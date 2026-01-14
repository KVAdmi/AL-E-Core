/**
 * TRUTH LAYER - EXECUTOR
 * 
 * Responsabilidad: EJECUTAR, NO NARRAR
 * - Ejecuta tools según el plan
 * - Recolecta evidencia técnica
 * - NO interpreta resultados
 * - NO genera texto para el usuario
 * 
 * PROHIBIDO:
 * - Inventar resultados
 * - Narrar acciones
 * - Asumir éxito sin evidencia
 */

import { executeTool } from '../tools/toolRouter';

export interface ToolExecutionResult {
  tool: string;                // Nombre del tool ejecutado
  success: boolean;            // ¿Ejecutó exitosamente?
  output: any;                 // Output crudo del tool
  evidenceIds: Record<string, any>; // IDs de evidencia (messageId, eventId, etc.)
  error?: string;              // Error si falló
  timestamp: string;           // Cuándo se ejecutó
}

export interface ExecutionReport {
  executions: ToolExecutionResult[];
  allSucceeded: boolean;
  failedTools: string[];
  totalExecutionTime: number;
}

/**
 * EXECUTOR CLASS
 */
export class Executor {
  
  /**
   * EXECUTE: Ejecutar tools según el plan
   */
  async execute(
    userId: string,
    requiredTools: string[],
    toolParameters: Record<string, any>
  ): Promise<ExecutionReport> {
    console.log('[EXECUTOR] ═══════════════════════════════════════');
    console.log('[EXECUTOR] Starting execution');
    console.log('[EXECUTOR] User:', userId);
    console.log('[EXECUTOR] Tools to execute:', requiredTools);
    
    const startTime = Date.now();
    const executions: ToolExecutionResult[] = [];
    
    // Ejecutar cada tool en secuencia
    for (const toolName of requiredTools) {
      console.log(`[EXECUTOR] Executing tool: ${toolName}`);
      
      const params = toolParameters[toolName] || {};
      const result = await this.executeSingleTool(userId, toolName, params);
      
      executions.push(result);
      
      if (!result.success) {
        console.log(`[EXECUTOR] ❌ Tool ${toolName} FAILED:`, result.error);
      } else {
        console.log(`[EXECUTOR] ✅ Tool ${toolName} SUCCESS`);
        if (Object.keys(result.evidenceIds).length > 0) {
          console.log(`[EXECUTOR] Evidence IDs:`, result.evidenceIds);
        }
      }
    }
    
    const totalExecutionTime = Date.now() - startTime;
    const allSucceeded = executions.every(e => e.success);
    const failedTools = executions.filter(e => !e.success).map(e => e.tool);
    
    console.log('[EXECUTOR] Execution complete');
    console.log('[EXECUTOR] All succeeded:', allSucceeded);
    console.log('[EXECUTOR] Failed tools:', failedTools.length > 0 ? failedTools : 'none');
    console.log('[EXECUTOR] Total time:', totalExecutionTime, 'ms');
    console.log('[EXECUTOR] ═══════════════════════════════════════');
    
    return {
      executions,
      allSucceeded,
      failedTools,
      totalExecutionTime,
    };
  }
  
  /**
   * EXECUTE SINGLE TOOL: Ejecutar un tool individual
   */
  private async executeSingleTool(
    userId: string,
    toolName: string,
    parameters: any
  ): Promise<ToolExecutionResult> {
    const timestamp = new Date().toISOString();
    
    try {
      // Ejecutar tool via toolRouter
      const result = await executeTool(userId, {
        name: toolName,
        parameters,
      });
      
      // Extraer evidencia
      const evidenceIds = this.extractEvidenceIds(toolName, result);
      
      return {
        tool: toolName,
        success: result.success === true,
        output: result,
        evidenceIds,
        error: result.error,
        timestamp,
      };
      
    } catch (error: any) {
      console.error(`[EXECUTOR] Exception executing ${toolName}:`, error);
      
      return {
        tool: toolName,
        success: false,
        output: null,
        evidenceIds: {},
        error: error.message || 'Unknown error',
        timestamp,
      };
    }
  }
  
  /**
   * EXTRACT EVIDENCE IDS: Extraer IDs de evidencia del resultado
   */
  private extractEvidenceIds(toolName: string, result: any): Record<string, any> {
    const evidence: Record<string, any> = {};
    
    if (!result || !result.data) {
      return evidence;
    }
    
    const data = result.data;
    
    // EMAIL
    if (toolName.includes('email') || toolName.includes('mail')) {
      if (data.messageId) evidence.messageId = data.messageId;
      if (data.threadId) evidence.threadId = data.threadId;
      if (data.messages && Array.isArray(data.messages)) {
        evidence.messageIds = data.messages.map((m: any) => m.id);
        evidence.count = data.messages.length;
      }
    }
    
    // CALENDAR
    if (toolName.includes('event') || toolName.includes('calendar')) {
      if (data.eventId) evidence.eventId = data.eventId;
      if (data.id) evidence.eventId = data.id;
      if (data.link) evidence.link = data.link;
      if (data.events && Array.isArray(data.events)) {
        evidence.eventIds = data.events.map((e: any) => e.id);
        evidence.count = data.events.length;
      }
    }
    
    // MEETINGS
    if (toolName.includes('meeting')) {
      if (data.meetingId) evidence.meetingId = data.meetingId;
      if (data.transcriptId) evidence.transcriptId = data.transcriptId;
      if (data.minuteId) evidence.minuteId = data.minuteId;
      if (data.s3Key) evidence.audioObjectKey = data.s3Key;
    }
    
    // DOCUMENTS
    if (toolName.includes('document') || toolName.includes('ocr')) {
      if (data.documentId) evidence.documentId = data.documentId;
      if (data.extractionId) evidence.extractionId = data.extractionId;
    }
    
    // WEB SEARCH
    if (toolName === 'web_search') {
      if (data.queryId) evidence.queryId = data.queryId;
      if (data.results && Array.isArray(data.results)) {
        evidence.sources = data.results.map((r: any) => r.url || r.title);
        evidence.count = data.results.length;
      }
    }
    
    return evidence;
  }
  
  /**
   * VALIDATE EVIDENCE: Verificar si hay evidencia suficiente
   */
  validateEvidence(executions: ToolExecutionResult[]): boolean {
    // Todos los tools exitosos deben tener al menos un evidence ID
    for (const exec of executions) {
      if (exec.success && Object.keys(exec.evidenceIds).length === 0) {
        // Tool exitoso pero sin evidencia → sospechoso
        console.warn(`[EXECUTOR] ⚠️ Tool ${exec.tool} succeeded but has NO evidence IDs`);
        
        // Excepciones: algunos tools no requieren evidenceIds
        const noEvidenceRequired = [
          'web_search', // Puede fallar y retornar empty results
          'meeting_status', // Solo lectura de estado
        ];
        
        if (!noEvidenceRequired.includes(exec.tool)) {
          return false; // Falta evidencia
        }
      }
    }
    
    return true; // Evidencia suficiente
  }
}
