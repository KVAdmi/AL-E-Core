/**
 * TRUTH LAYER (ANTI-MENTIRAS)
 * 
 * Capa de validación que bloquea respuestas inventadas.
 * 
 * REGLA DE ORO:
 * - Si toolsUsed = 0 y la acción requería tool → ERROR
 * - Si toolsUsed > 0 pero toolResults vacíos → ERROR
 * - Solo permite afirmar acciones con toolResult comprobable
 */

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  errorCode?: string;
}

/**
 * Determina si un mensaje del usuario requiere ejecutar una tool
 */
export function requiresTool(userMessage: string): boolean {
  const lowerMsg = userMessage.toLowerCase();
  
  // Patrones que REQUIEREN tool execution
  const toolRequiredPatterns = [
    // EMAIL
    /\b(revis|chec|ver|lee|leer|list|muestra|dame)\b.*\b(correo|email|mensaje|inbox|bandeja)/i,
    /\b(envia|manda|respond|contesta|escribe)\b.*\b(correo|email|mensaje)/i,
    
    // CALENDAR
    /\b(agenda|program|crea|pon|añade)\b.*\b(reunión|cita|evento|junta)/i,
    /\b(qué|cuál|cuales|cuándo|cuando)\b.*\b(tengo|hay|es mi)\b.*(agenda|cita|evento|reunión|junta)/i,
    
    // WEB SEARCH
    /\b(busca|investiga|encuentra|consulta)\b.*(en|la)?\s*(internet|web|google)/i,
    /\b(qué|cuál|cuanto|cómo)\b.*\b(es|son|cuesta|vale|significa)\b(?!.*\b(tu|nombre|eres)\b)/i,
    
    // ATTACHMENTS
    /\b(analiza|lee|revisa|examina|procesa)\b.*(archivo|documento|imagen|foto|pdf|excel)/i,
    /\b(qué|que)\b.*(dice|muestra|contiene|hay en)\b.*(archivo|documento|imagen|foto)/i,
  ];
  
  return toolRequiredPatterns.some(pattern => pattern.test(lowerMsg));
}

/**
 * Valida que una respuesta esté respaldada por tool execution real
 */
