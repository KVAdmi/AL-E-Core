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
  
  // CRÍTICO: Construir fecha en timezone México y convertir a UTC
  // México = UTC-6, entonces 11:30 PM México → 5:30 AM UTC del día siguiente
  
  targetDate.setHours(hours, minutes, 0, 0);
  
  // Crear el string ISO con timezone offset de México (-06:00)
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getDate()).padStart(2, '0');
  const hourStr = String(hours).padStart(2, '0');
  const minuteStr = String(minutes).padStart(2, '0');
  
  // Construir fecha con offset explícito de México
  const mexicoISOString = `${year}-${month}-${day}T${hourStr}:${minuteStr}:00-06:00`;
  const finalStartDate = new Date(mexicoISOString);
  
  console.log(`[CALENDAR_INTERNAL] 🕐 México time: ${hours}:${minutes.toString().padStart(2, '0')} (${year}-${month}-${day})`);
  console.log(`[CALENDAR_INTERNAL] 🕐 UTC time (stored): ${finalStartDate.toISOString()}`);
  
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
  
  // ═══════════════════════════════════════════════════════════════
  // DETECTAR SI ES UPDATE (editar/cambiar/modificar/esa cita)
  // ═══════════════════════════════════════════════════════════════
  const lowerMsg = userMessage.toLowerCase();
  
  // Detectar palabras clave de edición
  const editKeywords = lowerMsg.match(/\b(edita|editar|cambia|cambiar|modifica|modificar|actualiza|actualizar)\b/);
  
  // Detectar referencias a citas existentes
  const referenceToExisting = lowerMsg.match(/\b(esa|esta|la|el)\s+(cita|evento|reunión|reunion|agenda)\b/);
  
  // Detectar frases como "no quedo bien", "sigue mal", "titulo mal"
  const fixingExisting = lowerMsg.match(/\b(no\s+quedo|sigue\s+(mal|igual|con)|titulo\s+mal|está\s+mal|esta\s+mal)\b/);
  
  const isUpdate = editKeywords || referenceToExisting || fixingExisting;
  
  if (isUpdate) {
    console.log('[CALENDAR_INTERNAL] 🔍 Detected UPDATE intent');
    console.log(`[CALENDAR_INTERNAL] 🔍 Reason: editKeywords=${!!editKeywords}, reference=${!!referenceToExisting}, fixing=${!!fixingExisting}`);
    return await executeCalendarUpdate(userMessage, userId);
  }
  
  console.log('[CALENDAR_INTERNAL] Extracting event info for CREATE...');
  
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
    
    // 🔔 P0 CRÍTICO: Crear notification_job (1 hora antes por defecto)
    const notificationMinutes = 60; // 1 hora antes
    const runAt = new Date(eventInfo.startDate.getTime() - notificationMinutes * 60 * 1000);
    
    console.log('[CALENDAR_INTERNAL] 🔔 Creating notification_job...');
    const { data: notificationJob, error: notificationError } = await supabase
      .from('notification_jobs')
      .insert({
        owner_user_id: userId,
        type: 'event_reminder',
        channel: 'telegram',
        run_at: runAt.toISOString(),
        status: 'pending',
        payload: {
          eventId: newEvent.id,
          title: newEvent.title,
          start_at: newEvent.start_at,
          location: newEvent.location || ''
        }
      })
      .select()
      .single();
    
    if (notificationError) {
      console.error('[CALENDAR_INTERNAL] ⚠️ Notification job failed (non-fatal):', notificationError);
      // NO fallar la transacción completa por esto
    } else {
      console.log(`[CALENDAR_INTERNAL] ✅ Notification job created with ID: ${notificationJob.id}`);
      console.log(`[CALENDAR_INTERNAL] ✅ Will notify at: ${runAt.toISOString()}`);
    }
    
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
        timezone: newEvent.timezone,
        notificationJobId: notificationJob?.id || null
      },
      userMessage: `Listo. Agendé "${eventInfo.title}" el ${formattedDate}. Te notificaré 1 hora antes.`
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

// ═══════════════════════════════════════════════════════════════
// EXECUTE CALENDAR UPDATE
// ═══════════════════════════════════════════════════════════════

/**
 * Ejecuta actualización de evento de calendario
 * Busca el evento más reciente y lo actualiza
 */
