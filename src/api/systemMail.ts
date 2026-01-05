/**
 * =====================================================
 * SYSTEM MAIL API - AWS SES ONLY
 * =====================================================
 * 
 * PROPÓSITO:
 * Endpoint EXCLUSIVO para correos transaccionales del sistema
 * enviados por Amazon SES.
 * 
 * REGLAS ABSOLUTAS:
 * 1. SOLO correos del sistema (@al-eon.com, @infinitykode.com)
 * 2. SOLO tipos transaccionales (password_reset, email_verification, etc.)
 * 3. PROHIBIDO enviar correos de usuarios (esos van por /api/mail/send)
 * 4. Validación estricta con sesValidation.ts
 * 5. Logs obligatorios de auditoría
 * 
 * NO USAR ESTE ENDPOINT PARA:
 * - Correos de usuarios con cuentas conectadas
 * - Envíos "en nombre de" usuarios
 * - Marketing o newsletters
 * - Cualquier cosa que no sea transaccional del sistema
 * =====================================================
 */

import express from 'express';
import { 
  validateSESAbsoluteRules, 
  blockUserEmailsInSES,
  canUseSES,
  recordValidation,
  logBlockedSESAttempt,
  getSystemSender,
  SES_SIMULATOR,
  ALLOWED_EMAIL_TYPES
} from '../utils/sesValidation';
import nodemailer from 'nodemailer';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/system/mail/send - Enviar correo del sistema via SES
// ═══════════════════════════════════════════════════════════════

