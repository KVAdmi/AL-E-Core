/**
 * MAIL INTERNAL ACTIONS
 * Ejecuta acciones de correo desde Action Gateway
 */

import { ActionResult } from './actionGateway';
import { supabase } from '../db/supabase';
import { generate as llmGenerate } from '../llm/router';

/**
 * Ejecuta acción de correo basada en mensaje del usuario
 */
export async function executeMailAction(
  userMessage: string,
  userId: string
): Promise<ActionResult> {
  
  console.log(`[MAIL_INTERNAL] Executing mail action for user: ${userId}`);
  console.log(`[MAIL_INTERNAL] User message: "${userMessage.substring(0, 100)}"`);

  try {
    // Detectar intención específica
    const lowerMsg = userMessage.toLowerCase();
    
    // ═══════════════════════════════════════════════════════════════
    // 1. LEER CORREOS NO LEÍDOS
    // ═══════════════════════════════════════════════════════════════
    if (lowerMsg.includes('correo') && (lowerMsg.includes('nuevo') || lowerMsg.includes('sin leer') || lowerMsg.includes('no leído'))) {
      console.log('[MAIL_INTERNAL] 📧 Fetching unread emails...');
      
      const { data: messages, error } = await supabase
        .from('mail_messages')
        .select('id, from_email, from_name, subject, snippet, received_at')
        .eq('user_id', userId)
        .eq('status', 'new')
        .order('received_at', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[MAIL_INTERNAL] Error fetching emails:', error);
        return {
          success: false,
          action: 'mail.inbox.read',
          evidence: null,
          userMessage: 'No pude acceder a tu bandeja de entrada.',
          reason: error.message
        };
      }

      if (!messages || messages.length === 0) {
        return {
          success: true,
          action: 'mail.inbox.read',
          evidence: { count: 0 },
          userMessage: 'No tienes correos nuevos sin leer. 📬'
        };
      }

      // Formatear resumen
      const summary = messages.map((m, idx) => {
        const fromName = m.from_name || m.from_email;
        const date = new Date(m.received_at).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit'
        });
        return `${idx + 1}. **${fromName}**\n   ${m.subject}\n   _${m.snippet.substring(0, 80)}..._\n   ${date}`;
      }).join('\n\n');

      return {
        success: true,
        action: 'mail.inbox.read',
        evidence: {
          count: messages.length,
          messages: messages.map(m => ({ id: m.id, from: m.from_email, subject: m.subject }))
        },
        userMessage: `Tienes **${messages.length} correo${messages.length > 1 ? 's' : ''}** sin leer:\n\n${summary}`
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // 2. RESPONDER ÚLTIMO CORREO
    // ═══════════════════════════════════════════════════════════════
    if (lowerMsg.includes('respond') || lowerMsg.includes('contestar') || lowerMsg.includes('responder')) {
      console.log('[MAIL_INTERNAL] ✍️ Generating reply for last email...');
      
      // Obtener último correo
      const { data: lastMessage, error } = await supabase
        .from('mail_messages')
        .select('*')
        .eq('user_id', userId)
        .eq('folder', 'inbox')
        .order('received_at', { ascending: false })
        .limit(1)
        .single();

      if (error || !lastMessage) {
        return {
          success: false,
          action: 'mail.reply',
          evidence: null,
          userMessage: 'No encontré ningún correo para responder.',
          reason: error?.message
        };
      }

      // Generar borrador con AI
      const prompt = `
Genera una respuesta profesional para este correo:

**De:** ${lastMessage.from_email} ${lastMessage.from_name ? `(${lastMessage.from_name})` : ''}
**Asunto:** ${lastMessage.subject}
**Contenido:**
${lastMessage.body_text || lastMessage.snippet}

Genera SOLO el texto de respuesta, sin saludos ni despedidas. Sé directo y profesional.
`.trim();

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
          message_id: lastMessage.id,
          account_id: lastMessage.account_id,
          to_emails: [{ email: lastMessage.from_email, name: lastMessage.from_name }],
          subject: `Re: ${lastMessage.subject}`,
          draft_text: draftText,
          status: 'draft'
        })
        .select()
        .single();

      if (draftError) {
        console.error('[MAIL_INTERNAL] Error saving draft:', draftError);
        return {
          success: false,
          action: 'mail.reply',
          evidence: null,
          userMessage: 'No pude guardar el borrador de respuesta.',
          reason: draftError.message
        };
      }

      return {
        success: true,
        action: 'mail.reply',
        evidence: {
          draftId: draft.id,
          messageId: lastMessage.id,
          to: lastMessage.from_email
        },
        userMessage: `Generé un borrador de respuesta para **${lastMessage.from_email}**:\n\n---\n${draftText}\n---\n\n¿Quieres que lo envíe o lo modifico?`
      };
    }

    // ═══════════════════════════════════════════════════════════════
    // 3. DEFAULT: Consulta genérica sobre correos
    // ═══════════════════════════════════════════════════════════════
    console.log('[MAIL_INTERNAL] 📊 Getting inbox summary...');
    
    const { data: stats, error: statsError } = await supabase
      .from('mail_messages')
      .select('status')
      .eq('user_id', userId);

    if (statsError || !stats) {
      return {
        success: false,
        action: 'mail.inbox',
        evidence: null,
        userMessage: 'No pude acceder a tu bandeja de entrada.',
        reason: statsError?.message
      };
    }

    const newCount = stats.filter(m => m.status === 'new').length;
    const totalCount = stats.length;

    return {
      success: true,
      action: 'mail.inbox.summary',
      evidence: { new: newCount, total: totalCount },
      userMessage: `Tienes **${newCount} correo${newCount !== 1 ? 's' : ''} nuevo${newCount !== 1 ? 's' : ''}** de un total de **${totalCount}**.\n\n¿Quieres que te muestre los correos sin leer?`
    };

  } catch (error: any) {
    console.error('[MAIL_INTERNAL] Exception:', error);
    return {
      success: false,
      action: 'mail.inbox',
      evidence: null,
      userMessage: 'Hubo un error al procesar tu solicitud de correo.',
      reason: error.message
    };
  }
}
