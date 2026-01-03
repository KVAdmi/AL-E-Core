/**
 * MAIL SERVICE
 * Lógica principal para sistema de correo inbound
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { parseEmail, ParsedEmail } from './parseEml';
import { supabase } from '../db/supabase';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    : undefined // Usar IAM role si está disponible
});

/**
 * Descarga un archivo .eml desde S3
 */
export async function downloadEmailFromS3(bucket: string, key: string, region?: string): Promise<Buffer> {
  console.log(`[MAIL_SERVICE] Downloading s3://${bucket}/${key}`);

  const client = region && region !== (process.env.AWS_REGION || 'us-east-1')
    ? new S3Client({ region })
    : s3Client;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  const response = await client.send(command);

  if (!response.Body) {
    throw new Error('S3 response body is empty');
  }

  // Convertir stream a buffer
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as any) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Genera URL firmada para descargar desde S3
 */
export async function generatePresignedUrl(bucket: string, key: string, region?: string, expiresIn = 3600): Promise<string> {
  const client = region && region !== (process.env.AWS_REGION || 'us-east-1')
    ? new S3Client({ region })
    : s3Client;

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key
  });

  return await getSignedUrl(client, command, { expiresIn });
}

/**
 * Resuelve user_id basado en el destinatario del correo
 * Estrategia:
 * 1. Buscar mail_accounts por domain
 * 2. Si no existe, buscar por email_address exacto
 * 3. Si no existe, retornar null (correo sin asignar)
 */
export async function resolveUserId(toEmail: string): Promise<{ userId: string | null; accountId: string | null }> {
  console.log(`[MAIL_SERVICE] Resolving user_id for: ${toEmail}`);

  const domain = toEmail.split('@')[1];

  // 1. Buscar por dominio
  const { data: accountsByDomain, error: domainError } = await supabase
    .from('mail_accounts')
    .select('id, user_id')
    .eq('domain', domain)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (accountsByDomain && !domainError) {
    console.log(`[MAIL_SERVICE] ✓ Resolved by domain: ${domain} → user_id=${accountsByDomain.user_id}, account_id=${accountsByDomain.id}`);
    return {
      userId: accountsByDomain.user_id,
      accountId: accountsByDomain.id
    };
  }

  // 2. Buscar por email exacto
  const { data: accountsByEmail, error: emailError } = await supabase
    .from('mail_accounts')
    .select('id, user_id')
    .eq('email_address', toEmail)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (accountsByEmail && !emailError) {
    console.log(`[MAIL_SERVICE] ✓ Resolved by email: ${toEmail} → user_id=${accountsByEmail.user_id}, account_id=${accountsByEmail.id}`);
    return {
      userId: accountsByEmail.user_id,
      accountId: accountsByEmail.id
    };
  }

  // 3. No se pudo resolver
  console.log(`[MAIL_SERVICE] ⚠️ Could not resolve user_id for ${toEmail} - will mark as unassigned`);
  return {
    userId: null,
    accountId: null
  };
}

/**
 * Verifica si un mensaje ya existe por message_id (deduplicación)
 */
export async function checkMessageExists(messageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('mail_messages')
    .select('id')
    .eq('message_id', messageId)
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') { // PGRST116 = not found
    console.error('[MAIL_SERVICE] Error checking message existence:', error);
    return false;
  }

  return !!data;
}

/**
 * Inserta un mensaje en mail_messages
 */
export async function insertMessage(
  parsed: ParsedEmail,
  userId: string | null,
  accountId: string | null,
  s3Bucket: string,
  s3Key: string,
  s3Region: string
): Promise<{ id: string; inserted: boolean }> {
  
  console.log(`[MAIL_SERVICE] Inserting message: ${parsed.messageId}`);

  // Deduplicación
  const exists = await checkMessageExists(parsed.messageId);
  if (exists) {
    console.log(`[MAIL_SERVICE] ⚠️ Message already exists: ${parsed.messageId}`);
    return { id: '', inserted: false };
  }

  // Preparar datos
  const ccEmails = parsed.cc.map(c => ({ email: c.email, name: c.name }));
  const bccEmails = parsed.bcc.map(b => ({ email: b.email, name: b.name }));
  
  const attachmentsJson = parsed.attachments.map(a => ({
    filename: a.filename,
    contentType: a.contentType,
    size: a.size,
    contentId: a.contentId,
    isInline: a.isInline
  }));

  // Insertar
  const { data, error } = await supabase
    .from('mail_messages')
    .insert({
      user_id: userId,
      account_id: accountId,
      source: 'ses',
      message_id: parsed.messageId,
      from_email: parsed.from.email,
      from_name: parsed.from.name,
      to_email: parsed.to[0].email,
      to_name: parsed.to[0].name,
      cc_emails: ccEmails,
      bcc_emails: bccEmails,
      reply_to: parsed.replyTo,
      subject: parsed.subject,
      body_text: parsed.textBody,
      body_html: parsed.htmlBody,
      snippet: parsed.snippet,
      received_at: parsed.date.toISOString(),
      sent_at: parsed.date.toISOString(),
      s3_bucket: s3Bucket,
      s3_key: s3Key,
      s3_region: s3Region,
      raw_headers: parsed.headers,
      status: userId ? 'new' : 'unassigned',
      folder: 'inbox',
      has_attachments: parsed.attachments.length > 0,
      attachments_json: attachmentsJson,
      attachments_count: parsed.attachments.length,
      in_reply_to: parsed.inReplyTo,
      references_text: parsed.references?.join(' ')
    })
    .select('id')
    .single();

  if (error) {
    console.error('[MAIL_SERVICE] Error inserting message:', error);
    throw new Error(`Failed to insert message: ${error.message}`);
  }

  console.log(`[MAIL_SERVICE] ✓ Message inserted: ${data.id}`);

  return { id: data.id, inserted: true };
}

/**
 * Procesa un correo inbound completo
 * (descarga S3 → parsea → resuelve user → inserta)
 */
export async function processInboundEmail(
  bucket: string,
  key: string,
  region: string
): Promise<{ success: boolean; messageId?: string; inserted?: boolean; reason?: string }> {
  
  try {
    // 1. Descargar desde S3
    const emlBuffer = await downloadEmailFromS3(bucket, key, region);
    console.log(`[MAIL_SERVICE] Downloaded ${emlBuffer.length} bytes`);

    // 2. Parsear
    const parsed = await parseEmail(emlBuffer);
    console.log(`[MAIL_SERVICE] Parsed: from=${parsed.from.email}, to=${parsed.to[0].email}, subject="${parsed.subject}"`);

    // 3. Resolver user_id
    const { userId, accountId } = await resolveUserId(parsed.to[0].email);

    // 4. Insertar
    const { id, inserted } = await insertMessage(parsed, userId, accountId, bucket, key, region);

    return {
      success: true,
      messageId: id,
      inserted
    };

  } catch (error: any) {
    console.error('[MAIL_SERVICE] Error processing inbound email:', error);
    return {
      success: false,
      reason: error.message
    };
  }
}
