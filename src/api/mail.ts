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
// GET /api/email/inbox/:accountId - Leer inbox por IMAP (FRONTEND)
// ═══════════════════════════════════════════════════════════════

router.get('/inbox/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const { folder = 'INBOX', limit = 50, unreadOnly = 'false' } = req.query;
    
    // Obtener userId del session (asumiendo auth middleware)
    const ownerUserId = (req as any).user?.id;
    
    if (!ownerUserId) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Usuario no autenticado'
      });
    }
    
    // Feature flag
    const IMAP_ENABLED = process.env.ENABLE_IMAP !== 'false';
    
    if (!IMAP_ENABLED) {
      return res.status(501).json({
        success: false,
        error: 'IMAP_NOT_ENABLED',
        message: 'Lectura de inbox por IMAP no está habilitada aún'
      });
    }
    
    console.log(`[MAIL] Leyendo inbox - User: ${ownerUserId}, Account: ${accountId}, Folder: ${folder}`);
    
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
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    // Verificar que IMAP esté configurado
    if (!account.imap_host || !account.imap_user || !account.imap_pass_enc) {
      return res.status(400).json({
        success: false,
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
    
    const messages: any[] = [];
    const maxResults = parseInt(limit as string);
    let totalCount = 0;
    let unreadCount = 0;
    
    await new Promise<void>((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox(folder as string, true, (err, box) => {
          if (err) {
            reject(err);
            return;
          }
          
          totalCount = box.messages.total;
          
          if (totalCount === 0) {
            imap.end();
            resolve();
            return;
          }
          
          // Determinar rango de mensajes
          const start = Math.max(1, totalCount - maxResults + 1);
          const end = totalCount;
          
          // Construir criterios de búsqueda
          const searchCriteria = unreadOnly === 'true' ? ['UNSEEN'] : ['ALL'];
          
          imap.search(searchCriteria, (err, results) => {
            if (err) {
              reject(err);
              return;
            }
            
            if (results.length === 0) {
              imap.end();
              resolve();
              return;
            }
            
            unreadCount = box.messages.unseen || 0;
            
            // Limitar resultados
            const messageIds = results.slice(-maxResults);
            
            const fetch = imap.fetch(messageIds, {
              bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)', 'TEXT'],
              struct: true
            });
            
            fetch.on('message', (msg, seqno) => {
              let headers: any = {};
              let body = '';
              let attributes: any = {};
              
              msg.on('body', (stream, info) => {
                let buffer = '';
                stream.on('data', (chunk) => {
                  buffer += chunk.toString('utf8');
                });
                stream.once('end', () => {
                  if (info.which.includes('HEADER')) {
                    headers = Imap.parseHeader(buffer);
                  } else {
                    body = buffer;
                  }
                });
              });
              
              msg.once('attributes', (attrs) => {
                attributes = attrs;
              });
              
              msg.once('end', async () => {
                try {
                  const parsed = await simpleParser(Buffer.concat([
                    Buffer.from(Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\n')),
                    Buffer.from('\n\n'),
                    Buffer.from(body)
                  ]));
                  
                  const fromAddr = parsed.from?.value?.[0];
                  const bodyText = parsed.text || '';
                  const bodyPreview = bodyText.substring(0, 150).replace(/\n/g, ' ');
                  
                  messages.push({
                    id: `msg_${seqno}`,
                    uid: attributes.uid,
                    from: fromAddr?.address || 'unknown',
                    fromName: fromAddr?.name || fromAddr?.address || 'Unknown',
                    to: parsed.to?.value?.map((t: any) => t.address) || [],
                    subject: parsed.subject || '(Sin asunto)',
                    body: bodyText,
                    bodyPreview,
                    date: parsed.date?.toISOString() || new Date().toISOString(),
                    isRead: !attributes.flags?.includes('\\Seen'),
                    hasAttachments: parsed.attachments && parsed.attachments.length > 0,
                    attachments: parsed.attachments?.map((att: any) => ({
                      filename: att.filename,
                      contentType: att.contentType,
                      size: att.size
                    })) || []
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
      });
      
      imap.once('error', (err) => {
        reject(err);
      });
      
      imap.connect();
      
      // Timeout de 15 segundos
      setTimeout(() => {
        imap.end();
        reject(new Error('IMAP connection timeout'));
      }, 15000);
    });
    
    console.log(`[MAIL] ✓ Leídos ${messages.length} emails (Total: ${totalCount}, Unread: ${unreadCount})`);
    
    return res.json({
      success: true,
      messages: messages.reverse(), // Más recientes primero
      total: totalCount,
      unreadCount
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error reading inbox:', error);
    return res.status(500).json({
      success: false,
      error: 'IMAP_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/inbox - Leer inbox por IMAP (LEGACY - DEPRECADO)
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

// ═══════════════════════════════════════════════════════════════
// POST /api/email/reply - Responder email
// ═══════════════════════════════════════════════════════════════

router.post('/reply', async (req, res) => {
  try {
    const {
      ownerUserId,
      accountId,
      originalMessageId,
      to,
      subject,
      text,
      html
    } = req.body;
    
    if (!ownerUserId || !accountId || !to || !text) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'Campos requeridos: ownerUserId, accountId, to, text'
      });
    }
    
    // Preparar subject con Re:
    const replySubject = subject?.startsWith('Re:') ? subject : `Re: ${subject || 'Sin asunto'}`;
    
    // Reutilizar lógica de /send
    const sendPayload = {
      ownerUserId,
      accountId,
      to: Array.isArray(to) ? to : [to],
      subject: replySubject,
      text,
      html
    };
    
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
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    const smtpPass = decrypt(account.smtp_pass_enc);
    
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure,
      auth: {
        user: account.smtp_user,
        pass: smtpPass
      }
    });
    
    const toArray = Array.isArray(to) ? to : [to];
    let providerMessageId;
    let status = 'sent';
    let errorText = null;
    
    try {
      const sendResult = await transporter.sendMail({
        from: `"${account.from_name}" <${account.from_email}>`,
        to: toArray.join(', '),
        subject: replySubject,
        text,
        html: html || undefined,
        inReplyTo: originalMessageId,
        references: originalMessageId
      });
      
      providerMessageId = sendResult.messageId;
      console.log(`[MAIL] ✓ Reply enviado - Message ID: ${providerMessageId}`);
      
    } catch (error: any) {
      console.error('[MAIL] ✗ Error enviando reply:', error);
      status = 'failed';
      errorText = error.message;
    }
    
    // Guardar en DB
    await supabase
      .from('mail_messages')
      .insert({
        owner_user_id: ownerUserId,
        account_id: accountId,
        direction: 'outbound',
        from_email: account.from_email,
        to_emails_json: toArray,
        subject: replySubject,
        text_body: text,
        html_body: html || null,
        provider_message_id: providerMessageId || null,
        status,
        error_text: errorText
      });
    
    if (status === 'failed') {
      return res.status(500).json({
        success: false,
        error: 'SMTP_ERROR',
        message: 'Error enviando respuesta',
        details: errorText
      });
    }
    
    return res.json({
      success: true,
      message: 'Respuesta enviada exitosamente',
      messageId: providerMessageId
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in reply:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/email/message/:messageUid - Borrar email
// ═══════════════════════════════════════════════════════════════

router.delete('/message/:accountId/:messageUid', async (req, res) => {
  try {
    const { accountId, messageUid } = req.params;
    const ownerUserId = (req as any).user?.id;
    
    if (!ownerUserId) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED'
      });
    }
    
    console.log(`[MAIL] Borrando mensaje - Account: ${accountId}, UID: ${messageUid}`);
    
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
        success: false,
        error: 'ACCOUNT_NOT_FOUND'
      });
    }
    
    if (!account.imap_host || !account.imap_user || !account.imap_pass_enc) {
      return res.status(400).json({
        success: false,
        error: 'IMAP_NOT_CONFIGURED'
      });
    }
    
    const imapPass = decrypt(account.imap_pass_enc);
    
    // Conectar a IMAP y marcar como deleted
    const imap = new Imap({
      user: account.imap_user,
      password: imapPass,
      host: account.imap_host,
      port: account.imap_port || 993,
      tls: account.imap_secure !== false,
      tlsOptions: { rejectUnauthorized: false }
    });
    
    await new Promise<void>((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Marcar como deleted y expunge
          imap.addFlags([messageUid], '\\Deleted', (err) => {
            if (err) {
              reject(err);
              return;
            }
            
            imap.expunge((err) => {
              if (err) {
                reject(err);
                return;
              }
              
              imap.end();
              resolve();
            });
          });
        });
      });
      
      imap.once('error', (err) => {
        reject(err);
      });
      
      imap.connect();
      
      setTimeout(() => {
        imap.end();
        reject(new Error('IMAP timeout'));
      }, 10000);
    });
    
    console.log(`[MAIL] ✓ Mensaje borrado`);
    
    return res.json({
      success: true,
      message: 'Email borrado exitosamente'
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error deleting message:', error);
    return res.status(500).json({
      success: false,
      error: 'IMAP_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/email/message/:messageUid/read - Marcar como leído
// ═══════════════════════════════════════════════════════════════

router.patch('/message/:accountId/:messageUid/read', async (req, res) => {
  try {
    const { accountId, messageUid } = req.params;
    const { isRead = true } = req.body;
    const ownerUserId = (req as any).user?.id;
    
    if (!ownerUserId) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED'
      });
    }
    
    console.log(`[MAIL] Marcando mensaje como ${isRead ? 'leído' : 'no leído'} - UID: ${messageUid}`);
    
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
        success: false,
        error: 'ACCOUNT_NOT_FOUND'
      });
    }
    
    if (!account.imap_host) {
      return res.status(400).json({
        success: false,
        error: 'IMAP_NOT_CONFIGURED'
      });
    }
    
    const imapPass = decrypt(account.imap_pass_enc);
    
    const imap = new Imap({
      user: account.imap_user,
      password: imapPass,
      host: account.imap_host,
      port: account.imap_port || 993,
      tls: account.imap_secure !== false,
      tlsOptions: { rejectUnauthorized: false }
    });
    
    await new Promise<void>((resolve, reject) => {
      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            reject(err);
            return;
          }
          
          const flagFunc = isRead ? imap.addFlags.bind(imap) : imap.delFlags.bind(imap);
          
          flagFunc([messageUid], '\\Seen', (err: any) => {
            if (err) {
              reject(err);
              return;
            }
            
            imap.end();
            resolve();
          });
        });
      });
      
      imap.once('error', (err) => {
        reject(err);
      });
      
      imap.connect();
      
      setTimeout(() => {
        imap.end();
        reject(new Error('IMAP timeout'));
      }, 10000);
    });
    
    console.log(`[MAIL] ✓ Mensaje marcado`);
    
    return res.json({
      success: true,
      message: `Email marcado como ${isRead ? 'leído' : 'no leído'}`
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error updating read status:', error);
    return res.status(500).json({
      success: false,
      error: 'IMAP_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/folders/:accountId - Listar carpetas IMAP
// ═══════════════════════════════════════════════════════════════

router.get('/folders/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const ownerUserId = req.query.ownerUserId as string;
    
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_OWNER_USER_ID'
      });
    }
    
    // Leer folders de la DB
    const { data: folders, error } = await supabase
      .from('email_folders')
      .select('*')
      .eq('account_id', accountId)
      .eq('owner_user_id', ownerUserId)
      .order('sort_order', { ascending: true });
    
    if (error) {
      console.error('[MAIL] Error fetching folders:', error);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      success: true,
      folders: folders || []
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in GET /folders:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/folders - Crear carpeta personalizada
// ═══════════════════════════════════════════════════════════════

router.post('/folders', async (req, res) => {
  try {
    const { accountId, ownerUserId, folderName, imapPath, icon, color } = req.body;
    
    if (!accountId || !ownerUserId || !folderName || !imapPath) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    const { data: newFolder, error } = await supabase
      .from('email_folders')
      .insert({
        account_id: accountId,
        owner_user_id: ownerUserId,
        folder_name: folderName,
        folder_type: 'custom',
        imap_path: imapPath,
        icon: icon || 'folder',
        color: color || null,
        sort_order: 100
      })
      .select()
      .single();
    
    if (error) {
      console.error('[MAIL] Error creating folder:', error);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      success: true,
      folder: newFolder
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in POST /folders:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/drafts - Listar borradores
// ═══════════════════════════════════════════════════════════════

router.get('/drafts', async (req, res) => {
  try {
    const { accountId, ownerUserId } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_OWNER_USER_ID'
      });
    }
    
    let query = supabase
      .from('email_drafts')
      .select('*')
      .eq('owner_user_id', ownerUserId as string)
      .order('updated_at', { ascending: false });
    
    if (accountId) {
      query = query.eq('account_id', accountId as string);
    }
    
    const { data: drafts, error } = await query;
    
    if (error) {
      console.error('[MAIL] Error fetching drafts:', error);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      success: true,
      drafts: drafts || []
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in GET /drafts:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/drafts - Crear borrador
// ═══════════════════════════════════════════════════════════════

router.post('/drafts', async (req, res) => {
  try {
    const {
      accountId,
      ownerUserId,
      toAddresses,
      ccAddresses,
      bccAddresses,
      subject,
      bodyText,
      bodyHtml,
      inReplyTo,
      references,
      isScheduled,
      scheduledFor
    } = req.body;
    
    if (!accountId || !ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    const { data: newDraft, error } = await supabase
      .from('email_drafts')
      .insert({
        account_id: accountId,
        owner_user_id: ownerUserId,
        to_addresses: toAddresses || [],
        cc_addresses: ccAddresses || [],
        bcc_addresses: bccAddresses || [],
        subject: subject || '',
        body_text: bodyText || '',
        body_html: bodyHtml || '',
        in_reply_to: inReplyTo || null,
        references: references || [],
        is_scheduled: isScheduled || false,
        scheduled_for: scheduledFor || null
      })
      .select()
      .single();
    
    if (error) {
      console.error('[MAIL] Error creating draft:', error);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      success: true,
      draft: newDraft
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in POST /drafts:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// PATCH /api/mail/drafts/:id - Actualizar borrador
// ═══════════════════════════════════════════════════════════════

router.patch('/drafts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ownerUserId, ...updates } = req.body;
    
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_OWNER_USER_ID'
      });
    }
    
    const { data: updatedDraft, error } = await supabase
      .from('email_drafts')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('owner_user_id', ownerUserId)
      .select()
      .single();
    
    if (error) {
      console.error('[MAIL] Error updating draft:', error);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      success: true,
      draft: updatedDraft
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in PATCH /drafts/:id:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/mail/drafts/:id - Eliminar borrador
// ═══════════════════════════════════════════════════════════════

router.delete('/drafts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ownerUserId } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_OWNER_USER_ID'
      });
    }
    
    const { error } = await supabase
      .from('email_drafts')
      .delete()
      .eq('id', id)
      .eq('owner_user_id', ownerUserId as string);
    
    if (error) {
      console.error('[MAIL] Error deleting draft:', error);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      success: true,
      message: 'Draft deleted successfully'
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in DELETE /drafts/:id:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/drafts/:id/send - Enviar borrador
// ═══════════════════════════════════════════════════════════════

router.post('/drafts/:id/send', async (req, res) => {
  try {
    const { id } = req.params;
    const { ownerUserId } = req.body;
    
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_OWNER_USER_ID'
      });
    }
    
    // Obtener el borrador
    const { data: draft, error: draftError } = await supabase
      .from('email_drafts')
      .select('*')
      .eq('id', id)
      .eq('owner_user_id', ownerUserId)
      .single();
    
    if (draftError || !draft) {
      return res.status(404).json({
        success: false,
        error: 'DRAFT_NOT_FOUND'
      });
    }
    
    // Obtener la cuenta de email
    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', draft.account_id)
      .single();
    
    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND'
      });
    }
    
    // Desencriptar contraseña SMTP
    const smtpPass = decrypt(account.smtp_pass_enc);
    
    // Crear transporter de nodemailer
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_port === 465,
      auth: {
        user: account.smtp_user,
        pass: smtpPass
      }
    });
    
    // Enviar email
    const mailOptions: any = {
      from: `"${account.from_name}" <${account.from_email}>`,
      to: draft.to_addresses.join(', '),
      subject: draft.subject,
      text: draft.body_text,
      html: draft.body_html || draft.body_text
    };
    
    if (draft.cc_addresses && draft.cc_addresses.length > 0) {
      mailOptions.cc = draft.cc_addresses.join(', ');
    }
    
    if (draft.bcc_addresses && draft.bcc_addresses.length > 0) {
      mailOptions.bcc = draft.bcc_addresses.join(', ');
    }
    
    if (draft.in_reply_to) {
      mailOptions.inReplyTo = draft.in_reply_to;
    }
    
    if (draft.references && draft.references.length > 0) {
      mailOptions.references = draft.references.join(' ');
    }
    
    const info = await transporter.sendMail(mailOptions);
    
    console.log('[MAIL] ✓ Email enviado:', info.messageId);
    
    // Guardar en mail_messages (como "sent")
    await supabase
      .from('mail_messages')
      .insert({
        account_id: draft.account_id,
        owner_user_id: ownerUserId,
        to_email: draft.to_addresses[0],
        subject: draft.subject,
        body_text: draft.body_text,
        body_html: draft.body_html,
        status: 'sent',
        sent_at: new Date().toISOString()
      });
    
    // Eliminar el borrador
    await supabase
      .from('email_drafts')
      .delete()
      .eq('id', id);
    
    return res.json({
      success: true,
      messageId: info.messageId,
      message: 'Email sent successfully'
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error sending draft:', error);
    return res.status(500).json({
      success: false,
      error: 'SEND_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/attachments/upload - Subir attachment a Supabase Storage
// ═══════════════════════════════════════════════════════════════

import multer from 'multer';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB max

router.post('/attachments/upload', upload.single('file'), async (req, res) => {
  try {
    const { ownerUserId, messageId, draftId } = req.body;
    const file = req.file;
    
    if (!ownerUserId || !file) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    if (!messageId && !draftId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_MESSAGE_OR_DRAFT_ID'
      });
    }
    
    // Subir a Supabase Storage
    const fileName = `${ownerUserId}/${Date.now()}_${file.originalname}`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('email-attachments')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        cacheControl: '3600',
        upsert: false
      });
    
    if (uploadError) {
      console.error('[MAIL] Error uploading to storage:', uploadError);
      return res.status(500).json({
        success: false,
        error: 'STORAGE_ERROR',
        message: uploadError.message
      });
    }
    
    // Obtener URL pública (firmada por 1 año)
    const { data: urlData } = await supabase.storage
      .from('email-attachments')
      .createSignedUrl(fileName, 365 * 24 * 60 * 60); // 1 año
    
    // Guardar registro en email_attachments
    const { data: attachment, error: dbError } = await supabase
      .from('email_attachments')
      .insert({
        message_id: messageId || null,
        draft_id: draftId || null,
        owner_user_id: ownerUserId,
        filename: file.originalname,
        content_type: file.mimetype,
        size_bytes: file.size,
        storage_path: fileName,
        download_url: urlData?.signedUrl || null
      })
      .select()
      .single();
    
    if (dbError) {
      console.error('[MAIL] Error saving attachment metadata:', dbError);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: dbError.message
      });
    }
    
    return res.json({
      success: true,
      attachment
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in POST /attachments/upload:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/attachments/:id/download - Descargar attachment
// ═══════════════════════════════════════════════════════════════

router.get('/attachments/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const { ownerUserId } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_OWNER_USER_ID'
      });
    }
    
    // Obtener attachment metadata
    const { data: attachment, error: dbError } = await supabase
      .from('email_attachments')
      .select('*')
      .eq('id', id)
      .eq('owner_user_id', ownerUserId as string)
      .single();
    
    if (dbError || !attachment) {
      return res.status(404).json({
        success: false,
        error: 'ATTACHMENT_NOT_FOUND'
      });
    }
    
    // Obtener archivo de Supabase Storage
    const { data: fileData, error: storageError } = await supabase.storage
      .from('email-attachments')
      .download(attachment.storage_path);
    
    if (storageError) {
      console.error('[MAIL] Error downloading from storage:', storageError);
      return res.status(500).json({
        success: false,
        error: 'STORAGE_ERROR',
        message: storageError.message
      });
    }
    
    // Convertir Blob a Buffer
    const buffer = Buffer.from(await fileData.arrayBuffer());
    
    // Enviar archivo
    res.setHeader('Content-Type', attachment.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
    
  } catch (error: any) {
    console.error('[MAIL] Error in GET /attachments/:id/download:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /api/mail/attachments/:id - Eliminar attachment
// ═══════════════════════════════════════════════════════════════

router.delete('/attachments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { ownerUserId } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_OWNER_USER_ID'
      });
    }
    
    // Obtener attachment metadata
    const { data: attachment, error: dbError } = await supabase
      .from('email_attachments')
      .select('*')
      .eq('id', id)
      .eq('owner_user_id', ownerUserId as string)
      .single();
    
    if (dbError || !attachment) {
      return res.status(404).json({
        success: false,
        error: 'ATTACHMENT_NOT_FOUND'
      });
    }
    
    // Eliminar de Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('email-attachments')
      .remove([attachment.storage_path]);
    
    if (storageError) {
      console.error('[MAIL] Error deleting from storage:', storageError);
    }
    
    // Eliminar registro de DB
    const { error: deleteError } = await supabase
      .from('email_attachments')
      .delete()
      .eq('id', id);
    
    if (deleteError) {
      console.error('[MAIL] Error deleting attachment metadata:', deleteError);
      return res.status(500).json({
        success: false,
        error: 'DATABASE_ERROR',
        message: deleteError.message
      });
    }
    
    return res.json({
      success: true,
      message: 'Attachment deleted successfully'
    });
    
  } catch (error: any) {
    console.error('[MAIL] Error in DELETE /attachments/:id:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

export default router;

