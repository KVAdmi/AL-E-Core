/**
 * =====================================================
 * CALENDAR API - AL-E CORE
 * =====================================================
 * 
 * Calendario 100% interno de AL-E
 * Reemplaza Google Calendar API
 * 
 * Endpoints:
 * - POST /api/calendar/events - Crear evento
 * - GET /api/calendar/events - Listar eventos
 * - GET /api/calendar/events/:id - Obtener evento
 * - PATCH /api/calendar/events/:id - Actualizar evento
 * - DELETE /api/calendar/events/:id - Cancelar evento
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/calendar/events - Crear evento
// ═══════════════════════════════════════════════════════════════

router.post('/events', async (req, res) => {
  try {
    const {
      ownerUserId,
      title,
      description,
      startAt,
      endAt,
      timezone,
      location,
      attendees
    } = req.body;
    
    // Validaciones
    if (!ownerUserId || !title || !startAt || !endAt) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: ownerUserId, title, startAt, endAt'
      });
    }
    
    console.log(`[CALENDAR] Creando evento - User: ${ownerUserId}, Title: ${title}`);
    
    // Insertar evento
    const { data, error } = await supabase
      .from('calendar_events')
      .insert({
        owner_user_id: ownerUserId,
        title,
        description: description || null,
        start_at: startAt,
        end_at: endAt,
        timezone: timezone || 'America/Mexico_City',
        location: location || null,
        attendees_json: attendees || [],
        status: 'scheduled'
      })
      .select()
      .single();
    
    if (error) {
      console.error('[CALENDAR] Error creating event:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    console.log(`[CALENDAR] ✓ Evento creado: ${data.id}`);
    
    return res.json({
      ok: true,
      message: 'Evento creado exitosamente',
      event: data
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/calendar/events - Listar eventos
// ═══════════════════════════════════════════════════════════════

router.get('/events', async (req, res) => {
  try {
    const { ownerUserId, from, to, status } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_OWNER_USER_ID',
        message: 'ownerUserId es requerido'
      });
    }
    
    let query = supabase
      .from('calendar_events')
      .select('*')
      .eq('owner_user_id', ownerUserId);
    
    // Filtros opcionales
    if (from) {
      query = query.gte('start_at', from);
    }
    if (to) {
      query = query.lte('start_at', to);
    }
    if (status) {
      query = query.eq('status', status);
    } else {
      // Por defecto, solo eventos activos
      query = query.neq('status', 'cancelled');
    }
    
    query = query.order('start_at', { ascending: true });
    
    const { data, error } = await query;
    
    if (error) {
      console.error('[CALENDAR] Error fetching events:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      ok: true,
      events: data || [],
      count: data?.length || 0
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/calendar/events/:id - Obtener evento específico
// ═══════════════════════════════════════════════════════════════

router.get('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('calendar_events')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error || !data) {
      return res.status(404).json({
        ok: false,
        error: 'EVENT_NOT_FOUND',
        message: 'Evento no encontrado'
      });
    }
    
    return res.json({
      ok: true,
      event: data
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/calendar/events/:id - Actualizar evento
// ═══════════════════════════════════════════════════════════════

router.patch('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates: any = {};
    
    // Campos actualizables
    const allowedFields = [
      'title', 'description', 'start_at', 'end_at', 
      'timezone', 'location', 'attendees_json', 'status'
    ];
    
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'NO_UPDATES',
        message: 'No se proporcionaron campos para actualizar'
      });
    }
    
    updates.updated_at = new Date().toISOString();
    
    const { data, error } = await supabase
      .from('calendar_events')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error || !data) {
      return res.status(404).json({
        ok: false,
        error: 'EVENT_NOT_FOUND',
        message: 'Evento no encontrado'
      });
    }
    
    console.log(`[CALENDAR] ✓ Evento actualizado: ${id}`);
    
    return res.json({
      ok: true,
      message: 'Evento actualizado exitosamente',
      event: data
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/calendar/events/:id - Cancelar evento
// ═══════════════════════════════════════════════════════════════

router.delete('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('calendar_events')
      .update({ 
        status: 'cancelled', 
        updated_at: new Date().toISOString() 
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error || !data) {
      return res.status(404).json({
        ok: false,
        error: 'EVENT_NOT_FOUND',
        message: 'Evento no encontrado'
      });
    }
    
    console.log(`[CALENDAR] ✓ Evento cancelado: ${id}`);
    
    return res.json({
      ok: true,
      message: 'Evento cancelado exitosamente',
      event: data
    });
    
  } catch (error: any) {
    console.error('[CALENDAR] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

export default router;
