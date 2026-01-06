/**
 * =====================================================
 * SYSTEM MAIL API - COMPLETAMENTE DESHABILITADO
 * =====================================================
 * 
 * ❌ ESTADO: SES DESHABILITADO POR POLÍTICA DE SEGURIDAD
 * 
 * CONTEXTO:
 * Amazon SES está completamente bloqueado mientras AL-E
 * está en construcción. Este endpoint NO debe usarse.
 * 
 * Los correos personales deben ir por:
 * - Gmail API (/api/mail/send con provider=gmail)
 * - Outlook API (/api/mail/send con provider=outlook)
 * 
 * PROHIBICIONES:
 * ❌ NO enviar correos vía SES
 * ❌ NO usar SMTP de SES
 * ❌ NO procesar webhooks SES
 * ❌ NO reply/forward automático
 * ❌ NO destinatarios dinámicos
 * 
 * CRITERIO DE REACTIVACIÓN:
 * Solo con aprobación explícita + whitelist de destinatarios
 * =====================================================
 */

import express from 'express';
import { SES_BLOCKER } from '../utils/sesBlocker';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// BLOQUEO TOTAL - Middleware aplicado a todas las rutas
// ═══════════════════════════════════════════════════════════════

router.use(SES_BLOCKER.middleware);

// ═══════════════════════════════════════════════════════════════
// POST /api/system/mail/send - ENDPOINT DESHABILITADO
// ═══════════════════════════════════════════════════════════════

router.post('/send', async (req, res) => {
  // El middleware ya bloqueó la petición
  // Este código nunca debería ejecutarse si ENABLE_SES=false
  SES_BLOCKER.log({
    endpoint: '/api/system/mail/send',
    userId: req.body?.userId,
    action: 'send_email',
    reason: 'Intento de envío bloqueado por sesBlocker'
  });

  return res.status(403).json({
    success: false,
    error: 'SES_DISABLED',
    message: SES_BLOCKER.message
  });
});

// ═══════════════════════════════════════════════════════════════
// TODAS las demás rutas están bloqueadas por el middleware
// ═══════════════════════════════════════════════════════════════

router.get('/simulator', (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'SES_DISABLED',
    message: SES_BLOCKER.message
  });
});

router.get('/types', (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'SES_DISABLED',
    message: SES_BLOCKER.message
  });
});

router.get('/config', (req, res) => {
  return res.status(403).json({
    success: false,
    error: 'SES_DISABLED',
    message: SES_BLOCKER.message
  });
});

export default router;

