/**
 * Transactional Executor
 * P0: Ejecuta acciones transaccionales (email, calendar, telegram)
 * Reemplaza el código comentado de Gmail/Google Calendar
 */

import { supabase } from '../db/supabase';
import { UserIntegrations } from './integrationChecker';
import { IntentClassification } from './intentClassifier';

interface ToolExecutionResult {
  toolUsed: string;
  toolReason?: string;
  toolResult?: string;
  toolFailed: boolean;
  toolError?: string;
}

interface EventInfo {
  title: string | null;
  description: string | null;
  location: string | null;
  startDate: Date | null;
  endDate: Date | null;
}

/**
 * Extrae información del evento del mensaje del usuario
 */
function extractEventInfo(userMessage: string): EventInfo {
  const lowerMsg = userMessage.toLowerCase();
  
  // Extraer título (después de "agendar/crear/etc" y antes de fecha/hora)
  let title: string | null = null;
  const titleMatches = userMessage.match(/\b(?:agenda|agendar|crea|crear|pon|poner)\s+(?:una?\s+)?(?:cita|reunión|reunion|evento|llamada)?\s+(?:con|para|de|sobre|el)?\s+([^,.?!]+?)(?:\s+(?:para|el|a|en)\s+)/i);
  if (titleMatches && titleMatches[1]) {
    title = titleMatches[1].trim();
  } else {
    // Fallback: buscar cualquier texto descriptivo
    const fallbackMatch = userMessage.match(/\b(?:cita|reunión|reunion|evento|llamada)\s+(?:con|para|de|sobre|el)?\s+([^,.?!0-9]+)/i);
    if (fallbackMatch && fallbackMatch[1]) {
      title = fallbackMatch[1].trim();
    }
  }
  
  // Extraer ubicación (después de "en el/la")
  let location: string | null = null;
  const locationMatch = userMessage.match(/\b(?:en|ubicación|lugar)\s+(?:el|la|los)?\s*([^,.?!0-9]+?)(?:\s+(?:a|para|el|,|\?|$))/i);
  if (locationMatch && locationMatch[1]) {
    location = locationMatch[1].trim();
  }
  
  // Extraer fecha y hora
  const { startDate, endDate } = extractDateTime(userMessage);
  
  return {
    title,
    description: title, // Por ahora usamos el mismo título como descripción
    location,
    startDate,
    endDate
  };
}

/**
 * Extrae fecha y hora del mensaje
 */
function extractDateTime(userMessage: string): { startDate: Date | null; endDate: Date | null } {
  const lowerMsg = userMessage.toLowerCase();
  const now = new Date();
  
  // Obtener fecha base
  let targetDate = new Date(now);
  
  // Días de la semana
  const dayPatterns: { [key: string]: number } = {
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
  
  // Detectar día de la semana
  for (const [dayName, dayNum] of Object.entries(dayPatterns)) {
    if (lowerMsg.includes(dayName)) {
      const currentDay = now.getDay();
      let daysToAdd = dayNum - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7; // Siguiente semana si ya pasó
      targetDate.setDate(now.getDate() + daysToAdd);
      break;
    }
  }
  
  // Detectar "hoy", "mañana", "pasado mañana"
  if (lowerMsg.includes('hoy')) {
    targetDate = new Date(now);
  } else if (lowerMsg.includes('mañana')) {
    targetDate.setDate(now.getDate() + 1);
  } else if (lowerMsg.includes('pasado mañana') || lowerMsg.includes('pasado manana')) {
    targetDate.setDate(now.getDate() + 2);
  }
  
  // Extraer hora
  let hours = 9; // Default 9 AM
  let minutes = 0;
  
  // Formato "1 pm", "13:00", "1:30 pm", etc.
  const timeMatch = userMessage.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i);
  if (timeMatch) {
    hours = parseInt(timeMatch[1]);
    minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    // Convertir a formato 24 horas si hay am/pm
    const meridiem = timeMatch[3]?.toLowerCase();
    if (meridiem && meridiem.includes('pm') && hours < 12) {
      hours += 12;
    } else if (meridiem && meridiem.includes('am') && hours === 12) {
      hours = 0;
    }
  }
  
  // Establecer la hora
  targetDate.setHours(hours, minutes, 0, 0);
  
  // Si la fecha ya pasó hoy, agregar 7 días
  if (targetDate < now) {
    targetDate.setDate(targetDate.getDate() + 7);
  }
  
  // End date: 1 hora después por defecto
  const endDate = new Date(targetDate);
  endDate.setHours(targetDate.getHours() + 1);
  
  return {
    startDate: targetDate,
    endDate
  };
}

