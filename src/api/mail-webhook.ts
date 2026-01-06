/**
 * =====================================================
 * MAIL WEBHOOK API - COMPLETAMENTE DESHABILITADO
 * =====================================================
 * 
 * ❌ ESTADO: SES DESHABILITADO POR POLÍTICA DE SEGURIDAD
 * 
 * CONTEXTO:
 * Los webhooks de AWS SES están bloqueados mientras AL-E
 * está en construcción. No se procesarán notificaciones.
 * 
 * PROHIBICIONES:
 * ❌ NO recibir webhooks SES
 * ❌ NO procesar SNS notifications
 * ❌ NO descargar de S3
 * ❌ NO procesar correos inbound vía SES
 * 
 * Los correos personales se procesan vía:
 * - Gmail API (IMAP)
 * - Outlook API (Microsoft Graph)
 * =====================================================
 */

import express from 'express';
import { SES_BLOCKER } from '../utils/sesBlocker';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// BLOQUEO TOTAL - Todas las rutas están deshabilitadas
// ═══════════════════════════════════════════════════════════════

router.use(SES_BLOCKER.middleware);

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/webhook/ses - ENDPOINT DESHABILITADO
// ═══════════════════════════════════════════════════════════════

router.post('/webhook/ses', async (req, res) => {
  SES_BLOCKER.log({
    endpoint: '/api/mail/webhook/ses',
    action: 'webhook_receive',
    reason: 'Intento de procesar webhook SES bloqueado'
  });

  return res.status(403).json({
    success: false,
    error: 'SES_DISABLED',
    message: SES_BLOCKER.message
  });
});

export default router;
