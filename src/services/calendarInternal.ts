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
  console.log(`[CALENDAR_INTERNAL] 🔍 extractEventInfo - Input: "${userMessage}"`);
  
  // LIMPIAR PREFIJOS (pgaribay:, luma:, etc) ANTES de parsear
  const cleanMessage = userMessage.replace(/^[a-z]+:\s*/i, '').trim();
  console.log(`[CALENDAR_INTERNAL] 🧹 Cleaned message: "${cleanMessage}"`);
  
  const lowerMsg = cleanMessage.toLowerCase();
  
  // ═══════════════════════════════════════════════════════════════
  // EXTRAER TÍTULO
  // ═══════════════════════════════════════════════════════════════
  let title: string | null = null;
  
  // Opción 1: Buscar "llamar/hablar/contactar a [persona]"
  const callMatch = cleanMessage.match(/\b(?:llamar|hablar|contactar)\s+(?:a|con)\s+([a-záéíóúñ\s]{2,30}?)(?:\s+(?:hoy|mañana|el|a las|a la|próximo|prox|sig|siguiente|pasado|dentro|en|$|\?))/i);
  if (callMatch && callMatch[1]) {
    title = callMatch[1].trim();
    console.log(`[CALENDAR_INTERNAL] 🔍 Title (call pattern): "${title}"`);
  }
  
  // Opción 2: Buscar "para [hacer algo]" o "para ir a/al [lugar]"
  if (!title) {
    const purposeMatch = cleanMessage.match(/\bpara\s+(?:ir\s+)?(?:al?|con|ver)\s+([a-záéíóúñ\s]{3,35}?)(?:\s+(?:hoy|mañana|el|a las|a la|próximo|prox|sig|siguiente|pasado|dentro|en|$))/i);
    if (purposeMatch && purposeMatch[1]) {
      title = purposeMatch[1].trim();
      console.log(`[CALENDAR_INTERNAL] 🔍 Title (purpose): "${title}"`);
    }
  }
  
  // Opción 3: Buscar "con el/la [persona]"
  if (!title) {
    const withMatch = cleanMessage.match(/\b(?:con|cita\s+con|reunión\s+con|reunion\s+con)\s+(?:el|la)?\s*([a-záéíóúñ\s]{3,35}?)(?:\s+(?:hoy|mañana|el|a las|a la|próximo|prox|sig|siguiente|pasado|dentro|en|$))/i);
    if (withMatch && withMatch[1]) {
      title = withMatch[1].trim();
      console.log(`[CALENDAR_INTERNAL] 🔍 Title (with person): "${title}"`);
    }
  }
  
  // Opción 4: Buscar palabra clave sola (dentista, doctor, etc)
  if (!title) {
    const keywordMatch = cleanMessage.match(/\b(cena|comida|desayuno|almuerzo|reunión|reunion|cita|llamada|evento|junta|dentista|doctor|médico|medico|gimnasio|entrenamiento|clase|curso|zoom|meet|videollamada)\b/i);
    if (keywordMatch) {
      title = keywordMatch[1].charAt(0).toUpperCase() + keywordMatch[1].slice(1);
      console.log(`[CALENDAR_INTERNAL] 🔍 Title (keyword): "${title}"`);
    }
  }
  
  // Fallback final: usar texto completo resumido
  if (!title) {
    // Tomar primeras 3-5 palabras como título
    const words = cleanMessage.split(/\s+/).filter(w => w.length > 2 && !w.match(/^(el|la|los|las|de|del|para|por|en|con|hoy|mañana)$/i));
    title = words.slice(0, 3).join(' ') || 'Evento';
    console.log(`[CALENDAR_INTERNAL] 🔍 Title (fallback): "${title}"`);
  }
  
  // Limpiar título: capitalizar primera letra
  title = title.charAt(0).toUpperCase() + title.slice(1);
  
  // ═══════════════════════════════════════════════════════════════
  // EXTRAER FECHA
  // ═══════════════════════════════════════════════════════════════
  const now = new Date();
  const mexicoNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  
  let targetDate = new Date(mexicoNow);
  let dateDetected = false;
  
  // 1. "pasado mañana"
  if (lowerMsg.match(/\b(pasado\s+mañana|pasadomañana)\b/)) {
    targetDate.setDate(targetDate.getDate() + 2);
    console.log('[CALENDAR_INTERNAL] 🔍 Date: pasado mañana (+2 días)');
    dateDetected = true;
  }
  
  // 2. "mañana"
  else if (lowerMsg.match(/\b(mañana)\b/)) {
    targetDate.setDate(targetDate.getDate() + 1);
    console.log('[CALENDAR_INTERNAL] 🔍 Date: mañana (+1 día)');
    dateDetected = true;
  }
  
  // 3. "hoy"
  else if (lowerMsg.match(/\b(hoy)\b/)) {
    console.log('[CALENDAR_INTERNAL] 🔍 Date: hoy');
    dateDetected = true;
  }
  
  // 4. "dentro de X días/semanas"
  const withinMatch = lowerMsg.match(/\b(?:dentro\s+de|en)\s+(\d+)\s+(día|dias|día|días|semana|semanas)\b/);
  if (!dateDetected && withinMatch) {
    const amount = parseInt(withinMatch[1]);
    const unit = withinMatch[2];
    
    if (unit.includes('semana')) {
      targetDate.setDate(targetDate.getDate() + (amount * 7));
      console.log(`[CALENDAR_INTERNAL] 🔍 Date: dentro de ${amount} semana(s) (+${amount * 7} días)`);
    } else {
      targetDate.setDate(targetDate.getDate() + amount);
      console.log(`[CALENDAR_INTERNAL] 🔍 Date: dentro de ${amount} día(s)`);
    }
    dateDetected = true;
  }
  
  // 5. Día de la semana con modificadores: "próximo/siguiente/este martes"
  if (!dateDetected) {
    const dayMatch = lowerMsg.match(/(?:próximo|prox|siguiente|sig|este|esta|el)\s+(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)/i);
    if (dayMatch) {
      const dayName = dayMatch[1].toLowerCase();
      const dayMap: { [key: string]: number } = {
        'domingo': 0, 'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
        'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6
      };
      
      const targetDay = dayMap[dayName];
      const currentDay = targetDate.getDay();
      
      // Calcular días hasta el próximo día de la semana
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) {
        daysToAdd += 7; // Ir a la próxima semana
      }
      
      targetDate.setDate(targetDate.getDate() + daysToAdd);
      console.log(`[CALENDAR_INTERNAL] 🔍 Date: próximo ${dayName} (+${daysToAdd} días)`);
      dateDetected = true;
    }
  }
  
  // 6. "la próxima semana" o "la semana que viene"
  if (!dateDetected && lowerMsg.match(/\b(la\s+próxima\s+semana|la\s+semana\s+que\s+viene|próxima\s+semana)\b/)) {
    targetDate.setDate(targetDate.getDate() + 7);
    console.log('[CALENDAR_INTERNAL] 🔍 Date: la próxima semana (+7 días)');
    dateDetected = true;
  }
  
  // 7. Default: hoy (si no se detectó ninguna fecha específica)
  if (!dateDetected) {
    console.log('[CALENDAR_INTERNAL] 🔍 Date: default (hoy)');
  }
  
  // ═══════════════════════════════════════════════════════════════
  // EXTRAER HORA
  // ═══════════════════════════════════════════════════════════════
  const timeMatch = cleanMessage.match(/(?:a las?|de las?)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?)?/i);
  let hours = 12;
  let minutes = 0;
  
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    const meridiem = timeMatch[3]?.toLowerCase();
    
    // Convertir a formato 24 horas según meridiem
    if (meridiem && meridiem.includes('pm') && hours < 12) {
      hours += 12;
      console.log(`[CALENDAR_INTERNAL] 🔍 Time: ${timeMatch[1]} ${meridiem} → ${hours}:${minutes.toString().padStart(2, '0')}`);
    } else if (meridiem && meridiem.includes('am') && hours === 12) {
      hours = 0;
      console.log(`[CALENDAR_INTERNAL] 🔍 Time: ${timeMatch[1]} ${meridiem} → ${hours}:${minutes.toString().padStart(2, '0')}`);
    } else if (!meridiem && hours >= 1 && hours <= 11) {
      // Sin meridiem explícito: asumir PM para horas 1-11
      hours += 12;
      console.log(`[CALENDAR_INTERNAL] 🔍 Time: ${timeMatch[1]} (asumiendo PM) → ${hours}:${minutes.toString().padStart(2, '0')}`);
    } else {
      console.log(`[CALENDAR_INTERNAL] 🔍 Time: ${hours}:${minutes.toString().padStart(2, '0')}`);
    }
  } else {
    console.log('[CALENDAR_INTERNAL] 🔍 Time: default (12:00)');
  }
  
  // CRÍTICO: Construir fecha en timezone México usando ISO string
  // Para evitar problemas de conversión UTC
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const hourStr = String(hours).padStart(2, '0');
  const minuteStr = String(minutes).padStart(2, '0');
  
  // Crear fecha en México time (ISO format con timezone offset)
  const mexicoDateStr = `${year}-${month}-${day}T${hourStr}:${minuteStr}:00`;
  const finalStartDate = new Date(mexicoDateStr);
  
  console.log(`[CALENDAR_INTERNAL] 🕐 Final start date: ${finalStartDate.toISOString()} (${mexicoDateStr} México)`);
  
  // End date: 1 hora después
  const endDate = new Date(finalStartDate);
  endDate.setHours(finalStartDate.getHours() + 1);
  
  return {
    title,
    startDate: finalStartDate,
    endDate,
    description: cleanMessage
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
  
  console.log('[CALENDAR_INTERNAL] ========================================');
  console.log('[CALENDAR_INTERNAL] 🚀 INICIO executeCalendarAction');
  console.log(`[CALENDAR_INTERNAL] 🚀 User: ${userId}`);
  console.log(`[CALENDAR_INTERNAL] 🚀 Message: "${userMessage}"`);
  console.log('[CALENDAR_INTERNAL] ========================================');
  
  console.log('[CALENDAR_INTERNAL] Extracting event info...');
  
  const eventInfo = extractEventInfo(userMessage);
  
  console.log('[CALENDAR_INTERNAL] Event info extracted:');
  console.log(`[CALENDAR_INTERNAL]   - Title: ${eventInfo.title}`);
  console.log(`[CALENDAR_INTERNAL]   - Start: ${eventInfo.startDate?.toISOString()}`);
  console.log(`[CALENDAR_INTERNAL]   - End: ${eventInfo.endDate?.toISOString()}`);
  
  if (!eventInfo.title || !eventInfo.startDate) {
    console.log('[CALENDAR_INTERNAL] ❌ Missing required fields (title or date)');
    return {
      success: false,
      action: 'calendar.create',
      evidence: null,
      userMessage: '¿Para qué fecha y hora quieres agendar el evento?',
      reason: 'MISSING_DATE_OR_TIME'
    };
  }
  
  console.log(`[CALENDAR_INTERNAL] ✅ Creating event: "${eventInfo.title}" at ${eventInfo.startDate.toISOString()}`);
  
  try {
    // ═══ DB WRITE CON EVIDENCIA OBLIGATORIA ═══
    console.log('[CALENDAR_INTERNAL] 💾 Inserting into DB...');
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
      console.error('[CALENDAR_INTERNAL] ❌ Error details:', JSON.stringify(error));
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
    console.log(`[CALENDAR_INTERNAL] ✅ Event data:`, JSON.stringify(newEvent));
    
    const formattedDate = eventInfo.startDate.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    console.log(`[CALENDAR_INTERNAL] ✅ Formatted date: ${formattedDate}`);
    console.log(`[CALENDAR_INTERNAL] ✅ Returning success with evidence`);
    
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
    console.error('[CALENDAR_INTERNAL] ❌ Stack:', error.stack);
    return {
      success: false,
      action: 'calendar.create',
      evidence: null,
      userMessage: 'Hubo un error al crear el evento.',
      reason: error.message
    };
  }
}
