/**
 * =====================================================
 * CALENDAR API - AL-E CORE (TRANSACCIONAL REAL)
 * =====================================================
 * 
 * Calendario 100% interno con EVIDENCIA OBLIGATORIA
 * 
 * REGLA DE HIERRO:
 * - SI NO HAY DB WRITE REAL → success = false
 * - SI NO HAY eventId REAL → success = false
 * - Cada endpoint devuelve formato transaccional
 * 
 * Endpoints:
 * - POST /api/calendar/events
 * - GET /api/calendar/events?from&to
 * - PATCH /api/calendar/events/:id
 * - DELETE /api/calendar/events/:id
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/calendar/events - Crear evento CON EVIDENCIA
// ═══════════════════════════════════════════════════════════════

router.post('/events', requireAuth, async (req, res) => {
  try {
    const {
      title,
      description,
      start_at,
      end_at,
      timezone,
      location,
      attendees,
      notification_minutes
    } = req.body;
    
    const userId = req.user?.id;
    
    // Validaciones obligatorias
    if (!title || !start_at || !end_at) {
      return res.status(400).json({
        success: false,
        action: 'calendar.create',
        evidence: null,
        userMessage: 'Faltan datos obligatorios: título, fecha de inicio y fecha de fin.',
        reason: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    console.log(`[CALENDAR] Creating event - User: ${userId}, Title: ${title}`);
    
    // ═══ TRANSACCIÓN REAL CON EVIDENCIA ═══
    const { data: newEvent, error } = await supabase
      .from('calendar_events')
      .insert({
        owner_user_id: userId,
        title,
        description: description || '',
        start_at,
        end_at,
        timezone: timezone || 'America/Mexico_City',
        location: location || '',
        attendees_json: attendees || [],
        status: 'scheduled',
        notification_minutes: notification_minutes || 60,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    // SI FALLA LA DB → success = false
    if (error || !newEvent || !newEvent.id) {
      console.error('[CALENDAR] ❌ DB WRITE FAILED:', error);
      return res.status(500).json({
        success: false,
        action: 'calendar.create',
        evidence: null,
        userMessage: 'No pude crear el evento en tu calendario.',
        reason: error?.message || 'NO_ID_RETURNED'
      });
    }
    
    // ✅ ÉXITO REAL CON EVIDENCIA
    console.log(`[CALENDAR] ✅ Event created with ID: ${newEvent.id}`);
    
    return res.status(201).json({
      success: true,
      action: 'calendar.create',
      evidence: {
        table: 'calendar_events',
        id: newEvent.id
      },
      userMessage: `Evento creado: ${title}`,
      event: newEvent
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] ❌ EXCEPTION:', error);
    return res.status(500).json({
      success: false,
      action: 'calendar.create',
      evidence: null,
      userMessage: 'No pude crear el evento en tu calendario.',
      reason: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/calendar/events - Listar eventos (CON FILTROS)
// ═══════════════════════════════════════════════════════════════

router.get('/events', requireAuth, async (req, res) => {
  try {
    const { from, to, status } = req.query;
    const userId = req.user?.id;
    
    console.log(`[CALENDAR] Listing events - User: ${userId}, From: ${from}, To: ${to}`);
    
    let query = supabase
      .from('calendar_events')
      .select('*')
      .eq('owner_user_id', userId);
    
    // Filtros opcionales
    if (from) {
      query = query.gte('start_at', from as string);
    }
    if (to) {
      query = query.lte('start_at', to as string);
    }
    if (status) {
      query = query.eq('status', status as string);
    } else {
      // Por defecto, solo eventos activos
      query = query.neq('status', 'cancelled');
    }
    
    query = query.order('start_at', { ascending: true });
    
    const { data: events, error } = await query;
    
    if (error) {
      console.error('[CALENDAR] ❌ DB READ FAILED:', error);
      return res.status(500).json({
        success: false,
        action: 'calendar.list',
        evidence: null,
        userMessage: 'No pude obtener tus eventos.',
        reason: error.message
      });
    }
    
    console.log(`[CALENDAR] ✅ Events retrieved: ${events?.length || 0}`);
    
    return res.json({
      success: true,
      action: 'calendar.list',
      evidence: {
        table: 'calendar_events',
        count: events?.length || 0
      },
      userMessage: `${events?.length || 0} evento(s) encontrado(s).`,
      events: events || []
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] ❌ EXCEPTION:', error);
    return res.status(500).json({
      success: false,
      action: 'calendar.list',
      evidence: null,
      userMessage: 'No pude obtener tus eventos.',
      reason: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/calendar/events/:id - Obtener evento específico
// ═══════════════════════════════════════════════════════════════

router.get('/events/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    
    const { data: event, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('id', id)
      .eq('owner_user_id', userId)
      .single();
    
    if (error || !event) {
      return res.status(404).json({
        success: false,
        action: 'calendar.get',
        evidence: null,
        userMessage: 'Evento no encontrado.',
        reason: 'EVENT_NOT_FOUND'
      });
    }
    
    return res.json({
      success: true,
      action: 'calendar.get',
      evidence: {
        table: 'calendar_events',
        id: event.id
      },
      userMessage: 'Evento encontrado.',
      event
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] ❌ EXCEPTION:', error);
    return res.status(500).json({
      success: false,
      action: 'calendar.get',
      evidence: null,
      userMessage: 'No pude obtener el evento.',
      reason: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/calendar/events/:id - Actualizar evento CON EVIDENCIA
// ═══════════════════════════════════════════════════════════════

router.patch('/events/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const updates: any = {};
    
    // Campos actualizables
    const allowedFields = [
      'title', 'description', 'start_at', 'end_at', 
      'timezone', 'location', 'attendees_json', 'status',
      'notification_minutes'
    ];
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        action: 'calendar.update',
        evidence: null,
        userMessage: 'No se proporcionaron campos para actualizar.',
        reason: 'NO_UPDATES'
      });
    }
    
    updates.updated_at = new Date().toISOString();
    
    console.log(`[CALENDAR] Updating event - ID: ${id}, User: ${userId}`);
    
    // ═══ TRANSACCIÓN REAL CON EVIDENCIA ═══
    const { data: updatedEvent, error } = await supabase
      .from('calendar_events')
      .update(updates)
      .eq('id', id)
      .eq('owner_user_id', userId)
      .select()
      .single();
    
    // SI FALLA LA DB → success = false
    if (error || !updatedEvent) {
      console.error('[CALENDAR] ❌ DB UPDATE FAILED:', error);
      return res.status(404).json({
        success: false,
        action: 'calendar.update',
        evidence: null,
        userMessage: 'No pude actualizar el evento.',
        reason: error?.message || 'EVENT_NOT_FOUND'
      });
    }
    
    // ✅ ÉXITO REAL CON EVIDENCIA
    console.log(`[CALENDAR] ✅ Event updated: ${id}`);
    
    return res.json({
      success: true,
      action: 'calendar.update',
      evidence: {
        table: 'calendar_events',
        id: updatedEvent.id
      },
      userMessage: 'Evento actualizado correctamente.',
      event: updatedEvent
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] ❌ EXCEPTION:', error);
    return res.status(500).json({
      success: false,
      action: 'calendar.update',
      evidence: null,
      userMessage: 'No pude actualizar el evento.',
      reason: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/calendar/events/:id - Cancelar evento CON EVIDENCIA
// ═══════════════════════════════════════════════════════════════

router.delete('/events/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    
    console.log(`[CALENDAR] Cancelling event - ID: ${id}, User: ${userId}`);
    
    // ═══ TRANSACCIÓN REAL CON EVIDENCIA ═══
    const { data: cancelledEvent, error } = await supabase
      .from('calendar_events')
      .update({ 
        status: 'cancelled', 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .eq('owner_user_id', userId)
      .select()
      .single();
    
    // SI FALLA LA DB → success = false
    if (error || !cancelledEvent) {
      console.error('[CALENDAR] ❌ DB UPDATE FAILED:', error);
      return res.status(404).json({
        success: false,
        action: 'calendar.delete',
        evidence: null,
        userMessage: 'No pude cancelar el evento.',
        reason: error?.message || 'EVENT_NOT_FOUND'
      });
    }
    
    // ✅ ÉXITO REAL CON EVIDENCIA
    console.log(`[CALENDAR] ✅ Event cancelled: ${id}`);
    
    return res.json({
      success: true,
      action: 'calendar.delete',
      evidence: {
        table: 'calendar_events',
        id: cancelledEvent.id
      },
      userMessage: 'Evento cancelado correctamente.',
      event: cancelledEvent
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] ❌ EXCEPTION:', error);
    return res.status(500).json({
      success: false,
      action: 'calendar.delete',
      evidence: null,
      userMessage: 'No pude cancelar el evento.',
      reason: error.message
    });
  }
});

export default router;
