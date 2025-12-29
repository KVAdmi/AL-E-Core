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
  // Español - SOLO frases que CLARAMENTE indican búsqueda web falsa
  'busqué en',
  'busque en',
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
  'según lo que vi en internet',
  'segun lo que vi en internet',
  'según mi búsqueda en',
  'segun mi busqueda en',
  'después de buscar en',
  'despues de buscar en',
  
  // Inglés (por si el modelo responde en inglés)
  'i searched on',
  'i found on the web',
  'i found on the internet',
  'search results show',
  'according to my search',
  'i accessed the website',
  'i checked online',
  'i looked it up',
  'after searching on'
];

// ═══════════════════════════════════════════════════════════════
// FRASES TRANSACCIONALES PROHIBIDAS (Email/Calendar/Telegram sin tool execution)
// ═══════════════════════════════════════════════════════════════
// ACTUALIZADO: Post-migración a email manual + calendar interno + telegram
// ═══════════════════════════════════════════════════════════════

const FAKE_TRANSACTIONAL_PHRASES = [
  // Email (SMTP/IMAP manual) - SOLO acciones específicas falsas
  'revisé tu correo',
  'revise tu correo',
  'revisé tus correos',
  'revise tus correos',
  'acabo de revisar tu correo',
  'acabo de revisar tus correos',
  'leí tu correo',
  'lei tu correo',
  'consulté tu email',
  'consulte tu email',
  'verifiqué tu bandeja',
  'verifique tu bandeja',
  'accedí a tu correo',
  'accedi a tu correo',
  'envié el correo',
  'envie el correo',
  'acabo de enviar',
  'mandé el email',
  'mande el email',
  'he enviado',
  'acabo de mandar',
  
  // Calendar interno - SOLO acciones específicas falsas
  'revisé tu agenda',
  'revise tu agenda',
  'consulté tu calendario',
  'consulte tu calendario',
  'verifiqué tus eventos',
  'verifique tus eventos',
  'agendé la cita',
  'agende la cita',
  'creé el evento',
  'cree el evento',
  'programé la reunión',
  'programe la reunion',
  
  // Telegram - SOLO acciones específicas falsas
  'envié por telegram',
  'envie por telegram',
  'mandé el mensaje por telegram',
  'mande el mensaje por telegram',
  'te notifiqué por telegram',
  'te notifique por telegram'
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

/**
 * Detectar si la respuesta menciona acciones transaccionales falsas (Email/Calendar/Telegram)
 * CRITICAL: Si intent=transactional Y tool_failed, NO puede simular ejecución
 * CRITICAL: Si toolError = CONFIG_MISSING, BLOQUEO ABSOLUTO de frases afirmativas
 * 
 * P0 FIX: transactionalToolsUsed SOLO es true si la ejecución fue EXITOSA
 * Si el tool falló (config missing, conexión fallida, etc.), transactionalToolsUsed DEBE SER FALSE
 * 
 * ACTUALIZADO: Post-migración (no más OAuth, ahora SMTP/IMAP/Telegram)
 */
export function detectFakeTransactionalUse(
  responseText: string, 
  transactionalToolsSucceeded: boolean,  // RENOMBRADO: ahora indica éxito real, no solo intento
  toolError?: string
): {
  hasFakeClaims: boolean;
  detectedPhrases: string[];
} {
  if (transactionalToolsSucceeded) {
    // Si SÍ se ejecutaron tools transaccionales EXITOSAMENTE, está OK mencionar acciones
    return { hasFakeClaims: false, detectedPhrases: [] };
  }
  
  const lowerResponse = responseText.toLowerCase();
  const detectedPhrases: string[] = [];
  
  for (const phrase of FAKE_TRANSACTIONAL_PHRASES) {
    if (lowerResponse.includes(phrase.toLowerCase())) {
      detectedPhrases.push(phrase);
    }
  }
  
  // BLOQUEO EXTRA: Si toolError = CONFIG_MISSING o SMTP_ERROR, rechazar CUALQUIER frase afirmativa
  if (toolError === 'CONFIG_MISSING' || toolError === 'SMTP_ERROR' || toolError === 'IMAP_ERROR' || toolError === 'TELEGRAM_ERROR') {
    // Detectar frases afirmativas genéricas sobre acciones
    const affirmativePhrases = [
      'revisé',
      'revise',
      'agendé',
      'agende',
      'creé',
      'cree',
      'envié',
      'envie',
      'acabo de',
      'ya ',
      'listo,',
      'hecho,',
      'completado'
    ];
    
    for (const phrase of affirmativePhrases) {
      if (lowerResponse.includes(phrase)) {
        detectedPhrases.push(`AFFIRMATIVE: "${phrase}"`);
      }
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
 * 
 * POLÍTICA: NO meta-transparencia. Si detectamos fake claims, simplemente
 * devolvemos un mensaje neutral sin mencionar herramientas.
 */
export function sanitizeFakeToolResponse(
  responseText: string,
  detectedPhrases: string[]
): string {
  console.log(`[GUARDRAIL] ⚠️ Detected fake tool claims: ${detectedPhrases.join(', ')}`);
  
  // Si la respuesta original es muy corta (menos de 20 chars), probablemente
  // no tiene fake claims reales - devolver original
  if (responseText.trim().length < 20) {
    return responseText;
  }
  
  // Para fake claims reales, devolver mensaje simple sin mencionar tools
  return `No tengo esa información en este momento. ¿Puedes darme más contexto o reformular tu pregunta?`;
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
 * @param toolError - Código de error específico (NUEVO P0)
 * @returns Respuesta sanitizada si se detectaron fake claims, o respuesta original
 */
export function applyAntiLieGuardrail(
  responseText: string,
  webSearchUsed: boolean,
  intent?: IntentClassification,
  toolFailed?: boolean,
  toolError?: string
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
  
  // CHECK 2: BLOQUEO DURO OAuth (P0)
  // P0 FIX CRÍTICO: Si intent=transactional, verificar SIEMPRE fake claims
  // independientemente de si toolFailed (porque el LLM puede mentir ANTES del tool)
  if (intent?.intent_type === 'transactional') {
    // transactionalToolsSucceeded = !toolFailed
    // Si toolFailed = true → transactionalToolsSucceeded = false → detectar fake claims
    // Si toolFailed = false → transactionalToolsSucceeded = true → permitir menciones
    const transactionalDetection = detectFakeTransactionalUse(
      responseText, 
      !toolFailed,  // P0: Solo true si NO hubo fallo
      toolError
    );
    
    if (transactionalDetection.hasFakeClaims) {
      console.log(`[GUARDRAIL] 🛡️ 🔴 BLOQUEO DURO OAuth - fake transactional detected: ${transactionalDetection.detectedPhrases.join(', ')}`);
      
      // Mensaje más directo según el error
      let blockedMessage = '';
      
      if (toolError === 'CONFIG_MISSING') {
        blockedMessage = `No tienes una cuenta de email configurada. Ve a tu perfil y configura tu SMTP/IMAP.`;
      } else if (toolError === 'SMTP_ERROR' || toolError === 'IMAP_ERROR') {
        blockedMessage = `No puedo conectar con tu servidor de email. Verifica la configuración en tu perfil.`;
      } else if (toolError === 'TELEGRAM_ERROR') {
        blockedMessage = `No puedo enviar por Telegram. Verifica que tu bot esté conectado en tu perfil.`;
      } else if (toolFailed) {
        // Tool falló por razón desconocida
        blockedMessage = `No puedo ejecutar esa acción en este momento. Verifica tu configuración.`;
      } else {
        // Tool no falló pero el LLM inventó la respuesta ANTES de ejecutar
        blockedMessage = `No tengo esa información. ¿Puedes darme más contexto?`;
      }
      
      return {
        sanitized: true,
        text: blockedMessage,
        reason: `OAuth hard block - ${toolError || 'PREMATURE_RESPONSE'} - phrases: ${transactionalDetection.detectedPhrases.join(', ')}`
      };
    }
  }
  
  // CHECK 3: Datos específicos inventados en time_sensitive queries con tool_failed
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
