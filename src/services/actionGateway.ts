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
import { executeCalendarAction } from './calendarInternal';
import { listEmails } from '../ai/tools/emailTools';
import { webSearch, formatTavilyResults } from './tavilySearch';

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
  'mail.send': true,
  'mail.inbox': true,
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
  
  console.log(`[ACTION_GATEWAY] ========================================`);
  console.log(`[ACTION_GATEWAY] 🚀 INICIO - Intent: ${intent.intent_type}, tools: [${intent.tools_required.join(', ')}]`);
  console.log(`[ACTION_GATEWAY] 🚀 User message: "${userMessage.substring(0, 100)}"`);
  console.log(`[ACTION_GATEWAY] 🚀 Context: userId=${ctx.userId}, workspaceId=${ctx.workspaceId}`);
  console.log(`[ACTION_GATEWAY] ========================================`);
  
  // ═══════════════════════════════════════════════════════════════
  // CALENDAR ACTIONS
  // ═══════════════════════════════════════════════════════════════
  
  if (intent.intent_type === 'transactional' && intent.tools_required.includes('calendar')) {
    
    console.log('[ACTION_GATEWAY] 🔍 Detected TRANSACTIONAL intent with CALENDAR tool');
    
    if (!CAPABILITIES['calendar.create']) {
      console.log('[ACTION_GATEWAY] ❌ calendar.create CAPABILITY DISABLED');
      return {
        success: false,
        action: 'calendar.create',
        evidence: null,
        userMessage: 'Esta función aún no está disponible.',
        reason: 'CAPABILITY_DISABLED'
      };
    }
    
    console.log('[ACTION_GATEWAY] ✅ calendar.create CAPABILITY ENABLED');
    console.log('[ACTION_GATEWAY] 🔥 FORCING calendar.create execution...');
    
    // Ejecutar calendario interno
    return await executeCalendarAction(userMessage, ctx.userId);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // MAIL ACTIONS
  // ═══════════════════════════════════════════════════════════════
  
  if (intent.tools_required.includes('mail_inbox') || intent.tools_required.includes('email') || intent.tools_required.includes('list_emails')) {
    
    if (!CAPABILITIES['mail.inbox']) {
      return {
        success: false,
        action: 'mail.inbox',
        evidence: null,
        userMessage: 'Esta función aún no está disponible.',
        reason: 'CAPABILITY_DISABLED'
      };
    }
    
    console.log('[ACTION_GATEWAY] 🔥 FORCING list_emails execution...');
    
    try {
      // Ejecutar list_emails real
      const emails = await listEmails(ctx.userId, {
        folderType: 'inbox',
        limit: 5
      });
      
      if (!emails || emails.length === 0) {
        return {
          success: true,
          action: 'mail.inbox',
          evidence: {
            count: 0,
            emails: []
          },
          userMessage: 'No tienes correos nuevos en tu bandeja de entrada.'
        };
      }
      
      // Formatear evidencia
      const formattedEmails = emails.map(e => ({
        from: e.from_name || e.from_address,
        subject: e.subject,
        date: e.date,
        preview: e.body_preview || e.body_text?.substring(0, 100)
      }));
      
      return {
        success: true,
        action: 'mail.inbox',
        evidence: {
          count: emails.length,
          emails: formattedEmails
        },
        userMessage: `Tienes ${emails.length} correos en tu bandeja:\n\n${
          emails.map((e, i) => `${i+1}. De: ${e.from_name || e.from_address}\n   Asunto: ${e.subject}\n   Fecha: ${e.date}`).join('\n\n')
        }`
      };
      
    } catch (error: any) {
      console.error('[ACTION_GATEWAY] Mail error:', error);
      return {
        success: false,
        action: 'mail.inbox',
        evidence: null,
        userMessage: 'Hubo un error al revisar tus correos.',
        reason: error.message
      };
    }
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
    
    // Ejecutar Tavily
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
