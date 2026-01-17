/**
 * =====================================================
 * TELEGRAM BOT API - AL-E CORE
 * =====================================================
 * 
 * Sistema multi-bot: cada usuario puede tener su propio bot
 * Webhook: https://api.al-eon.com/api/telegram/webhook/:botId/:secret
 * 
 * Endpoints:
 * - POST /api/telegram/bots/connect - Conectar bot de usuario
 * - GET /api/telegram/bots - Listar bots del usuario
 * - POST /api/telegram/webhook/:botId/:secret - Recibir mensajes
 * - POST /api/telegram/send - Enviar mensaje (con validación auto_send)
 * - GET /api/telegram/chats - Listar chats del bot
 * - POST /api/telegram/bot/settings - Actualizar settings (auto_send_enabled)
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { encrypt, decrypt, generateSecret } from '../utils/encryption';
import TelegramBot from 'node-telegram-bot-api';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/telegram/bots/connect - Conectar bot de usuario
// ═══════════════════════════════════════════════════════════════

router.post('/bots/connect', requireAuth, async (req, res) => {
  try {
    const ownerUserId = req.userId!; // Garantizado por requireAuth
    const { botUsername, botToken } = req.body;
    
    if (!botUsername || !botToken) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: botUsername, botToken'
      });
    }
    
    console.log(`[TELEGRAM] Conectando bot - User: ${ownerUserId}, Bot: ${botUsername}`);
    
    // Validar token con Telegram
    let botInfo;
    try {
      const bot = new TelegramBot(botToken);
      botInfo = await bot.getMe();
      
      if (botInfo.username !== botUsername.replace('@', '')) {
        return res.status(400).json({
          ok: false,
          error: 'BOT_USERNAME_MISMATCH',
          message: `El token corresponde a @${botInfo.username}, no a ${botUsername}`
        });
      }
    } catch (error: any) {
      console.error('[TELEGRAM] Error validating bot token:', error);
      return res.status(400).json({
        ok: false,
        error: 'INVALID_BOT_TOKEN',
        message: 'Token de bot inválido o bot no existe'
      });
    }
    
    // Encriptar token y generar secret
    const botTokenEnc = encrypt(botToken);
    const webhookSecret = generateSecret(32);
    
    // Insertar/Actualizar bot en DB
    const { data: existingBot } = await supabase
      .from('telegram_bots')
      .select('id')
      .eq('owner_user_id', ownerUserId)
      .eq('bot_username', botUsername)
      .maybeSingle();
    
    let botId;
    
    if (existingBot) {
      // Actualizar bot existente
      const { data, error } = await supabase
        .from('telegram_bots')
        .update({
          bot_token_enc: botTokenEnc,
          webhook_secret: webhookSecret,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingBot.id)
        .select()
        .single();
      
      if (error) {
        console.error('[TELEGRAM] Error updating bot:', error);
        return res.status(500).json({
          ok: false,
          error: 'DB_ERROR',
          message: error.message
        });
      }
      
      botId = data.id;
      console.log(`[TELEGRAM] ✓ Bot actualizado: ${botId}`);
      
    } else {
      // Crear nuevo bot
      const { data, error } = await supabase
        .from('telegram_bots')
        .insert({
          owner_user_id: ownerUserId,
          bot_username: botUsername,
          bot_token_enc: botTokenEnc,
          webhook_secret: webhookSecret,
          is_active: true
        })
        .select()
        .single();
      
      if (error) {
        console.error('[TELEGRAM] Error creating bot:', error);
        return res.status(500).json({
          ok: false,
          error: 'DB_ERROR',
          message: error.message
        });
      }
      
      botId = data.id;
      console.log(`[TELEGRAM] ✓ Bot creado: ${botId}`);
    }
    
    // Configurar webhook en Telegram
    const webhookUrl = `https://api.al-eon.com/api/telegram/webhook/${botId}/${webhookSecret}`;
    
    try {
      const bot = new TelegramBot(botToken);
      await bot.setWebHook(webhookUrl);
      
      // Guardar URL de webhook en DB
      await supabase
        .from('telegram_bots')
        .update({
          webhook_url: webhookUrl,
          webhook_set_at: new Date().toISOString()
        })
        .eq('id', botId);
      
      console.log(`[TELEGRAM] ✓ Webhook configurado: ${webhookUrl}`);
      
    } catch (error: any) {
      console.error('[TELEGRAM] Error setting webhook:', error);
      return res.status(500).json({
        ok: false,
        error: 'WEBHOOK_ERROR',
        message: 'Error configurando webhook en Telegram',
        details: error.message
      });
    }
    
    return res.json({
      ok: true,
      message: 'Bot conectado exitosamente',
      bot: {
        id: botId,
        username: botUsername,
        webhookUrl
      }
    });
    
  } catch (error: any) {
    console.error('[TELEGRAM] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/telegram/bots - Listar bots del usuario
// ═══════════════════════════════════════════════════════════════

router.get('/bots', requireAuth, async (req, res) => {
  try {
    const ownerUserId = req.userId!; // Garantizado por requireAuth
    
    const { data, error } = await supabase
      .from('telegram_bots')
      .select('id, bot_username, webhook_url, webhook_set_at, is_active, created_at, updated_at')
      .eq('owner_user_id', ownerUserId)
      .eq('is_active', true)
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('[TELEGRAM] Error fetching bots:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    return res.json({
      ok: true,
      bots: data || []
    });
    
  } catch (error: any) {
    console.error('[TELEGRAM] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/telegram/webhook/:botId/:secret - Recibir mensajes
// ═══════════════════════════════════════════════════════════════

router.post('/webhook/:botId/:secret', async (req, res) => {
  try {
    const { botId, secret } = req.params;
    const update = req.body;
    
    console.log(`[TELEGRAM] Webhook recibido - Bot: ${botId}`);
    
    // Validar botId y secret
    const { data: bot, error: botError } = await supabase
      .from('telegram_bots')
      .select('*')
      .eq('id', botId)
      .eq('webhook_secret', secret)
      .eq('is_active', true)
      .single();
    
    if (botError || !bot) {
      console.error('[TELEGRAM] Invalid botId or secret');
      return res.status(403).json({
        ok: false,
        error: 'INVALID_BOT_OR_SECRET',
        message: 'Bot no encontrado o secret inválido'
      });
    }
    
    // Procesar mensaje
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const userId = update.message.from.id;
      const username = update.message.from.username;
      const firstName = update.message.from.first_name;
      const lastName = update.message.from.last_name;
      const text = update.message.text;
      const messageId = update.message.message_id;
      const messageDate = new Date(update.message.date * 1000); // Unix timestamp to Date
      
      // Construir nombre del chat
      const chatName = firstName && lastName 
        ? `${firstName} ${lastName}` 
        : firstName || username || `Usuario ${userId}`;
      
      console.log(`[TELEGRAM] Mensaje de ${chatName} (@${username}) [${chatId}]: ${text}`);
      
      // Registrar/actualizar chat
      const { data: existingChat, error: chatSelectError } = await supabase
        .from('telegram_chats')
        .select('id')
        .eq('bot_id', botId)
        .eq('chat_id', chatId)
        .maybeSingle();
      
      if (chatSelectError) {
        console.error('[TELEGRAM] Error checking existing chat:', chatSelectError);
      }
      
      if (existingChat) {
        const { error: chatUpdateError } = await supabase
          .from('telegram_chats')
          .update({ 
            chat_name: chatName,
            last_message_text: text,
            last_message_at: messageDate.toISOString(),
            last_seen_at: new Date().toISOString() 
          })
          .eq('id', existingChat.id);
        
        if (chatUpdateError) {
          console.error('[TELEGRAM] Error updating chat:', chatUpdateError);
        } else {
          console.log(`[TELEGRAM] ✓ Chat actualizado: ${existingChat.id}`);
        }
      } else {
        const { data: newChat, error: chatInsertError } = await supabase
          .from('telegram_chats')
          .insert({
            owner_user_id: bot.owner_user_id,
            bot_id: botId,
            chat_id: chatId,
            telegram_user_id: userId,
            telegram_username: username || null,
            chat_name: chatName,
            last_message_text: text,
            last_message_at: messageDate.toISOString()
          })
          .select()
          .single();
        
        if (chatInsertError) {
          console.error('[TELEGRAM] Error creating chat:', chatInsertError);
        } else {
          console.log(`[TELEGRAM] ✓ Chat creado: ${newChat.id}`);
        }
      }
      
      // Guardar mensaje inbound
      const { error: messageError } = await supabase
        .from('telegram_messages')
        .insert({
          owner_user_id: bot.owner_user_id,
          bot_id: botId,
          chat_id: chatId,
          direction: 'inbound',
          text,
          telegram_message_id: messageId,
          status: 'received'
        });
      
      if (messageError) {
        console.error('[TELEGRAM] Error saving message:', messageError);
      } else {
        console.log(`[TELEGRAM] ✓ Mensaje guardado: ${messageId}`);
      }
      
      // TODO: Enviar a orchestrator para procesamiento
      // Por ahora, responder con mensaje simple
      try {
        const botToken = decrypt(bot.bot_token_enc);
        const telegramBot = new TelegramBot(botToken);
        
        await telegramBot.sendMessage(chatId, `Recibí tu mensaje: "${text}"\n\nIntegración con AL-E en proceso...`);
        
        console.log(`[TELEGRAM] ✓ Respuesta enviada a ${chatId}`);
      } catch (error) {
        console.error('[TELEGRAM] Error sending response:', error);
      }
    }

    // Procesar callback_query (botones)
    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;
      const callbackData = callbackQuery.data;

      console.log(`[TELEGRAM] Callback recibido - Chat: ${chatId}, Data: ${callbackData}`);

      try {
        const data = JSON.parse(callbackData);
        const { action, eventId } = data;

        const botToken = decrypt(bot.bot_token_enc);
        const telegramBot = new TelegramBot(botToken);

        // Ejecutar acción según el botón presionado
        if (action === 'confirm') {
          // Confirmar evento
          const { data: event, error: updateError } = await supabase
            .from('calendar_events')
            .update({ status: 'confirmed', updated_at: new Date().toISOString() })
            .eq('id', eventId)
            .eq('owner_user_id', bot.owner_user_id)
            .select()
            .single();

          if (updateError || !event) {
            await telegramBot.answerCallbackQuery(callbackQuery.id, {
              text: '❌ Error: evento no encontrado',
              show_alert: true
            });
          } else {
            // Actualizar mensaje
            await telegramBot.editMessageText(
              `✅ Evento confirmado\n\n📅 ${event.title}\n🕒 ${new Date(event.start_at).toLocaleString('es-MX')}`,
              {
                chat_id: chatId,
                message_id: messageId
              }
            );

            await telegramBot.answerCallbackQuery(callbackQuery.id, {
              text: '✅ Evento confirmado exitosamente'
            });

            console.log(`[TELEGRAM] ✓ Evento confirmado - ID: ${eventId}`);
          }

        } else if (action === 'cancel') {
          // Cancelar evento
          const { data: event, error: updateError } = await supabase
            .from('calendar_events')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', eventId)
            .eq('owner_user_id', bot.owner_user_id)
            .select()
            .single();

          if (updateError || !event) {
            await telegramBot.answerCallbackQuery(callbackQuery.id, {
              text: '❌ Error: evento no encontrado',
              show_alert: true
            });
          } else {
            await telegramBot.editMessageText(
              `❌ Evento cancelado\n\n📅 ${event.title}\n🕒 ${new Date(event.start_at).toLocaleString('es-MX')}`,
              {
                chat_id: chatId,
                message_id: messageId
              }
            );

            await telegramBot.answerCallbackQuery(callbackQuery.id, {
              text: '❌ Evento cancelado'
            });

            console.log(`[TELEGRAM] ✓ Evento cancelado - ID: ${eventId}`);
          }

        } else if (action === 'reschedule') {
          // Reagendar: solo notificar al usuario que debe hacerlo manualmente
          await telegramBot.answerCallbackQuery(callbackQuery.id, {
            text: '🔁 Dime la nueva fecha por mensaje',
            show_alert: true
          });

          await telegramBot.sendMessage(chatId, 
            '🔁 Para reagendar, dime la nueva fecha y hora.\n\nEjemplo: "Mueve mi cita al viernes a las 3pm"'
          );
        }

      } catch (error: any) {
        console.error('[TELEGRAM] Error processing callback:', error);
        
        const botToken = decrypt(bot.bot_token_enc);
        const telegramBot = new TelegramBot(botToken);
        
        await telegramBot.answerCallbackQuery(callbackQuery.id, {
          text: '❌ Error procesando acción',
          show_alert: true
        });
      }
    }
    
    // Responder 200 OK a Telegram (obligatorio)
    return res.json({ ok: true });
    
  } catch (error: any) {
    console.error('[TELEGRAM] Webhook error:', error);
    // Siempre responder 200 a Telegram para evitar reintentos
    return res.json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/telegram/send - Enviar mensaje
// ═══════════════════════════════════════════════════════════════

router.post('/send', requireAuth, async (req, res) => {
  try {
    const ownerUserId = req.userId; // Del middleware requireAuth
    const { chatId, text } = req.body;
    
    if (!chatId || !text) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: chatId, text'
      });
    }
    
    console.log(`[TELEGRAM] Enviando mensaje - User: ${ownerUserId}, Chat: ${chatId}`);
    
    // 1. Obtener bot activo del usuario
    const { data: bot, error: botError } = await supabase
      .from('telegram_bots')
      .select('*')
      .eq('owner_user_id', ownerUserId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (botError || !bot) {
      return res.status(404).json({
        ok: false,
        error: 'BOT_NOT_FOUND',
        message: 'No tienes un bot de Telegram configurado'
      });
    }

    // 2. Obtener chat y validar auto_send_enabled
    const { data: chat, error: chatError } = await supabase
      .from('telegram_chats')
      .select('auto_send_enabled, chat_id')
      .eq('bot_id', bot.id)
      .eq('owner_user_id', ownerUserId)
      .order('last_seen_at', { ascending: false })
      .limit(1)
      .single();

    if (chatError || !chat) {
      return res.status(404).json({
        ok: false,
        error: 'CHAT_NOT_FOUND',
        message: 'No hay chats activos. Inicia conversación con tu bot primero.'
      });
    }

    // 3. Validar auto_send_enabled
    if (!chat.auto_send_enabled) {
      console.log(`[TELEGRAM] ⚠️ Auto-send desactivado - devolviendo borrador`);
      return res.json({
        ok: true,
        requires_approval: true,
        draft: {
          text,
          chatId: chat.chat_id,
          message: 'Auto-send desactivado. Actívalo en settings o aprueba este mensaje manualmente.'
        }
      });
    }
    
    // 4. Enviar mensaje (auto_send_enabled = true)
    let messageId;
    let status = 'sent';
    let errorText = null;
    
    try {
      const botToken = decrypt(bot.bot_token_enc);
      const telegramBot = new TelegramBot(botToken);
      
      const result = await telegramBot.sendMessage(chat.chat_id, text);
      messageId = result.message_id;
      
      console.log(`[TELEGRAM] ✓ Mensaje enviado - ID: ${messageId}`);
      
    } catch (error: any) {
      console.error('[TELEGRAM] Error sending message:', error);
      status = 'failed';
      errorText = error.message;
    }
    
    // 5. Guardar en DB con evidencia
    await supabase
      .from('telegram_messages')
      .insert({
        owner_user_id: ownerUserId,
        bot_id: bot.id,
        chat_id: chat.chat_id,
        direction: 'outbound',
        text,
        telegram_message_id: messageId || null,
        status,
        error_text: errorText
      });
    
    if (status === 'failed') {
      return res.status(500).json({
        ok: false,
        error: 'TELEGRAM_ERROR',
        message: 'Error enviando mensaje',
        details: errorText
      });
    }
    
    return res.json({
      ok: true,
      message: 'Mensaje enviado exitosamente',
      messageId
    });
    
  } catch (error: any) {
    console.error('[TELEGRAM] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/telegram/chats - Listar chats del usuario
// ═══════════════════════════════════════════════════════════════

router.get('/chats', requireAuth, async (req, res) => {
  try {
    const ownerUserId = req.userId!; // Garantizado por requireAuth
    
    // Obtener chats con info del bot
    const { data, error } = await supabase
      .from('telegram_chats')
      .select(`
        id,
        chat_id,
        telegram_username,
        auto_send_enabled,
        first_seen_at,
        last_seen_at,
        bot_id
      `)
      .eq('owner_user_id', ownerUserId)
      .order('last_seen_at', { ascending: false });
    
    if (error) {
      console.error('[TELEGRAM] Error fetching chats:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    // Formatear para frontend (compatibilidad telegram_accounts)
    const chats = (data || []).map(chat => ({
      chatId: chat.id, // UUID del chat
      title: chat.telegram_username ? `@${chat.telegram_username}` : `Chat ${chat.chat_id}`,
      username: chat.telegram_username,
      connected: true,
      auto_send_enabled: chat.auto_send_enabled || false,
      last_seen_at: chat.last_seen_at
    }));
    
    return res.json({
      ok: true,
      chats
    });
    
  } catch (error: any) {
    console.error('[TELEGRAM] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/telegram/bot/settings - Actualizar settings del chat
// ═══════════════════════════════════════════════════════════════

router.post('/bot/settings', requireAuth, async (req, res) => {
  try {
    const { chatId, auto_send_enabled } = req.body;
    
    if (!chatId || auto_send_enabled === undefined) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: chatId, auto_send_enabled'
      });
    }
    
    console.log(`[TELEGRAM] Actualizando settings - Chat: ${chatId}, auto_send: ${auto_send_enabled}`);
    
    // Actualizar telegram_chats
    const { data, error } = await supabase
      .from('telegram_chats')
      .update({ 
        auto_send_enabled,
        last_seen_at: new Date().toISOString()
      })
      .eq('id', chatId)
      .select()
      .single();
    
    if (error) {
      console.error('[TELEGRAM] Error updating settings:', error);
      return res.status(500).json({
        ok: false,
        error: 'DB_ERROR',
        message: error.message
      });
    }
    
    if (!data) {
      return res.status(404).json({
        ok: false,
        error: 'CHAT_NOT_FOUND',
        message: 'Chat no encontrado'
      });
    }
    
    console.log(`[TELEGRAM] ✓ Settings actualizados - Chat: ${chatId}`);
    
    return res.json({
      ok: true,
      message: 'Settings actualizados exitosamente',
      chat: {
        chatId: data.id,
        auto_send_enabled: data.auto_send_enabled
      }
    });
    
  } catch (error: any) {
    console.error('[TELEGRAM] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/telegram/messages - Obtener mensajes de un chat
// ═══════════════════════════════════════════════════════════════

router.get('/messages', requireAuth, async (req, res) => {
  try {
    const ownerUserId = req.userId!; // Garantizado por requireAuth
    const { chatId } = req.query;
    
    if (!chatId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_CHAT_ID',
        message: 'Parámetro requerido: chatId'
      });
    }
    
    // Primero verificar que el chat pertenezca al usuario
    const { data: chat, error: chatError } = await supabase
      .from('telegram_chats')
      .select('id, bot_id, chat_id')
      .eq('id', chatId as string)
      .eq('owner_user_id', ownerUserId)
      .single();
    
    if (chatError || !chat) {
      return res.status(404).json({
        ok: false,
        error: 'CHAT_NOT_FOUND',
        message: 'Chat no encontrado o no pertenece al usuario'
      });
    }
    
    // Obtener mensajes del chat (últimos 100)
    // 🔒 P0 FIX: Query incluye BOTH incoming + outgoing (no filtra direction)
    console.log(`[TELEGRAM] 📨 Fetching messages for chat ${chatId}`);
    const { data: messages, error: messagesError } = await supabase
      .from('telegram_messages')
      .select('id, text, direction, status, telegram_message_id, created_at')
      .eq('owner_user_id', ownerUserId)
      .eq('bot_id', chat.bot_id)
      .eq('chat_id', chat.chat_id)
      .order('created_at', { ascending: true })
      .limit(100);
    
    if (messagesError) {
      console.error('[TELEGRAM] Error fetching messages:', messagesError);
      return res.status(500).json({
        success: false,
        safe_message: 'Tuvimos un problema cargando los mensajes de Telegram',
        metadata: {
          reason: 'db_error',
          error: messagesError.message,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // Log de diagnóstico
    const inboundCount = messages?.filter(m => m.direction === 'inbound').length || 0;
    const outboundCount = messages?.filter(m => m.direction === 'outbound').length || 0;
    console.log(`[TELEGRAM] ✅ Loaded ${messages?.length || 0} messages (${inboundCount} inbound, ${outboundCount} outbound)`);
    
    // Formatear mensajes para el frontend
    // 🔥 FIX P0: Agregar campos que espera el frontend (incoming, date, from)
    const formattedMessages = (messages || []).map(msg => ({
      id: msg.id,
      text: msg.text,
      incoming: msg.direction === 'inbound', // ✅ Campo requerido por frontend
      direction: msg.direction,
      sender_type: msg.direction === 'inbound' ? 'user' : 'bot',
      date: msg.created_at, // ✅ Frontend espera "date" no "sent_at"
      sent_at: msg.created_at,
      status: msg.status,
      from: { // ✅ Objeto "from" requerido por frontend
        id: msg.direction === 'inbound' ? 'user' : 'bot',
        name: msg.direction === 'inbound' ? 'Usuario' : 'AL-E Bot',
        isBot: msg.direction === 'outbound'
      }
    }));
    
    console.log(`[TELEGRAM] 📤 Returning ${formattedMessages.length} messages to frontend`);
    if (formattedMessages.length > 0) {
      console.log('[TELEGRAM] 📋 Sample message:', JSON.stringify(formattedMessages[0], null, 2));
    }
    
    return res.json({
      ok: true,
      messages: formattedMessages
    });
    
  } catch (error: any) {
    console.error('[TELEGRAM] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'INTERNAL_ERROR',
      message: error.message
    });
  }
});

export default router;
