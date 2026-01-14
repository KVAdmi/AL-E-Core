/**
 * TRUTH LAYER - GOVERNOR
 * 
 * Responsabilidad: POLICÍA DE EVIDENCIA
 * - Valida que todas las acciones tienen evidencia real
 * - Bloquea respuestas si falta evidencia
 * - Verifica integridad de executions
 * - NO narra, solo APRUEBA o BLOQUEA
 * 
 * REGLA SUPREMA:
 * SIN EVIDENCIA = AL-E NO RESPONDE
 */

import { ExecutionReport, ToolExecutionResult } from './executor';
import { ExecutionPlan } from './planner';
import { AuthorityContext } from '../authority/authorityEngine';

export interface GovernorDecision {
  status: 'approved' | 'blocked';
  reason?: string;
  missingEvidence?: string[];
  failedTools?: string[];
  details?: any;
}

export interface GovernorContext {
  plan: ExecutionPlan;
  executionReport: ExecutionReport;
  authorityContext: AuthorityContext;
}

/**
 * GOVERNOR CLASS
 */
export class Governor {
  
  /**
   * VALIDATE: Validar ejecución y decidir si aprobar o bloquear
   */
  validate(context: GovernorContext): GovernorDecision {
    console.log('[GOVERNOR] ═══════════════════════════════════════');
    console.log('[GOVERNOR] Starting validation');
    console.log('[GOVERNOR] Required tools:', context.plan.requiredTools);
    console.log('[GOVERNOR] Executed tools:', context.executionReport.executions.length);
    
    // 1. Verificar que todos los required tools se ejecutaron
    const missingTools = this.checkMissingTools(context.plan, context.executionReport);
    if (missingTools.length > 0) {
      console.log('[GOVERNOR] ❌ BLOCKED: Missing required tools');
      console.log('[GOVERNOR] Missing:', missingTools);
      
      return {
        status: 'blocked',
        reason: 'missing_tools',
        missingEvidence: missingTools,
        details: {
          message: 'No se pudieron ejecutar todas las herramientas necesarias.',
          missingTools,
        },
      };
    }
    
    // 2. Verificar que todos tuvieron éxito
    if (!context.executionReport.allSucceeded) {
      console.log('[GOVERNOR] ❌ BLOCKED: Some tools failed');
      console.log('[GOVERNOR] Failed:', context.executionReport.failedTools);
      
      return {
        status: 'blocked',
        reason: 'tool_failed',
        failedTools: context.executionReport.failedTools,
        details: {
          message: 'Una o más acciones fallaron durante la ejecución.',
          failedTools: context.executionReport.failedTools,
          errors: this.extractErrors(context.executionReport),
        },
      };
    }
    
    // 3. Verificar evidencia en cada ejecución
    const missingEvidence = this.checkMissingEvidence(context.executionReport);
    if (missingEvidence.length > 0) {
      console.log('[GOVERNOR] ❌ BLOCKED: Missing evidence');
      console.log('[GOVERNOR] Tools without evidence:', missingEvidence);
      
      return {
        status: 'blocked',
        reason: 'missing_evidence',
        missingEvidence,
        details: {
          message: 'Las acciones no generaron evidencia verificable.',
          toolsWithoutEvidence: missingEvidence,
        },
      };
    }
    
    // 4. Validaciones específicas por tipo de tool
    const specificValidation = this.validateSpecificTools(context.executionReport);
    if (!specificValidation.valid) {
      console.log('[GOVERNOR] ❌ BLOCKED: Specific validation failed');
      console.log('[GOVERNOR] Reason:', specificValidation.reason);
      
      return {
        status: 'blocked',
        reason: specificValidation.reason || 'validation_failed',
        details: specificValidation.details,
      };
    }
    
    // 5. TODO APROBADO
    console.log('[GOVERNOR] ✅ VALIDATION APPROVED');
    console.log('[GOVERNOR] All tools executed successfully with evidence');
    console.log('[GOVERNOR] ═══════════════════════════════════════');
    
    return {
      status: 'approved',
    };
  }
  
