/**
 * API de Notificaciones
 * Endpoint para programar notificaciones (Telegram, Email, etc.)
 */

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * POST /api/notifications/schedule
 * Programar una notificación
 */
router.post('/schedule', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      type,
      channel,
      run_at,
      payload
    } = req.body;

    // Validar campos requeridos
    if (!type || !channel || !run_at || !payload) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['type', 'channel', 'run_at', 'payload']
      });
    }

    // Validar que run_at sea una fecha futura
    const runAtDate = new Date(run_at);
    if (isNaN(runAtDate.getTime())) {
      return res.status(400).json({ error: 'Invalid run_at date' });
    }

    if (runAtDate <= new Date()) {
      return res.status(400).json({ error: 'run_at must be in the future' });
    }

    // Crear notification_job
    const { data: job, error: dbError } = await supabase
      .from('notification_jobs')
      .insert({
        owner_user_id: user.id,
        type,
        channel,
        status: 'pending',
        run_at: runAtDate.toISOString(),
        payload,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[NOTIFICATIONS] Error creating job:', dbError);
      return res.status(500).json({ 
        error: 'Failed to schedule notification',
        detail: dbError.message 
      });
    }

    console.log(`[NOTIFICATIONS] ✅ Notificación programada: ${job.id} - Type: ${type}, Run at: ${run_at}`);

    return res.json({
      success: true,
      jobId: job.id,
      run_at: job.run_at,
      message: 'Notification scheduled successfully',
    });
  } catch (error: any) {
    console.error('[NOTIFICATIONS] Error in /schedule:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/notifications/pending
 * Obtener notificaciones pendientes del usuario
 */
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: jobs, error: dbError } = await supabase
      .from('notification_jobs')
      .select('*')
      .eq('owner_user_id', user.id)
      .eq('status', 'pending')
      .order('run_at', { ascending: true });

    if (dbError) {
      console.error('[NOTIFICATIONS] Error fetching pending jobs:', dbError);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    return res.json({
      success: true,
      notifications: jobs || [],
    });
  } catch (error: any) {
    console.error('[NOTIFICATIONS] Error in /pending:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/notifications/:id
 * Cancelar una notificación programada
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verificar que el job pertenece al usuario
    const { data: job } = await supabase
      .from('notification_jobs')
      .select('*')
      .eq('id', id)
      .eq('owner_user_id', user.id)
      .single();

    if (!job) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    // Actualizar status a cancelled
    const { error: updateError } = await supabase
      .from('notification_jobs')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (updateError) {
      console.error('[NOTIFICATIONS] Error cancelling job:', updateError);
      return res.status(500).json({ error: 'Failed to cancel notification' });
    }

    console.log(`[NOTIFICATIONS] ❌ Notificación cancelada: ${id}`);

    return res.json({
      success: true,
      message: 'Notification cancelled successfully',
    });
  } catch (error: any) {
    console.error('[NOTIFICATIONS] Error in DELETE /:id:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