async function executeCalendarUpdate(
  userMessage: string,
  userId: string
): Promise<ActionResult> {
  
  console.log('[CALENDAR_UPDATE] ========================================');
  console.log('[CALENDAR_UPDATE] 🚀 INICIO executeCalendarUpdate');
  console.log(`[CALENDAR_UPDATE] 🚀 User: ${userId}`);
  console.log(`[CALENDAR_UPDATE] 🚀 Message: "${userMessage}"`);
  console.log('[CALENDAR_UPDATE] ========================================');
  
  try {
    // 1. Buscar el evento más reciente del usuario (últimas 24 horas)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const { data: recentEvents, error: fetchError } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('owner_user_id', userId)
      .gte('created_at', oneDayAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(5);
    
    if (fetchError || !recentEvents || recentEvents.length === 0) {
      console.log('[CALENDAR_UPDATE] ❌ No recent events found');
      return {
        success: false,
        action: 'calendar.update',
        evidence: null,
        userMessage: 'No encontré eventos recientes para editar. ¿Podrías ser más específico?',
        reason: 'NO_RECENT_EVENTS'
      };
    }
    
    console.log(`[CALENDAR_UPDATE] Found ${recentEvents.length} recent events`);
    console.log(`[CALENDAR_UPDATE] Most recent event: "${recentEvents[0].title}" (${recentEvents[0].id})`);
    
    // 2. Extraer qué quiere cambiar (título, fecha, hora, etc.)
    const updates: any = {};
    const lowerMsg = userMessage.toLowerCase();
    
    // ═══ EXTRAER NUEVO TÍTULO (múltiples patrones) ═══
    
    // Patrón 1: "el título debe ser X" / "título es X" / "es tema X"
    let titleMatch = userMessage.match(/(?:titulo|título)\s+(?:debe\s+ser|es|sea|que\s+sea)\s+(.{3,80}?)(?:\s+para|$)/i);
    if (!titleMatch) {
      titleMatch = userMessage.match(/\b(?:es\s+tema|tema\s+es)\s+(.{3,80}?)(?:\s+para|$)/i);
    }
    
    // Patrón 2: "llamar X" / "que se llame X"
    if (!titleMatch) {
      titleMatch = userMessage.match(/(?:llamar|llamarse|que\s+se\s+llame)\s+["']?([^"']{5,80})["']?/i);
    }
    
    // Patrón 3: "cambiar el título a X" / "editar título a X"
    if (!titleMatch) {
      titleMatch = userMessage.match(/(?:cambiar|editar)\s+(?:el\s+)?titulo\s+a\s+(.{3,80}?)(?:\s+por|$)/i);
    }
    
    // Patrón 4: "pon como título: X" / "ponle de título X"
    if (!titleMatch) {
      titleMatch = userMessage.match(/\b(?:pon|poner|ponle)\s+(?:como|de)?\s*titulo[:\s]+(.{3,80}?)(?:\s+pls|$)/i);
    }
    
    if (titleMatch && titleMatch[1]) {
      updates.title = titleMatch[1].trim();
      console.log(`[CALENDAR_UPDATE] ✅ New title extracted: "${updates.title}"`);
    } else {
      console.log(`[CALENDAR_UPDATE] ⚠️ No title pattern matched in message`);
    }
    
    // Si no hay cambios específicos, retornar error
    if (Object.keys(updates).length === 0) {
      console.log('[CALENDAR_UPDATE] ❌ No updates detected in message');
      return {
        success: false,
        action: 'calendar.update',
        evidence: null,
        userMessage: '¿Qué quieres cambiar del evento? Por favor dime el nuevo título o fecha.',
        reason: 'NO_UPDATES_SPECIFIED'
      };
    }
    
    updates.updated_at = new Date().toISOString();
    
    // 3. Actualizar el evento más reciente
    const eventToUpdate = recentEvents[0];
    console.log(`[CALENDAR_UPDATE] Updating event ID: ${eventToUpdate.id}`);
    console.log(`[CALENDAR_UPDATE] Updates:`, JSON.stringify(updates));
    
    const { data: updatedEvent, error: updateError } = await supabase
      .from('calendar_events')
      .update(updates)
      .eq('id', eventToUpdate.id)
      .eq('owner_user_id', userId)
      .select()
      .single();
    
    if (updateError || !updatedEvent) {
      console.error('[CALENDAR_UPDATE] ❌ Update failed:', updateError);
      return {
        success: false,
        action: 'calendar.update',
        evidence: null,
        userMessage: 'No pude actualizar el evento.',
        reason: updateError?.message || 'UPDATE_FAILED'
      };
    }
    
    console.log(`[CALENDAR_UPDATE] ✅ Event updated successfully`);
    console.log(`[CALENDAR_UPDATE] Updated data:`, JSON.stringify(updatedEvent));
    
    // 4. Retornar éxito con evidencia
    return {
      success: true,
      action: 'calendar.update',
      evidence: {
        eventId: updatedEvent.id,
        title: updatedEvent.title,
        changes: updates
      },
      userMessage: `Listo. Actualicé el evento "${updatedEvent.title}".`
    };
    
  } catch (error: any) {
    console.error('[CALENDAR_UPDATE] ❌ Unexpected error:', error);
    return {
      success: false,
      action: 'calendar.update',
      evidence: null,
      userMessage: 'Hubo un error al actualizar el evento.',
      reason: error.message
    };
  }
}