  /**
   * CHECK MISSING TOOLS: Verificar que todos los required tools se ejecutaron
   */
  private checkMissingTools(plan: ExecutionPlan, report: ExecutionReport): string[] {
    const executedToolNames = report.executions.map(e => e.tool);
    const missing: string[] = [];
    
    for (const requiredTool of plan.requiredTools) {
      if (!executedToolNames.includes(requiredTool)) {
        missing.push(requiredTool);
      }
    }
    
    return missing;
  }
  
  /**
   * CHECK MISSING EVIDENCE: Verificar que tools exitosos tienen evidencia
   */
  private checkMissingEvidence(report: ExecutionReport): string[] {
    const missingEvidence: string[] = [];
    
    // Tools que NO requieren evidenceIds (excepciones)
    const noEvidenceRequired = [
      'web_search',      // Puede retornar resultados sin queryId
      'meeting_status',  // Solo lectura de estado
      'list_events',     // Lista vacía es válida
      'list_emails',     // Lista vacía es válida
    ];
    
    for (const exec of report.executions) {
      if (exec.success) {
        // Si el tool requiere evidencia y no tiene
        if (!noEvidenceRequired.includes(exec.tool) && 
            Object.keys(exec.evidenceIds).length === 0) {
          missingEvidence.push(exec.tool);
        }
      }
    }
    
    return missingEvidence;
  }
  
  /**
   * VALIDATE SPECIFIC TOOLS: Validaciones específicas por tool
   */
  private validateSpecificTools(report: ExecutionReport): { valid: boolean; reason?: string; details?: any } {
    for (const exec of report.executions) {
      // EMAIL: send_email DEBE tener messageId
      if ((exec.tool === 'send_email' || exec.tool === 'create_and_send_email') && exec.success) {
        if (!exec.evidenceIds.messageId) {
          return {
            valid: false,
            reason: 'email_no_message_id',
            details: {
              message: 'El envío de correo no generó un messageId verificable.',
              tool: exec.tool,
            },
          };
        }
      }
      
      // CALENDAR: create_event DEBE tener eventId
      if (exec.tool === 'create_event' && exec.success) {
        if (!exec.evidenceIds.eventId) {
          return {
            valid: false,
            reason: 'calendar_no_event_id',
            details: {
              message: 'La creación del evento no generó un eventId verificable.',
              tool: exec.tool,
            },
          };
        }
      }
      
      // MEETINGS: meeting_send DEBE tener messageId (correo enviado)
      if (exec.tool === 'meeting_send' && exec.success) {
        if (!exec.evidenceIds.messageId) {
          return {
            valid: false,
            reason: 'meeting_send_no_message_id',
            details: {
              message: 'El envío de la minuta no generó confirmación de correo.',
              tool: exec.tool,
            },
          };
        }
      }
    }
    
    return { valid: true };
  }
  
  /**
   * EXTRACT ERRORS: Extraer mensajes de error de executions fallidas
   */
  private extractErrors(report: ExecutionReport): Array<{ tool: string; error: string }> {
    return report.executions
      .filter(e => !e.success)
      .map(e => ({
        tool: e.tool,
        error: e.error || 'Unknown error',
      }));
  }
  
  /**
   * VALIDATE NO ACCOUNTS: Caso especial - no hay cuentas configuradas
   */
  validateNoAccounts(toolName: string): GovernorDecision {
    console.log('[GOVERNOR] ❌ BLOCKED: No accounts configured');
    
    let message = '';
    if (toolName.includes('email') || toolName.includes('mail')) {
      message = 'No hay cuentas de correo configuradas. Agrega una cuenta para poder leer o enviar correos.';
    } else if (toolName.includes('calendar') || toolName.includes('event')) {
      message = 'No hay cuentas de calendario configuradas.';
    }
    
    return {
      status: 'blocked',
      reason: 'no_accounts_configured',
      details: {
        message,
        tool: toolName,
      },
    };
  }
  
  /**
   * VALIDATE CAPABILITY DISABLED: Caso especial - capability deshabilitada
   */
  validateCapabilityDisabled(toolName: string, capability: string): GovernorDecision {
    console.log('[GOVERNOR] ❌ BLOCKED: Capability disabled');
    
    return {
      status: 'blocked',
      reason: 'capability_disabled',
      details: {
        message: `Esta función (${capability}) no está disponible actualmente.`,
        tool: toolName,
        capability,
      },
    };
  }
}
