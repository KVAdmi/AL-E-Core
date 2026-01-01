/**
 * MODE SELECTOR - P0 CORE
 * 
 * Clasifica cada request en 1 de 3 modos ANTES de responder:
 * 
 * MODE_A: KNOWLEDGE_GENERAL (70-85%)
 *   - Recetas, historia, ideas, estrategia, explicaciones
 *   - NO usa tools por defecto
 *   - Responde con conocimiento del modelo
 * 
 * MODE_B: RESEARCH_RECENT (10-25%)
 *   - Noticias, tendencias, comparativas actuales
 *   - USA web search + cita fuentes
 *   - Requiere verificación externa
 * 
 * MODE_C: CRITICAL_DATA_OR_ACTION (5-10%)
 *   - Finanzas exactas, precios, agenda, email
 *   - USA APIs oficiales o ejecuta acciones internas
 *   - REQUIERE evidence obligatorio
 */

export type ResponseMode = 
  | 'KNOWLEDGE_GENERAL'     // No tools, respuesta directa del modelo
  | 'RESEARCH_RECENT'       // Web search + fuentes
  | 'CRITICAL_DATA_OR_ACTION'; // APIs/Actions + evidence

export interface ModeClassification {
  mode: ResponseMode;
  confidence: number;
  reasoning: string;
  toolsRequired: string[];
  evidenceRequired: boolean;
}

/**
 * Patrones para KNOWLEDGE_GENERAL (MODE_A)
 */
const KNOWLEDGE_PATTERNS = [
  // Recetas y cocina
  /\b(receta|preparar|cocinar|ingredientes|cómo\s+hacer|cómo\s+se\s+hace)\b/i,
  
  // Historia y cultura
  /\b(historia|origen|surgió|comenzó|fundó|época|siglo|antigua|civilización)\b/i,
  
  // Explicaciones y conceptos
  /\b(qué\s+es|explica|significa|define|concepto|diferencia\s+entre|cómo\s+funciona)\b/i,
  
  // Estrategia y planning
  /\b(estrategia|plan|idea|campaña|propuesta|sugerencia|recomendación|consejo)\b/i,
  
  // Creatividad
  /\b(escribe|redacta|crea|genera|diseña|inventa)\s+(poema|historia|carta|email|texto|copy)\b/i,
  
  // Análisis general
  /\b(analiza|compara|evalúa|ventajas|desventajas|pros|contras)\b/i
];

/**
 * Patrones para RESEARCH_RECENT (MODE_B)
 */
const RESEARCH_PATTERNS = [
  // Temporalidad reciente explícita
  /\b(últim[oa]s?|reciente|actualidad|tendencia|novedad|nuevo)\b/i,
  /\b(hoy|ayer|esta\s+semana|este\s+mes|2025|2024)\b/i,
  
  // Noticias y eventos
  /\b(noticia|reportaje|anuncio|lanzamiento|evento|conferencia)\b/i,
  
  // Comparativas actuales
  /\b(mejor\s+del\s+mercado|top\s+\d+|ranking|comparativa\s+actual)\b/i,
  
  // Búsqueda explícita
  /\b(busca|investiga|encuentra|averigua|consulta)\b/i
];

/**
 * Patrones para CRITICAL_DATA_OR_ACTION (MODE_C)
 */
const CRITICAL_PATTERNS = [
  // Finanzas exactas
  /\b(precio|cotización|tipo\s+de\s+cambio|dólar|euro|acción|bolsa)\s+(hoy|actual|ahora)\b/i,
  /\b(cuánto\s+cuesta|cuánto\s+vale)\s+.*(hoy|ahora|actualmente)\b/i,
  
  // Acciones de agenda
  /\b(agenda|cita|reunión|evento|recordatorio)\b/i,
  /\b(agendar|programar|crear\s+evento)\b/i,
  
  // Acciones de email
  /\b(envía|manda|correo|email)\b/i,
  /\b(revisa\s+mi\s+correo|inbox|bandeja)\b/i,
  
  // Datos críticos con timestamp
  /\b(monitor|tracking|estado\s+actual|status)\s+(de|del|la)\b/i
];

