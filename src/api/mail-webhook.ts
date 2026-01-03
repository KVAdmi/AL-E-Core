/**
 * =====================================================
 * MAIL WEBHOOK API - AWS SES Inbound
 * =====================================================
 * 
 * Recibe notificaciones de AWS SES cuando llegan correos
 * 
 * Endpoints:
 * - POST /api/mail/webhook/ses - Webhook SNS de AWS SES
 * - POST /api/mail/webhook/ses/verify - Verificar suscripción SNS
 * 
 * Flujo AWS SES Inbound:
 * 1. Correo llega a dominio configurado
 * 2. SES Rule Set guarda correo en S3
 * 3. SES envía notificación SNS al webhook
 * 4. Backend procesa notificación y descarga de S3
 * 5. Guarda en mail_messages_new
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { simpleParser } from 'mailparser';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/webhook/ses - Recibir notificación de AWS SES
// ═══════════════════════════════════════════════════════════════

router.post('/webhook/ses', async (req, res) => {
  try {
    console.log('[MAIL-WEBHOOK] 📥 Received SNS notification');
    
    const messageType = req.headers['x-amz-sns-message-type'];
    
    // 1. Verificación de suscripción SNS
    if (messageType === 'SubscriptionConfirmation') {
      console.log('[MAIL-WEBHOOK] 🔔 SNS Subscription Confirmation');
      const { SubscribeURL } = req.body;
      
      if (SubscribeURL) {
        // Confirmar suscripción automáticamente
        const https = await import('https');
        https.get(SubscribeURL, (response) => {
          console.log('[MAIL-WEBHOOK] ✅ Subscription confirmed');
        });
      }
      
      return res.status(200).json({ message: 'Subscription confirmed' });
    }
    
    // 2. Procesar notificación de correo recibido
    if (messageType === 'Notification') {
      const snsMessage = JSON.parse(req.body.Message || '{}');
      
      console.log('[MAIL-WEBHOOK] 📧 Processing email notification');
      console.log('[MAIL-WEBHOOK] Event type:', snsMessage.eventType);
      
      if (snsMessage.eventType === 'Received') {
        await processInboundEmail(snsMessage);
      }
      
      return res.status(200).json({ message: 'Notification processed' });
    }
    
    return res.status(400).json({ error: 'Unknown message type' });
    
  } catch (error: any) {
    console.error('[MAIL-WEBHOOK] ❌ Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// Función: Procesar correo entrante
// ═══════════════════════════════════════════════════════════════

async function processInboundEmail(snsMessage: any) {
  try {
    const mail = snsMessage.mail;
    const receipt = snsMessage.receipt;
    
    console.log('[MAIL-WEBHOOK] 📬 Processing inbound email');
    console.log(`[MAIL-WEBHOOK] From: ${mail.source}`);
    console.log(`[MAIL-WEBHOOK] To: ${mail.destination.join(', ')}`);
    console.log(`[MAIL-WEBHOOK] Subject: ${mail.commonHeaders.subject}`);
    
    // 1. Buscar cuenta de correo del destinatario
    const recipientEmail = mail.destination[0]; // Primer destinatario
    const domain = recipientEmail.split('@')[1];
    
    const { data: account, error: accountError } = await supabase
      .from('mail_accounts')
      .select('*')
      .eq('domain', domain)
      .eq('status', 'active')
      .single();
    
    if (accountError || !account) {
      console.error('[MAIL-WEBHOOK] ❌ No active account found for domain:', domain);
      return;
    }
    
    console.log(`[MAIL-WEBHOOK] ✓ Found account: ${account.id}`);
    
    // 2. Descargar correo desde S3 (si está configurado)
    let emailContent = null;
    let parsedEmail = null;
    
    if (receipt.action?.type === 'S3' && account.s3_bucket) {
      const s3Key = receipt.action.objectKey;
      console.log(`[MAIL-WEBHOOK] 📥 Downloading from S3: ${s3Key}`);
      
      const s3Client = new S3Client({
        region: account.aws_region || 'us-east-1',
        credentials: {
          accessKeyId: account.aws_access_key_id || '',
          secretAccessKey: account.aws_secret_access_key_enc || '' // TODO: Desencriptar
        }
      });
      
      const command = new GetObjectCommand({
        Bucket: account.s3_bucket,
        Key: s3Key
      });
      
      const s3Response = await s3Client.send(command);
      
      // Convertir stream a string
      if (s3Response.Body) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of s3Response.Body as any) {
          chunks.push(chunk);
        }
        emailContent = Buffer.concat(chunks).toString('utf-8');
      }
      
      // Parsear correo completo
      if (emailContent) {
        parsedEmail = await simpleParser(emailContent);
      }
    }
    
    // 3. Verificar spam
    const spamVerdict = receipt.spamVerdict?.status || 'PASS';
    const virusVerdict = receipt.virusVerdict?.status || 'PASS';
    const spfVerdict = receipt.spfVerdict?.status || 'PASS';
    const dkimVerdict = receipt.dkimVerdict?.status || 'PASS';
    const dmarcVerdict = receipt.dmarcVerdict?.status || 'PASS';
    
    const isSpam = spamVerdict === 'FAIL' || virusVerdict === 'FAIL';
    const spamScore = isSpam ? 100 : 0; // Simplificado
    
    const spamReason = isSpam 
      ? `Spam: ${spamVerdict}, Virus: ${virusVerdict}, SPF: ${spfVerdict}, DKIM: ${dkimVerdict}, DMARC: ${dmarcVerdict}`
      : null;
    
    console.log(`[MAIL-WEBHOOK] 🛡️ Spam check: ${isSpam ? 'SPAM' : 'CLEAN'}`);
    
    // 4. Extraer adjuntos
    const hasAttachments = parsedEmail?.attachments && parsedEmail.attachments.length > 0;
    const attachmentsJson = hasAttachments 
      ? parsedEmail!.attachments.map((att: any) => ({
          filename: att.filename,
          contentType: att.contentType,
          size: att.size,
          contentId: att.cid
        }))
      : null;
    
    // 5. Insertar mensaje en base de datos
    const { data: message, error: messageError } = await supabase
      .from('mail_messages_new')
      .insert({
        user_id: account.user_id,
        account_id: account.id,
        source: 'ses',
        message_id: mail.messageId,
        from_email: mail.source,
        to_email: recipientEmail,
        cc_emails: mail.commonHeaders.cc || [],
        bcc_emails: mail.commonHeaders.bcc || [],
        subject: mail.commonHeaders.subject || '(No subject)',
        body_text: parsedEmail?.text || '',
        body_html: parsedEmail?.html || null,
        snippet: parsedEmail?.text?.substring(0, 300) || '',
        received_at: new Date(mail.timestamp),
        sent_at: new Date(mail.timestamp),
        s3_bucket: account.s3_bucket,
        s3_key: receipt.action?.objectKey || null,
        raw_headers: mail.headers || {},
        status: isSpam ? 'spam' : 'new',
        folder: isSpam ? 'spam' : 'inbox',
        spam_score: spamScore,
        is_spam: isSpam,
        spam_reason: spamReason,
        has_attachments: hasAttachments,
        attachments_json: attachmentsJson
      })
      .select()
      .single();
    
    if (messageError) {
      console.error('[MAIL-WEBHOOK] ❌ Error inserting message:', messageError);
      return;
    }
    
    console.log(`[MAIL-WEBHOOK] ✅ Message saved: ${message.id}`);
    
    // 6. Aplicar filtros automáticos (si existen)
    await applyMailFilters(message.id, account.id, account.user_id);
    
    // 7. Log de sincronización
    await supabase
      .from('mail_sync_log_new')
      .insert({
        account_id: account.id,
        sync_type: 'webhook',
        status: 'success',
        messages_fetched: 1,
        messages_new: 1,
        completed_at: new Date(),
        duration_ms: 0
      });
    
    console.log('[MAIL-WEBHOOK] ✅ Processing complete');
    
  } catch (error: any) {
    console.error('[MAIL-WEBHOOK] ❌ Error processing email:', error);
    
    // Log error
    await supabase
      .from('mail_sync_log_new')
      .insert({
        account_id: null,
        sync_type: 'webhook',
        status: 'failed',
        errors: error.message,
        completed_at: new Date()
      });
  }
}

// ═══════════════════════════════════════════════════════════════
// Función: Aplicar filtros automáticos
// ═══════════════════════════════════════════════════════════════

async function applyMailFilters(messageId: string, accountId: string, userId: string) {
  try {
    // Obtener filtros activos del usuario
    const { data: filters } = await supabase
      .from('mail_filters')
      .select('*')
      .eq('user_id', userId)
      .eq('account_id', accountId)
      .eq('is_active', true)
      .order('priority', { ascending: false });
    
    if (!filters || filters.length === 0) {
      return;
    }
    
    // Obtener mensaje
    const { data: message } = await supabase
      .from('mail_messages_new')
      .select('*')
      .eq('id', messageId)
      .single();
    
    if (!message) return;
    
    console.log(`[MAIL-WEBHOOK] 🔍 Applying ${filters.length} filters...`);
    
    for (const filter of filters) {
      const conditions = filter.conditions as any;
      const actions = filter.actions as any;
      
      // Verificar condiciones
      let matches = true;
      
      if (conditions.from && !message.from_email?.includes(conditions.from)) {
        matches = false;
      }
      
      if (conditions.subject_contains && !message.subject?.toLowerCase().includes(conditions.subject_contains.toLowerCase())) {
        matches = false;
      }
      
      if (conditions.has_attachments !== undefined && message.has_attachments !== conditions.has_attachments) {
        matches = false;
      }
      
      // Aplicar acciones si coincide
      if (matches) {
        console.log(`[MAIL-WEBHOOK] ✓ Filter matched: ${filter.name}`);
        
        const updates: any = {};
        
        if (actions.folder) updates.folder = actions.folder;
        if (actions.flag) updates.flag = actions.flag;
        if (actions.mark_read) updates.status = 'read';
        if (actions.mark_spam) {
          updates.is_spam = true;
          updates.status = 'spam';
          updates.folder = 'spam';
        }
        
        if (Object.keys(updates).length > 0) {
          await supabase
            .from('mail_messages_new')
            .update(updates)
            .eq('id', messageId);
          
          console.log('[MAIL-WEBHOOK] ✓ Actions applied:', updates);
        }
      }
    }
    
  } catch (error: any) {
    console.error('[MAIL-WEBHOOK] Error applying filters:', error);
  }
}

export default router;
