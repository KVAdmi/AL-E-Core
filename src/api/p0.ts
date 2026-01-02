/**
 * =====================================================
 * P0 VALIDATION ENDPOINT - INTERNAL TESTING
 * =====================================================
 * 
 * Endpoint interno para pruebas P0 sin dependencia del frontend
 * Usa service role key para bypass de auth
 * 
 * NO EXPONER EN PRODUCCIÓN SIN RATE LIMITING
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import nodemailer from 'nodemailer';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/p0/mail/test - Test endpoint con service role
// ═══════════════════════════════════════════════════════════════

router.post('/mail/test', async (req, res) => {
  try {
    // Validar service role key
    const authHeader = req.headers.authorization;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!authHeader || authHeader !== `Bearer ${serviceRoleKey}`) {
      console.error('[P0] ❌ Unauthorized - Invalid service role key');
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Service role key required for P0 validation'
      });
    }
    
    console.log('[P0] ✅ Service role authenticated');
    
    // Parámetros de prueba
    const { to, subject, body } = req.body;
    
    // Defaults para prueba rápida
    const testTo = to || 'p.garibay@infinitykode.com';
    const testSubject = subject || `P0 Validation Test - AWS SES - ${new Date().toISOString()}`;
    const testBody = body || `Correo de prueba P0 - Evidencia técnica\n\nTimestamp: ${new Date().toISOString()}\nEndpoint: /api/p0/mail/test\nProvider: AWS SES\n\nEste correo valida la integración real de AWS SES con auditoría completa.`;
    
    console.log('[P0] 📧 Test parameters:');
    console.log(`[P0] To: ${testTo}`);
    console.log(`[P0] Subject: ${testSubject}`);
    
    // Verificar configuración SMTP
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const emailFrom = process.env.EMAIL_FROM_DEFAULT || 'notificaciones@al-eon.com';
    const emailFromName = process.env.EMAIL_FROM_NAME || 'AL-E';
    
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPass) {
      console.error('[P0] ❌ SMTP not configured');
      return res.status(500).json({
        success: false,
        error: 'SMTP_NOT_CONFIGURED',
        message: 'SMTP environment variables missing'
      });
    }
    
    console.log('[P0] ✅ SMTP configured');
    console.log(`[P0] Host: ${smtpHost}:${smtpPort}`);
    console.log(`[P0] From: ${emailFromName} <${emailFrom}>`);
    
    // Crear transporter
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });
    
    // Enviar correo REAL
    console.log('[P0] 📤 Sending email via AWS SES...');
    const startTime = Date.now();
    
    const info = await transporter.sendMail({
      from: `"${emailFromName}" <${emailFrom}>`,
      to: testTo,
      subject: testSubject,
      text: testBody
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`[P0] ✅ Email sent in ${elapsed}ms`);
    console.log(`[P0] Message ID: ${info.messageId}`);
    console.log(`[P0] Response: ${info.response}`);
    
    // P0 CRÍTICO: Validar messageId
    if (!info.messageId) {
      console.error('[P0] ❌ NO MESSAGE ID');
      return res.status(500).json({
        success: false,
        error: 'NO_MESSAGE_ID',
        message: 'AWS SES did not return message ID'
      });
    }
    
    // Registrar en audit log
    console.log('[P0] 💾 Recording in email_audit_log...');
    const { data: auditLog, error: auditError } = await supabase
      .from('email_audit_log')
      .insert({
        to: testTo,
        from: emailFrom,
        subject: testSubject,
        body_text: testBody,
        body_html: null,
        provider: 'aws_ses',
        provider_message_id: info.messageId,
        status: 'sent',
        sent_by_user_id: null, // P0 test, no user
        sent_at: new Date().toISOString()
      })
      .select('id, provider_message_id, sent_at')
      .single();
    
    if (auditError || !auditLog) {
      console.error('[P0] ❌ Audit log failed:', auditError);
      return res.status(500).json({
        success: false,
        error: 'AUDIT_LOG_FAILED',
        message: 'Email sent but audit log failed',
        messageId: info.messageId
      });
    }
    
    console.log(`[P0] ✅ Audit log created: ${auditLog.id}`);
    
    // SUCCESS - Retornar evidencia completa
    return res.status(200).json({
      success: true,
      test: 'P0_MAIL_VALIDATION',
      evidence: {
        table: 'email_audit_log',
        id: auditLog.id,
        provider_message_id: auditLog.provider_message_id,
        sent_at: auditLog.sent_at
      },
      details: {
        to: testTo,
        from: emailFrom,
        subject: testSubject,
        provider: 'aws_ses',
        elapsed_ms: elapsed
      },
      verification: {
        inbox_check: `Verify email received at: ${testTo}`,
        supabase_query: `SELECT * FROM email_audit_log WHERE id = '${auditLog.id}'`
      },
      messageId: info.messageId
    });
    
  } catch (error: any) {
    console.error('[P0] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SMTP_ERROR',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export default router;
