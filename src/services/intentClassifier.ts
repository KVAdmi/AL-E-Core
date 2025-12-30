/**
 * Intent Classifier
 * 
 * Clasifica la intención del usuario para determinar:
 * - Tipo de conocimiento requerido (estable vs temporal)
 * - Tools necesarios
 * - Modo de respuesta si tools fallan
 * 
 * CRITICAL: Este es el cerebro del sistema de orquestación
 */

export type IntentType = 'stable' | 'time_sensitive' | 'transactional' | 'verification';

export interface IntentClassification {
  intent_type: IntentType;
  tools_required: string[];
  confidence: number; // 0.0 - 1.0
  reasoning?: string;
  fallback_strategy: 'general_context' | 'historical_ranges' | 'verification_steps' | 'none';
}

// ═══════════════════════════════════════════════════════════════
// PATTERNS DE TIEMPO SENSIBLE
// ═══════════════════════════════════════════════════════════════

const TIME_SENSITIVE_PATTERNS = {
  // Temporales explícitos
  temporal_explicit: /\b(hoy|ahora|actual|actualidad|reciente|últimamente|recientemente|esta semana|este mes|mañana|próximo|próxima|pasado mañana|fin de semana|en este momento)\b/i,
  
  // Fechas específicas
  temporal_specific: /\b(2024|2025|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i,
  
  // Clima/Weather
  weather: /\b(clima|temperatura|pronóstico|pronostico|weather|forecast|lluvia|viento|humedad|tormenta|calor|frío|frio)\b/i,
  
  // Financiero/Precios
  financial: /\b(precio|costo|valor|cotización|cotizacion|dólar|dolar|peso|euro|bitcoin|cripto|tipo de cambio|tasa|bolsa|acción|accion|mercado|índice|indice)\b/i,
  
  // Noticias/Eventos
  news: /\b(noticia|noticias|último|ultima|breaking|evento|sucedió|sucedio|pasó|paso|anunció|anuncio|reportó|reporto)\b/i,
  
  // Disponibilidad/Status
  availability: /\b(está disponible|esta disponible|abierto|cerrado|horario|disponibilidad|stock)\b/i
};

// ═══════════════════════════════════════════════════════════════
// PATTERNS DE VERIFICACIÓN
// ═══════════════════════════════════════════════════════════════

const VERIFICATION_PATTERNS = {
  // Comandos explícitos de búsqueda
  explicit_commands: /\b(busca|buscar|búsqueda|busqueda|search|investiga|averigua|encuentra|verifica|checa|confirma|valida|validar|consulta|échale un ojo|ve a|accede a|mira en|ayudame a ver|ayúdame a ver|qué te encuentras|que te encuentras|qué sabes|que sabes|cuéntame|cuentame|dime)\b/i,
  
  // Preguntas sobre existencia
  existence: /\b(existe|existencia|tiene (página|web|sitio|url|dominio)|hay (página|web|sitio))\b/i,
  
  // Información sobre entidades (ULTRA FLEXIBLE - captura "sobre X", "de X", "acerca de X")
  entity_info: /\b(información sobre|info sobre|datos sobre|qué es|que es|quién es|quien es|dónde está|donde esta|sobre (la|el|los|las)?\s*(empresa|compañía|organizacion|organización|negocio|startup|proyecto|producto|servicio)|acerca de|acerca del|referente a|con respecto a)\b/i,
  
  // Datos actuales/en tiempo real (NUEVO: tipo de cambio, precios, clima, etc)
  real_time_data: /\b(tipo de cambio|precio del dólar|dólar hoy|cotización|cuánto está|cuanto esta|cuánto vale|cuanto vale|clima|temperatura|weather|tráfico|trafico|stock|bolsa|cripto)\b/i
};

// ═══════════════════════════════════════════════════════════════
// PATTERNS DE ACCIONES TRANSACCIONALES
// ═══════════════════════════════════════════════════════════════
// P0: Detectores SIMPLES - El transactionalExecutor maneja los regexes específicos

const TRANSACTIONAL_PATTERNS = {
  // Email (cualquier acción relacionada con correo)
  email_action: /\b(correo|email|emails|gmail|mail|mails|inbox|bandeja|mensaje|mensajes|smtp|imap)\b/i,
  
  // Calendar (cualquier acción relacionada con agenda/eventos)
  // Pattern ULTRA FLEXIBLE: captura variaciones naturales del español mexicano
  calendar_action: /(agenda(?:r(?:la|lo|las|los|me|te|se|nos)?)?|calendario|calendar|cita|citas|evento|eventos|meet|meets|meeting|meetings|junta|juntas|reunión|reunion|reuniones|videollamada|video call|llamada|zoom|intentar?\s+agendar?|ayud[ae]s?\s+a\s+agendar?|pue[ds]es?\s+agendar?)/i,
  
  // Telegram (cualquier acción relacionada con Telegram)
  telegram_action: /\b(telegram|telegrama|bot|notifica|notificar|avisa|avisar)\b/i
};

// ═══════════════════════════════════════════════════════════════
// PATTERNS DE CONOCIMIENTO ESTABLE
// ═══════════════════════════════════════════════════════════════

const STABLE_KNOWLEDGE_PATTERNS = {
  // Tutoriales/Cómo hacer
  tutorial: /\b(cómo|como|tutorial|guía|guia|paso a paso|explicar|explica|enseñar|enseña|aprender)\b/i,
  
  // Teoría/Conceptos
  theory: /\b(qué significa|que significa|definición|definicion|concepto|teoría|teoria|fundamento|principio)\b/i,
  
  // Recetas/Cocina
  cooking: /\b(receta|cocinar|preparar|ingredientes|cocina|comida|platillo)\b/i,
  
  // Ideas/Consejos
  ideas: /\b(idea|ideas|consejo|consejos|sugerencia|sugerencias|recomendación|recomendacion|tip|tips)\b/i,
  
  // Comparaciones
  comparison: /\b(diferencia entre|comparar|mejor que|peor que|ventajas|desventajas|pros y contras)\b/i
};

// ═══════════════════════════════════════════════════════════════
// CLASSIFIER PRINCIPAL
// ═══════════════════════════════════════════════════════════════

/**
 * Clasificar intención del usuario
 * 
 * IMPORTANTE: Este classifier NO bloquea respuestas.
 * Solo determina la estrategia de ejecución.
 */
export function classifyIntent(message: string): IntentClassification {
  const lowerMsg = message.toLowerCase();
  
  console.log(`[INTENT] 🔍 Analyzing message: "${message.substring(0, 80)}..."`);
  
  let timeSensitiveScore = 0;
  let verificationScore = 0;
  let stableKnowledgeScore = 0;
  
  const reasoning: string[] = [];
  
  // ═══════════════════════════════════════════════════════════════
  // SCORE: Time Sensitive
  // ═══════════════════════════════════════════════════════════════
  
  if (TIME_SENSITIVE_PATTERNS.temporal_explicit.test(lowerMsg)) {
    timeSensitiveScore += 3;
    reasoning.push('Temporal explícito detectado (hoy/ahora/actual)');
  }
  
  if (TIME_SENSITIVE_PATTERNS.temporal_specific.test(lowerMsg)) {
    timeSensitiveScore += 2;
    reasoning.push('Fecha específica detectada');
  }
  
  if (TIME_SENSITIVE_PATTERNS.weather.test(lowerMsg)) {
    timeSensitiveScore += 4;
    reasoning.push('Query de clima detectado');
  }
  
  if (TIME_SENSITIVE_PATTERNS.financial.test(lowerMsg)) {
    timeSensitiveScore += 4;
    reasoning.push('Query financiero detectado');
  }
  
  if (TIME_SENSITIVE_PATTERNS.news.test(lowerMsg)) {
    timeSensitiveScore += 3;
    reasoning.push('Query de noticias detectado');
  }
  
  if (TIME_SENSITIVE_PATTERNS.availability.test(lowerMsg)) {
    timeSensitiveScore += 2;
    reasoning.push('Query de disponibilidad detectado');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SCORE: Verification
  // ═══════════════════════════════════════════════════════════════
  
  if (VERIFICATION_PATTERNS.explicit_commands.test(lowerMsg)) {
    verificationScore += 5;
    reasoning.push('Comando de verificación explícito');
  }
  
  if (VERIFICATION_PATTERNS.existence.test(lowerMsg)) {
    verificationScore += 4;
    reasoning.push('Pregunta de existencia detectada');
  }
  
  if (VERIFICATION_PATTERNS.entity_info.test(lowerMsg)) {
    verificationScore += 3;
    reasoning.push('Solicitud de información sobre entidad');
  }
  
  // NUEVO: Real-time data (tipo de cambio, clima, etc) → WEB SEARCH OBLIGATORIO
  if (VERIFICATION_PATTERNS.real_time_data.test(lowerMsg)) {
    verificationScore += 8; // SCORE ALTO para forzar web search
    timeSensitiveScore += 5; // También es time-sensitive
    reasoning.push('🔴 Datos en tiempo real detectados (tipo cambio/clima/precios) → Web search requerido');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SCORE: Transactional (Email/Calendar/Telegram)
  // ═══════════════════════════════════════════════════════════════
  
  let transactionalScore = 0;
  
  if (TRANSACTIONAL_PATTERNS.email_action.test(lowerMsg)) {
    transactionalScore += 10; // MÁXIMA PRIORIDAD
    reasoning.push('🔴 Acción de Email detectada');
    console.log(`[INTENT] ✓ EMAIL ACTION detected in: "${lowerMsg.substring(0, 50)}..."`);
  }
  
  if (TRANSACTIONAL_PATTERNS.calendar_action.test(lowerMsg)) {
    transactionalScore += 10; // MÁXIMA PRIORIDAD
    reasoning.push('🔴 Acción de Calendario detectada');
    console.log(`[INTENT] ✓ CALENDAR ACTION detected in: "${lowerMsg.substring(0, 50)}..."`);
  }
  
  if (TRANSACTIONAL_PATTERNS.telegram_action.test(lowerMsg)) {
    transactionalScore += 10; // MÁXIMA PRIORIDAD
    reasoning.push('🔴 Acción de Telegram detectada');
    console.log(`[INTENT] ✓ TELEGRAM ACTION detected in: "${lowerMsg.substring(0, 50)}..."`);
  }
  
  console.log(`[INTENT] 📊 Scores - Transactional: ${transactionalScore}, TimeSensitive: ${timeSensitiveScore}, Verification: ${verificationScore}, Stable: ${stableKnowledgeScore}`);
  
  // ═══════════════════════════════════════════════════════════════
  // SCORE: Stable Knowledge
  // ═══════════════════════════════════════════════════════════════
  
  if (STABLE_KNOWLEDGE_PATTERNS.tutorial.test(lowerMsg)) {
    stableKnowledgeScore += 3;
    reasoning.push('Tutorial/Cómo hacer detectado');
  }
  
  if (STABLE_KNOWLEDGE_PATTERNS.theory.test(lowerMsg)) {
    stableKnowledgeScore += 3;
    reasoning.push('Pregunta teórica/conceptual');
  }
  
  if (STABLE_KNOWLEDGE_PATTERNS.cooking.test(lowerMsg)) {
    stableKnowledgeScore += 4;
    reasoning.push('Query de cocina/receta');
  }
  
  if (STABLE_KNOWLEDGE_PATTERNS.ideas.test(lowerMsg)) {
    stableKnowledgeScore += 2;
    reasoning.push('Solicitud de ideas/consejos');
  }
  
  if (STABLE_KNOWLEDGE_PATTERNS.comparison.test(lowerMsg)) {
    stableKnowledgeScore += 2;
    reasoning.push('Comparación conceptual');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DECISIÓN: Intent Type
  // ═══════════════════════════════════════════════════════════════
  
  let intent_type: IntentType;
  let tools_required: string[] = [];
  let fallback_strategy: IntentClassification['fallback_strategy'];
  let confidence: number;
  
  // ═══════════════════════════════════════════════════════════════
  // 🔥 PRIORIDAD 1: TRANSACTIONAL (GANA SIEMPRE - SIN EXCEPCIÓN)
  // ═══════════════════════════════════════════════════════════════
  // Si hay CUALQUIER palabra de email/calendar/telegram → TRANSACTIONAL
  // NO importa si hay "hoy", "ahora", "busca" → TRANSACTIONAL GANA
  
  if (transactionalScore > 0) {
    intent_type = 'transactional';
    
    // Determinar herramientas específicas
    if (TRANSACTIONAL_PATTERNS.email_action.test(lowerMsg)) {
      tools_required.push('email');
    }
    if (TRANSACTIONAL_PATTERNS.calendar_action.test(lowerMsg)) {
      tools_required.push('calendar');
    }
    if (TRANSACTIONAL_PATTERNS.telegram_action.test(lowerMsg)) {
      tools_required.push('telegram');
    }
    
    fallback_strategy = 'none'; // Si falla, debe fallar explícitamente
    confidence = 1.0; // MÁXIMA confianza - esto es una acción clara
    
    const reasoningText = `🔴 Acción de ${tools_required.join('/')} detectada | ` + reasoning.join(' | ');
    console.log(`[INTENT] ${reasoningText} → TRANSACTIONAL`);
    
    return {
      intent_type,
      tools_required,
      confidence,
      reasoning: reasoningText,
      fallback_strategy
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // PRIORIDAD 2: VERIFICATION (búsqueda explícita)
  // ═══════════════════════════════════════════════════════════════
  
  if (verificationScore >= 4) {
    intent_type = 'verification';
    tools_required = ['web_search'];
    fallback_strategy = 'verification_steps';
    confidence = Math.min(verificationScore / 5, 1.0);
    reasoning.push('→ Intent: VERIFICATION (explicit command)');
    
  // ═══════════════════════════════════════════════════════════════
  // PRIORIDAD 3: TIME SENSITIVE (requiere datos actuales)
  // ═══════════════════════════════════════════════════════════════
  
  } else if (timeSensitiveScore >= 3) {
    intent_type = 'time_sensitive';
    tools_required = ['web_search'];
    
    // Estrategia de fallback según el tipo
    if (TIME_SENSITIVE_PATTERNS.weather.test(lowerMsg)) {
      fallback_strategy = 'historical_ranges'; // "Típicamente en esta época..."
    } else if (TIME_SENSITIVE_PATTERNS.financial.test(lowerMsg)) {
      fallback_strategy = 'historical_ranges'; // "Rango habitual..."
    } else {
      fallback_strategy = 'verification_steps'; // "Consulta en..."
    }
    
    confidence = Math.min(timeSensitiveScore / 5, 1.0);
    reasoning.push('→ Intent: TIME_SENSITIVE (requires current data)');
    
  } else if (stableKnowledgeScore >= 2) {
    // STABLE KNOWLEDGE (no requiere tools)
    intent_type = 'stable';
    tools_required = [];
    fallback_strategy = 'none';
    confidence = Math.min(stableKnowledgeScore / 4, 1.0);
    reasoning.push('→ Intent: STABLE (no tools needed)');
    
  } else {
    // DEFAULT: STABLE con baja confianza
    intent_type = 'stable';
    tools_required = [];
    fallback_strategy = 'general_context';
    confidence = 0.3;
    reasoning.push('→ Intent: STABLE (default, low confidence)');
  }
  
  console.log(`[INTENT] Classification: ${intent_type} (confidence: ${confidence.toFixed(2)})`);
  console.log(`[INTENT] Tools required: ${tools_required.length > 0 ? tools_required.join(', ') : 'none'}`);
  console.log(`[INTENT] Reasoning: ${reasoning.join(' | ')}`);
  
  return {
    intent_type,
    tools_required,
    confidence,
    reasoning: reasoning.join(' | '),
    fallback_strategy
  };
}

// ═══════════════════════════════════════════════════════════════
// FALLBACK RESPONSE GENERATOR
// ═══════════════════════════════════════════════════════════════

/**
 * Generar respuesta de fallback cuando tools fallan
 * 
 * IMPORTANTE: NUNCA inventa datos específicos como hechos
 */
export function generateFallbackContext(
  intent: IntentClassification,
  userMessage: string,
  toolError?: string
): string {
  const strategy = intent.fallback_strategy;
  
  if (strategy === 'none') {
    // No se requiere fallback (stable knowledge)
    return '';
  }
  
  let fallbackContext = '\n\n═══════════════════════════════════════════════════════════\n';
  fallbackContext += '⚠️ CONTEXTO CRÍTICO PARA EL ASISTENTE\n';
  fallbackContext += '═══════════════════════════════════════════════════════════\n\n';
  
  fallbackContext += `La herramienta de búsqueda web NO está disponible en este momento.\n`;
  if (toolError) {
    fallbackContext += `Razón: ${toolError}\n`;
  }
  fallbackContext += `\n`;
  
  if (strategy === 'historical_ranges') {
    fallbackContext += `INSTRUCCIONES OBLIGATORIAS:\n`;
    fallbackContext += `1. NO inventar datos específicos actuales (temperaturas exactas, precios exactos, etc.)\n`;
    fallbackContext += `2. PUEDES ofrecer:\n`;
    fallbackContext += `   - Contexto general sobre el tema\n`;
    fallbackContext += `   - Rangos históricos típicos (MARCADOS como aproximación histórica)\n`;
    fallbackContext += `   - Tendencias estacionales si aplica\n`;
    fallbackContext += `3. DEBES ofrecer:\n`;
    fallbackContext += `   - Fuentes oficiales donde verificar la información actual\n`;
    fallbackContext += `   - Pasos claros para que el usuario consulte datos reales\n`;
    fallbackContext += `4. DEBES preguntar si el usuario acepta estimación o prefiere esperar\n\n`;
    
    fallbackContext += `EJEMPLO DE RESPUESTA CORRECTA:\n`;
    fallbackContext += `"No puedo consultar [datos actuales] en tiempo real ahora mismo.\n\n`;
    fallbackContext += `Puedo ofrecerte:\n`;
    fallbackContext += `• Contexto general sobre [tema]\n`;
    fallbackContext += `• Rangos típicos históricos (como referencia, no dato actual)\n`;
    fallbackContext += `• Cómo verificarlo en fuente oficial: [pasos]\n\n`;
    fallbackContext += `¿Prefieres la información general o esperar a que la búsqueda esté disponible?"\n\n`;
    
  } else if (strategy === 'verification_steps') {
    fallbackContext += `INSTRUCCIONES OBLIGATORIAS:\n`;
    fallbackContext += `1. NO inventar que realizaste búsqueda\n`;
    fallbackContext += `2. DEBES ofrecer:\n`;
    fallbackContext += `   - Pasos claros para verificar manualmente\n`;
    fallbackContext += `   - Fuentes oficiales recomendadas\n`;
    fallbackContext += `   - Qué buscar específicamente\n`;
    fallbackContext += `3. PUEDES ofrecer contexto general si es relevante\n\n`;
    
    fallbackContext += `EJEMPLO DE RESPUESTA CORRECTA:\n`;
    fallbackContext += `"No puedo verificar eso en este momento, pero te guío:\n\n`;
    fallbackContext += `Para verificar [X]:\n`;
    fallbackContext += `1. Accede a [fuente oficial]\n`;
    fallbackContext += `2. Busca [sección específica]\n`;
    fallbackContext += `3. Verifica [dato específico]\n\n`;
    fallbackContext += `¿Necesitas más detalles sobre el proceso?"\n\n`;
    
  } else if (strategy === 'general_context') {
    fallbackContext += `INSTRUCCIONES OBLIGATORIAS:\n`;
    fallbackContext += `1. NO inventar información específica como si fuera verificada\n`;
    fallbackContext += `2. Responde con conocimiento general disponible\n`;
    fallbackContext += `3. Marca claramente lo que es contexto vs lo que requeriría verificación\n`;
    fallbackContext += `4. Ofrece cómo el usuario puede verificar si necesita datos actuales\n\n`;
  }
  
  fallbackContext += `═══════════════════════════════════════════════════════════\n`;
  
  return fallbackContext;
}
