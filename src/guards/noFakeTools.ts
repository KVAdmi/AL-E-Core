/**
 * Guardrail Anti-Mentiras
 * 
 * Filtro post-respuesta que previene que el modelo "actúe" herramientas que NO ejecutó
 * O invente datos específicos cuando son requeridos
 * 
 * CRITICAL: Si web_search_used=false, el modelo NO puede mencionar búsquedas web
 * CRITICAL: Si intent=time_sensitive Y tool_failed, NO puede dar datos específicos como hechos
 */

import { IntentClassification } from '../services/intentClassifier';

// ═══════════════════════════════════════════════════════════════
// FRASES PROHIBIDAS (cuando NO se ejecutó herramienta)
// ═══════════════════════════════════════════════════════════════

const FAKE_SEARCH_PHRASES = [
  // Español
  'busqué',
  'busque',
  'búsqueda',
  'encontré en internet',
  'encontre en internet',
  'encontré en la web',
  'encontre en la web',
  'resultados de búsqueda',
  'resultados de busqueda',
  'según los resultados',
  'accedí a la web',
  'accedi a la web',
  'accedí a la página',
  'accedi a la pagina',
  'revisé en internet',
  'revise en internet',
  'consulté en línea',
  'consulte en linea',
  'verifiqué en la web',
  'verifique en la web',
  'investigué en internet',
  'investigue en internet',
  '*buscando*',
  '*verificando*',
  '*consultando*',
  'según lo que vi en',
  'segun lo que vi en',
  'según mi búsqueda',
  'segun mi busqueda',
  'en mi búsqueda',
  'en mi busqueda',
  'después de buscar',
  'despues de buscar',
  
  // Inglés (por si el modelo responde en inglés)
  'i searched',
  'i found on the web',
  'i found on the internet',
  'search results',
  'according to my search',
  'i accessed the website',
  'i checked online',
  'i looked it up',
  'after searching'
];

// ═══════════════════════════════════════════════════════════════
// DETECTOR
// ═══════════════════════════════════════════════════════════════

/**
 * Detectar si la respuesta menciona búsquedas web falsas
 */
export function detectFakeToolUse(responseText: string, webSearchUsed: boolean): {
  hasFakeClaims: boolean;
  detectedPhrases: string[];
} {
  if (webSearchUsed) {
    // Si SÍ se ejecutó web search, está OK mencionar búsquedas
    return { hasFakeClaims: false, detectedPhrases: [] };
  }
  
  const lowerResponse = responseText.toLowerCase();
  const detectedPhrases: string[] = [];
  
  for (const phrase of FAKE_SEARCH_PHRASES) {
    if (lowerResponse.includes(phrase.toLowerCase())) {
      detectedPhrases.push(phrase);
    }
  }
  
  return {
    hasFakeClaims: detectedPhrases.length > 0,
    detectedPhrases
  };
}

// ═══════════════════════════════════════════════════════════════
// SANITIZADOR
// ═══════════════════════════════════════════════════════════════

/**
 * Reemplazar respuesta con mensaje honesto si se detectan fake claims
 */
export function sanitizeFakeToolResponse(
  responseText: string,
  detectedPhrases: string[]
): string {
  console.log(`[GUARDRAIL] ⚠️ Detected fake tool claims: ${detectedPhrases.join(', ')}`);
  
  return `⚠️ **Corrección de transparencia**

No realicé una búsqueda web en este mensaje. 

Si necesitas información actualizada o verificada de internet, puedo hacer una búsqueda web real usando:
- Comandos explícitos: "busca", "verifica", "valida"
- Preguntas sobre datos actuales: "precio del dólar hoy", "tipo de cambio actual"

¿Te gustaría que busque algo específico?`;
}

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL (EXPORTADA)
// ═══════════════════════════════════════════════════════════════

/**
 * Aplicar guardrail anti-mentiras (MEJORADO)
 * 
 * @param responseText - Respuesta del modelo
 * @param webSearchUsed - Si se ejecutó web search en este request
 * @param intent - Clasificación de intención (NUEVO)
 * @param toolFailed - Si el tool falló (NUEVO)
 * @returns Respuesta sanitizada si se detectaron fake claims, o respuesta original
 */
export function applyAntiLieGuardrail(
  responseText: string,
  webSearchUsed: boolean,
  intent?: IntentClassification,
  toolFailed?: boolean
): { sanitized: boolean; text: string; reason?: string } {
  
  // CHECK 1: Fake tool claims (búsquedas web inventadas)
  const detection = detectFakeToolUse(responseText, webSearchUsed);
  
  if (detection.hasFakeClaims) {
    console.log(`[GUARDRAIL] 🛡️ Sanitizing response (fake tool use detected)`);
    
    return {
      sanitized: true,
      text: sanitizeFakeToolResponse(responseText, detection.detectedPhrases),
      reason: `Fake tool claims detected: ${detection.detectedPhrases.join(', ')}`
    };
  }
  
  // CHECK 2: Datos específicos inventados en time_sensitive queries con tool_failed
  if (intent?.intent_type === 'time_sensitive' && toolFailed) {
    // Detectar si la respuesta contiene números específicos presentados como actuales
    const hasSpecificNumbers = /\b\d{1,3}(?:[.,]\d{1,3})?(?:\s*(?:°C|°F|grados|pesos?|dólares?|USD|MXN|%|porcentaje))?\b/i.test(responseText);
    
    // Si contiene números específicos Y NO menciona que son aproximaciones/históricos
    const hasDisclaimers = /aproximad[oa]|típicamente|históric[oa]|generalmente|rango|estimación|sin verificar|sin acceso actual/i.test(responseText);
    
    if (hasSpecificNumbers && !hasDisclaimers) {
      console.log(`[GUARDRAIL] 🛡️ Sanitizing response (specific data in time_sensitive with tool_failed)`);
      
      return {
        sanitized: true,
        text: `⚠️ **Información no verificada**

No pude acceder a datos actuales en tiempo real para tu consulta.

Para obtener información precisa y actualizada, te recomiendo:
• Consultar fuentes oficiales directamente
• Intentar la búsqueda nuevamente en un momento

¿Quieres que te explique cómo verificar esta información, o prefieres que intente de nuevo?`,
        reason: 'Specific numbers in time_sensitive query without disclaimers when tool failed'
      };
    }
  }
  
  // Respuesta limpia, pasar sin modificar
  return {
    sanitized: false,
    text: responseText
  };
}