/**
 * Clasificar modo de respuesta
 */
export function selectResponseMode(userMessage: string): ModeClassification {
  const lowerMsg = userMessage.toLowerCase();
  
  // Scores por categoría
  let knowledgeScore = 0;
  let researchScore = 0;
  let criticalScore = 0;
  
  // ═══════════════════════════════════════════════════════════════
  // SCORE MODE_C (CRITICAL) - PRIORIDAD MÁXIMA
  // ═══════════════════════════════════════════════════════════════
  
  for (const pattern of CRITICAL_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      criticalScore += 10;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SCORE MODE_B (RESEARCH)
  // ═══════════════════════════════════════════════════════════════
  
  for (const pattern of RESEARCH_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      researchScore += 5;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // SCORE MODE_A (KNOWLEDGE)
  // ═══════════════════════════════════════════════════════════════
  
  for (const pattern of KNOWLEDGE_PATTERNS) {
    if (pattern.test(lowerMsg)) {
      knowledgeScore += 3;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DECISIÓN FINAL (prioridad: CRITICAL > RESEARCH > KNOWLEDGE)
  // ═══════════════════════════════════════════════════════════════
  
  console.log(`[MODE_SELECTOR] Scores - Knowledge: ${knowledgeScore}, Research: ${researchScore}, Critical: ${criticalScore}`);
  
  if (criticalScore >= 10) {
    // MODE_C: CRITICAL_DATA_OR_ACTION
    const toolsRequired: string[] = [];
    
    // Detectar qué tool específico
    if (/\b(agenda|cita|reunión|evento)\b/i.test(lowerMsg)) {
      toolsRequired.push('calendar');
    }
    if (/\b(envía|manda|correo|email)\b/i.test(lowerMsg)) {
      toolsRequired.push('email');
    }
    if (/\b(precio|cotización|tipo\s+de\s+cambio|dólar|bolsa)\b/i.test(lowerMsg)) {
      toolsRequired.push('finance');
    }
    
    return {
      mode: 'CRITICAL_DATA_OR_ACTION',
      confidence: 0.95,
      reasoning: 'Acción transaccional o dato crítico con timestamp → requiere API/action con evidence',
      toolsRequired,
      evidenceRequired: true
    };
  }
  
  if (researchScore >= 5) {
    // MODE_B: RESEARCH_RECENT
    return {
      mode: 'RESEARCH_RECENT',
      confidence: 0.85,
      reasoning: 'Información reciente/actual → requiere web search + fuentes',
      toolsRequired: ['web_search'],
      evidenceRequired: false // Solo citar fuentes
    };
  }
  
  // MODE_A: KNOWLEDGE_GENERAL (default)
  return {
    mode: 'KNOWLEDGE_GENERAL',
    confidence: 0.90,
    reasoning: 'Pregunta general o conceptual → responder con conocimiento del modelo sin tools',
    toolsRequired: [],
    evidenceRequired: false
  };
}

/**
 * Validar si la respuesta requiere evidence obligatorio
 */
export function requiresEvidence(mode: ResponseMode): boolean {
  return mode === 'CRITICAL_DATA_OR_ACTION';
}

/**
 * Obtener mensaje de error cuando falta evidence
 */
export function getNoEvidenceError(mode: ResponseMode): string {
  switch (mode) {
    case 'CRITICAL_DATA_OR_ACTION':
      return 'No se pudo obtener evidencia de la acción ejecutada. No se puede confirmar el resultado.';
    case 'RESEARCH_RECENT':
      return 'No se pudieron obtener fuentes verificables para esta información.';
    default:
      return 'No se pudo completar la operación solicitada.';
  }
}
