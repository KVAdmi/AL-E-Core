/**
 * TRUTH LAYER - NARRATOR
 * 
 * Responsabilidad: COMUNICAR HECHOS APROBADOS
 * - SOLO puede hablar si Governor aprobó
 * - Narra ÚNICAMENTE basado en evidencia real
 * - NO inventa, NO asume, NO improvisa
 * 
 * PROHIBIDO:
 * - Decir "hice X" sin evidenceIds
 * - Decir "parece que", "encontré", "revisé" sin datos
 * - Inventar resultados cuando executions fallaron
 */

import { GovernorDecision } from './governor';
import { ExecutionReport } from './executor';
import { ExecutionPlan } from './planner';

export interface NarrativeResponse {
  content: string;        // Texto para el usuario
  wasBlocked: boolean;    // ¿Fue bloqueado por Governor?
  evidence: any;          // Evidencia usada en la narración
}

/**
 * NARRATOR CLASS
 */
export class Narrator {
  
  /**
   * NARRATE: Generar respuesta basada en decisión del Governor
   */
  narrate(
    decision: GovernorDecision,
    plan: ExecutionPlan,
    executionReport: ExecutionReport
  ): NarrativeResponse {
    console.log('[NARRATOR] ═══════════════════════════════════════');
    console.log('[NARRATOR] Generating narrative');
    console.log('[NARRATOR] Governor status:', decision.status);
    
    // Si está bloqueado, narrar solo el bloqueo
    if (decision.status === 'blocked') {
      console.log('[NARRATOR] Narrating BLOCKED response');
      const content = this.narrateBlocked(decision);
      
      return {
        content,
        wasBlocked: true,
        evidence: decision.details || {},
      };
    }
    
    // Si fue aprobado, narrar basado en evidencia
    console.log('[NARRATOR] Narrating APPROVED response');
    const content = this.narrateApproved(plan, executionReport);
    
    const evidence = this.collectEvidence(executionReport);
    
    console.log('[NARRATOR] Narrative generated');
    console.log('[NARRATOR] ═══════════════════════════════════════');
    
    return {
      content,
      wasBlocked: false,
      evidence,
    };
  }
  
  /**
   * NARRATE BLOCKED: Respuesta cuando Governor bloqueó
   */
  private narrateBlocked(decision: GovernorDecision): string {
    const reason = decision.reason;
    const details = decision.details;
    
    // BLOQUEO: Falta autoridad
    if (reason === 'authority_insufficient') {
      return `Esta operación requiere nivel de autoridad ${details.requiredLevel}, pero actualmente tienes ${details.currentLevel}.`;
    }
    
    // BLOQUEO: Falta confirmación
    if (reason === 'confirmation_required') {
      return `${details.message}\n\n${details.confirmationPrompt}`;
    }
    
    // BLOQUEO: Capability deshabilitada
    if (reason === 'capability_disabled') {
      return details.message || 'Esta función no está disponible actualmente.';
    }
    
    // BLOQUEO: No hay cuentas configuradas
    if (reason === 'no_accounts_configured') {
      return details.message || 'No hay cuentas configuradas.';
    }
    
    // BLOQUEO: Tools faltantes
    if (reason === 'missing_tools') {
      return 'No se pudieron ejecutar todas las herramientas necesarias para completar esta acción.';
    }
    
    // BLOQUEO: Tools fallaron
    if (reason === 'tool_failed') {
      const errors = details.errors || [];
      if (errors.length > 0) {
        const errorMsg = errors[0].error;
        return `No pude completar la acción. ${errorMsg}`;
      }
      return 'Una o más acciones fallaron durante la ejecución.';
    }
    
    // BLOQUEO: Falta evidencia
    if (reason === 'missing_evidence') {
      return 'Las acciones no generaron evidencia verificable. No puedo confirmar que se completaron correctamente.';
    }
    
    // BLOQUEO genérico
    return 'No puedo completar esta acción en este momento.';
  }
  
