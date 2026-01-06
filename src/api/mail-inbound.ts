/**
 * MAIL INBOUND API - DESHABILITADO
 * 
 * ❌ ESTADO: SES DESHABILITADO POR POLÍTICA DE SEGURIDAD
 * 
 * Este endpoint procesaba correos entrantes de AWS SES vía S3.
 * Ahora está bloqueado. Los correos personales van por IMAP directo.
 */

import express from 'express';
import { SES_BLOCKER } from '../utils/sesBlocker';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// BLOQUEO TOTAL - Todos los endpoints están deshabilitados
// ═══════════════════════════════════════════════════════════════

router.use(SES_BLOCKER.middleware);

router.post('/inbound/ses', async (req, res) => {
  SES_BLOCKER.log({
    endpoint: '/mail/inbound/ses',
    action: 'inbound_receive',
    reason: 'Intento de procesar inbound SES bloqueado'
  });

  return res.status(403).json({
    success: false,
    error: 'SES_DISABLED',
    message: SES_BLOCKER.message
  });
});

router.get('/messages', async (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'SES_DISABLED',
    message: 'Este endpoint procesaba correos SES. Usa /api/email/messages para correos IMAP.'
  });
});

export default router;
