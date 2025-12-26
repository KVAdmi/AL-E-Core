/**
 * Profile API - User Personalization
 * 
 * Gestiona preferencias de identidad del usuario:
 * - preferred_name: Cómo quiere que le diga la IA
 * - assistant_name: Nombre de su asistente
 * - tone_pref: Preferencia de tono
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

/**
 * GET /api/profile/me
 * 
 * Obtiene perfil del usuario autenticado
 * Fuente de verdad para personalización
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user_uuid = req.user!.id;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('user_id, email, display_name, role, preferred_name, assistant_name, tone_pref, avatar_url, theme')
      .eq('user_id', user_uuid)
      .single();

    if (error || !data) {
      console.error('[PROFILE] Error fetching profile:', error);
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Perfil no encontrado'
      });
    }

    console.log(`[PROFILE] ✓ Profile loaded: ${data.display_name || 'N/A'}`);

    res.json({
      user_uuid: data.user_id,
      email: data.email,
      display_name: data.display_name,
      role: data.role,
      preferred_name: data.preferred_name,
      assistant_name: data.assistant_name || 'Luma',
      tone_pref: data.tone_pref || 'barrio',
      avatar_url: data.avatar_url,
      theme: data.theme
    });

  } catch (err: any) {
    console.error('[PROFILE] Unexpected error in GET /me:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error al obtener perfil'
    });
  }
});

/**
 * PATCH /api/profile/me
 * 
 * Actualiza preferencias de personalización
 * Solo campos permitidos: preferred_name, assistant_name, tone_pref
 */
router.patch('/me', requireAuth, async (req, res) => {
  try {
    const user_uuid = req.user!.id;
    const { preferred_name, assistant_name, tone_pref } = req.body;

    // Validaciones
    const updates: any = {};

    if (preferred_name !== undefined) {
      const trimmed = String(preferred_name).trim();
      if (trimmed.length < 2 || trimmed.length > 30) {
        return res.status(400).json({
          error: 'INVALID_PREFERRED_NAME',
          message: 'preferred_name debe tener entre 2 y 30 caracteres'
        });
      }
      // Solo letras, números, espacios, guiones
      if (!/^[a-zA-Z0-9\s\-áéíóúñÁÉÍÓÚÑ]+$/.test(trimmed)) {
        return res.status(400).json({
          error: 'INVALID_PREFERRED_NAME',
          message: 'preferred_name solo puede contener letras, números, espacios y guiones'
        });
      }
      updates.preferred_name = trimmed;
    }

    if (assistant_name !== undefined) {
      const trimmed = String(assistant_name).trim();
      if (trimmed.length < 2 || trimmed.length > 30) {
        return res.status(400).json({
          error: 'INVALID_ASSISTANT_NAME',
          message: 'assistant_name debe tener entre 2 y 30 caracteres'
        });
      }
      if (!/^[a-zA-Z0-9\s\-áéíóúñÁÉÍÓÚÑ]+$/.test(trimmed)) {
        return res.status(400).json({
          error: 'INVALID_ASSISTANT_NAME',
          message: 'assistant_name solo puede contener letras, números, espacios y guiones'
        });
      }
      updates.assistant_name = trimmed;
    }

    if (tone_pref !== undefined) {
      const validTones = ['barrio', 'pro', 'neutral'];
      if (!validTones.includes(tone_pref)) {
        return res.status(400).json({
          error: 'INVALID_TONE',
          message: `tone_pref debe ser: ${validTones.join(', ')}`
        });
      }
      updates.tone_pref = tone_pref;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        error: 'NO_UPDATES',
        message: 'No se proporcionaron campos para actualizar'
      });
    }

    // Update
    const { data, error } = await supabase
      .from('user_profiles')
      .update(updates)
      .eq('user_id', user_uuid)
      .select()
      .single();

    if (error) {
      console.error('[PROFILE] Error updating profile:', error);
      return res.status(500).json({
        error: 'DB_ERROR',
        message: 'Error al actualizar perfil'
      });
    }

    console.log(`[PROFILE] ✓ Profile updated: ${JSON.stringify(updates)}`);

    res.json({
      success: true,
      profile: {
        user_uuid: data.user_id,
        display_name: data.display_name,
        preferred_name: data.preferred_name,
        assistant_name: data.assistant_name,
        tone_pref: data.tone_pref
      }
    });

  } catch (err: any) {
    console.error('[PROFILE] Unexpected error in PATCH /me:', err);
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Error al actualizar perfil'
    });
  }
});

export default router;
