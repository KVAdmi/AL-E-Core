/**
 * =====================================================
 * CALENDAR TOOLS - Handlers para Tool Router
 * =====================================================
 * 
 * Herramientas:
 * - calendar_create_event: Crear evento en calendario
 * - calendar_update_event: Actualizar evento existente
 * - calendar_list_events: Listar eventos con filtros
 * 
 * IMPORTANTE:
 * - Crea notification_jobs automáticamente
 * - Valida ownership de eventos
 * - Maneja zonas horarias
 * =====================================================
 */

import { ToolResult } from '../registry';
import { supabase } from '../../db/supabase';

// ═══════════════════════════════════════════════════════════════
// CALENDAR CREATE EVENT
// ═══════════════════════════════════════════════════════════════

export interface CalendarCreateEventArgs {
  userId: string;
  title: string;
  startAt: string; // ISO 8601
  endAt: string; // ISO 8601
  location?: string;
  description?: string;
  attendees?: string[];
  notificationMinutes?: number; // Minutos antes para notificar (default: 60)
}

export async function calendarCreateEventHandler(
  args: CalendarCreateEventArgs
): Promise<ToolResult> {
  try {
    const {
      userId,
      title,
      startAt,
      endAt,
      location,
      description,
      attendees,
      notificationMinutes = 60
    } = args;

    console.log(`[CALENDAR TOOL] Creando evento - User: ${userId}, Title: ${title}`);

    // Validar fechas
    const start = new Date(startAt);
    const end = new Date(endAt);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return {
        success: false,
        error: 'INVALID_DATE',
        timestamp: new Date().toISOString(),
        provider: 'calendar',
        data: {
          message: 'Fechas inválidas. Usa formato ISO 8601.'
        }
      };
    }

    if (start >= end) {
      return {
        success: false,
        error: 'INVALID_TIME_RANGE',
        timestamp: new Date().toISOString(),
        provider: 'calendar',
        data: {
          message: 'La fecha de inicio debe ser anterior a la fecha de fin.'
        }
      };
    }

    // 1. Crear evento
    const { data: event, error: eventError } = await supabase
      .from('calendar_events')
      .insert({
        owner_user_id: userId,
        title,
        start_at: startAt,
        end_at: endAt,
        location: location || null,
        description: description || null,
        attendees: attendees || [],
        status: 'draft',
        notification_minutes: notificationMinutes
      })
      .select()
      .single();

    if (eventError) {
      console.error('[CALENDAR TOOL] Error creating event:', eventError);
      return {
        success: false,
        error: eventError.message,
        timestamp: new Date().toISOString(),
        provider: 'calendar'
      };
    }

    console.log(`[CALENDAR TOOL] ✓ Evento creado - ID: ${event.id}`);

    // 2. Crear notification job si aplica
    if (notificationMinutes > 0) {
      const runAt = new Date(start.getTime() - notificationMinutes * 60 * 1000);

      await supabase
        .from('notification_jobs')
        .insert({
          owner_user_id: userId,
          type: 'event_reminder',
          channel: 'telegram',
          run_at: runAt.toISOString(),
          status: 'pending',
          payload: {
            eventId: event.id,
            title: event.title,
            start_at: event.start_at,
            location: event.location
          }
        });

      console.log(`[CALENDAR TOOL] ✓ Notification job creado - Run at: ${runAt.toISOString()}`);
    }

    return {
      success: true,
      data: {
        event: {
          id: event.id,
          title: event.title,
          startAt: event.start_at,
          endAt: event.end_at,
          location: event.location,
          description: event.description,
          attendees: event.attendees,
          status: event.status,
          notificationMinutes: event.notification_minutes
        },
        notificationScheduled: notificationMinutes > 0
      },
      timestamp: new Date().toISOString(),
      provider: 'calendar',
      source: 'calendar_events'
    };

  } catch (error: any) {
    console.error('[CALENDAR TOOL] Error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'calendar'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR UPDATE EVENT
// ═══════════════════════════════════════════════════════════════

export interface CalendarUpdateEventArgs {
  userId: string;
  eventId: string;
  title?: string;
  startAt?: string;
  endAt?: string;
  location?: string;
  description?: string;
  status?: 'draft' | 'confirmed' | 'cancelled';
  attendees?: string[];
}

export async function calendarUpdateEventHandler(
  args: CalendarUpdateEventArgs
): Promise<ToolResult> {
  try {
    const { userId, eventId, ...updates } = args;

    console.log(`[CALENDAR TOOL] Actualizando evento - ID: ${eventId}`);

    // 1. Validar ownership
    const { data: existingEvent, error: fetchError } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('id', eventId)
      .eq('owner_user_id', userId)
      .single();

    if (fetchError || !existingEvent) {
      return {
        success: false,
        error: 'EVENT_NOT_FOUND',
        timestamp: new Date().toISOString(),
        provider: 'calendar',
        data: {
          message: 'Evento no encontrado o no pertenece al usuario.'
        }
      };
    }

    // 2. Validar fechas si se actualizan
    if (updates.startAt || updates.endAt) {
      const newStart = updates.startAt ? new Date(updates.startAt) : new Date(existingEvent.start_at);
      const newEnd = updates.endAt ? new Date(updates.endAt) : new Date(existingEvent.end_at);

      if (newStart >= newEnd) {
        return {
          success: false,
          error: 'INVALID_TIME_RANGE',
          timestamp: new Date().toISOString(),
          provider: 'calendar'
        };
      }
    }

    // 3. Actualizar evento
    const updatePayload: any = {
      ...updates,
      updated_at: new Date().toISOString()
    };

    // Renombrar campos para match DB
    if (updates.startAt) {
      updatePayload.start_at = updates.startAt;
      delete updatePayload.startAt;
    }
    if (updates.endAt) {
      updatePayload.end_at = updates.endAt;
      delete updatePayload.endAt;
    }

    const { data: updatedEvent, error: updateError } = await supabase
      .from('calendar_events')
      .update(updatePayload)
      .eq('id', eventId)
      .eq('owner_user_id', userId)
      .select()
      .single();

    if (updateError) {
      console.error('[CALENDAR TOOL] Error updating event:', updateError);
      return {
        success: false,
        error: updateError.message,
        timestamp: new Date().toISOString(),
        provider: 'calendar'
      };
    }

    console.log(`[CALENDAR TOOL] ✓ Evento actualizado - ID: ${eventId}`);

    return {
      success: true,
      data: {
        event: {
          id: updatedEvent.id,
          title: updatedEvent.title,
          startAt: updatedEvent.start_at,
          endAt: updatedEvent.end_at,
          location: updatedEvent.location,
          description: updatedEvent.description,
          attendees: updatedEvent.attendees,
          status: updatedEvent.status
        }
      },
      timestamp: new Date().toISOString(),
      provider: 'calendar',
      source: 'calendar_events'
    };

  } catch (error: any) {
    console.error('[CALENDAR TOOL] Error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'calendar'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR LIST EVENTS
// ═══════════════════════════════════════════════════════════════

export interface CalendarListEventsArgs {
  userId: string;
  dateFrom?: string; // ISO 8601
  dateTo?: string; // ISO 8601
  status?: 'draft' | 'confirmed' | 'cancelled';
  limit?: number;
}

export async function calendarListEventsHandler(
  args: CalendarListEventsArgs
): Promise<ToolResult> {
  try {
    const { userId, dateFrom, dateTo, status, limit = 50 } = args;

    console.log(`[CALENDAR TOOL] Listando eventos - User: ${userId}`);

    // Construir query
    let query = supabase
      .from('calendar_events')
      .select('*')
      .eq('owner_user_id', userId);

    if (dateFrom) {
      query = query.gte('start_at', dateFrom);
    }

    if (dateTo) {
      query = query.lte('start_at', dateTo);
    }

    if (status) {
      query = query.eq('status', status);
    }

    query = query.order('start_at', { ascending: true }).limit(limit);

    const { data: events, error } = await query;

    if (error) {
      console.error('[CALENDAR TOOL] Error listing events:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        provider: 'calendar'
      };
    }

    console.log(`[CALENDAR TOOL] ✓ ${events.length} eventos encontrados`);

    return {
      success: true,
      data: {
        events: events.map(e => ({
          id: e.id,
          title: e.title,
          startAt: e.start_at,
          endAt: e.end_at,
          location: e.location,
          description: e.description,
          attendees: e.attendees,
          status: e.status,
          notificationMinutes: e.notification_minutes,
          createdAt: e.created_at
        })),
        count: events.length
      },
      timestamp: new Date().toISOString(),
      provider: 'calendar',
      source: 'calendar_events'
    };

  } catch (error: any) {
    console.error('[CALENDAR TOOL] Error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'calendar'
    };
  }
}
