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

export interface EmailSendAction {
  action: 'send_email';
  to: string; // Email destino
  subject: string;
  body: string;
}

export interface CalendarReadAction {
  action: 'read_calendar';
  days_ahead?: number; // Default: 7 días
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

export type ParsedAction = EmailCheckAction | EmailSendAction | CalendarReadAction | CalendarCreateAction;

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
  
  // P0 MEGA EXPANSIÓN: TODO el lenguaje mexicano/natural/casual
  const emailPatterns = [
    // Verbos de acción + correo (permisivo hasta 150 chars)
    /\b(revisa|revisar|checa|checka|chécame|checame|ve|ver|vete a ver|vé|mira|mirar|échale un ojo|echale un ojo|échale|echale|consulta|consultá|consultame|búscame|buscame|busca|buscar|lee|leer|dame|dáme|dime|muestra|muestrame|muéstrame|trae|traeme|tráeme|ayúdame|ayudame|ayúdame a|ayudame a|me ayudas|me ayudás|puedes|podés|por favor|porfavor|porfa|pls|plz|favor de|necesito|quiero|quisiera).{0,150}\b(correo|correos|email|emails|gmail|mail|mails|inbox|bandeja|mensaje|mensajes)\b/i,
    
    // Correo + llegó/nuevo/reciente
    /\b(correo|correos|email|emails|mail|mails).{0,80}\b(llegó|llego|llegaron|nuevo|nuevos|nueva|nuevas|reciente|recientes|pendiente|pendientes)/i,
    
    // Tengo/hay correos
    /\b(tengo|tienes?|hay|habrá|habra|me llegó|me llego|me llegaron).{0,50}(correo|correos|email|emails|mail|mails)/i,
    
    // Mi/mis correos
    /\b(mi|mis|tu|tus).{0,50}(correo|correos|email|emails|mail|mails|inbox|bandeja)/i,
    
    // Patterns casuales con "ayuda"
    /\b(ayud[oa]|ayúda).{0,100}(revisar|ver|checar|mirar|buscar).{0,100}(correo|email|mail|inbox)/i,
    
    // Super casual: "flaca/vieja/compa + acción + correo"
    /\b(flaca|vieja|compa|compadre|parce|brother|bro|wey|güey|carnal).{0,100}(correo|email|mail|inbox)/i
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
  
  // P0 MEGA EXPANSIÓN: TODO el lenguaje mexicano/natural/casual
  const calendarPatterns = [
    // Verbos de acción + evento (permisivo hasta 150 chars)
    /\b(agenda|agendá|agendar|agendame|agéndame|pon|poné|poner|ponme|crea|creá|crear|creame|créame|añade|añadí|añadir|añademe|agrega|agregá|agregar|agregame|apunta|apuntá|apuntar|apuntame|programa|programá|programar|programame|separa|separá|separar|sepárame|reserva|reservá|reservar|reservame|haz|hacé|hacer|hazme|book|schedule|ayúdame|ayudame|ayúdame a|ayudame a|me ayudas|me ayudás|puedes|podés|por favor|porfavor|porfa|pls|plz|favor de|necesito|quiero|quisiera).{0,150}\b(cita|evento|meet|meeting|junta|juntar|reunión|reunion|videollamada|video|call|llamada|sesión|sesion|compromiso|pendiente)\b/i,
    
    // Evento + con/para/el + día
    /\b(cita|evento|meet|meeting|junta|reunión|reunion|videollamada|call|sesión|sesion).{0,100}\b(con|para|al|a|el|este|próximo|proximo|siguiente|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|mañana|hoy|pasado)\b/i,
    
    // Super casual con "ayuda/favor"
    /\b(ayud[oa]|ayúda).{0,100}(agendar|crear|hacer|poner).{0,100}(meet|meeting|cita|evento|reunión|reunion|junta|video)/i,
    
    // Flaca/casual + acción + meet
    /\b(flaca|vieja|compa|compadre|parce|brother|bro|wey|güey|carnal).{0,150}(agendar|crear|hacer|poner).{0,150}(meet|meeting|cita|evento|reunión|reunion|junta|videollamada)/i,
    
    // Imperativo directo: "ponme/hazme/creame + meet"
    /\b(ponme|poné|hazme|hacé|creame|créame|agéndame|agendame).{0,100}(meet|meeting|cita|evento|reunión|reunion|junta|videollamada)/i
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
