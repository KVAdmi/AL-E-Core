/**
 * TRUTH LAYER - PLANNER
 * 
 * Responsabilidad: PENSAR, NO HABLAR
 * - Analiza el mensaje del usuario
 * - Determina intent y tools requeridos
 * - Calcula autoridad necesaria
 * - Genera plan de ejecución
 * 
 * PROHIBIDO:
 * - Generar texto para el usuario
 * - Ejecutar tools
 * - Narrar resultados
 */

import { IntentClassification, classifyIntent } from '../../services/intentClassifier';
import { AuthorityLevel, getMaxRequiredAuthority, needsConfirmation } from '../authority/authorityMatrix';

export interface ExecutionPlan {
  intent: string;                     // "send_email", "list_emails", "create_event", etc.
  authorityRequired: AuthorityLevel;  // Nivel mínimo de autoridad
  requiresConfirmation: boolean;      // ¿Necesita confirmación del usuario?
  requiredTools: string[];            // Tools que DEBEN ejecutarse
  optionalTools: string[];            // Tools opcionales (best-effort)
  planSteps: string[];                // Pasos del plan (para logging)
  reasoning: string;                  // Por qué se eligió este plan
  classification: IntentClassification; // Clasificación del intent
}

/**
 * PLANNER CLASS
 */
export class Planner {
  
  /**
   * PLAN: Analizar mensaje y generar plan de ejecución
   */
  plan(userMessage: string, contextHints?: any): ExecutionPlan {
    console.log('[PLANNER] ═══════════════════════════════════════');
    console.log('[PLANNER] Planning execution for message');
    console.log('[PLANNER] Message:', userMessage.substring(0, 100));
    
    // 1. Clasificar intent
    const classification = classifyIntent(userMessage);
    console.log('[PLANNER] Intent classified:', classification.intent_type);
    console.log('[PLANNER] Confidence:', classification.confidence);
    console.log('[PLANNER] Tools required:', classification.tools_required);
    
    // 2. Determinar intent primario
    const intent = this.determineIntent(userMessage, classification);
    console.log('[PLANNER] Primary intent:', intent);
    
    // 3. Determinar tools requeridos
    const requiredTools = this.determineRequiredTools(userMessage, classification);
    const optionalTools = this.determineOptionalTools(userMessage, classification);
    console.log('[PLANNER] Required tools:', requiredTools);
    console.log('[PLANNER] Optional tools:', optionalTools);
    
    // 4. Calcular autoridad requerida
    const authorityRequired = getMaxRequiredAuthority(requiredTools);
    console.log('[PLANNER] Authority required:', authorityRequired);
    
    // 5. Verificar si necesita confirmación
    const requiresConfirmation = needsConfirmation(requiredTools);
    console.log('[PLANNER] Requires confirmation:', requiresConfirmation);
    
    // 6. Generar pasos del plan
    const planSteps = this.generatePlanSteps(intent, requiredTools, optionalTools);
    
    // 7. Razonamiento
    const reasoning = this.generateReasoning(intent, requiredTools, authorityRequired, requiresConfirmation);
    
    console.log('[PLANNER] ✅ Plan generated');
    console.log('[PLANNER] ═══════════════════════════════════════');
    
    return {
      intent,
      authorityRequired,
      requiresConfirmation,
      requiredTools,
      optionalTools,
      planSteps,
      reasoning,
      classification,
    };
  }
  
  /**
   * DETERMINE INTENT: Traducir clasificación a intent específico
   */
  private determineIntent(userMessage: string, classification: IntentClassification): string {
    const lowerMsg = userMessage.toLowerCase();
    
    // EMAIL
    if (lowerMsg.includes('envía') || lowerMsg.includes('envia') || lowerMsg.includes('manda')) {
      if (lowerMsg.includes('correo') || lowerMsg.includes('email')) {
        return 'send_email';
      }
    }
    
    if (lowerMsg.includes('lee') || lowerMsg.includes('revisa') || lowerMsg.includes('muestra')) {
      if (lowerMsg.includes('correo') || lowerMsg.includes('email') || lowerMsg.includes('inbox')) {
        return 'list_emails';
      }
    }
    
    // CALENDAR
    if (lowerMsg.includes('agenda') || lowerMsg.includes('cita') || lowerMsg.includes('reunión')) {
      if (lowerMsg.includes('crea') || lowerMsg.includes('agendar')) {
        return 'create_event';
      }
      if (lowerMsg.includes('lista') || lowerMsg.includes('muestra') || lowerMsg.includes('cuándo')) {
        return 'list_events';
      }
    }
    
    // MEETINGS
    if (lowerMsg.includes('grabación') || lowerMsg.includes('reunión grabada') || lowerMsg.includes('minuta')) {
      return 'meeting_query';
    }
    
    // WEB SEARCH
    if (classification.intent_type === 'time_sensitive' || classification.tools_required.includes('web_search')) {
      return 'web_search';
    }
    
    // KNOWLEDGE QUERY
    if (classification.intent_type === 'stable') {
      return 'knowledge_query';
    }
    
    // DEFAULT
    return 'general_query';
  }
  
