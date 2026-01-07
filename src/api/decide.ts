/**
 * /api/decide - Aplicar reglas determinísticas y devolver acciones recomendadas
 * Autenticación: multiAppAuth middleware
 */
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { validateMultiAppAuth } from '../middleware/multiAppAuth';
import { evaluateRules, EventContext } from '../services/ruleEngine';

const router = express.Router();

/**
 * POST /api/decide
 * Payload:
 * {
 *   "user_id": "uuid",
 *   "event_id": "uuid" (opcional),
 *   "context": {
 *     "current_risk_level": "alert",
 *     "last_checkin_at": "2025-06-01T15:00:00Z",
 *     "inactivity_minutes": 250
 *   }
 * }
 * 
 * Response:
 * {
 *   "actions": [
 *     {
 *       "type": "alert_trust_circle",
 *       "priority": 1,
 *       "reason": "rule:inactivity_plus_risk",
 *       "payload": { ... }
 *     }
 *   ],
 *   "decision_id": "uuid"
 * }
 */
router.post('/', validateMultiAppAuth, async (req, res) => {
  try {
    const { user_id, event_id, context } = req.body;
    const { appId, workspaceId } = req as any;

    // Validar campos requeridos
    if (!user_id) {
      return res.status(400).json({
        error: 'Missing required field: user_id',
      });
    }

    if (!context || typeof context !== 'object') {
      return res.status(400).json({
        error: 'Missing or invalid field: context',
        expected: 'object with optional fields: current_risk_level, last_checkin_at, inactivity_minutes',
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Obtener evento actual si existe event_id
    let currentEvent = null;
    if (event_id) {
      const { data: evt } = await supabase
        .from('ae_events')
        .select('*')
        .eq('id', event_id)
        .single();
      currentEvent = evt;
    }

    // Obtener eventos recientes (últimas 24 horas)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentEvents } = await supabase
      .from('ae_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user_id)
      .gte('timestamp', yesterday)
      .order('timestamp', { ascending: false });

    // Preparar contexto para rule engine
    const eventContext: EventContext = {
      user_id,
      event_id,
      current_risk_level: context.current_risk_level,
      last_checkin_at: context.last_checkin_at,
      inactivity_minutes: context.inactivity_minutes,
      recent_events: recentEvents || [],
    };

    // Ejecutar rule engine
    const actions = evaluateRules(eventContext, currentEvent, recentEvents || []);

    // Guardar decisión en ae_decisions
    const { data: decision, error: decisionError } = await supabase
      .from('ae_decisions')
      .insert({
        workspace_id: workspaceId,
        app_id: appId,
        user_id,
        event_id: event_id || null,
        actions: actions.map(a => ({
          type: a.type,
          priority: a.priority,
          reason: a.reason,
          payload: a.payload,
        })),
      })
      .select('id')
      .single();

    if (decisionError) {
      console.error('[POST /api/decide] Error saving decision:', decisionError);
      // No bloqueamos respuesta, solo logueamos
    }

    console.log(`[POST /api/decide] Decision for user ${user_id}: ${actions.length} actions`);

    res.status(200).json({
      success: true,
      actions,
      decision_id: decision?.id || null,
      workspace_id: workspaceId,
      app_id: appId,
    });
  } catch (err: any) {
    console.error('[POST /api/decide] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
