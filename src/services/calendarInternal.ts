/**
 * CALENDARIO INTERNO P0
 * 
 * Agenda interna de AL-E (NO usa Google Calendar)
 * Toda acción DEBE retornar evidence o fail
 */

import { supabase } from '../db/supabase';
import { ActionResult } from './actionGateway';

/**
 * Extrae información del evento del mensaje
 */
function extractEventInfo(userMessage: string): {
  title: string | null;
  startDate: Date | null;
  endDate: Date | null;
  description?: string;
} {
  const lowerMsg = userMessage.toLowerCase();
  
  // Extraer título - busca después de palabras clave
  let title: string | null = null;
  
  const titleMatch = userMessage.match(/(?:cena|comida|desayuno|reunión|reunion|cita|llamada|evento|junta|dentista|zoom|meet|videollamada)\s+(?:con|para|de)?\s*([a-záéíóúñ\s]+?)(?:\s+(?:hoy|mañana|el|a las|a la|por|en|para)|$)/i);
  if (titleMatch && titleMatch[1]) {
    title = titleMatch[1].trim();
  }
  
  // Si no encontró, usar palabra clave como título
  if (!title) {
    const keywordMatch = userMessage.match(/\b(cena|comida|desayuno|reunión|reunion|cita|llamada|evento|junta|dentista|zoom|meet)\b/i);
    if (keywordMatch) {
      title = keywordMatch[1].charAt(0).toUpperCase() + keywordMatch[1].slice(1);
    }
  }
  
  // Fallback final
  if (!title) {
    title = 'Evento';
  }
  
  // Extraer fecha y hora
  const now = new Date();
  const mexicoNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  
  let targetDate = new Date(mexicoNow);
  
  // Detectar "hoy" o "mañana"
  if (lowerMsg.includes('mañana')) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  
  // Extraer hora
  const timeMatch = userMessage.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)?/i);
  let hours = 12;
  let minutes = 0;
  
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    const meridiem = timeMatch[3]?.toLowerCase();
    if (meridiem && meridiem.includes('pm') && hours < 12) {
      hours += 12;
    } else if (meridiem && meridiem.includes('am') && hours === 12) {
      hours = 0;
    }
  }
  
  targetDate.setHours(hours, minutes, 0, 0);
  
  // Si la fecha ya pasó hoy, agregar 1 día
  if (targetDate < mexicoNow) {
    targetDate.setDate(targetDate.getDate() + 1);
  }
  
  // End date: 1 hora después
  const endDate = new Date(targetDate);
  endDate.setHours(targetDate.getHours() + 1);
  
  return {
    title,
    startDate: targetDate,
    endDate,
    description: userMessage
  };
}

/**
 * Ejecuta acción de calendario
 * CRÍTICO: SIEMPRE retorna evidence o fail explícito
 */
export async function executeCalendarAction(
  userMessage: string,
  userId: string
): Promise<ActionResult> {
  
  console.log('[CALENDAR_INTERNAL] Extracting event info...');
  
  const eventInfo = extractEventInfo(userMessage);
  
  if (!eventInfo.title || !eventInfo.startDate) {
    return {
      success: false,
      action: 'calendar.create',
      evidence: null,
      userMessage: '¿Para qué fecha y hora quieres agendar el evento?',
      reason: 'MISSING_DATE_OR_TIME'
    };
  }
  
  console.log(`[CALENDAR_INTERNAL] Creating event: "${eventInfo.title}" at ${eventInfo.startDate.toISOString()}`);
  
  try {
    // ═══ DB WRITE CON EVIDENCIA OBLIGATORIA ═══
    const { data: newEvent, error } = await supabase
      .from('calendar_events')
      .insert({
        owner_user_id: userId,
        title: eventInfo.title,
        description: eventInfo.description || '',
        location: '',
        start_at: eventInfo.startDate.toISOString(),
        end_at: eventInfo.endDate!.toISOString(),
        timezone: 'America/Mexico_City',
        status: 'scheduled',
        notification_minutes: 60,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    // SI NO HAY eventId → FAIL
    if (error || !newEvent || !newEvent.id) {
      console.error('[CALENDAR_INTERNAL] ❌ DB WRITE FAILED:', error);
      return {
        success: false,
        action: 'calendar.create',
        evidence: null,
        userMessage: 'No pude crear el evento en tu calendario interno.',
        reason: error?.message || 'NO_EVENT_ID'
      };
    }
    
    // ✅ SUCCESS CON EVIDENCIA
    console.log(`[CALENDAR_INTERNAL] ✅ Event created with ID: ${newEvent.id}`);
    
    const formattedDate = eventInfo.startDate.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    return {
      success: true,
      action: 'calendar.create',
      evidence: {
        eventId: newEvent.id,
        title: newEvent.title,
        startAt: newEvent.start_at,
        endAt: newEvent.end_at,
        timezone: newEvent.timezone
      },
      userMessage: `Listo. Agendé "${eventInfo.title}" el ${formattedDate}.`
    };
    
  } catch (error: any) {
    console.error('[CALENDAR_INTERNAL] ❌ Unexpected error:', error);
    return {
      success: false,
      action: 'calendar.create',
      evidence: null,
      userMessage: 'Hubo un error al crear el evento.',
      reason: error.message
    };
  }
}
