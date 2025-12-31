/**
 * RESPONSE VALIDATOR P0
 * 
 * Valida que el LLM NO mienta sobre acciones ejecutadas
 * Si dice "agendé" pero no hay eventId → RECHAZAR
 */

import { ActionResult } from './actionGateway';
import { IntentClassification } from './intentClassifier';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  correctedResponse?: string;
}

/**
 * Valida respuesta del LLM contra la evidencia real
 */
export function validateLLMResponse(
  llmResponse: string,
  intent: IntentClassification,
  actionResult?: ActionResult
): ValidationResult {
  
  const lowerResponse = llmResponse.toLowerCase();
  
  // ═══════════════════════════════════════════════════════════════
  // GUARDRAIL 1: NO PUEDE DECIR "AGENDÉ" SIN eventId
  // ═══════════════════════════════════════════════════════════════
  
  if (intent.tools_required.includes('calendar')) {
    const claimsPhrases = [
      'agendé',
      'he agendado',
      'cita ha sido creada',
      'evento creado',
      'agregué',
      'he agregado',
      'la llamada está',
      'quedó agendada'
    ];
    
    const claimsExecution = claimsPhrases.some(phrase => lowerResponse.includes(phrase));
    
    if (claimsExecution) {
      // Verificar si HAY evidencia
      if (!actionResult || !actionResult.success || !actionResult.evidence?.eventId) {
        console.error('[RESPONSE_VALIDATOR] ❌ LLM MENTIRA DETECTADA: dice "agendé" pero NO hay eventId');
        
        return {
          valid: false,
          reason: 'LLM_LIE: Claims calendar action without evidence',
          correctedResponse: actionResult?.userMessage || '¿Para qué fecha y hora quieres agendar el evento?'
        };
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // GUARDRAIL 2: NO PUEDE DECIR "BUSQUÉ" SIN urls
  // ═══════════════════════════════════════════════════════════════
  
  if (intent.tools_required.includes('web_search')) {
    const claimsPhrases = [
      'encontré',
      'busqué',
      'los resultados son',
      'según',
      'de acuerdo a'
    ];
    
    const claimsSearch = claimsPhrases.some(phrase => lowerResponse.includes(phrase));
    
    if (claimsSearch) {
      if (!actionResult || !actionResult.success || !actionResult.evidence?.urls || actionResult.evidence.urls.length === 0) {
        console.error('[RESPONSE_VALIDATOR] ❌ LLM MENTIRA DETECTADA: dice "busqué" pero NO hay urls');
        
        return {
          valid: false,
          reason: 'LLM_LIE: Claims web search without evidence',
          correctedResponse: 'No encontré información sobre eso.'
        };
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // GUARDRAIL 3: NO PUEDE MENCIONAR GOOGLE CALENDAR
  // ═══════════════════════════════════════════════════════════════
  
  if (intent.tools_required.includes('calendar')) {
    const prohibitedPhrases = [
      'google calendar',
      'necesito que conectes',
      'configura tu calendario',
      'no tengo acceso a tu calendario'
    ];
    
    for (const phrase of prohibitedPhrases) {
      if (lowerResponse.includes(phrase)) {
        console.error(`[RESPONSE_VALIDATOR] ❌ FRASE PROHIBIDA: "${phrase}"`);
        
        return {
          valid: false,
          reason: `PROHIBITED_PHRASE: "${phrase}"`,
          correctedResponse: 'Uso mi calendario interno para agendar. ¿Para qué fecha y hora?'
        };
      }
    }
  }
  
  return { valid: true };
}
