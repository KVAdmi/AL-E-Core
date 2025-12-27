/**
 * Action Parser
 * 
 * Extrae parámetros de acciones del mensaje del usuario
 * CRÍTICO: NO preguntar, INFERIR lo máximo posible
 */

export interface EmailCheckAction {
  action: 'check_email';
  query?: string; // Keywords para buscar (ej: "Dra. López")
  timeframe_minutes?: number; // Default: 60 minutos
}

export interface CalendarCreateAction {
  action: 'create_calendar_event';
  title: string;
  date: Date;
  time_start: string; // HH:mm
  duration_minutes: number; // Default: 60
  description?: string;
  create_meet: boolean; // Default: true
}

export type ParsedAction = EmailCheckAction | CalendarCreateAction;

/**
 * Detectar acciones explícitas en el mensaje
 * CONFIDENCE ALTA = EJECUTAR SIN PREGUNTAR
 */
export function detectActionIntent(message: string): {
  has_action: boolean;
  actions: ParsedAction[];
  confidence: number; // 0.0 - 1.0
} {
  const lowerMsg = message.toLowerCase();
  const actions: ParsedAction[] = [];
  let confidence = 0;
  
  // ═══════════════════════════════════════════════════════════════
  // ACCIÓN 1: CHECK EMAIL
  // ═══════════════════════════════════════════════════════════════
  
  const emailPatterns = [
    /\b(revisa|revisar|checa|checka|ver|check|mira|mirar|busca|buscar)\b.*\b(correo|email|gmail|inbox|bandeja)/i,
    /\b(correo|email|mail)\b.*\b(llegó|llego|llegaron|nuevo|nuevos|reciente)/i,
    /\bme.*llegó.*correo/i
  ];
  
  if (emailPatterns.some(p => p.test(message))) {
    confidence = Math.max(confidence, 0.9);
    
    // Extraer query (keywords para buscar)
    const queryMatch = message.match(/\b(?:sobre|de|relacionado|doctor|doctora|dra?\.?)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i);
    const query = queryMatch ? queryMatch[1] : undefined;
    
    actions.push({
      action: 'check_email',
      query,
      timeframe_minutes: 60 // Default: última hora
    });
  }
  
  // ═══════════════════════════════════════════════════════════════
  // ACCIÓN 2: CREATE CALENDAR EVENT
  // ═══════════════════════════════════════════════════════════════
  
  const calendarPatterns = [
    /\b(agenda|agendar|agend[aá]r|crea|crear|pon|poner|añade|añadir|programa|programar)\b.*\b(cita|evento|reunión|reunion|meeting|meet)/i,
    /\b(cita|reunión|reunion|meeting)\b.*\b(para|el|este|próximo|proximo)/i
  ];
  
  if (calendarPatterns.some(p => p.test(message))) {
    confidence = Math.max(confidence, 0.9);
    
    // Extraer fecha
    const date = parseDate(message);
    
    // Extraer hora
    const time = parseTime(message);
    
    // Extraer título (inferir de contexto)
    const title = inferTitle(message);
    
    // Solo agregar si tenemos fecha Y hora
    if (date && time) {
      actions.push({
        action: 'create_calendar_event',
        title,
        date,
        time_start: time,
        duration_minutes: 60,
        create_meet: true
      });
    } else {
      // Si falta fecha u hora, bajar confianza
      confidence = Math.min(confidence, 0.6);
    }
  }
  
  return {
    has_action: actions.length > 0,
    actions,
    confidence
  };
}

/**
 * Parsear fecha del mensaje
 * Soporta: "lunes", "el martes", "mañana", "pasado mañana", etc.
 */
function parseDate(message: string): Date | null {
  const lowerMsg = message.toLowerCase();
  const now = new Date();
  
  // Hoy
  if (/\bhoy\b/.test(lowerMsg)) {
    return now;
  }
  
  // Mañana
  if (/\bma[ñn]ana\b/.test(lowerMsg)) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  }
  
  // Pasado mañana
  if (/\bpasado ma[ñn]ana\b/.test(lowerMsg)) {
    const dayAfter = new Date(now);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return dayAfter;
  }
  
  // Días de la semana
  const daysMap: { [key: string]: number } = {
    'lunes': 1,
    'martes': 2,
    'miércoles': 3,
    'miercoles': 3,
    'jueves': 4,
    'viernes': 5,
    'sábado': 6,
    'sabado': 6,
    'domingo': 0
  };
  
  for (const [dayName, targetDay] of Object.entries(daysMap)) {
    if (lowerMsg.includes(dayName)) {
      const currentDay = now.getDay();
      let daysToAdd = targetDay - currentDay;
      
      // Si el día ya pasó esta semana, ir a la próxima
      if (daysToAdd <= 0) {
        daysToAdd += 7;
      }
      
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() + daysToAdd);
      return targetDate;
    }
  }
  
  // Fechas específicas (ej: "15 de enero", "3 de marzo")
  const dateMatch = message.match(/\b(\d{1,2})\s*(?:de)?\s*(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i);
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const monthNames = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const month = monthNames.indexOf(dateMatch[2].toLowerCase());
    
    if (month !== -1) {
      const year = now.getFullYear();
      const targetDate = new Date(year, month, day);
      
      // Si ya pasó, asumir año siguiente
      if (targetDate < now) {
        targetDate.setFullYear(year + 1);
      }
      
      return targetDate;
    }
  }
  
  return null;
}

/**
 * Parsear hora del mensaje
 * Soporta: "12", "12:00", "12pm", "a las 3", "15:30"
 */
function parseTime(message: string): string | null {
  // Patrón: "12", "12:00", "12pm", "a las 12"
  const timeMatch = message.match(/\b(?:a las|a la)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|hrs?|horas?)?\b/i);
  
  if (timeMatch) {
    let hour = parseInt(timeMatch[1]);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    const meridiem = timeMatch[3]?.toLowerCase();
    
    // Convertir a formato 24h si tiene am/pm
    if (meridiem === 'pm' && hour < 12) {
      hour += 12;
    } else if (meridiem === 'am' && hour === 12) {
      hour = 0;
    }
    
    return `${hour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  
  return null;
}

/**
 * Inferir título del evento desde el contexto
 */
function inferTitle(message: string): string {
  const lowerMsg = message.toLowerCase();
  
  // Detectar tipo de cita
  if (/ginec[oó]log[oa]/.test(lowerMsg)) {
    // Extraer nombre del doctor si existe
    const doctorMatch = message.match(/\b(?:doctor|doctora|dra?\.?|dr\.?)\s+([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i);
    if (doctorMatch) {
      return `Cita ginecóloga - Dr. ${doctorMatch[1]}`;
    }
    return 'Cita ginecóloga';
  }
  
  if (/\b(dentista|odont[oó]log[oa])\b/.test(lowerMsg)) {
    return 'Cita dentista';
  }
  
  if (/\breuni[oó]n\b/.test(lowerMsg)) {
    return 'Reunión';
  }
  
  if (/\bmeet\b/.test(lowerMsg)) {
    return 'Google Meet';
  }
  
  // Default genérico
  return 'Cita';
}
