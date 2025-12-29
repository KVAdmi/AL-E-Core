/**
 * =====================================================
 * MAIL SEND/INBOX API - AL-E CORE
 * =====================================================
 * 
 * Envío y recepción de emails via SMTP/IMAP
 * Reemplaza Gmail API send/read
 * 
 * Endpoints:
 * - POST /api/mail/send - Enviar email
 * - GET /api/mail/inbox - Leer emails (IMAP)
 * - GET /api/mail/threads - Listar hilos
 * - GET /api/mail/messages - Listar mensajes
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { decrypt } from '../utils/encryption';
import nodemailer from 'nodemailer';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/send - Enviar email por SMTP
// ═══════════════════════════════════════════════════════════════

router.post('/send', async (req, res) => {
  try {
    const {
      ownerUserId,
      accountId,
      to,
      subject,
      text,
      html,
      cc,
      bcc
    } = req.body;
    
    // Validaciones
    if (!ownerUserId || !accountId || !to || !subject || !text) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: ownerUserId, accountId, to, subject, text'
      });
    }
    
    console.log(`[MAIL] Enviando email - User: ${ownerUserId}, To: ${Array.isArray(to) ? to.join(', ') : to}`);
    
    // Obtener cuenta de email
    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('owner_user_id', ownerUserId)
      .eq('is_active', true)
      .single();
    
    if (accountError || !account) {
      return res.status(404).json({
        ok: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta de email no encontrada o inactiva'
      });
    }
    
    // Desencriptar password SMTP
    const smtpPass = decrypt(account.smtp_pass_enc);
    
    // Crear transporter de Nodemailer
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure,
      auth: {
        user: account.smtp_user,
        pass: smtpPass
      }
    });
    
    // Preparar destinatarios
    const toArray = Array.isArray(to) ? to : [to];
    const ccArray = cc ? (Array.isArray(cc) ? cc : [cc]) : undefined;
    const bccArray = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined;
    
    // Enviar email
    let sendResult;
    let providerMessageId;
    let status = 'sent';
    let errorText = null;
    
    try {
      sendResult = await transporter.sendMail({
        from: `"${account.from_name}" <${account.from_email}>`,
        to: toArray.join(', '),
        cc: ccArray?.join(', '),
        bcc: bccArray?.join(', '),
        subject,
        text,
        html: html || undefined
      });
      
      providerMessageId = sendResult.messageId;
      console.log(`[MAIL] ✓ Email enviado - Message ID: ${providerMessageId}`);
      
    } catch (error: any) {
      console.error('[MAIL] ✗ Error enviando email:', error);
      status = 'failed';
      errorText = error.message;
    }
    
    // Guardar en DB
    const { data: message, error: dbError } = await supabase
      .from('mail_messages')
      .insert({
        owner_user_id: ownerUserId,
        account_id: accountId,
        direction: 'outbound',
        from_email: account.from_email,
        to_emails_json: toArray,
        cc_json: ccArray || null,
        bcc_json: bccArray || null,
        subject,
        text_body: text,
        html_body: html || null,
        provider_message_id: providerMessageId || null,
        status,
        error_text: errorText
      })
      .select()
      .single();
    
    if (dbError) {
      console.error('[MAIL] Warning: Email sent but failed to save to DB:', dbError);
    }
    
    if (status === 'failed') {
      return res.status(500).json({
        ok: false,
        error: 'SMTP_ERROR',
        message: 'Error enviando email',
        details: errorText
      });
    }
    
    return res.json({
      ok: true,
      message: 'Email enviado exitosamente',
      messageId: providerMessageId,
      sent: {
        to: toArray,
        subject,
        from: account.from_email
      }
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/inbox - Leer inbox por IMAP
// ═══════════════════════════════════════════════════════════════

router.get('/inbox', async (req, res) => {
  try {
    const { ownerUserId, accountId, maxResults } = req.query;
    
    // Feature flag
    const IMAP_ENABLED = process.env.ENABLE_IMAP !== 'false';
    
    if (!IMAP_ENABLED) {
      return res.status(501).json({
        ok: false,
        error: 'IMAP_NOT_ENABLED',
        message: 'Lectura de inbox por IMAP no está habilitada aún'
      });
    }
    
    if (!ownerUserId || !accountId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_PARAMS',
        message: 'ownerUserId y accountId son requeridos'
      });
    }
    
    console.log(`[MAIL] Leyendo inbox - User: ${ownerUserId}, Account: ${accountId}`);
    
    // Obtener cuenta
    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('owner_user_id', ownerUserId)
      .eq('is_active', true)
      .single();
    
    if (accountError || !account) {
      return res.status(404).json({
        ok: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    // Verificar que IMAP esté configurado
    if (!account.imap_host || !account.imap_user || !account.imap_pass_enc) {
      return res.status(400).json({
        ok: false,
        error: 'IMAP_NOT_CONFIGURED',
        message: 'Esta cuenta no tiene IMAP configurado'
      });
    }
    
    // Desencriptar password IMAP
    const imapPass = decrypt(account.imap_pass_enc);
    
    // Conectar a IMAP
    const imap = new Imap({
      user: account.imap_user,
      password: imapPass,
      host: account.imap_host,
      port: account.imap_port || 993,
      tls: account.imap_secure !== false,
      tlsOptions: { rejectUnauthorized: false }
    });
    
    const emails: any[] = [];
    const limit = maxResults ? parseInt(maxResults as string) : 10;
    
    await new Promise<void>((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Obtener últimos N mensajes
          const totalMessages = box.messages.total;
          const start = Math.max(1, totalMessages - limit + 1);
          const end = totalMessages;
          
          if (totalMessages === 0) {
            imap.end();
            resolve();
            return;
          }
          
          const fetch = imap.seq.fetch(`${start}:${end}`, {
            bodies: ['HEADER', 'TEXT'],
            struct: true
          });
          
          fetch.on('message', (msg, seqno) => {
            let buffer = '';
            
            msg.on('body', (stream, info) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });
            
            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                
                emails.push({
                  id: seqno,
                  from: parsed.from?.text || 'Unknown',
                  to: parsed.to?.text || '',
                  subject: parsed.subject || '(Sin asunto)',
                  text: parsed.text?.substring(0, 500) || '',
                  date: parsed.date?.toISOString() || new Date().toISOString(),
                  snippet: parsed.text?.substring(0, 150) || ''
                });
              } catch (error) {
                console.error('[MAIL] Error parsing email:', error);
              }
            });
          });
          
          fetch.once('error', (err) => {
            reject(err);
          });
          
          fetch.once('end', () => {
            imap.end();
            resolve();
          });
        });
      });
      
      imap.once('error', (err) => {
        reject(err);
      });
      
      imap.connect();
      
      // Timeout de 10 segundos
      setTimeout(() => {
        imap.end();
        reject(new Error('IMAP connection timeout'));
      }, 10000);
    });
    
    console.log(`[MAIL] ✓ Leídos ${emails.length} emails`);
    
    return res.json({
      ok: true,
      emails: emails.reverse(), // Más recientes primero
      count: emails.length
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error reading inbox:', error);
    return res.status(500).json({
      ok: false,
      error: 'IMAP_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/messages - Listar mensajes del usuario
// ═══════════════════════════════════════════════════════════════

router.get('/messages', async (req, res) => {
  try {
    const { ownerUserId, limit } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_OWNER_USER_ID',
        message: 'ownerUserId es requerido'
      });
    }
    
    const { data, error } = await supabase
      .from('mail_messages')
      .select('*')
      .eq('owner_user_id', ownerUserId)
      .order('created_at', { ascending: false })
      .limit(limit ? parseInt(limit as string) : 50);
    
    if (error) {
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      ok: true,
      messages: data || []
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

export default router;