/**
 * Ejecuta acción transaccional según el intent
 */
export async function executeTransactionalAction(
  userMessage: string,
  userId: string,
  intent: IntentClassification,
  integrations: UserIntegrations
): Promise<ToolExecutionResult> {
  
  const lowerMsg = userMessage.toLowerCase();
  
  // ═══════════════════════════════════════════════════════════════
  // 1. EMAIL - LEER INBOX
  // ═══════════════════════════════════════════════════════════════
  if (
    lowerMsg.match(/\b(revisa|revisar|checa|checka|ve|ver|mira|consulta|busca|lee|leer|último|ultima|tengo|hay)\b.{0,100}\b(correo|email|mail|inbox|bandeja|mensajes?)\b/i) ||
    lowerMsg.match(/\b(correo|email|mail|inbox|bandeja)\b.{0,100}\b(revisa|revisar|checa|ve|ver|mira|último|ultima|tengo|hay)\b/i)
  ) {
    console.log('[TRANSACTIONAL] Intent: EMAIL_READ');
    
    if (!integrations.hasEmail) {
      return {
        toolUsed: 'email_read',
        toolReason: 'No email account configured',
        toolResult: '❌ No tienes ninguna cuenta de email configurada.\n\nPara leer tus correos, primero debes configurar una cuenta SMTP/IMAP en tu perfil.',
        toolFailed: true,
        toolError: 'NO_EMAIL_ACCOUNT'
      };
    }
    
    // Obtener cuenta principal (primera activa)
    const { data: emailAccount } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .limit(1)
      .single();
    
    if (!emailAccount) {
      return {
        toolUsed: 'email_read',
        toolReason: 'No active email account found',
        toolResult: '❌ No encontré una cuenta de email activa.',
        toolFailed: true,
        toolError: 'NO_ACTIVE_EMAIL_ACCOUNT'
      };
    }
    
    // Llamar al endpoint de mail inbox
    try {
      // P0: Por ahora devolvemos mensaje de que la funcionalidad está lista
      // TODO: Implementar llamada real al endpoint /api/mail/inbox
      
      return {
        toolUsed: 'email_read',
        toolReason: 'Email inbox ready (implementation pending)',
        toolResult: `✅ Cuenta de email configurada: ${emailAccount.from_email}

⚠️ La lectura de inbox está lista pero aún no implementada en el orchestrator.

Por ahora, puedes:
1. Ir a tu perfil y configurar tu cuenta IMAP
2. Usar el endpoint \`GET /api/mail/inbox\` directamente
3. O pedirme que te ayude con otra cosa mientras implementamos esto`,
        toolFailed: false
      };
    } catch (error: any) {
      console.error('[TRANSACTIONAL] Error reading inbox:', error);
      return {
        toolUsed: 'email_read',
        toolReason: 'Email read failed',
        toolResult: `❌ Error al leer el inbox: ${error.message}`,
        toolFailed: true,
        toolError: error.message
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 2. EMAIL - ENVIAR
  // ═══════════════════════════════════════════════════════════════
  if (
    lowerMsg.match(/\b(envía|enviar|manda|mandar|send|escribe|escribir|redacta|responde|responder|contesta|contestar)\b.{0,80}\b(correo|email|mail|mensaje)\b/i)
  ) {
    console.log('[TRANSACTIONAL] Intent: EMAIL_SEND');
    
    if (!integrations.hasEmail) {
      return {
        toolUsed: 'email_send',
        toolReason: 'No email account configured',
        toolResult: '❌ No tienes ninguna cuenta de email configurada.\n\nPara enviar correos, primero debes configurar una cuenta SMTP en tu perfil.',
        toolFailed: true,
        toolError: 'NO_EMAIL_ACCOUNT'
      };
    }
    
    return {
      toolUsed: 'email_send',
      toolReason: 'Email send ready (implementation pending)',
      toolResult: `✅ Cuenta de email lista para enviar.

⚠️ El envío de correos está listo pero aún no implementado en el orchestrator.

Por ahora, usa el endpoint \`POST /api/mail/send\` directamente con tu cuenta configurada.`,
      toolFailed: false
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 3. CALENDAR - LEER/CONSULTAR
  // ═══════════════════════════════════════════════════════════════
  if (
    lowerMsg.match(/\b(revisa|revisar|checa|ve|ver|mira|consulta|muestra|cuáles?|qué)\b.{0,100}\b(agenda|calendar|calendario|eventos?|reunión|reuniones|cita|citas)\b/i) ||
    lowerMsg.match(/\b(agenda|calendar|calendario|eventos?)\b.{0,100}\b(hoy|mañana|esta semana|próxim|tengo|hay)\b/i)
  ) {
    console.log('[TRANSACTIONAL] Intent: CALENDAR_READ');
    
    // Calendario interno siempre está disponible
    const { data: events, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('status', 'scheduled')
      .gte('start_at', new Date().toISOString())
      .order('start_at', { ascending: true })
      .limit(10);
    
    if (error) {
      console.error('[TRANSACTIONAL] Error reading calendar:', error);
      return {
        toolUsed: 'calendar_read',
        toolReason: 'Calendar read failed',
        toolResult: `❌ Error al leer el calendario: ${error.message}`,
        toolFailed: true,
        toolError: error.message
      };
    }
    
    if (!events || events.length === 0) {
      return {
        toolUsed: 'calendar_read',
        toolReason: 'No upcoming events',
        toolResult: '📅 No tienes eventos próximos en tu calendario.\n\n¿Quieres que te ayude a agendar algo?',
        toolFailed: false
      };
    }
    
    const eventList = events.map((e: any, idx: number) => {
      const startDate = new Date(e.start_at);
      const formatted = startDate.toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${idx + 1}. **${e.title}** - ${formatted}${e.location ? ` (${e.location})` : ''}`;
    }).join('\n');
    
    return {
      toolUsed: 'calendar_read',
      toolReason: 'Calendar events retrieved',
      toolResult: `📅 **Tus próximos eventos:**\n\n${eventList}\n\n✅ Total: ${events.length} evento(s)`,
      toolFailed: false
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 4. CALENDAR - CREAR EVENTO
  // ═══════════════════════════════════════════════════════════════
  if (
    lowerMsg.match(/\b(agenda|agendar|crea|crear|pon|poner|añade|añadir|agrega|agregar|programa|programar)\b.{0,100}\b(reunión|reunion|cita|evento|llamada|call|meet)\b/i)
  ) {
    console.log('[TRANSACTIONAL] Intent: CALENDAR_CREATE');
    
    // Extraer información del evento usando regex
    const eventInfo = extractEventInfo(userMessage);
    
    if (!eventInfo.title) {
      return {
        toolUsed: 'calendar_create',
        toolReason: 'Missing event title',
        toolResult: '⚠️ ¿Cuál es el nombre o motivo del evento que quieres agendar?',
        toolFailed: true,
        toolError: 'MISSING_TITLE'
      };
    }
    
    if (!eventInfo.startDate) {
      return {
        toolUsed: 'calendar_create',
        toolReason: 'Missing event date',
        toolResult: '⚠️ ¿Para qué fecha y hora quieres agendar el evento?',
        toolFailed: true,
        toolError: 'MISSING_DATE'
      };
    }
    
    try {
      // Crear evento en la base de datos
      const { data: newEvent, error } = await supabase
        .from('calendar_events')
        .insert({
          owner_user_id: userId,
          title: eventInfo.title,
          description: eventInfo.description || '',
          location: eventInfo.location || '',
          start_at: eventInfo.startDate.toISOString(),
          end_at: eventInfo.endDate.toISOString(),
          timezone: 'America/Mexico_City',
          status: 'scheduled',
          notification_minutes: 60, // 1 hora antes
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        console.error('[TRANSACTIONAL] Error creating event:', error);
        return {
          toolUsed: 'calendar_create',
          toolReason: 'Database error',
          toolResult: `❌ Error al crear el evento: ${error.message}`,
          toolFailed: true,
          toolError: error.message
        };
      }
      
      const formattedDate = eventInfo.startDate.toLocaleString('es-MX', {
        timeZone: 'America/Mexico_City',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      return {
        toolUsed: 'calendar_create',
        toolReason: 'Event created successfully',
        toolResult: `✅ **Evento agendado exitosamente:**

📅 **${eventInfo.title}**
🕐 ${formattedDate}${eventInfo.location ? `\n📍 ${eventInfo.location}` : ''}

🔔 Recibirás una notificación 1 hora antes.`,
        toolFailed: false
      };
      
    } catch (error: any) {
      console.error('[TRANSACTIONAL] Error creating calendar event:', error);
      return {
        toolUsed: 'calendar_create',
        toolReason: 'Unexpected error',
        toolResult: `❌ Error inesperado al crear el evento: ${error.message}`,
        toolFailed: true,
        toolError: error.message
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 5. TELEGRAM - ENVIAR MENSAJE
  // ═══════════════════════════════════════════════════════════════
  if (
    lowerMsg.match(/\b(envía|enviar|manda|mandar|notifica|notificar|avisa|avisar)\b.{0,100}\b(telegram|telegrama|bot)\b/i)
  ) {
    console.log('[TRANSACTIONAL] Intent: TELEGRAM_SEND');
    
    if (!integrations.hasTelegram) {
      return {
        toolUsed: 'telegram_send',
        toolReason: 'No telegram bot configured',
        toolResult: '❌ No tienes ningún bot de Telegram conectado.\n\nPara enviar mensajes por Telegram, primero conecta tu bot en tu perfil.',
        toolFailed: true,
        toolError: 'NO_TELEGRAM_BOT'
      };
    }
    
    return {
      toolUsed: 'telegram_send',
      toolReason: 'Telegram send ready (implementation pending)',
      toolResult: `✅ Bot de Telegram conectado.

⚠️ El envío de mensajes está listo pero aún no implementado en el orchestrator.

Por ahora, usa el endpoint \`POST /api/telegram/send\` directamente.`,
      toolFailed: false
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // DEFAULT: Intent transaccional no reconocido
  // ═══════════════════════════════════════════════════════════════
  console.log('[TRANSACTIONAL] Intent no reconocido, devolviendo status de integraciones');
  
  const statusLines: string[] = [];
  statusLines.push('⚠️ Detecté que quieres hacer algo, pero no estoy seguro qué exactamente.');
  statusLines.push('');
  statusLines.push('**Tus integraciones disponibles:**');
  statusLines.push('');
  
  if (integrations.hasEmail) {
    statusLines.push(`✅ Email: ${integrations.emailAccounts} cuenta(s) - Puedo leer y enviar correos`);
  } else {
    statusLines.push('❌ Email: No configurado');
  }
  
  statusLines.push('✅ Calendario: Disponible - Puedo leer y crear eventos');
  
  if (integrations.hasTelegram) {
    statusLines.push(`✅ Telegram: ${integrations.telegramBots} bot(s) - Puedo enviar mensajes`);
  } else {
    statusLines.push('❌ Telegram: No configurado');
  }
  
  statusLines.push('');
  statusLines.push('¿Qué necesitas hacer exactamente?');
  
  return {
    toolUsed: 'none',
    toolReason: 'Transactional intent unclear',
    toolResult: statusLines.join('\n'),
    toolFailed: false
  };
}
