/**
 * MAIL INBOUND API
 * Endpoints para correo entrante y gestión de mensajes
 */

import express, { Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { supabase } from '../db/supabase';
import { processInboundEmail, generatePresignedUrl } from '../mail/mailService';
import { generate as llmGenerate } from '../llm/router';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// WEBHOOK SES INBOUND (NO AUTH - usa X-Internal-Secret)
// ═══════════════════════════════════════════════════════════════

/**
 * POST /mail/inbound/ses
 * Recibe notificación de Lambda cuando llega un correo a S3
 */
router.post('/inbound/ses', async (req: Request, res: Response) => {
  const requestId = `req_${Date.now()}`;
  console.log(`[MAIL_INBOUND] ${requestId} - POST /inbound/ses`);

  try {
    // Validar secret interno
    const secret = req.headers['x-internal-secret'];
    const expectedSecret = process.env.INBOUND_SECRET;

    if (!expectedSecret) {
      console.error(`[MAIL_INBOUND] ${requestId} - INBOUND_SECRET not configured`);
      return res.status(500).json({
        ok: false,
        error: 'Internal configuration error'
      });
    }

    if (secret !== expectedSecret) {
      console.error(`[MAIL_INBOUND] ${requestId} - Invalid X-Internal-Secret`);
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized'
      });
    }

    // Extraer payload
    const { bucket, key, region, ts } = req.body;

    if (!bucket || !key) {
      console.error(`[MAIL_INBOUND] ${requestId} - Missing bucket or key`);
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: bucket, key'
      });
    }

    console.log(`[MAIL_INBOUND] ${requestId} - Processing: s3://${bucket}/${key} (region=${region || 'us-east-1'})`);
    console.log(`[MAIL_INBOUND] ${requestId} - Timestamp: ${ts}`);

    // Procesar correo
    const result = await processInboundEmail(bucket, key, region || 'us-east-1');

    if (result.success) {
      console.log(`[MAIL_INBOUND] ${requestId} - ✓ Success: messageId=${result.messageId}, inserted=${result.inserted}`);
      return res.status(200).json({
        ok: true,
        inserted: result.inserted,
        id: result.messageId
      });
    } else {
      console.error(`[MAIL_INBOUND] ${requestId} - ✗ Failed: ${result.reason}`);
      return res.status(500).json({
        ok: false,
        error: result.reason
      });
    }

  } catch (error: any) {
    console.error(`[MAIL_INBOUND] ${requestId} - Exception:`, error);
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// USER ENDPOINTS (requieren JWT)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /mail/messages
 * Lista mensajes del usuario con paginación
 */
router.get('/messages', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const limit = parseInt(req.query.limit as string) || 50;
  const offset = parseInt(req.query.offset as string) || 0;
  const status = req.query.status as string;
  const folder = req.query.folder as string;

  console.log(`[MAIL_INBOX] GET /messages - user=${userId}, limit=${limit}, offset=${offset}, status=${status}, folder=${folder}`);

  try {
    let query = supabase
      .from('mail_messages')
      .select('id, from_email, from_name, to_email, subject, snippet, received_at, status, folder, flag, is_starred, has_attachments, attachments_count, created_at', { count: 'exact' })
      .eq('user_id', userId)
      .neq('status', 'deleted')
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filtros opcionales
    if (status) {
      query = query.eq('status', status);
    }
    if (folder) {
      query = query.eq('folder', folder);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[MAIL_INBOX] Error fetching messages:', error);
      return res.status(500).json({ 
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message 
      });
    }

    return res.json({
      success: true,
      messages: data || [],
      total: count || 0,
      hasMore: (count || 0) > (offset + limit)
    });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ 
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message 
    });
  }
});

/**
 * GET /mail/messages/:id
 * Obtiene detalle completo de un mensaje
 */
router.get('/messages/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const messageId = req.params.id;

  console.log(`[MAIL_INBOX] GET /messages/${messageId} - user=${userId}`);

  try {
    const { data, error } = await supabase
      .from('mail_messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      console.error('[MAIL_INBOX] Message not found:', error);
      return res.status(404).json({ 
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'El mensaje no existe o no tienes acceso'
      });
    }

    // Generar presigned URL si hay S3
    let presignedUrl = null;
    if (data.s3_bucket && data.s3_key) {
      presignedUrl = await generatePresignedUrl(
        data.s3_bucket,
        data.s3_key,
        data.s3_region || 'us-east-1',
        3600 // 1 hora
      );
    }

    return res.json({
      success: true,
      message: {
        ...data,
        presignedUrl
      }
    });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ 
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message 
    });
  }
});

/**
 * POST /mail/messages/:id/read
 * Marca un mensaje como leído
 */
router.post('/messages/:id/read', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const messageId = req.params.id;

  console.log(`[MAIL_INBOX] POST /messages/${messageId}/read - user=${userId}`);

  try {
    const { data, error } = await supabase
      .from('mail_messages')
      .update({ status: 'read' })
      .eq('id', messageId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      console.error('[MAIL_INBOX] Failed to mark as read:', error);
      return res.status(404).json({ 
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'El mensaje no existe o no tienes acceso'
      });
    }

    return res.json({ 
      success: true, 
      message: 'Message marked as read'
    });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ 
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message 
    });
  }
});

/**
 * POST /mail/messages/:id/draft
 * Crea/actualiza un borrador de respuesta
 */
