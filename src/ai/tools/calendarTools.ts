/**
 * =====================================================
 * CALENDAR TOOLS - AL-E CORE
 * =====================================================
 * 
 * Herramientas para que AL-E pueda:
 * - Crear eventos en calendario
 * - Agendar citas automáticamente
 * - Detectar conflictos de horario
 * - Enviar recordatorios
 * - Extraer fechas de emails y crear eventos
 * 
 * =====================================================
 */

import { supabase } from '../../db/supabase';

export interface CalendarEvent {
  id?: string;
  owner_user_id: string;
  title: string;
  description?: string;
  start_at: string;  // ISO 8601 - CORREGIDO: era start_date
  end_at?: string;   // CORREGIDO: era end_date
  timezone?: string;
  location?: string;
  attendees_json?: any;  // CORREGIDO: era attendees (array)
  notification_minutes?: number;  // CORREGIDO: era reminder_minutes
  status?: string;
  source?: 'manual' | 'email' | 'chat';
  source_id?: string;
  reminder_sent?: boolean;
  created_at?: string;
  updated_at?: string;
}

/**
 * Crea un evento en el calendario
 */
export async function createCalendarEvent(
  userId: string,
  event: Omit<CalendarEvent, 'id' | 'owner_user_id' | 'created_at' | 'updated_at' | 'reminder_sent'>
): Promise<{ success: boolean; event?: CalendarEvent; error?: string }> {
  try {
    console.log('[CALENDAR TOOLS] 📅 Creando evento:', event.title);
    
    // Validar fecha
    const startDate = new Date(event.start_at);
    if (isNaN(startDate.getTime())) {
      throw new Error('Fecha inválida');
    }
    
    // Verificar conflictos
    const hasConflict = await checkConflicts(userId, event.start_at, event.end_at);
    if (hasConflict) {
      console.warn('[CALENDAR TOOLS] ⚠️  Conflicto de horario detectado');
    }
    
    // Insertar en base de datos
    const { data, error } = await supabase
      .from('calendar_events')
      .insert([{
        owner_user_id: userId,
        ...event,
        status: event.status || 'confirmed',
        reminder_sent: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) {
      throw new Error(error.message);
    }
    
    console.log('[CALENDAR TOOLS] ✓ Evento creado:', data.id);
    
    return {
      success: true,
      event: data
    };
    
  } catch (error: any) {
    console.error('[CALENDAR TOOLS] ❌ Error creando evento:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Lista eventos del usuario en un rango de fechas
 */
export async function listEvents(
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<{ success: boolean; events?: CalendarEvent[]; error?: string }> {
  try {
    console.log('[CALENDAR TOOLS] 📋 Listando eventos');
    
    let query = supabase
      .from('calendar_events')
      .select('*')
      .eq('owner_user_id', userId)
      .order('start_at', { ascending: true });
    
    if (startDate) {
      query = query.gte('start_at', startDate);
    }
    
    if (endDate) {
      query = query.lte('start_at', endDate);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw new Error(error.message);
    }
    
    return {
      success: true,
      events: data || []
    };
    
  } catch (error: any) {
    console.error('[CALENDAR TOOLS] ❌ Error listando eventos:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Verifica conflictos de horario
 */
async function checkConflicts(
  userId: string,
  startDate: string,
  endDate?: string
): Promise<boolean> {
  try {
    const end = endDate || new Date(new Date(startDate).getTime() + 60 * 60 * 1000).toISOString(); // +1 hora
    
    const { data, error } = await supabase
      .from('calendar_events')
      .select('id')
      .eq('owner_user_id', userId)
      .or(`start_at.lte.${end},end_at.gte.${startDate}`);
    
    if (error) return false;
    
    return (data && data.length > 0);
    
  } catch (error) {
    return false;
  }
}

/**
 * Extrae fechas de texto y crea eventos automáticamente
 */
export async function extractAndSchedule(
  userId: string,
  text: string,
  context?: {
    source: 'email' | 'chat';
    source_id?: string;
    default_title?: string;
  }
): Promise<{ success: boolean; events?: CalendarEvent[]; error?: string }> {
  try {
    console.log('[CALENDAR TOOLS] 🔍 Extrayendo fechas de texto');
    
    const detectedDates = extractDatesFromText(text);
    
    if (detectedDates.length === 0) {
      return {
        success: true,
        events: []
      };
    }
    
    const createdEvents: CalendarEvent[] = [];
    
    for (const detected of detectedDates) {
      const eventData: Omit<CalendarEvent, 'id' | 'owner_user_id' | 'created_at' | 'updated_at' | 'reminder_sent'> = {
        title: detected.title || context?.default_title || 'Evento detectado',
        description: detected.context,
        start_at: detected.date,
        end_at: detected.endDate,
        source: context?.source || 'chat',
        source_id: context?.source_id,
        notification_minutes: 30 // recordatorio 30 min antes
      };
      
      const result = await createCalendarEvent(userId, eventData);
      
      if (result.success && result.event) {
        createdEvents.push(result.event);
      }
    }
    
    return {
      success: true,
      events: createdEvents
    };
    
  } catch (error: any) {
    console.error('[CALENDAR TOOLS] ❌ Error en extractAndSchedule:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Extrae fechas y horarios de texto
 */
function extractDatesFromText(text: string): Array<{
  date: string;
  endDate?: string;
  title?: string;
  context: string;
}> {
  const results: Array<{
    date: string;
    endDate?: string;
    title?: string;
    context: string;
  }> = [];
  
  const lower = text.toLowerCase();
  
  // Patrones de fecha
  const datePatterns = [
    // "mañana a las 3pm"
    /mañana\s+a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi,
    // "15 de enero a las 10am"
    /(\d{1,2})\s+de\s+(\w+)(?:\s+de\s+(\d{4}))?\s+a\s+las?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi,
    // "próximo lunes 2pm"
    /(próximo|siguiente)\s+(lunes|martes|miércoles|jueves|viernes|sábado|domingo)\s+(?:a\s+las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi
  ];
  
  datePatterns.forEach(pattern => {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const matchText = match[0];
      const context = extractContextAroundMatch(text, match.index, 100);
      
      // Intentar parsear fecha
      const parsedDate = parseRelativeDate(matchText);
      
      if (parsedDate) {
        // Buscar título cercano (reunión, junta, cita, etc.)
        const titleMatch = context.match(/(?:reunión|junta|cita|llamada|meeting)\s+(?:con\s+)?([^.\n,]+)/i);
        const title = titleMatch ? titleMatch[0] : undefined;
        
        results.push({
          date: parsedDate.toISOString(),
          title,
          context
        });
      }
    }
  });
  
  return results;
}

/**
 * Parsea fechas relativas a ISO 8601
 */
function parseRelativeDate(text: string): Date | null {
  const now = new Date();
  const lower = text.toLowerCase();
  
  // "mañana a las 3pm"
  if (lower.includes('mañana')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const hourMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (hourMatch) {
      let hour = parseInt(hourMatch[1]);
      const minute = hourMatch[2] ? parseInt(hourMatch[2]) : 0;
      const isPM = hourMatch[3]?.toLowerCase() === 'pm';
      
      if (isPM && hour < 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      
      tomorrow.setHours(hour, minute, 0, 0);
      return tomorrow;
    }
  }
  
  // "próximo lunes 2pm"
  const dayMatch = lower.match(/(próximo|siguiente)\s+(lunes|martes|miércoles|jueves|viernes|sábado|domingo)/);
  if (dayMatch) {
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const targetDay = days.indexOf(dayMatch[2]);
    const currentDay = now.getDay();
    
    let daysToAdd = targetDay - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysToAdd);
    
    const hourMatch = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (hourMatch) {
      let hour = parseInt(hourMatch[1]);
      const minute = hourMatch[2] ? parseInt(hourMatch[2]) : 0;
      const isPM = hourMatch[3]?.toLowerCase() === 'pm';
      
      if (isPM && hour < 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      
      targetDate.setHours(hour, minute, 0, 0);
      return targetDate;
    }
  }
  
  return null;
}

/**
 * Extrae contexto alrededor de un match
 */
function extractContextAroundMatch(text: string, index: number, length: number): string {
  const start = Math.max(0, index - length);
  const end = Math.min(text.length, index + length);
  return text.substring(start, end).trim();
}

/**
 * Definiciones de herramientas para el LLM
 */
export const CALENDAR_TOOLS_DEFINITIONS = [
  {
    name: 'create_calendar_event',
    description: 'Crea un evento en el calendario del usuario con fecha, hora, título y descripción.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Título del evento'
        },
        description: {
          type: 'string',
          description: 'Descripción del evento (opcional)'
        },
        start_at: {
          type: 'string',
          description: 'Fecha y hora de inicio en formato ISO 8601 (ej: 2026-01-15T14:00:00Z)'
        },
        end_at: {
          type: 'string',
          description: 'Fecha y hora de fin (opcional)'
        },
        timezone: {
          type: 'string',
          description: 'Zona horaria (opcional, ej: America/Mexico_City)'
        },
        location: {
          type: 'string',
          description: 'Ubicación del evento (opcional)'
        },
        attendees_json: {
          type: 'object',
          description: 'JSON con lista de asistentes (opcional)'
        },
        notification_minutes: {
          type: 'number',
          description: 'Minutos antes para recordatorio (default: 30)'
        }
      },
      required: ['title', 'start_at']
    }
  },
  {
    name: 'list_calendar_events',
    description: 'Lista eventos del calendario del usuario, opcionalmente filtrados por rango de fechas.',
    parameters: {
      type: 'object',
      properties: {
        start_at: {
          type: 'string',
          description: 'Fecha de inicio del rango (ISO 8601)'
        },
        end_at: {
          type: 'string',
          description: 'Fecha de fin del rango (ISO 8601)'
        }
      }
    }
  },
  {
    name: 'extract_and_schedule',
    description: 'Extrae fechas y horarios de un texto (email, mensaje) y crea eventos automáticamente.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Texto del cual extraer fechas'
        },
        source: {
          type: 'string',
          enum: ['email', 'chat'],
          description: 'Origen del texto'
        },
        source_id: {
          type: 'string',
          description: 'ID del email o mensaje origen'
        },
        default_title: {
          type: 'string',
          description: 'Título por defecto si no se detecta'
        }
      },
      required: ['text']
    }
  }
];
