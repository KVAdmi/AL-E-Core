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
 * - POST /api/telegram/send - Enviar mensaje
 * - GET /api/telegram/chats - Listar chats del bot
 * =====================================================
 */

import express from 'express';
import { supabase } from '../db/supabase';
import { encrypt, decrypt, generateSecret } from '../utils/encryption';
import TelegramBot from 'node-telegram-bot-api';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/telegram/bots/connect - Conectar bot de usuario
// ═══════════════════════════════════════════════════════════════

router.post('/bots/connect', async (req, res) => {
  try {
    const { ownerUserId, botUsername, botToken } = req.body;
    
    if (!ownerUserId || !botUsername || !botToken) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: ownerUserId, botUsername, botToken'
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

router.get('/bots', async (req, res) => {
  try {
    const { ownerUserId } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_OWNER_USER_ID',
        message: 'ownerUserId es requerido'
      });
    }
    
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
      const text = update.message.text;
      const messageId = update.message.message_id;
      
      console.log(`[TELEGRAM] Mensaje de @${username} (${chatId}): ${text}`);
      
      // Registrar/actualizar chat
      const { data: existingChat } = await supabase
        .from('telegram_chats')
        .select('id')
        .eq('bot_id', botId)
        .eq('chat_id', chatId)
        .maybeSingle();
      
      if (existingChat) {
        await supabase
          .from('telegram_chats')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('id', existingChat.id);
      } else {
        await supabase
          .from('telegram_chats')
          .insert({
            owner_user_id: bot.owner_user_id,
            bot_id: botId,
            chat_id: chatId,
            telegram_user_id: userId,
            telegram_username: username || null
          });
      }
      
      // Guardar mensaje inbound
      await supabase
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

router.post('/send', async (req, res) => {
  try {
    const { ownerUserId, chatId, text } = req.body;
    
    if (!ownerUserId || !chatId || !text) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_REQUIRED_FIELDS',
        message: 'Campos requeridos: ownerUserId, chatId, text'
      });
    }
    
    console.log(`[TELEGRAM] Enviando mensaje - User: ${ownerUserId}, Chat: ${chatId}`);
    
    // Obtener bot activo del usuario
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
    
    // Enviar mensaje
    let messageId;
    let status = 'sent';
    let errorText = null;
    
    try {
      const botToken = decrypt(bot.bot_token_enc);
      const telegramBot = new TelegramBot(botToken);
      
      const result = await telegramBot.sendMessage(chatId, text);
      messageId = result.message_id;
      
      console.log(`[TELEGRAM] ✓ Mensaje enviado - ID: ${messageId}`);
      
    } catch (error: any) {
      console.error('[TELEGRAM] Error sending message:', error);
      status = 'failed';
      errorText = error.message;
    }
    
    // Guardar en DB
    await supabase
      .from('telegram_messages')
      .insert({
        owner_user_id: ownerUserId,
        bot_id: bot.id,
        chat_id: chatId,
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

router.get('/chats', async (req, res) => {
  try {
    const { ownerUserId } = req.query;
    
    if (!ownerUserId) {
      return res.status(400).json({
        ok: false,
        error: 'MISSING_OWNER_USER_ID',
        message: 'ownerUserId es requerido'
      });
    }
    
    const { data, error } = await supabase
      .from('telegram_chats')
      .select('*')
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
    
    return res.json({
      ok: true,
      chats: data || []
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
