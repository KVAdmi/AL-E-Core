import express from 'express';
import { supabase } from '../db/supabase';
import { env } from '../config/env';
import { isUuid } from '../utils/helpers';

const router = express.Router();

// GET /api/sessions - Lista sesiones
router.get('/', async (req, res) => {
  try {
    const {
      workspaceId = env.defaultWorkspaceId,
      userId,
      mode
    } = req.query;
    
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({
        error: 'userId es requerido'
      });
    }
    
    console.log('[SESSIONS] Listando sesiones para userId:', userId, 'workspace:', workspaceId);
    
    let query = supabase
      .from('ae_sessions')
      .select('id, title, updated_at, last_message_at, total_messages, pinned, archived, mode, workspace_id, assistant_id')
      .eq('user_id_old', userId)
      .eq('workspace_id', workspaceId)
      .eq('archived', false);
    
    if (mode && typeof mode === 'string') {
      query = query.eq('mode', mode);
    }
    
    query = query.order('last_message_at', { ascending: false, nullsFirst: false });
    
    const { data, error } = await query;
    
    if (error) {
      console.error('[SESSIONS] Error obteniendo sesiones:', error);
      return res.status(500).json({ error: 'Error obteniendo sesiones' });
    }
    
    console.log('[SESSIONS] Sesiones encontradas:', data?.length || 0);
    
    res.json(data || []);
    
  } catch (error) {
    console.error('[SESSIONS] Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/sessions/:id/messages - Obtiene mensajes de una sesión
router.get('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId = env.defaultWorkspaceId } = req.query;
    
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'ID de sesión inválido' });
    }
    
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId es requerido' });
    }
    
    console.log('[SESSIONS] Obteniendo mensajes de sesión', id);
    
    const { data: session, error: sessionError } = await supabase
      .from('ae_sessions')
      .select('id, user_id_old, workspace_id')
      .eq('id', id)
      .single();
    
    if (sessionError || !session) {
      console.error('[SESSIONS] Sesión no encontrada:', sessionError);
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    
    if (session.user_id_old !== userId || session.workspace_id !== workspaceId) {
      console.warn('[SESSIONS] Acceso denegado: userId o workspace no coinciden');
      return res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    }
    
    const { data: messages, error: messagesError } = await supabase
      .from('ae_messages')
      .select('id, role, content, created_at, tokens, cost, metadata')
      .eq('session_id', id)
      .order('created_at', { ascending: true });
    
    if (messagesError) {
      console.error('[SESSIONS] Error obteniendo mensajes:', messagesError);
      return res.status(500).json({ error: 'Error obteniendo mensajes' });
    }
    
    console.log('[SESSIONS] Mensajes encontrados:', messages?.length || 0);
    
    res.json(messages || []);
    
  } catch (error) {
    console.error('[SESSIONS] Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// PATCH /api/sessions/:id - Actualiza sesión (pin, archive, title)
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      userId,
      workspaceId = env.defaultWorkspaceId,
      pinned,
      archived,
      title
    } = req.body;
    
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'ID de sesión inválido' });
    }
    
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId es requerido' });
    }
    
    console.log('[SESSIONS] Actualizando sesión', id);
    
    const { data: session, error: sessionError } = await supabase
      .from('ae_sessions')
      .select('id, user_id_old, workspace_id')
      .eq('id', id)
      .single();
    
    if (sessionError || !session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    
    if (session.user_id_old !== userId || session.workspace_id !== workspaceId) {
      return res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    }
    
    const updates: any = {
      updated_at: new Date().toISOString()
    };
    
    if (typeof pinned === 'boolean') {
      updates.pinned = pinned;
    }
    
    if (typeof archived === 'boolean') {
      updates.archived = archived;
    }
    
    if (title && typeof title === 'string') {
      updates.title = title;
    }
    
    const { data: updatedSession, error: updateError } = await supabase
      .from('ae_sessions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) {
      console.error('[SESSIONS] Error actualizando:', updateError);
      return res.status(500).json({ error: 'Error actualizando sesión' });
    }
    
    console.log('[SESSIONS] Sesión actualizada');
    
    res.json(updatedSession);
    
  } catch (error) {
    console.error('[SESSIONS] Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

// DELETE /api/sessions/:id - Soft delete
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, workspaceId = env.defaultWorkspaceId } = req.body;
    
    if (!isUuid(id)) {
      return res.status(400).json({ error: 'ID de sesión inválido' });
    }
    
    if (!userId) {
      return res.status(400).json({ error: 'userId es requerido' });
    }
    
    const { data: session, error: sessionError } = await supabase
      .from('ae_sessions')
      .select('id, user_id_old, workspace_id')
      .eq('id', id)
      .single();
    
    if (sessionError || !session) {
      return res.status(404).json({ error: 'Sesión no encontrada' });
    }
    
    if (session.user_id_old !== userId || session.workspace_id !== workspaceId) {
      return res.status(403).json({ error: 'No tienes acceso a esta sesión' });
    }
    
    const { error: deleteError } = await supabase
      .from('ae_sessions')
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);
    
    if (deleteError) {
      console.error('[SESSIONS] Error eliminando:', deleteError);
      return res.status(500).json({ error: 'Error eliminando sesión' });
    }
    
    console.log('[SESSIONS] Sesión archivada');
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('[SESSIONS] Error:', error);
    res.status(500).json({ error: 'Error interno' });
  }
});

export { router as sessionsRouter };
