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
  explicit_commands: /\b(busca|buscar|búsqueda|busqueda|search|investiga|averigua|encuentra|verifica|checa|confirma|valida|validar|consulta|échale un ojo|ve a|accede a|mira en)\b/i,
  
  // Preguntas sobre existencia
  existence: /\b(existe|existencia|tiene (página|web|sitio|url|dominio)|hay (página|web|sitio))\b/i,
  
  // Información sobre entidades
  entity_info: /\b(información sobre|info sobre|datos sobre|qué es|que es|quién es|quien es|dónde está|donde esta)\b/i,
  
  // Datos actuales/en tiempo real (NUEVO: tipo de cambio, precios, clima, etc)
  real_time_data: /\b(tipo de cambio|precio del dólar|dólar hoy|cotización|cuánto está|cuanto esta|cuánto vale|cuanto vale|clima|temperatura|weather|tráfico|trafico|stock|bolsa|cripto)\b/i
};

// ═══════════════════════════════════════════════════════════════
// PATTERNS DE ACCIONES TRANSACCIONALES
// ═══════════════════════════════════════════════════════════════

const TRANSACTIONAL_PATTERNS = {
  // Gmail - Lectura: TODO lenguaje natural para revisar correos
  gmail_read: /\b(revisa|revisar|checa|checka|échale|echale|check|ve|ver|vete a|mira|mirar|échale un ojo|echale un ojo|consulta|consultame|busca|buscame|lee|leer|último|ultima|recibí|recibi|llegó|llego|tengo|tienes?|hay|habrá|habra|muestra|mostrar|muéstrame|muestrame|trae|traeme|dame|dime|ve a|ayudame a ver|ayúdame a ver|puedes ir|puedes ver|favor|pls|plz|porfavor|por favor)\b.{0,100}\b(correo|email|emails|gmail|mail|mails|inbox|bandeja|mensajes?|mensaje)\b|\b(correo|email|gmail|mail|inbox|bandeja|mensajes?)\b.{0,100}\b(revisa|revisar|checa|checka|ve|ver|mira|último|ultima|recibí|recibi|llegó|llego|hay|tengo|dame|dime|trae)\b/i,
  
  // Gmail - Envío: TODO lenguaje natural para enviar correos
  gmail_send: /\b(envía|enviá|enviar|manda|mandá|mandar|mandame|mándame|send|escribe|escribí|escribir|redacta|redactá|responde|respondé|responder|contesta|contestá|contestar|dispara|disparar|comunícate|comunicate|contacta|contactá|avísale|avisale|dile)\b.{0,80}\b(correo|email|mensaje|mail|un email|un correo|un mail|un mensaje)\b|\b(correo|email|mail|mensaje)\b.{0,50}\b(a|para|al|pa)\b/i,
  
  // Calendar - Lectura: TODO lenguaje natural para ver agenda
  calendar_read: /\b(revisa|revisá|revisar|checa|checá|checka|ve|vé|ver|mira|mirá|mirar|échale|échale un ojo|echale un ojo|consulta|consultá|consultame|muestra|mostrá|mostrar|muéstrame|muestrame|dame|dime|trae|traeme|qué tengo|que tengo|qué hay|que hay)\b.{0,100}\b(agenda|calendario|calendar|citas?|eventos?|pendientes?|compromisos?|juntas?|reuniones?|meets?|meetings?)\b|\b(agenda|calendario|citas?|eventos?|juntas?|reuniones?)\b.{0,80}\b(revisa|checa|ve|mira|tengo|tienes?|hay|dame|dime|trae|hoy|mañana|semana|mes)\b/i,
  
  // Calendar - Creación: TODO lenguaje natural para crear eventos
  // P0 FIX: MEGA EXPANSIÓN - "meet", "ayudame", "porfavor", "flaca", etc.
  calendar_create: /\b(agenda|agendá|agendar|agendame|pon|poné|poner|ponme|crea|creá|crear|creame|añade|añadí|añadir|añademe|agrega|agregá|agregar|agregame|apunta|apuntá|apuntar|apuntame|programa|programá|programar|programame|separa|separá|separar|sepárame|reserva|reservá|reservar|reservame|book|schedule|ayúdame|ayudame|ayúdame a|ayudame a|me ayudas|me ayudás|puedes|podés|por favor|porfavor|porfa|pls|plz|favor de|necesito|quiero|quisiera)\b.{0,150}\b(cita|evento|meet|meeting|junta|juntar|reunión|reunion|videollamada|video|call|llamada|sesión|sesion|compromiso|pendiente|agendar|crear|poner)\b|\b(cita|evento|meet|meeting|junta|reunión|reunion|videollamada|call)\b.{0,100}\b(con|para|al|a|el|este|próximo|proximo|siguiente|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|mañana|hoy|pasado)\b/i,
  
  // Detectores genéricos (cualquier mención)
  has_gmail_action: /\b(correo|email|emails|gmail|mail|mails|inbox|bandeja|mensaje|mensajes)\b/i,
  has_calendar_action: /\b(agenda|agendá|calendario|calendar|cita|citas|evento|eventos|meet|meets|meeting|meetings|junta|juntas|reunión|reunion|reuniones|videollamada|video call)\b/i
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
  // SCORE: Transactional (Gmail/Calendar)
  // ═══════════════════════════════════════════════════════════════
  
  let transactionalScore = 0;
  
  if (TRANSACTIONAL_PATTERNS.gmail_read.test(lowerMsg)) {
    transactionalScore += 10; // MÁXIMA PRIORIDAD
    reasoning.push('🔴 Lectura de Gmail detectada');
  }
  
  if (TRANSACTIONAL_PATTERNS.gmail_send.test(lowerMsg)) {
    transactionalScore += 10; // MÁXIMA PRIORIDAD
    reasoning.push('🔴 Envío de Gmail detectado');
  }
  
  if (TRANSACTIONAL_PATTERNS.calendar_read.test(lowerMsg)) {
    transactionalScore += 10; // MÁXIMA PRIORIDAD
    reasoning.push('🔴 Lectura de Calendar detectada');
  }
  
  if (TRANSACTIONAL_PATTERNS.calendar_create.test(lowerMsg)) {
    transactionalScore += 10; // MÁXIMA PRIORIDAD
    reasoning.push('🔴 Creación de Calendar detectada');
  }
  
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
  
  const maxScore = Math.max(timeSensitiveScore, verificationScore, stableKnowledgeScore, transactionalScore);
  
  let intent_type: IntentType;
  let tools_required: string[] = [];
  let fallback_strategy: IntentClassification['fallback_strategy'];
  let confidence: number;
  
  // PRIORIDAD 1: Transactional (Gmail/Calendar) - SIEMPRE gana
  if (transactionalScore >= 10) {
    intent_type = 'transactional';
    
    // Determinar herramientas específicas
    if (TRANSACTIONAL_PATTERNS.gmail_read.test(lowerMsg)) {
      tools_required.push('gmail_read');
    }
    if (TRANSACTIONAL_PATTERNS.gmail_send.test(lowerMsg)) {
      tools_required.push('gmail_send');
    }
    if (TRANSACTIONAL_PATTERNS.calendar_read.test(lowerMsg)) {
      tools_required.push('calendar_read');
    }
    if (TRANSACTIONAL_PATTERNS.calendar_create.test(lowerMsg)) {
      tools_required.push('calendar_create');
    }
    
    fallback_strategy = 'none'; // Sin fallback - DEBE ejecutar o rechazar
    confidence = 1.0; // Máxima confianza en detección
    reasoning.push('→ Intent: TRANSACTIONAL (Gmail/Calendar action detected)');
    
  } else if (verificationScore >= 4) {
    // PRIORIDAD 2: VERIFICACIÓN EXPLÍCITA
    intent_type = 'verification';
    tools_required = ['web_search'];
    fallback_strategy = 'verification_steps';
    confidence = Math.min(verificationScore / 5, 1.0);
    reasoning.push('→ Intent: VERIFICATION (explicit command)');
    
  } else if (timeSensitiveScore >= 3) {
    // TIME SENSITIVE (requiere datos actuales)
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