export function validateTruth(params: {
  userMessage: string;
  answer: string;
  toolsUsed: string[];
  toolResults?: Record<string, any>[];
  metadata?: Record<string, any>;
}): ValidationResult {
  const { userMessage, answer, toolsUsed, toolResults, metadata } = params;
  
  // ══════════════════════════════════════════════════════════════
  // VALIDACIÓN #1: Si requiere tool y no ejecutó ninguna → BLOQUEAR
  // ══════════════════════════════════════════════════════════════
  
  if (requiresTool(userMessage) && (!toolsUsed || toolsUsed.length === 0)) {
    console.error('[TRUTH LAYER] ❌ BLOCKED: Requiere tool pero toolsUsed = 0');
    console.error('[TRUTH LAYER] User message:', userMessage);
    console.error('[TRUTH LAYER] Answer attempt:', answer.substring(0, 200));
    
    return {
      isValid: false,
      errorCode: 'TOOL_EXECUTION_REQUIRED',
      error: 'No se pudo completar la acción porque no se ejecutó la tool requerida.'
    };
  }
  
  // ══════════════════════════════════════════════════════════════
  // VALIDACIÓN #2: Si ejecutó tool pero no hay resultados → BLOQUEAR
  // ══════════════════════════════════════════════════════════════
  
  if (toolsUsed && toolsUsed.length > 0) {
    if (!toolResults || toolResults.length === 0) {
      console.error('[TRUTH LAYER] ❌ BLOCKED: toolsUsed > 0 pero toolResults vacío');
      console.error('[TRUTH LAYER] Tools used:', toolsUsed);
      
      return {
        isValid: false,
        errorCode: 'MISSING_TOOL_RESULTS',
        error: 'Error interno: tool ejecutada pero sin resultados.'
      };
    }
  }
  
  // ══════════════════════════════════════════════════════════════
  // VALIDACIÓN #3: Respuesta afirma éxito sin tool → BLOQUEAR
  // ══════════════════════════════════════════════════════════════
  
  const successPhrases = [
    /\b(enviado|mandado|respondido)\b/i,
    /\b(agendé|programé|creé)\b.*\b(reunión|cita|evento)/i,
    /\b(encontré|busqué|revisé)\b/i,
    /\b(analicé|procesé|leí)\b.*\b(archivo|documento)/i,
    /\b(listo|hecho|completado|finalizado)\b/i,
  ];
  
  const claimsSuccess = successPhrases.some(pattern => pattern.test(answer));
  
  if (claimsSuccess && (!toolsUsed || toolsUsed.length === 0)) {
    console.error('[TRUTH LAYER] ❌ BLOCKED: Afirma éxito sin tool execution');
    console.error('[TRUTH LAYER] Answer:', answer.substring(0, 200));
    
    return {
      isValid: false,
      errorCode: 'SUCCESS_WITHOUT_TOOL',
      error: 'No se puede afirmar éxito sin ejecutar la acción requerida.'
    };
  }
  
  // ══════════════════════════════════════════════════════════════
  // VALIDACIÓN #4: Email/Calendar requieren IDs reales
  // ══════════════════════════════════════════════════════════════
  
  if (toolsUsed.includes('list_emails') || toolsUsed.includes('read_email')) {
    const emailResults = toolResults?.find(r => r.emails || r.email);
    
    if (!emailResults || (emailResults.emails && emailResults.emails.length === 0)) {
      // Si no hay correos, la respuesta debe admitirlo
      if (answer.match(/tienes?\s+\d+.*correo/i) || answer.match(/recibiste.*de/i)) {
        console.error('[TRUTH LAYER] ❌ BLOCKED: Afirma correos sin resultados');
        return {
          isValid: false,
          errorCode: 'EMAIL_FABRICATION',
          error: 'No se encontraron correos en tu cuenta.'
        };
      }
    }
  }
  
  if (toolsUsed.includes('list_events')) {
    const calendarResults = toolResults?.find(r => r.events);
    
    if (!calendarResults || (calendarResults.events && calendarResults.events.length === 0)) {
      // Si no hay eventos, la respuesta debe admitirlo
      if (answer.match(/tienes?\s+.*\b(reunión|cita|evento)/i)) {
        console.error('[TRUTH LAYER] ❌ BLOCKED: Afirma eventos sin resultados');
        return {
          isValid: false,
          errorCode: 'CALENDAR_FABRICATION',
          error: 'No se encontraron eventos en tu calendario.'
        };
      }
    }
  }
  
  // ══════════════════════════════════════════════════════════════
  // ✅ VALIDACIÓN PASADA
  // ══════════════════════════════════════════════════════════════
  
  console.log('[TRUTH LAYER] ✅ Validation passed');
  return { isValid: true };
}

/**
 * Genera mensaje de error estándar cuando Truth Layer bloquea una respuesta
 */
export function getTruthLayerErrorMessage(errorCode: string): string {
  const messages: Record<string, string> = {
    TOOL_EXECUTION_REQUIRED: 'No pude completar la acción porque no se ejecutó la operación requerida. Por favor, intenta de nuevo.',
    MISSING_TOOL_RESULTS: 'Ocurrió un error técnico al procesar tu solicitud. Por favor, intenta de nuevo.',
    SUCCESS_WITHOUT_TOOL: 'No puedo confirmar que la acción se completó. Por favor, verifica manualmente.',
    EMAIL_FABRICATION: 'No encontré correos en tu cuenta. Si esperabas ver correos, verifica que tu cuenta esté sincronizada.',
    CALENDAR_FABRICATION: 'No encontré eventos en tu calendario. Si esperabas ver eventos, verifica que tu calendario esté configurado.',
  };
  
  return messages[errorCode] || 'Ocurrió un error al procesar tu solicitud.';
}
