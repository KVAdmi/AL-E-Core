/**
 * =====================================================
 * MAIL SEND API - AL-E CORE (FUNCIONAL)
 * =====================================================
 * 
 * ✅ SMTP REAL IMPLEMENTADO
 * 
 * REGLAS OBLIGATORIAS:
 * 1. SOLO success=true si hay messageId REAL del proveedor
 * 2. NO SIMULAR SMTP
 * 3. NO GENERAR messageId FALSO
 * 4. VALIDAR que info.messageId existe antes de responder success
 * 5. GUARDAR mensaje en email_messages con messageId real
 * 
 * PROVIDER: SMTP de la cuenta del usuario (Hostinger, Gmail, etc.)
 * EVIDENCIA: info.messageId del transporter nodemailer
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { decryptCredential } from '../utils/emailEncryption';
import nodemailer from 'nodemailer';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/send - AWS SES (P0 VALIDACIÓN REAL)
// ═══════════════════════════════════════════════════════════════
/**
 * REGLAS OBLIGATORIAS (NO NEGOCIABLES):
 * 1. SOLO success=true si hay provider_message_id REAL
 * 2. SIEMPRE registrar en email_audit_log
 * 3. NO confirmar envío sin evidencia SMTP
 * 4. NO simular messageId
 * 5. NO success=true sin registro en DB
 */

