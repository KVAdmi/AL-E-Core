/**
 * =====================================================
 * TELEGRAM TOOLS - Handlers para Tool Router
 * =====================================================
 * 
 * Herramientas:
 * - telegram_send_message: Enviar mensaje simple
 * - telegram_send_confirmation: Enviar mensaje con botones interactivos
 * 
 * IMPORTANTE:
 * - Requiere bot configurado (telegram_bots)
 * - Requiere chat activo (telegram_chats)
 * - Registra en telegram_messages
 * =====================================================
 */

import axios from 'axios';
import { ToolResult } from '../registry';
import { supabase } from '../../db/supabase';
import { decrypt } from '../../utils/encryption';
import TelegramBot from 'node-telegram-bot-api';

// ═══════════════════════════════════════════════════════════════
// TELEGRAM SEND MESSAGE (Simple)
// ═══════════════════════════════════════════════════════════════

export interface TelegramSendMessageArgs {
  userId: string;
  message: string;
  chatId?: number; // Opcional, si no se pasa usa el último chat activo
}

export async function telegramSendMessageHandler(
  args: TelegramSendMessageArgs
): Promise<ToolResult> {
  try {
    const { userId, message, chatId } = args;

    console.log(`[TELEGRAM TOOL] Enviando mensaje - User: ${userId}`);

    // 1. Obtener bot activo del usuario
    const { data: bot, error: botError } = await supabase
      .from('telegram_bots')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (botError || !bot) {
      return {
        success: false,
        error: 'NO_TELEGRAM_BOT',
        timestamp: new Date().toISOString(),
        provider: 'telegram',
        data: {
          message: 'No tienes un bot de Telegram configurado. Conecta tu bot primero.'
        }
      };
    }

    // 2. Determinar chatId
    let targetChatId = chatId;

    if (!targetChatId) {
      // Usar último chat activo
      const { data: chats, error: chatsError } = await supabase
        .from('telegram_chats')
        .select('chat_id')
        .eq('bot_id', bot.id)
        .order('last_seen_at', { ascending: false })
        .limit(1);

      if (chatsError || !chats || chats.length === 0) {
        return {
          success: false,
          error: 'NO_ACTIVE_CHAT',
          timestamp: new Date().toISOString(),
          provider: 'telegram',
          data: {
            message: 'No hay chats activos. Inicia una conversación con tu bot primero.'
          }
        };
      }

      targetChatId = chats[0].chat_id;
    }

    // 3. Enviar mensaje
    const botToken = decrypt(bot.bot_token_enc);
    const telegramBot = new TelegramBot(botToken);

    const result = await telegramBot.sendMessage(targetChatId, message);

    console.log(`[TELEGRAM TOOL] ✓ Mensaje enviado - MessageId: ${result.message_id}`);

    // 4. Guardar en DB
    await supabase
      .from('telegram_messages')
      .insert({
        owner_user_id: userId,
        bot_id: bot.id,
        chat_id: targetChatId,
        direction: 'outbound',
        text: message,
        telegram_message_id: result.message_id,
        status: 'sent'
      });

    return {
      success: true,
      data: {
        messageId: result.message_id,
        chatId: targetChatId,
        message,
        sentAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      provider: 'telegram',
      source: `Telegram Bot @${bot.bot_username}`
    };

  } catch (error: any) {
    console.error('[TELEGRAM TOOL] Error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'telegram'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM SEND CONFIRMATION (Con botones interactivos)
// ═══════════════════════════════════════════════════════════════

export interface TelegramSendConfirmationArgs {
  userId: string;
  message: string;
  eventId: string; // ID del evento a confirmar
  chatId?: number;
}

export async function telegramSendConfirmationHandler(
  args: TelegramSendConfirmationArgs
): Promise<ToolResult> {
  try {
    const { userId, message, eventId, chatId } = args;

    console.log(`[TELEGRAM TOOL] Enviando confirmación - Event: ${eventId}`);

    // 1. Obtener bot activo
    const { data: bot, error: botError } = await supabase
      .from('telegram_bots')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (botError || !bot) {
      return {
        success: false,
        error: 'NO_TELEGRAM_BOT',
        timestamp: new Date().toISOString(),
        provider: 'telegram'
      };
    }

    // 2. Determinar chatId
    let targetChatId = chatId;

    if (!targetChatId) {
      const { data: chats } = await supabase
        .from('telegram_chats')
        .select('chat_id')
        .eq('bot_id', bot.id)
        .order('last_seen_at', { ascending: false })
        .limit(1);

      if (!chats || chats.length === 0) {
        return {
          success: false,
          error: 'NO_ACTIVE_CHAT',
          timestamp: new Date().toISOString(),
          provider: 'telegram'
        };
      }

      targetChatId = chats[0].chat_id;
    }

    // 3. Crear botones inline
    const botToken = decrypt(bot.bot_token_enc);
    const telegramBot = new TelegramBot(botToken);

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: '✅ Confirmar',
            callback_data: JSON.stringify({ action: 'confirm', eventId })
          },
          {
            text: '🔁 Reagendar',
            callback_data: JSON.stringify({ action: 'reschedule', eventId })
          }
        ],
        [
          {
            text: '❌ Cancelar',
            callback_data: JSON.stringify({ action: 'cancel', eventId })
          }
        ]
      ]
    };

    const result = await telegramBot.sendMessage(targetChatId, message, {
      reply_markup: keyboard
    });

    console.log(`[TELEGRAM TOOL] ✓ Confirmación enviada - MessageId: ${result.message_id}`);

    // 4. Guardar en DB
    await supabase
      .from('telegram_messages')
      .insert({
        owner_user_id: userId,
        bot_id: bot.id,
        chat_id: targetChatId,
        direction: 'outbound',
        text: message,
        telegram_message_id: result.message_id,
        status: 'sent'
      });

    return {
      success: true,
      data: {
        messageId: result.message_id,
        chatId: targetChatId,
        eventId,
        message,
        hasButtons: true,
        sentAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString(),
      provider: 'telegram',
      source: `Telegram Bot @${bot.bot_username}`
    };

  } catch (error: any) {
    console.error('[TELEGRAM TOOL] Error:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'telegram'
    };
  }
}