router.post('/send', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { 
      type,        // Tipo de correo (OBLIGATORIO, debe estar en ALLOWED_EMAIL_TYPES)
      to,          // Destinatario(s)
      subject,     // Asunto
      text,        // Cuerpo en texto plano
      html,        // Cuerpo HTML (opcional)
      userId,      // Usuario que dispara el correo (para logs)
      workspaceId  // Workspace del usuario (para logs)
    } = req.body;
    
    // ═══════════════════════════════════════════════════════════
    // VALIDACIÓN 1: Campos obligatorios
    // ═══════════════════════════════════════════════════════════
    
    if (!type || !to || !subject || !text) {
      console.error('[SYSTEM MAIL] ❌ Campos faltantes:', { type, to, subject, hasText: !!text });
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: type, to, subject, text'
      });
    }
    
    // ═══════════════════════════════════════════════════════════
    // VALIDACIÓN 2: Tipo de correo permitido
    // ═══════════════════════════════════════════════════════════
    
    if (!ALLOWED_EMAIL_TYPES.includes(type as any)) {
      console.error('[SYSTEM MAIL] ❌ Tipo no permitido:', type);
      logBlockedSESAttempt({
        userId,
        from: 'system',
        to,
        reason: `INVALID_TYPE: ${type}`,
        provider: 'SES'
      });
      
      return res.status(403).json({
        success: false,
        error: 'INVALID_EMAIL_TYPE',
        message: `Tipo '${type}' no permitido. SES solo para: ${ALLOWED_EMAIL_TYPES.join(', ')}`
      });
    }
    
    // ═══════════════════════════════════════════════════════════
    // OBTENER REMITENTE DEL SISTEMA
    // ═══════════════════════════════════════════════════════════
    
    const sender = getSystemSender(type as any);
    const from = sender.email;
    const fromName = sender.name;
    
    console.log('[SYSTEM MAIL] 📧 Enviando:', {
      type,
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      userId,
      workspaceId
    });
    
    // ═══════════════════════════════════════════════════════════
    // VALIDACIÓN 3: REGLAS ABSOLUTAS SES
    // ═══════════════════════════════════════════════════════════
    
    // Bloquear si intenta usar accountId (correo de usuario)
    const blockCheck = blockUserEmailsInSES({
      provider: 'SES',
      from,
      accountId: undefined // System mail NUNCA tiene accountId
    });
    
    if (blockCheck.blocked) {
      console.error('[SYSTEM MAIL] 🚫 Bloqueado por REGLA ABSOLUTA:', blockCheck.reason);
      logBlockedSESAttempt({
        userId,
        from,
        to,
        reason: blockCheck.reason!,
        provider: 'SES'
      });
      
      return res.status(403).json({
        success: false,
        error: 'SES_RULE_VIOLATION',
        message: blockCheck.reason
      });
    }
    
    // Validar dominio + tipo
    const validation = validateSESAbsoluteRules({
      from,
      to,
      type
    });
    
    if (!validation.valid) {
      console.error('[SYSTEM MAIL] 🚫 Validación SES falló:', validation.error);
      logBlockedSESAttempt({
        userId,
        from,
        to,
        reason: validation.error!,
        provider: 'SES'
      });
      
      return res.status(403).json({
        success: false,
        error: 'SES_VALIDATION_FAILED',
        message: validation.error
      });
    }
    
    // ═══════════════════════════════════════════════════════════
    // VALIDACIÓN 4: canUseSES (supresión, rate limit, etc.)
    // ═══════════════════════════════════════════════════════════
    
    const recipients = Array.isArray(to) ? to : [to];
    for (const recipient of recipients) {
      const sesCheck = canUseSES(type, recipient);
      
      recordValidation(sesCheck);
      
      if (!sesCheck.allowed) {
        console.error('[SYSTEM MAIL] 🚫 SES check falló para:', recipient, sesCheck.reason);
        logBlockedSESAttempt({
          userId,
          from,
          to: recipient,
          reason: sesCheck.reason,
          provider: 'SES'
        });
        
        return res.status(403).json({
          success: false,
          error: sesCheck.reason,
          message: sesCheck.details || 'Email no permitido para SES'
        });
      }
    }
    
    // ═══════════════════════════════════════════════════════════
    // ENVIAR EMAIL VIA SES
    // ═══════════════════════════════════════════════════════════
    
    const transporter = nodemailer.createTransport({
      host: process.env.SES_SMTP_HOST || 'email-smtp.us-east-1.amazonaws.com',
      port: parseInt(process.env.SES_SMTP_PORT || '587'),
      secure: false, // TLS
      auth: {
        user: process.env.SES_SMTP_USER,
        pass: process.env.SES_SMTP_PASSWORD
      }
    });
    
    const mailOptions = {
      from: `"${fromName}" <${from}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html: html || text,
      headers: {
        'X-Email-Type': type,
        'X-User-Id': userId || 'system',
        'X-Workspace-Id': workspaceId || 'none'
      }
    };
    
    const info = await transporter.sendMail(mailOptions);
    
    const duration = Date.now() - startTime;
    
    console.log('[SYSTEM MAIL] ✅ Enviado exitosamente:', {
      messageId: info.messageId,
      type,
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      duration: `${duration}ms`
    });
    
    // ═══════════════════════════════════════════════════════════
    // RESPUESTA EXITOSA
    // ═══════════════════════════════════════════════════════════
    
    return res.json({
      success: true,
      messageId: info.messageId,
      provider: 'SES',
      from,
      to: recipients,
      type,
      duration
    });
    
  } catch (error: any) {
    const duration = Date.now() - startTime;
    
    console.error('[SYSTEM MAIL] ❌ Error:', {
      error: error.message,
      code: error.code,
      duration: `${duration}ms`
    });
    
    return res.status(500).json({
      success: false,
      error: error.code || 'SES_ERROR',
      message: `Error enviando correo: ${error.message}`
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/system/mail/simulator - Emails de prueba SES
// ═══════════════════════════════════════════════════════════════

router.get('/simulator', async (req, res) => {
  return res.json({
    success: true,
    simulator: SES_SIMULATOR,
    instructions: {
      description: 'Usa estos emails para testing sin afectar reputación de SES',
      emails: {
        SUCCESS: {
          email: SES_SIMULATOR.SUCCESS,
          description: 'Simula envío exitoso'
        },
        BOUNCE: {
          email: SES_SIMULATOR.BOUNCE,
          description: 'Simula hard bounce'
        },
        COMPLAINT: {
          email: SES_SIMULATOR.COMPLAINT,
          description: 'Simula complaint (spam report)'
        },
        SUPPRESSION: {
          email: SES_SIMULATOR.SUPPRESSION,
          description: 'Simula email en lista de supresión'
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/system/mail/types - Tipos de correo permitidos
// ═══════════════════════════════════════════════════════════════

router.get('/types', async (req, res) => {
  return res.json({
    success: true,
    allowedTypes: ALLOWED_EMAIL_TYPES,
    description: 'Tipos de correo transaccional permitidos para SES',
    examples: {
      password_reset: {
        from: 'seguridad@al-eon.com',
        type: 'password_reset',
        to: 'user@example.com',
        subject: 'Restablecer contraseña',
        text: 'Haz clic en el enlace para restablecer...'
      },
      email_verification: {
        from: 'verificacion@al-eon.com',
        type: 'email_verification',
        to: 'user@example.com',
        subject: 'Verifica tu email',
        text: 'Haz clic para verificar tu cuenta...'
      }
    }
  });
});

export default router;
