/**
 * ACTION GATEWAY P0
 * 
 * Core recupera autoridad TOTAL.
 * El LLM NO decide si ejecuta o no.
 * Core detecta intención y EJECUTA.
 * 
 * CRÍTICO: Esto elimina "no tengo acceso" cuando capability=true
 */

import { IntentClassification } from './intentClassifier';

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface ActionResult {
  success: boolean;
  action: string;
  evidence: any | null;
  userMessage: string;
  reason?: string;
}

export interface ActionContext {
  userId: string;
  workspaceId: string;
  projectId?: string;
}

// ═══════════════════════════════════════════════════════════════
// RUNTIME CAPABILITIES (VERDAD DEL SISTEMA)
// ═══════════════════════════════════════════════════════════════

const CAPABILITIES = {
  'calendar.create': true,
  'calendar.list': true,
  'calendar.update': true,
  'calendar.delete': true,
  'web.search': true,
  'mail.send': false,
  'mail.inbox': false,
  'telegram': false,
  'documents.read': false
};

// ═══════════════════════════════════════════════════════════════
// ACTION GATEWAY
// ═══════════════════════════════════════════════════════════════

/**
 * Ejecuta acción basada en intención
 * CRÍTICO: Core manda, LLM obedece
 */
export async function executeAction(
  intent: IntentClassification,
  userMessage: string,
  ctx: ActionContext
): Promise<ActionResult> {
  
  console.log(`[ACTION_GATEWAY] Intent: ${intent.intent_type}, tools: ${intent.tools_required.join(',')}`);
  
  // ═══════════════════════════════════════════════════════════════
  // CALENDAR ACTIONS
  // ═══════════════════════════════════════════════════════════════
  
  if (intent.intent_type === 'transactional' && intent.tools_required.includes('calendar')) {
    
    if (!CAPABILITIES['calendar.create']) {
      return {
        success: false,
        action: 'calendar.create',
        evidence: null,
        userMessage: 'Esta función aún no está disponible.',
        reason: 'CAPABILITY_DISABLED'
      };
    }
    
    console.log('[ACTION_GATEWAY] 🔥 FORCING calendar.create execution...');
    
    // Importar y ejecutar calendario interno
    const { executeCalendarAction } = await import('./calendarInternal');
    return await executeCalendarAction(userMessage, ctx.userId);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // WEB SEARCH ACTIONS
  // ═══════════════════════════════════════════════════════════════
  
  if (intent.tools_required.includes('web_search')) {
    
    if (!CAPABILITIES['web.search']) {
      return {
        success: false,
        action: 'web.search',
        evidence: null,
        userMessage: 'Esta función aún no está disponible.',
        reason: 'CAPABILITY_DISABLED'
      };
    }
    
    console.log('[ACTION_GATEWAY] 🔥 FORCING web.search execution...');
    
    // Importar y ejecutar Tavily
    const { webSearch, formatTavilyResults } = await import('./tavilySearch');
    
    try {
      const searchResponse = await webSearch({
        query: userMessage,
        searchDepth: 'basic',
        maxResults: 5
      });
      
      if (searchResponse.success && searchResponse.results.length > 0) {
        const formattedResults = formatTavilyResults(searchResponse);
        
        return {
          success: true,
          action: 'web.search',
          evidence: {
            query: userMessage,
            resultsCount: searchResponse.results.length,
            urls: searchResponse.results.map(r => r.url),
            sources: searchResponse.results
          },
          userMessage: formattedResults
        };
      } else {
        return {
          success: false,
          action: 'web.search',
          evidence: {
            query: userMessage,
            resultsCount: 0,
            urls: []
          },
          userMessage: 'No encontré resultados para tu búsqueda.',
          reason: 'NO_RESULTS'
        };
      }
      
    } catch (error: any) {
      console.error('[ACTION_GATEWAY] Web search error:', error);
      return {
        success: false,
        action: 'web.search',
        evidence: null,
        userMessage: 'Hubo un error al buscar en la web.',
        reason: error.message
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // NO ACTION REQUIRED
  // ═══════════════════════════════════════════════════════════════
  
  return {
    success: true,
    action: 'none',
    evidence: null,
    userMessage: '' // El LLM redacta libremente
  };
}

/**
 * Valida si la respuesta del LLM contiene frases prohibidas
 * cuando capability=true
 */
export function validateLLMResponse(
  response: string,
  intent: IntentClassification
): { valid: boolean; reason?: string } {
  
  const lowerResponse = response.toLowerCase();
  
  // GUARDRAIL: Si capability=true pero el LLM dice "no tengo acceso"
  if (intent.tools_required.includes('calendar') && CAPABILITIES['calendar.create']) {
    const prohibitedPhrases = [
      'no tengo acceso a tu calendario',
      'necesito google calendar',
      'debes usar google calendar',
      'configura google calendar',
      'no puedo agendar sin'
    ];
    
    for (const phrase of prohibitedPhrases) {
      if (lowerResponse.includes(phrase)) {
        console.error(`[ACTION_GATEWAY] ❌ LLM REFUSAL DETECTED: "${phrase}"`);
        return {
          valid: false,
          reason: `LLM_REFUSAL: "${phrase}" cuando calendar.create=true`
        };
      }
    }
  }
  
  // GUARDRAIL: Si capability=true pero el LLM dice "no tengo búsqueda web"
  if (intent.tools_required.includes('web_search') && CAPABILITIES['web.search']) {
    const prohibitedPhrases = [
      'no tengo capacidad de buscar',
      'no tengo acceso a internet',
      'no puedo buscar en la web',
      'no tengo búsqueda web'
    ];
    
    for (const phrase of prohibitedPhrases) {
      if (lowerResponse.includes(phrase)) {
        console.error(`[ACTION_GATEWAY] ❌ LLM REFUSAL DETECTED: "${phrase}"`);
        return {
          valid: false,
          reason: `LLM_REFUSAL: "${phrase}" cuando web.search=true`
        };
      }
    }
  }
  
  return { valid: true };
}
