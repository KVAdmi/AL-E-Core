/**
 * Guardrail Anti-Mentiras
 * 
 * Filtro post-respuesta que previene que el modelo "actúe" herramientas que NO ejecutó
 * 
 * CRITICAL: Si web_search_used=false, el modelo NO puede mencionar búsquedas web
 */

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
 * Aplicar guardrail anti-mentiras
 * 
 * @param responseText - Respuesta del modelo
 * @param webSearchUsed - Si se ejecutó web search en este request
 * @returns Respuesta sanitizada si se detectaron fake claims, o respuesta original
 */
export function applyAntiLieGuardrail(
  responseText: string,
  webSearchUsed: boolean
): { sanitized: boolean; text: string; reason?: string } {
  
  const detection = detectFakeToolUse(responseText, webSearchUsed);
  
  if (!detection.hasFakeClaims) {
    // Respuesta limpia, pasar sin modificar
    return {
      sanitized: false,
      text: responseText
    };
  }
  
  // Detectadas fake claims, sanitizar
  console.log(`[GUARDRAIL] 🛡️ Sanitizing response (fake tool use detected)`);
  
  return {
    sanitized: true,
    text: sanitizeFakeToolResponse(responseText, detection.detectedPhrases),
    reason: `Fake tool claims detected: ${detection.detectedPhrases.join(', ')}`
  };
}
