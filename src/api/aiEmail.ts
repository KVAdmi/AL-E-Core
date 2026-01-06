/**
 * =====================================================
 * AI EMAIL API - Análisis, Clasificación y Respuestas
 * =====================================================
 * 
 * Endpoints:
 * - POST /api/ai/analyze-email: Analizar y clasificar correo con LLM
 * - POST /api/ai/draft-reply: Generar borrador de respuesta
 * - POST /api/ai/send-auto-reply: Enviar respuesta (valida auto_send_enabled)
 * - POST /api/mail/classify: Actualizar clasificación manualmente
 * 
 * IMPORTANTE:
 * - Usa Anthropic Claude para análisis
 * - Registra en email_messages.classification
 * - Política auto_send_enabled igual que Telegram
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { requireAuth } from '../middleware/auth';
import Anthropic from '@anthropic-ai/sdk';
import { decryptCredential } from '../utils/emailEncryption';
import nodemailer from 'nodemailer';

const router = express.Router();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!
});

// ═══════════════════════════════════════════════════════════════
// POST /api/ai/analyze-email
// ═══════════════════════════════════════════════════════════════

router.post('/analyze-email', requireAuth, async (req, res) => {
  try {
    const { messageId } = req.body;
    const userId = (req as any).user?.id;

    console.log('[AI EMAIL] Analizando mensaje:', messageId);

    if (!messageId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_MESSAGE_ID',
        message: 'messageId es requerido'
      });
    }

    // Obtener mensaje
    const { data: message, error: messageError } = await supabase
      .from('email_messages')
      .select('*')
      .eq('id', messageId)
      .eq('owner_user_id', userId)
      .single();

    if (messageError || !message) {
      return res.status(404).json({
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'Mensaje no encontrado'
      });
    }

    // Analizar con LLM
    const prompt = `Analiza este correo electrónico y clasifícalo:

**De:** ${message.from_name} <${message.from_address}>
**Asunto:** ${message.subject}
**Fecha:** ${message.date}
**Cuerpo:**
${message.body_text || message.body_html?.substring(0, 2000) || 'Sin contenido'}

Responde en formato JSON:
{
  "classification": "urgent|important|normal|low_priority|spam",
  "category": "meeting|task|information|question|other",
  "sentiment": "positive|neutral|negative",
  "requires_action": true/false,
  "summary": "Resumen breve en español (max 100 caracteres)",
  "action_items": ["acción 1", "acción 2"],
  "urgency_reason": "Por qué es urgente (solo si classification=urgent)"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const analysisText = response.content[0].type === 'text' 
      ? response.content[0].text 
      : '';

    // Extraer JSON
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No se pudo parsear análisis del LLM');
    }

    const analysis = JSON.parse(jsonMatch[0]);

    // Actualizar clasificación en DB
    const { error: updateError } = await supabase
      .from('email_messages')
      .update({
        classification: analysis.classification,
        category: analysis.category,
        sentiment: analysis.sentiment,
        requires_action: analysis.requires_action,
        ai_summary: analysis.summary,
        action_items: analysis.action_items
      })
      .eq('id', messageId);

    if (updateError) {
      console.error('[AI EMAIL] Error actualizando clasificación:', updateError);
    }

    console.log('[AI EMAIL] Análisis completado:', analysis.classification);

    return res.json({
      success: true,
      messageId: message.id,
      subject: message.subject,
      from: message.from_address,
      analysis: analysis
    });

  } catch (error: any) {
    console.error('[AI EMAIL] Error analizando:', error);
    return res.status(500).json({
      success: false,
      error: 'ANALYSIS_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/ai/draft-reply
// ═══════════════════════════════════════════════════════════════

router.post('/draft-reply', requireAuth, async (req, res) => {
  try {
    const { messageId, replyType = 'formal', instructions } = req.body;
    const userId = (req as any).user?.id;

    console.log('[AI EMAIL] Generando borrador:', messageId, replyType);

    if (!messageId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_MESSAGE_ID',
        message: 'messageId es requerido'
      });
    }

    // Obtener mensaje original
    const { data: message, error: messageError } = await supabase
      .from('email_messages')
      .select('*')
      .eq('id', messageId)
      .eq('owner_user_id', userId)
      .single();

    if (messageError || !message) {
      return res.status(404).json({
        success: false,
        error: 'MESSAGE_NOT_FOUND',
        message: 'Mensaje no encontrado'
      });
    }

    // Generar borrador con LLM
    const toneInstructions = {
      formal: 'Tono formal y profesional, saludo cordial.',
      friendly: 'Tono amigable y cercano, natural.',
      brief: 'Respuesta breve y directa, máximo 3 líneas.'
    };

    const prompt = `Genera una respuesta a este correo electrónico:

**De:** ${message.from_name} <${message.from_address}>
**Asunto:** ${message.subject}
**Fecha:** ${message.date}
**Cuerpo:**
${message.body_text || message.body_html?.substring(0, 2000) || 'Sin contenido'}

**Instrucciones:**
- ${toneInstructions[replyType as keyof typeof toneInstructions]}
${instructions ? `- ${instructions}` : ''}

Responde SOLO con el cuerpo del correo (sin "Asunto:", sin "De:", sin "Para:").
Incluye saludo y despedida apropiados.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });

    const draftBody = response.content[0].type === 'text' 
      ? response.content[0].text.trim()
      : '';

    // Guardar borrador en email_drafts
    const draftSubject = message.subject.startsWith('Re:') 
      ? message.subject 
      : `Re: ${message.subject}`;

    const { data: draft, error: draftError } = await supabase
      .from('email_drafts')
      .insert({
        account_id: message.account_id,
        owner_user_id: userId,
        to_addresses: [message.from_address],
        subject: draftSubject,
        body_text: draftBody,
        body_html: draftBody.replace(/\n/g, '<br>'),
        in_reply_to: message.message_id,
        reply_to_message_id: message.id
      })
      .select('*')
      .single();

    if (draftError) {
      console.error('[AI EMAIL] Error guardando borrador:', draftError);
      return res.status(500).json({
        success: false,
        error: 'DRAFT_ERROR',
        message: 'Error guardando borrador'
      });
    }

    console.log('[AI EMAIL] Borrador creado:', draft.id);

    return res.json({
      success: true,
      draft: {
        id: draft.id,
        to: draft.to_addresses,
        subject: draft.subject,
        body: draft.body_text,
        replyType: replyType
      }
    });

  } catch (error: any) {
    console.error('[AI EMAIL] Error generando borrador:', error);
    return res.status(500).json({
      success: false,
      error: 'DRAFT_GENERATION_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/ai/send-auto-reply (con validación auto_send_enabled)
// ═══════════════════════════════════════════════════════════════

router.post('/send-auto-reply', requireAuth, async (req, res) => {
  try {
    const { draftId, messageId, replyType = 'formal', instructions } = req.body;
    const userId = (req as any).user?.id;

    console.log('[AI EMAIL] Auto-reply:', { draftId, messageId });

    // Si no hay draft, generarlo primero
    let draft;
    if (draftId) {
      // Usar draft existente
      const { data, error } = await supabase
        .from('email_drafts')
        .select('*')
        .eq('id', draftId)
        .eq('owner_user_id', userId)
        .single();

      if (error || !data) {
        return res.status(404).json({
          success: false,
          error: 'DRAFT_NOT_FOUND',
          message: 'Borrador no encontrado'
        });
      }

      draft = data;
    } else if (messageId) {
      // Generar draft automático
      const draftResponse = await fetch(`${process.env.API_URL || 'http://localhost:3000'}/api/ai/draft-reply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization || ''
        },
        body: JSON.stringify({ messageId, replyType, instructions })
      });

      const draftData = await draftResponse.json();
      if (!draftData.success) {
        throw new Error(draftData.message);
      }

      draft = draftData.draft;
    } else {
      return res.status(400).json({
        success: false,
        error: 'MISSING_DRAFT_OR_MESSAGE',
        message: 'Se requiere draftId o messageId'
      });
    }

    // Obtener cuenta de email
    const { data: account, error: accountError } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('id', draft.account_id)
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .single();

    if (accountError || !account) {
      return res.status(404).json({
        success: false,
        error: 'ACCOUNT_NOT_FOUND',
        message: 'Cuenta de correo no encontrada o inactiva'
      });
    }

    // VALIDAR POLÍTICA AUTO_SEND_ENABLED
    if (!account.auto_send_enabled) {
      // MODO BORRADOR: No enviar, retornar draft
      console.log('[AI EMAIL] auto_send_enabled=false → Retornando borrador');

      return res.json({
        success: true,
        mode: 'DRAFT_ONLY',
        draft: {
          id: draft.id,
          to: draft.to_addresses,
          subject: draft.subject,
          body: draft.body_text
        },
        message: 'Borrador creado. Envío automático deshabilitado. Revisa y aprueba en la app.'
      });
    }

    // MODO AUTO-SEND: Enviar correo real
    console.log('[AI EMAIL] auto_send_enabled=true → Enviando correo real');

    // Descifrar password SMTP
    const smtpPass = decryptCredential(account.smtp_pass_enc);

    // Crear transporter
    const transporter = nodemailer.createTransport({
      host: account.smtp_host,
      port: account.smtp_port,
      secure: account.smtp_secure,
      auth: {
        user: account.smtp_user,
        pass: smtpPass
      }
    });

    // Enviar correo
    const info = await transporter.sendMail({
      from: `"${account.from_name}" <${account.from_email}>`,
      to: draft.to_addresses.join(', '),
      cc: draft.cc_addresses?.join(', '),
      bcc: draft.bcc_addresses?.join(', '),
      replyTo: account.from_email,
      subject: draft.subject,
      text: draft.body_text,
      html: draft.body_html || draft.body_text.replace(/\n/g, '<br>'),
      inReplyTo: draft.in_reply_to,
      headers: draft.in_reply_to ? {
        'In-Reply-To': draft.in_reply_to,
        'References': draft.in_reply_to
      } : undefined
    });

    if (!info.messageId) {
      throw new Error('Sin confirmación del servidor SMTP');
    }

    // Guardar en email_messages (Sent)
    const { data: sentFolder } = await supabase
      .from('email_folders')
      .select('id')
      .eq('account_id', account.id)
      .eq('folder_type', 'sent')
      .limit(1)
      .single();

    await supabase
      .from('email_messages')
      .insert({
        account_id: account.id,
        owner_user_id: userId,
        folder_id: sentFolder?.id,
        current_folder_id: sentFolder?.id,
        message_id: info.messageId,
        from_address: account.from_email,
        from_name: account.from_name,
        to_addresses: draft.to_addresses,
        cc_addresses: draft.cc_addresses || [],
        bcc_addresses: draft.bcc_addresses || [],
        subject: draft.subject,
        body_text: draft.body_text,
        body_html: draft.body_html,
        body_preview: draft.body_text.substring(0, 200),
        has_attachments: false,
        is_read: true,
        date: new Date().toISOString(),
        in_reply_to: draft.in_reply_to
      });

    // Marcar draft como enviado
    await supabase
      .from('email_drafts')
      .update({ is_sent: true, sent_at: new Date().toISOString() })
      .eq('id', draft.id);

    console.log('[AI EMAIL] Correo enviado:', info.messageId);

    return res.json({
      success: true,
      mode: 'AUTO_SENT',
      messageId: info.messageId,
      to: draft.to_addresses,
      subject: draft.subject,
      provider: account.smtp_host
    });

  } catch (error: any) {
    console.error('[AI EMAIL] Error enviando auto-reply:', error);
    return res.status(500).json({
      success: false,
      error: 'SEND_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/mail/classify (actualizar clasificación manualmente)
// ═══════════════════════════════════════════════════════════════

router.post('/classify', requireAuth, async (req, res) => {
  try {
    const { messageId, classification, category } = req.body;
    const userId = (req as any).user?.id;

    console.log('[MAIL CLASSIFY] Clasificando:', messageId, classification);

    if (!messageId || !classification) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FIELDS',
        message: 'messageId y classification son requeridos'
      });
    }

    const validClassifications = ['urgent', 'important', 'normal', 'low_priority', 'spam'];
    if (!validClassifications.includes(classification)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_CLASSIFICATION',
        message: `classification debe ser: ${validClassifications.join(', ')}`
      });
    }

    // Actualizar clasificación
    const updateData: any = { classification };
    if (category) {
      updateData.category = category;
    }

    const { data, error } = await supabase
      .from('email_messages')
      .update(updateData)
      .eq('id', messageId)
      .eq('owner_user_id', userId)
      .select('subject, from_address')
      .single();

    if (error) {
      console.error('[MAIL CLASSIFY] Error:', error);
      return res.status(500).json({
        success: false,
        error: 'DB_ERROR',
        message: 'Error actualizando clasificación'
      });
    }

    console.log('[MAIL CLASSIFY] Actualizado exitosamente');

    return res.json({
      success: true,
      messageId: messageId,
      classification: classification,
      category: category,
      subject: data?.subject
    });

  } catch (error: any) {
    console.error('[MAIL CLASSIFY] Error:', error);
    return res.status(500).json({
      success: false,
      error: 'CLASSIFY_ERROR',
      message: error.message
    });
  }
});

export default router;