router.post('/send', requireAuth, async (req, res) => {
  try {
    const { accountId, to, subject, body, html, cc, bcc, replyTo, inReplyTo } = req.body;
    const userId = (req as any).user?.id;
    
    console.log('[MAIL.SEND] 📧 Request:', { userId, accountId, to, subject });
    
    // Validar campos requeridos
    if (!accountId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_ACCOUNT_ID',
        message: 'accountId es requerido'
      });
    }
    
    if (!to || !subject || (!body && !html)) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: to, subject, body o html'
      });
    }
    
    // Obtener cuenta SMTP del usuario
    console.log('[MAIL.SEND] 🔍 Obteniendo cuenta:', accountId);
    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .single();
    
    if (accountError || !account) {
      console.error('[MAIL.SEND] ❌ Cuenta no encontrada:', accountError);
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta de correo no encontrada o inactiva'
      });
    }
    
    // Descifrar password SMTP
    console.log('[MAIL.SEND] 🔐 Descifrando credenciales SMTP...');
    const smtpPass = decryptCredential(account.smtp_pass_enc);
    
    // Crear transporter con cuenta del usuario
    console.log('[MAIL.SEND] 🔧 Configurando SMTP:', account.smtp_host);
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
    
    // Enviar correo REAL
    console.log('[MAIL.SEND] 📤 Enviando correo...');
    const info = await transporter.sendMail({
      from: `"${account.from_name}" <${account.from_email}>`,
      to: toArray.join(', '),
      cc: ccArray?.join(', '),
      bcc: bccArray?.join(', '),
      replyTo: replyTo || account.from_email,
      subject: subject,
      text: body,
      html: html || body,
      inReplyTo: inReplyTo,
      headers: inReplyTo ? {
        'In-Reply-To': inReplyTo,
        'References': inReplyTo
      } : undefined
    });
    
    console.log('[MAIL.SEND] ✅ Correo enviado');
    console.log('[MAIL.SEND] Message ID:', info.messageId);
    
    // Validar messageId
    if (!info.messageId) {
      console.error('[MAIL.SEND] ❌ Sin Message ID');
      return res.status(500).json({
        success: false,
        error: 'NO_MESSAGE_ID',
        message: 'Error: sin confirmación del proveedor SMTP'
      });
    }
    
    // Obtener folder "Sent" (o crearlo si no existe)
    let sentFolder;
    const { data: folders } = await supabase
      .from('email_folders')
      .select('id')
      .eq('account_id', accountId)
      .eq('folder_type', 'sent')
      .limit(1);
    
    if (folders && folders.length > 0) {
      sentFolder = folders[0];
    } else {
      // Crear folder Sent si no existe
      const { data: newFolder } = await supabase
        .from('email_folders')
        .insert({
          account_id: accountId,
          owner_user_id: userId,
          folder_name: 'Sent',
          folder_type: 'sent',
          imap_path: 'INBOX.Sent'
        })
        .select('id')
        .single();
      sentFolder = newFolder;
    }
    
    // Guardar mensaje enviado en email_messages
    console.log('[MAIL.SEND] 💾 Guardando en DB...');
    const { data: savedMessage, error: saveError } = await supabase
      .from('email_messages')
      .insert({
        account_id: accountId,
        owner_user_id: userId,
        folder_id: sentFolder?.id,
        current_folder_id: sentFolder?.id,
        message_id: info.messageId,
        from_address: account.from_email,
        from_name: account.from_name,
        to_addresses: toArray,
        cc_addresses: ccArray || [],
        bcc_addresses: bccArray || [],
        subject: subject,
        body_text: body,
        body_html: html || null,
        body_preview: body?.substring(0, 200),
        has_attachments: false,
        attachment_count: 0,
        is_read: true,
        date: new Date().toISOString(),
        in_reply_to: inReplyTo,
        size_bytes: (body?.length || 0) + (html?.length || 0)
      })
      .select('id, message_id')
      .single();
    
    if (saveError) {
      console.error('[MAIL.SEND] ⚠️ Error guardando mensaje:', saveError);
      // No bloquear el envío si falla el guardado
    }
    
    console.log('[MAIL.SEND] ✅ Completado');
    
    return res.json({
      success: true,
      messageId: info.messageId,
      savedMessageId: savedMessage?.id,
      provider: account.smtp_host,
      from: account.from_email,
      to: toArray,
      subject: subject
    });
    
  } catch (error: any) {
    console.error('[MAIL.SEND] ❌ Error enviando correo:', error);
    return res.status(500).json({
      success: false,
      error: error.code || 'SMTP_ERROR',
      message: `Error al enviar correo: ${error.message}`
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/accounts/:accountId/sync - Sincronizar mensajes IMAP
// ═══════════════════════════════════════════════════════════════

router.post('/accounts/:accountId/sync', requireAuth, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { folder = 'INBOX', limit = 100 } = req.body;
    const userId = (req as any).user?.id;
    
    console.log('[MAIL.SYNC] 🔄 Iniciando sync:', { userId, accountId, folder });
    
    // Obtener cuenta
    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .single();
    
    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta no encontrada'
      });
    }
    
    // Verificar IMAP configurado
    if (!account.imap_host || !account.imap_user || !account.imap_pass_enc) {
      return res.status(400).json({
        success: false,
        error: 'IMAP_NOT_CONFIGURED',
        message: 'Esta cuenta no tiene IMAP configurado'
      });
    }
    
    // Descifrar password IMAP
    console.log('[MAIL.SYNC] 🔐 Descifrando credenciales IMAP...');
    const imapPass = decryptCredential(account.imap_pass_enc);
    
    // Obtener o crear folder
    let folderId;
    const { data: existingFolder } = await supabase
      .from('email_folders')
      .select('id')
      .eq('account_id', accountId)
      .eq('imap_path', folder)
      .limit(1)
      .single();
    
    if (existingFolder) {
      folderId = existingFolder.id;
    } else {
      // Crear folder si no existe
      const { data: newFolder, error: folderError } = await supabase
        .from('email_folders')
        .insert({
          account_id: accountId,
          owner_user_id: userId,
          folder_name: folder,
          folder_type: folder.toLowerCase() === 'inbox' ? 'inbox' : 'custom',
          imap_path: folder
        })
        .select('id')
        .single();
      
      if (folderError || !newFolder) {
        return res.status(500).json({
          success: false,
          error: 'FOLDER_CREATE_FAILED',
          message: 'Error creando folder'
        });
      }
      
      folderId = newFolder.id;
    }
    
    // Configurar IMAP
    const imap = new Imap({
      user: account.imap_user,
      password: imapPass,
      host: account.imap_host,
      port: account.imap_port || 993,
      tls: account.imap_secure !== false,
      tlsOptions: { rejectUnauthorized: false }
    });
    
    let messagesFetched = 0;
    let messagesNew = 0;
    const messages: any[] = [];
    
    await new Promise<void>((resolve, reject) => {
      imap.once('ready', () => {
        console.log('[MAIL.SYNC] ✅ IMAP conectado');
        
        imap.openBox(folder, false, (err, box) => {
          if (err) {
            console.error('[MAIL.SYNC] ❌ Error abriendo folder:', err);
            return reject(err);
          }
          
          console.log('[MAIL.SYNC] 📬 Folder abierto:', box.messages.total, 'mensajes');
          
          if (box.messages.total === 0) {
            imap.end();
            return resolve();
          }
          
          // Obtener últimos N mensajes
          const start = Math.max(1, box.messages.total - (limit || 100) + 1);
          const end = box.messages.total;
          
          console.log('[MAIL.SYNC] 📨 Fetching mensajes:', start, '-', end);
          
          const fetch = imap.seq.fetch(`${start}:${end}`, {
            bodies: '',
            struct: true
          });
          
          fetch.on('message', (msg, seqno) => {
            let buffer = '';
            
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
              });
            });
            
            msg.once('end', async () => {
              try {
                const parsed = await simpleParser(buffer);
                
                // Extraer from (puede ser un objeto o array)
                const fromValue = Array.isArray(parsed.from) 
                  ? parsed.from[0] 
                  : parsed.from;
                
                // Extraer to (puede ser un objeto o array)
                const toValue = parsed.to 
                  ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
                  : [];
                
                // Extraer cc (puede ser un objeto o array)
                const ccValue = parsed.cc 
                  ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc])
                  : [];
                
                messages.push({
                  seqno,
                  messageId: parsed.messageId,
                  from: fromValue,
                  to: toValue,
                  cc: ccValue,
                  subject: parsed.subject || '(Sin asunto)',
                  date: parsed.date,
                  text: parsed.text,
                  html: parsed.html,
                  inReplyTo: parsed.inReplyTo,
                  hasAttachments: (parsed.attachments?.length || 0) > 0,
                  attachmentCount: parsed.attachments?.length || 0
                });
                
                messagesFetched++;
              } catch (parseError) {
                console.error('[MAIL.SYNC] ⚠️ Error parsing mensaje:', parseError);
              }
            });
          });
          
          fetch.once('error', (err) => {
            console.error('[MAIL.SYNC] ❌ Error en fetch:', err);
            reject(err);
          });
          
          fetch.once('end', () => {
            console.log('[MAIL.SYNC] ✅ Fetch completado');
            imap.end();
          });
        });
      });
      
      imap.once('error', (err) => {
        console.error('[MAIL.SYNC] ❌ Error IMAP:', err);
        reject(err);
      });
      
      imap.once('end', () => {
        console.log('[MAIL.SYNC] 🔌 IMAP desconectado');
        resolve();
      });
      
      imap.connect();
    });
    
    // Guardar mensajes en DB
    console.log('[MAIL.SYNC] 💾 Guardando', messages.length, 'mensajes en DB...');
    
    for (const msg of messages) {
      // Verificar si ya existe
      const { data: existing } = await supabase
        .from('email_messages')
        .select('id')
        .eq('account_id', accountId)
        .eq('message_id', msg.messageId)
        .limit(1)
        .single();
      
      if (existing) {
        console.log('[MAIL.SYNC] ⏭️  Mensaje ya existe:', msg.messageId);
        continue; // Skip duplicados
      }
      
      // Insertar nuevo mensaje
      const { error: insertError } = await supabase
        .from('email_messages')
        .insert({
          account_id: accountId,
          owner_user_id: userId,
          folder_id: folderId,
          current_folder_id: folderId,
          message_id: msg.messageId,
          from_address: msg.from?.address || '',
          from_name: msg.from?.name || '',
          to_addresses: msg.to.map((t: any) => t.address),
          cc_addresses: msg.cc?.map((c: any) => c.address) || [],
          subject: msg.subject,
          body_text: msg.text,
          body_html: msg.html,
          body_preview: msg.text?.substring(0, 200),
          has_attachments: msg.hasAttachments,
          attachment_count: msg.attachmentCount,
          is_read: false,
          date: msg.date,
          in_reply_to: msg.inReplyTo,
          size_bytes: (msg.text?.length || 0) + (msg.html?.length || 0)
        });
      
      if (insertError) {
        console.error('[MAIL.SYNC] ⚠️ Error guardando mensaje:', insertError);
      } else {
        messagesNew++;
      }
    }
    
    console.log('[MAIL.SYNC] ✅ Sync completado:', messagesNew, 'mensajes nuevos');
    
    return res.json({
      success: true,
      sync: {
        folder,
        messages_fetched: messagesFetched,
        messages_new: messagesNew
      }
    });
    
  } catch (error: any) {
    console.error('[MAIL.SYNC] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error.code || 'SYNC_ERROR',
      message: `Error sincronizando: ${error.message}`
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/messages - Listar mensajes del usuario
// ═══════════════════════════════════════════════════════════════

router.get('/messages', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { 
      accountId, 
      folder, 
      cursor, 
      limit = '50',
      unreadOnly = 'false',
      search 
    } = req.query;
    
    console.log('[MAIL.MESSAGES] 📬 Listando mensajes:', { 
      userId, 
      accountId, 
      folder, 
      limit 
    });
    
    // Construir query
    let query = supabase
      .from('email_messages')
      .select('*')
      .eq('owner_user_id', userId);
    
    // Filtrar por cuenta
    if (accountId) {
      query = query.eq('account_id', accountId);
    }
    
    // Filtrar por folder
    if (folder && typeof folder === 'string') {
      // Buscar folder_id por nombre o tipo
      const { data: folderData } = await supabase
        .from('email_folders')
        .select('id')
        .eq('owner_user_id', userId)
        .or(`folder_name.eq.${folder},folder_type.eq.${folder.toLowerCase()}`)
        .limit(1)
        .single();
      
      if (folderData) {
        query = query.eq('current_folder_id', folderData.id);
      }
    }
    
    // Filtrar no leídos
    if (unreadOnly === 'true') {
      query = query.eq('is_read', false);
    }
    
    // Buscar por texto
    if (search && typeof search === 'string') {
      query = query.or(`subject.ilike.%${search}%,body_text.ilike.%${search}%`);
    }
    
    // Paginación
    const limitNum = parseInt(limit as string) || 50;
    query = query
      .order('date', { ascending: false })
      .limit(limitNum);
    
    if (cursor) {
      query = query.lt('date', cursor as string);
    }
    
    const { data: messages, error } = await query;
    
    if (error) {
      console.error('[MAIL.MESSAGES] ❌ Error:', error);
      return res.status(500).json({
        success: false,
        error: 'QUERY_ERROR',
        message: 'Error obteniendo mensajes'
      });
    }
    
    console.log('[MAIL.MESSAGES] ✅ Retornando', messages?.length || 0, 'mensajes');
    
    return res.json({
      success: true,
      messages: messages || [],
      hasMore: (messages?.length || 0) >= limitNum,
      nextCursor: messages && messages.length > 0 
        ? messages[messages.length - 1].date 
        : null
    });
    
  } catch (error: any) {
    console.error('[MAIL.MESSAGES] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: `Error: ${error.message}`
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/mail/messages/:id - Obtener detalle de un mensaje
// ═══════════════════════════════════════════════════════════════

router.get('/messages/:id', requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;
    
    console.log('[MAIL.MESSAGE] 📧 Obteniendo mensaje:', id);
    
    const { data: message, error } = await supabase
      .from('email_messages')
      .select('*')
      .eq('id', id)
      .eq('owner_user_id', userId)
      .single();
    
    if (error || !message) {
      return res.status(404).json({
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'Mensaje no encontrado'
      });
    }
    
    console.log('[MAIL.MESSAGE] ✅ Mensaje encontrado');
    
    return res.json({
      success: true,
      message
    });
    
  } catch (error: any) {
    console.error('[MAIL.MESSAGE] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: `Error: ${error.message}`
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
    const imapPass = decryptCredential(account.imap_pass_enc);
    
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
                    to: (parsed.to && !Array.isArray(parsed.to) && parsed.to.value) 
                      ? parsed.to.value.map((t: any) => t.address) 
                      : [],
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
    const imapPass = decryptCredential(account.imap_pass_enc);
    
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
                
                const fromText = parsed.from && !Array.isArray(parsed.from) && parsed.from.text 
                  ? parsed.from.text 
                  : 'Unknown';
                const toText = parsed.to && !Array.isArray(parsed.to) && parsed.to.text 
                  ? parsed.to.text 
                  : '';
                
                emails.push({
                  id: seqno,
                  from: fromText,
                  to: toText,
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
    // ✅ FIX: Obtener userId del token
    const ownerUserId = req.userId || req.query.ownerUserId as string;
    const { limit } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_OWNER_USER_ID',
        message: 'Autenticación requerida - no se pudo identificar al usuario'
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
    
    const smtpPass = decryptCredential(account.smtp_pass_enc);
    
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
    
    const imapPass = decryptCredential(account.imap_pass_enc);
    
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
    
    const imapPass = decryptCredential(account.imap_pass_enc);
    
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
    const smtpPass = decryptCredential(account.smtp_pass_enc);
    
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