  /**
   * NARRATE APPROVED: Respuesta cuando Governor aprobó
   */
  private narrateApproved(plan: ExecutionPlan, executionReport: ExecutionReport): string {
    const intent = plan.intent;
    const executions = executionReport.executions;
    
    // SEND EMAIL
    if (intent === 'send_email') {
      const exec = executions.find(e => e.tool === 'send_email' || e.tool === 'create_and_send_email');
      if (exec && exec.evidenceIds.messageId) {
        return `Correo enviado. ID de mensaje: ${exec.evidenceIds.messageId}`;
      }
    }
    
    // LIST EMAILS
    if (intent === 'list_emails') {
      const exec = executions.find(e => e.tool === 'list_emails');
      if (exec && exec.evidenceIds.count !== undefined) {
        const count = exec.evidenceIds.count;
        
        if (count === 0) {
          return 'No tienes correos nuevos sin leer.';
        }
        
        // Narrar resumen de correos
        const messages = exec.output?.data?.messages || [];
        const summary = messages.slice(0, 5).map((m: any, idx: number) => {
          const from = m.from_name || m.from_address || m.from_email;
          const subject = m.subject || '(Sin asunto)';
          return `${idx + 1}. De: ${from}\n   Asunto: ${subject}`;
        }).join('\n\n');
        
        return `Tienes ${count} correo${count > 1 ? 's' : ''} sin leer:\n\n${summary}`;
      }
    }
    
    // CREATE EVENT
    if (intent === 'create_event') {
      const exec = executions.find(e => e.tool === 'create_event');
      if (exec && exec.evidenceIds.eventId) {
        const event = exec.output?.data || {};
        const title = event.title || 'Evento';
        const date = event.start ? new Date(event.start).toLocaleString('es-MX') : '';
        const link = exec.evidenceIds.link || '';
        
        let response = `Listo. Agendé "${title}"`;
        if (date) response += ` para el ${date}`;
        if (link) response += `\n\nLink de la reunión: ${link}`;
        
        return response;
      }
    }
    
    // LIST EVENTS
    if (intent === 'list_events') {
      const exec = executions.find(e => e.tool === 'list_events');
      if (exec && exec.evidenceIds.count !== undefined) {
        const count = exec.evidenceIds.count;
        
        if (count === 0) {
          return 'No tienes eventos próximos en tu calendario.';
        }
        
        const events = exec.output?.data?.events || [];
        const summary = events.slice(0, 5).map((e: any, idx: number) => {
          const title = e.title || e.summary || '(Sin título)';
          const start = e.start ? new Date(e.start).toLocaleString('es-MX') : '';
          return `${idx + 1}. ${title}\n   ${start}`;
        }).join('\n\n');
        
        return `Tienes ${count} evento${count > 1 ? 's' : ''} próximo${count > 1 ? 's' : ''}:\n\n${summary}`;
      }
    }
    
    // WEB SEARCH
    if (intent === 'web_search') {
      const exec = executions.find(e => e.tool === 'web_search');
      if (exec && exec.evidenceIds.sources) {
        const sources = exec.evidenceIds.sources;
        const results = exec.output?.data?.results || [];
        
        if (results.length === 0) {
          return 'No encontré resultados relevantes en la búsqueda web.';
        }
        
        // Narrar resultados
        const summary = results.slice(0, 3).map((r: any, idx: number) => {
          const title = r.title || 'Sin título';
          const snippet = r.snippet || r.content || '';
          const url = r.url || '';
          return `${idx + 1}. ${title}\n   ${snippet.substring(0, 150)}...\n   ${url}`;
        }).join('\n\n');
        
        return `Encontré ${results.length} resultado${results.length > 1 ? 's' : ''}:\n\n${summary}`;
      }
    }
    
    // MEETING QUERY
    if (intent === 'meeting_query') {
      const exec = executions.find(e => e.tool.includes('meeting'));
      if (exec && exec.evidenceIds.meetingId) {
        return `Información de la reunión obtenida (ID: ${exec.evidenceIds.meetingId}).`;
      }
    }
    
    // GENERAL QUERY (sin tools ejecutados)
    if (executions.length === 0) {
      return 'Información procesada basada en conocimiento disponible.';
    }
    
    // Fallback genérico
    return 'Acción completada exitosamente.';
  }
  
  /**
   * COLLECT EVIDENCE: Recolectar toda la evidencia de executions
   */
  private collectEvidence(executionReport: ExecutionReport): any {
    const evidence: any = {
      executionTime: executionReport.totalExecutionTime,
      tools: [],
    };
    
    for (const exec of executionReport.executions) {
      evidence.tools.push({
        tool: exec.tool,
        success: exec.success,
        evidenceIds: exec.evidenceIds,
        timestamp: exec.timestamp,
      });
    }
    
    return evidence;
  }
}