router.post('/messages/:id/draft', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const messageId = req.params.id;
  const { draft_text, draft_html, status } = req.body;

  console.log(`[MAIL_INBOX] POST /messages/${messageId}/draft - user=${userId}`);

  try {
    // Verificar que el mensaje existe y pertenece al usuario
    const { data: message, error: msgError } = await supabase
      .from('mail_messages')
      .select('id, account_id, from_email, subject')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();

    if (msgError || !message) {
      console.error('[MAIL_INBOX] Message not found:', msgError);
      return res.status(404).json({ error: 'Message not found' });
    }

    // Crear/actualizar draft
    const { data: draft, error: draftError } = await supabase
      .from('mail_drafts')
      .upsert({
        user_id: userId,
        message_id: messageId,
        account_id: message.account_id,
        to_emails: [{ email: message.from_email }],
        subject: `Re: ${message.subject}`,
        draft_text,
        draft_html,
        status: status || 'draft'
      }, {
        onConflict: 'message_id'
      })
      .select()
      .single();

    if (draftError) {
      console.error('[MAIL_INBOX] Failed to create draft:', draftError);
      return res.status(500).json({ error: draftError.message });
    }

    return res.json({ ok: true, draft });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /mail/messages/:id/ai-reply
 * Genera un borrador de respuesta usando AI
 */
router.post('/messages/:id/ai-reply', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const messageId = req.params.id;

  console.log(`[MAIL_INBOX] POST /messages/${messageId}/ai-reply - user=${userId}`);

  try {
    // Obtener mensaje
    const { data: message, error: msgError } = await supabase
      .from('mail_messages')
      .select('*')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single();

    if (msgError || !message) {
      console.error('[MAIL_INBOX] Message not found:', msgError);
      return res.status(404).json({ error: 'Message not found' });
    }

    // Construir prompt para AI
    const prompt = `
Eres un asistente de correo profesional. Genera una respuesta cortés y profesional para el siguiente correo:

**De:** ${message.from_email} ${message.from_name ? `(${message.from_name})` : ''}
**Asunto:** ${message.subject}
**Fecha:** ${new Date(message.received_at).toLocaleString('es-MX')}

**Contenido:**
${message.body_text || message.snippet}

---

Genera SOLO el texto de respuesta, sin incluir saludos iniciales como "Estimado [nombre]" ni despedidas. Sé directo y profesional.
`.trim();

    // Generar respuesta con LLM
    const llmResult = await llmGenerate({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 500
    });

    const draftText = llmResult.response.text || 'No se pudo generar la respuesta.';

    // Guardar draft
    const { data: draft, error: draftError } = await supabase
      .from('mail_drafts')
      .insert({
        user_id: userId,
        message_id: messageId,
        account_id: message.account_id,
        to_emails: [{ email: message.from_email, name: message.from_name }],
        subject: `Re: ${message.subject}`,
        draft_text: draftText,
        status: 'draft'
      })
      .select()
      .single();

    if (draftError) {
      console.error('[MAIL_INBOX] Failed to save AI draft:', draftError);
      return res.status(500).json({ error: draftError.message });
    }

    return res.json({
      success: true,
      draft_text: draftText,
      draft
    });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ 
      success: false,
      error: 'AI_GENERATION_FAILED',
      message: error.message 
    });
  }
});

/**
 * GET /mail/drafts
 * Lista borradores del usuario
 */
router.get('/drafts', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const status = req.query.status as string;

  console.log(`[MAIL_INBOX] GET /drafts - user=${userId}, status=${status || 'all'}`);

  try {
    let query = supabase
      .from('mail_drafts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[MAIL_INBOX] Error fetching drafts:', error);
      return res.status(500).json({ 
        success: false,
        error: 'DATABASE_ERROR',
        message: error.message 
      });
    }

    return res.json({
      success: true,
      drafts: data || []
    });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ 
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message 
    });
  }
});

/**
 * PATCH /mail/messages/:id/flag
 * Actualiza bandera de clasificación
 */
router.patch('/messages/:id/flag', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const messageId = req.params.id;
  const { flag } = req.body;

  console.log(`[MAIL_INBOX] PATCH /messages/${messageId}/flag - user=${userId}, flag=${flag}`);

  // Validar valores permitidos
  const validFlags = ['urgent', 'important', 'pending', 'follow_up', 'low_priority', null];
  if (flag !== undefined && !validFlags.includes(flag)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_FLAG',
      message: 'Flag must be one of: urgent, important, pending, follow_up, low_priority, or null'
    });
  }

  try {
    const { data, error } = await supabase
      .from('mail_messages')
      .update({ flag: flag || null })
      .eq('id', messageId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      console.error('[MAIL_INBOX] Failed to update flag:', error);
      return res.status(404).json({ 
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'El mensaje no existe o no tienes acceso'
      });
    }

    return res.json({ 
      success: true, 
      message: 'Flag updated'
    });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ 
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message 
    });
  }
});

/**
 * POST /mail/messages/:id/spam
 * Marca mensaje como spam
 */
router.post('/messages/:id/spam', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  const messageId = req.params.id;

  console.log(`[MAIL_INBOX] POST /messages/${messageId}/spam - user=${userId}`);

  try {
    const { data, error } = await supabase
      .from('mail_messages')
      .update({ 
        is_spam: true,
        status: 'spam',
        folder: 'spam',
        spam_score: 100,
        spam_reason: 'User marked as spam'
      })
      .eq('id', messageId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      console.error('[MAIL_INBOX] Failed to mark as spam:', error);
      return res.status(404).json({ 
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'El mensaje no existe o no tienes acceso'
      });
    }

    return res.json({ 
      success: true, 
      message: 'Message marked as spam'
    });

  } catch (error: any) {
    console.error('[MAIL_INBOX] Exception:', error);
    return res.status(500).json({ 
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message 
    });
  }
});

export default router;
