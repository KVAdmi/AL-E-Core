/**
 * Google Calendar Service
 * 
 * EJECUCIÓN REAL de Google Calendar API (NO stub)
 * CRÍTICO: Si el usuario tiene Calendar conectado, EJECUTAR sin preguntar
 */

import { google } from 'googleapis';
import { getSupabaseClient } from '../db/supabase';

export interface CalendarReadResult {
  success: boolean;
  error?: string;
  message: string;
  events?: Array<{
    id: string;
    summary: string;
    start: string;
    end: string;
    meet_link?: string;
  }>;
}

export interface CalendarCreateResult {
  success: boolean;
  error?: string;
  message: string;
  event_id?: string;
  meet_link?: string;
}

/**
 * Obtener cliente OAuth2 autenticado del usuario
 */
async function getAuthenticatedClient(userId: string) {
  const supabase = getSupabaseClient();
  
  console.log(`[CALENDAR] 🔍 Looking for OAuth tokens - userId: ${userId}`);
  
  // Obtener tokens de Supabase (buscar calendar, google, o google-calendar)
  const { data: tokenData, error } = await supabase
    .from('user_integrations')
    .select('access_token, refresh_token, expires_at, integration_type')
    .eq('user_id', userId)
    .or('integration_type.eq.calendar,integration_type.eq.google,integration_type.eq.google-calendar')
    .single();
  
  console.log(`[CALENDAR] 🔍 Query result - found: ${!!tokenData}, integration_type: ${tokenData?.integration_type || 'N/A'}, error: ${error?.message || 'none'}`);
  
  if (error || !tokenData) {
    console.log(`[CALENDAR] ❌ OAuth tokens not found for user: ${userId}`);
    throw new Error('OAUTH_NOT_CONNECTED');
  }
  
  console.log(`[CALENDAR] ✅ OAuth tokens found for user: ${userId}`);
  
  // CRÍTICO: Verificar que access_token NO esté NULL o vacío
  if (!tokenData.access_token || tokenData.access_token.trim() === '') {
    console.log(`[CALENDAR] ❌ CRITICAL: access_token is NULL or empty - Integration record exists but tokens are missing`);
    throw new Error('OAUTH_TOKENS_MISSING');
  }
  
  if (!tokenData.refresh_token || tokenData.refresh_token.trim() === '') {
    console.log(`[CALENDAR] ⚠️ WARNING: refresh_token is NULL or empty`);
  }
  
  // Verificar si el token expiró (expires_at es timestamp de Supabase)
  if (tokenData.expires_at) {
    const expiresAtDate = new Date(tokenData.expires_at);
    const now = new Date();
    
    if (expiresAtDate < now) {
      console.log(`[CALENDAR] ⚠️ Token expired at ${tokenData.expires_at}`);
      // TODO: Implementar refresh token
      throw new Error('OAUTH_TOKEN_EXPIRED');
    }
  }
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token
  });
  
  return oauth2Client;
}

/**
 * Leer eventos del calendario
 * 
 * EJECUCIÓN REAL - NO preguntar, EJECUTAR
 */
export async function readCalendar(
  userId: string,
  startDate?: Date,
  endDate?: Date
): Promise<CalendarReadResult> {
  try {
    console.log('[CALENDAR] � readCalendar - Executing real API call...');
    
    const auth = await getAuthenticatedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth });
    
    // Default: próximos 7 días
    const timeMin = startDate || new Date();
    const timeMax = endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 20
    });
    
    const items = response.data.items || [];
    
    if (items.length === 0) {
      return {
        success: true,
        message: 'No tienes eventos próximos.',
        events: []
      };
    }
    
    const events = items.map(event => ({
      id: event.id!,
      summary: event.summary || '(sin título)',
      start: event.start?.dateTime || event.start?.date || '',
      end: event.end?.dateTime || event.end?.date || '',
      meet_link: event.hangoutLink
    }));
    
    console.log(`[CALENDAR] ✅ Found ${events.length} events`);
    
    return {
      success: true,
      message: `Tienes ${events.length} evento${events.length > 1 ? 's' : ''} próximo${events.length > 1 ? 's' : ''}.`,
      events
    };
    
  } catch (error: any) {
    console.error('[CALENDAR] ❌ Error:', error.message);
    
    if (error.message === 'OAUTH_NOT_CONNECTED') {
      return {
        success: false,
        error: 'OAUTH_NOT_CONNECTED',
        message: 'No tienes Google Calendar conectado. Necesitas autorizar AL-E en tu perfil primero.'
      };
    }
    
    if (error.message === 'OAUTH_TOKEN_EXPIRED') {
      return {
        success: false,
        error: 'OAUTH_TOKEN_EXPIRED',
        message: 'Tu sesión de Google Calendar expiró. Por favor, reconecta tu cuenta en el perfil.'
      };
    }
    
    return {
      success: false,
      error: 'CALENDAR_API_ERROR',
      message: `Error al leer calendario: ${error.message}`
    };
  }
}

/**
 * Crear evento en calendario
 * 
 * EJECUCIÓN REAL - NO preguntar, EJECUTAR
 * IMPORTANTE: Crea Google Meet automáticamente
 */
export async function createCalendarEvent(
  userId: string,
  title: string,
  startTime: Date,
  endTime: Date,
  description?: string,
  location?: string
): Promise<CalendarCreateResult> {
  try {
    console.log('[CALENDAR] � createCalendarEvent - Executing real API call...');
    
    const auth = await getAuthenticatedClient(userId);
    const calendar = google.calendar({ version: 'v3', auth });
    
    const event = {
      summary: title,
      description,
      location,
      start: {
        dateTime: startTime.toISOString(),
        timeZone: 'America/Mexico_City' // TODO: Obtener timezone del usuario
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: 'America/Mexico_City'
      },
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' }
        }
      }
    };
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      conferenceDataVersion: 1 // Necesario para crear Meet
    });
    
    const meetLink = response.data.hangoutLink;
    
    console.log(`[CALENDAR] ✅ Created event - ID: ${response.data.id}, Meet: ${meetLink}`);
    
    return {
      success: true,
      message: `Listo. Agendé "${title}" y añadí un enlace de Google Meet.`,
      event_id: response.data.id,
      meet_link: meetLink
    };
    
  } catch (error: any) {
    console.error('[CALENDAR] ❌ Error:', error.message);
    
    if (error.message === 'OAUTH_NOT_CONNECTED') {
      return {
        success: false,
        error: 'OAUTH_NOT_CONNECTED',
        message: 'No tienes Google Calendar conectado. Necesitas autorizar AL-E en tu perfil primero.'
      };
    }
    
    return {
      success: false,
      error: 'CALENDAR_CREATE_ERROR',
      message: `Error al crear evento: ${error.message}`
    };
  }
}
