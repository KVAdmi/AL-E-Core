/**
 * Memory API - Explicit Memory System
 * 
 * Guardar y leer memorias explícitas (acuerdos/decisiones/hechos)
 * con validación de seguridad y ownership.
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabase';
import { requireAuth, optionalAuth } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/memory/save
 * 
 * Guarda memoria explícita (acuerdo/decisión/hecho)
 * REQUIERE JWT para ambos scopes (user y project)
 */
router.post('/save', requireAuth, async (req, res) => {
  try {
    const {
      workspaceId = 'al-eon',
      scope, // 'user' | 'project'
      scope_id,
      type, // 'agreement' | 'decision' | 'fact' | 'preference'
      content,
      importance = 3
    } = req.body;

    // Validaciones básicas
    if (!scope || !['user', 'project'].includes(scope)) {
      return res.status(400).json({
        error: 'INVALID_SCOPE',
        message: 'scope debe ser "user" o "project"'
      });
    }

    if (!type || !['agreement', 'decision', 'fact', 'preference'].includes(type)) {
      return res.status(400).json({
        error: 'INVALID_TYPE',
        message: 'type debe ser: agreement, decision, fact, preference'
      });
    }

    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({
        error: 'INVALID_CONTENT',
        message: 'content es requerido y debe ser texto'
      });
    }

    if (scope === 'project' && (!scope_id || scope_id.trim().length === 0)) {
      return res.status(400).json({
        error: 'INVALID_SCOPE_ID',
        message: 'scope_id es requerido para scope=project'
      });
    }

    // 🔒 SEGURIDAD: owner siempre viene del JWT
    const owner_user_uuid = req.user!.id;

    // Para scope=user, scope_id es el mismo user_uuid
    const finalScopeId = scope === 'user' ? owner_user_uuid : scope_id;

    // Insertar en assistant_memories (schema real: id, workspace_id, user_id_old, mode, memory, importance, created_at, user_id_uuid, user_id)
    const { data, error } = await supabase
      .from('assistant_memories')
      .insert({
        workspace_id: workspaceId,
        user_id: owner_user_uuid, // UUID string
        user_id_uuid: owner_user_uuid, // UUID para queries
        mode: 'universal',
        memory: `[${type}] ${content.trim()}`, // Guardar tipo y contenido en memory
        importance: Math.min(Math.max(parseFloat(importance as any) || 1.0, 0.0), 1.0) // Float entre 0-1
      })
      .select()
      .single();

    if (error) {
      console.error('[MEMORY] Error saving memory:', error);
      return res.status(500).json({
        error: 'DB_ERROR',
        message: 'Error al guardar memoria',
        detail: error.message
      });
    }

    // 🔒 LOG OBLIGATORIO (sin PII)
    console.log(`[MEMORY] memory_save { scope: ${scope}, scope_id: ${finalScopeId}, type: ${type}, importance: ${importance}, workspace_id: ${workspaceId}, owner_user_uuid: ${owner_user_uuid} }`);

    res.json({
      success: true,
      memory: {
        id: data.id,
        scope,
        scope_id: finalScopeId,
        type,
        content: data.summary,
        importance: data.importance,
        created_at: data.created_at
      }
    });

  } catch (err: any) {
    console.error('[MEMORY] Unexpected error in /save:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error interno al guardar memoria'
    });
  }
});

/**
 * GET /api/memory/context
 * 
 * Recupera memorias relevantes para inyectar en prompt
 * Filtra por scope y ownership automáticamente
 */
router.get('/context', requireAuth, async (req, res) => {
  try {
    const {
      workspaceId = 'al-eon',
      scope = 'project', // 'user' | 'project'
      scope_id,
      limit = '10'
    } = req.query;

    if (!scope || !['user', 'project'].includes(scope as string)) {
      return res.status(400).json({
        error: 'INVALID_SCOPE',
        message: 'scope debe ser "user" o "project"'
      });
    }

    // 🔒 SEGURIDAD: siempre usar user del JWT
    const owner_user_uuid = req.user!.id;

    // Para scope=user, ignorar scope_id del query
    const finalScopeId = scope === 'user' ? owner_user_uuid : (scope_id as string);

    if (scope === 'project' && !finalScopeId) {
      return res.status(400).json({
        error: 'INVALID_SCOPE_ID',
        message: 'scope_id es requerido para scope=project'
      });
    }

    // Query con filtros de seguridad
    const { data, error } = await supabase
      .from('assistant_memories')
      .select('id, type, summary, importance, created_at, metadata')
      .eq('workspace_id', workspaceId)
      .contains('metadata', { scope, scope_id: finalScopeId })
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(parseInt(limit as string));

    if (error) {
      console.error('[MEMORY] Error fetching memories:', error);
      return res.status(500).json({
        error: 'DB_ERROR',
        message: 'Error al recuperar memorias',
        detail: error.message
      });
    }

    // 🔒 LOG OBLIGATORIO
    console.log(`[MEMORY] memory_context { scope: ${scope}, scope_id: ${finalScopeId}, returned_count: ${data?.length || 0}, workspace_id: ${workspaceId}, owner_user_uuid: ${owner_user_uuid} }`);

    res.json({
      memories: (data || []).map(m => ({
        id: m.id,
        type: m.type,
        content: m.summary,
        importance: m.importance,
        created_at: m.created_at,
        scope: m.metadata?.scope,
        scope_id: m.metadata?.scope_id
      }))
    });

  } catch (err: any) {
    console.error('[MEMORY] Unexpected error in /context:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error interno al recuperar memorias'
    });
  }
});

/**
 * DELETE /api/memory/:id
 * 
 * Elimina una memoria (solo el owner puede eliminarla)
 */
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const owner_user_uuid = req.user!.id;

    // Verificar ownership
    const { data: memory, error: fetchError } = await supabase
      .from('assistant_memories')
      .select('id, metadata')
      .eq('id', id)
      .single();

    if (fetchError || !memory) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Memoria no encontrada'
      });
    }

    // Verificar que el usuario sea el owner
    if (memory.metadata?.owner_user_uuid !== owner_user_uuid) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'No tienes permiso para eliminar esta memoria'
      });
    }

    // Eliminar
    const { error: deleteError } = await supabase
      .from('assistant_memories')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('[MEMORY] Error deleting memory:', deleteError);
      return res.status(500).json({
        error: 'DB_ERROR',
        message: 'Error al eliminar memoria'
      });
    }

    console.log(`[MEMORY] memory_deleted { id: ${id}, owner_user_uuid: ${owner_user_uuid} }`);

    res.json({ success: true });

  } catch (err: any) {
    console.error('[MEMORY] Unexpected error in DELETE:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error interno al eliminar memoria'
    });
  }
});

export default router;
