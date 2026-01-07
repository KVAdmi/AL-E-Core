/**
 * /api/events - Recibir eventos desde KUNNA
 * Autenticación: multiAppAuth middleware
 */
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { validateMultiAppAuth } from '../middleware/multiAppAuth';

const router = express.Router();

const ALLOWED_EVENT_TYPES = [
  'checkin_manual',
  'checkin_auto',
  'checkin_failed',
  'location_update',
  'route_started',
  'route_completed',
  'anomaly_detected',
  'risk_level_changed',
  'sos_manual',
  'sos_auto',
  'safe_confirmation',
];

/**
 * POST /api/events
 * Payload:
 * {
 *   "user_id": "uuid",
 *   "event_type": "checkin_failed",
 *   "timestamp": "2025-06-01T17:30:00Z",
 *   "metadata": { ... }
 * }
 */
router.post('/', validateMultiAppAuth, async (req, res) => {
  try {
    const { user_id, event_type, timestamp, metadata } = req.body;
    const { appId, workspaceId } = req as any;

    // Validar campos requeridos
    if (!user_id || !event_type || !timestamp) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['user_id', 'event_type', 'timestamp'],
      });
    }

    // Validar event_type permitido
    if (!ALLOWED_EVENT_TYPES.includes(event_type)) {
      return res.status(400).json({
        error: 'Invalid event_type',
        allowed: ALLOWED_EVENT_TYPES,
      });
    }

    // Validar formato de timestamp
    const eventDate = new Date(timestamp);
    if (isNaN(eventDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid timestamp format',
        expected: 'ISO 8601 (e.g., 2025-06-01T17:30:00Z)',
      });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Insertar evento en ae_events
    const { data, error } = await supabase
      .from('ae_events')
      .insert({
        workspace_id: workspaceId,
        app_id: appId,
        user_id,
        event_type,
        timestamp: eventDate.toISOString(),
        metadata: metadata || {},
      })
      .select('id')
      .single();

    if (error) {
      console.error('[POST /api/events] Error inserting event:', error);
      return res.status(500).json({ error: 'Failed to save event' });
    }

    console.log(`[POST /api/events] Event saved: ${data.id} (${event_type} for ${user_id})`);

    res.status(201).json({
      success: true,
      event_id: data.id,
      app_id: appId,
      workspace_id: workspaceId,
    });
  } catch (err: any) {
    console.error('[POST /api/events] Error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