  /**
   * DETERMINE REQUIRED TOOLS: Tools que DEBEN ejecutarse
   */
  private determineRequiredTools(userMessage: string, classification: IntentClassification): string[] {
    const lowerMsg = userMessage.toLowerCase();
    const tools: string[] = [];
    
    // ═══ EMAIL TOOLS ═══
    // Enviar email
    if ((lowerMsg.includes('envía') || lowerMsg.includes('envia') || lowerMsg.includes('manda') || lowerMsg.includes('escribe')) && 
        (lowerMsg.includes('correo') || lowerMsg.includes('email') || lowerMsg.includes('mail'))) {
      tools.push('send_email');
    }
    // Listar emails (inbox)
    else if ((lowerMsg.includes('revisa') || lowerMsg.includes('muestra') || lowerMsg.includes('lista') || lowerMsg.includes('cuál') || lowerMsg.includes('últim')) && 
             (lowerMsg.includes('correo') || lowerMsg.includes('email') || lowerMsg.includes('inbox') || lowerMsg.includes('bandeja'))) {
      tools.push('list_emails');
    }
    // Leer email específico (cuando menciona "lee" o pide contenido)
    else if ((lowerMsg.includes('lee') || lowerMsg.includes('abre') || lowerMsg.includes('contenido') || lowerMsg.includes('dice')) && 
             (lowerMsg.includes('correo') || lowerMsg.includes('email') || lowerMsg.includes('mensaje'))) {
      // Si pide leer, primero necesita listar para obtener emailId
      if (!tools.includes('list_emails')) {
        tools.push('list_emails');
      }
    }
    
    // ═══ CALENDAR TOOLS ═══
    // Crear evento
    if ((lowerMsg.includes('crea') || lowerMsg.includes('agendar') || lowerMsg.includes('programa') || lowerMsg.includes('agregar')) && 
        (lowerMsg.includes('evento') || lowerMsg.includes('cita') || lowerMsg.includes('reunión') || lowerMsg.includes('junta') || lowerMsg.includes('agenda'))) {
      tools.push('create_event');
    }
    // Listar eventos
    else if ((lowerMsg.includes('qué') || lowerMsg.includes('cuál') || lowerMsg.includes('muestra') || lowerMsg.includes('lista') || lowerMsg.includes('tengo') || lowerMsg.includes('agenda')) && 
             (lowerMsg.includes('evento') || lowerMsg.includes('cita') || lowerMsg.includes('reunión') || lowerMsg.includes('calendario') || lowerMsg.includes('agenda') || lowerMsg.includes('programado') || lowerMsg.includes('agendado'))) {
      tools.push('list_events');
    }
    
    // ═══ WEB SEARCH ═══
    // Si clasificación sugiere web_search O si pide buscar/investigar
    if (classification.tools_required.includes('web_search') || 
        lowerMsg.includes('busca') || lowerMsg.includes('investiga') || 
        lowerMsg.includes('encuentra') || lowerMsg.includes('información sobre') ||
        lowerMsg.includes('qué es') || lowerMsg.includes('cómo funciona')) {
      // Solo si NO es algo interno (email, calendario)
      if (!lowerMsg.includes('correo') && !lowerMsg.includes('email') && !lowerMsg.includes('agenda')) {
        tools.push('web_search');
      }
    }
    
    // ═══ MEETING TOOLS ═══
    if (lowerMsg.includes('grabación') || lowerMsg.includes('transcripción') || lowerMsg.includes('minuta') || lowerMsg.includes('reunión grabada')) {
      tools.push('meeting_query');
    }
    
    return tools;
  }
  
  /**
   * DETERMINE OPTIONAL TOOLS: Tools opcionales (best-effort)
   */
  private determineOptionalTools(userMessage: string, classification: IntentClassification): string[] {
    // Por ahora, sin tools opcionales (simplificar)
    return [];
  }
  
  /**
   * GENERATE PLAN STEPS: Pasos legibles del plan
   */
  private generatePlanSteps(intent: string, requiredTools: string[], optionalTools: string[]): string[] {
    const steps: string[] = [];
    
    steps.push(`Intent identificado: ${intent}`);
    
    if (requiredTools.length > 0) {
      steps.push(`Ejecutar tools obligatorios: ${requiredTools.join(', ')}`);
    }
    
    if (optionalTools.length > 0) {
      steps.push(`Ejecutar tools opcionales: ${optionalTools.join(', ')}`);
    }
    
    steps.push('Validar evidencia de ejecución');
    steps.push('Generar respuesta basada en resultados reales');
    
    return steps;
  }
  
  /**
   * GENERATE REASONING: Explicar por qué este plan
   */
  private generateReasoning(
    intent: string,
    requiredTools: string[],
    authority: AuthorityLevel,
    needsConfirm: boolean
  ): string {
    let reasoning = `Intent "${intent}" requiere autoridad ${authority}. `;
    
    if (requiredTools.length > 0) {
      reasoning += `Tools necesarios: ${requiredTools.join(', ')}. `;
    }
    
    if (needsConfirm) {
      reasoning += 'Requiere confirmación del usuario antes de ejecutar. ';
    }
    
    return reasoning;
  }
}
