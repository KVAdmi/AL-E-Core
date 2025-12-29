/**
 * =====================================================
 * NOTIFICATION WORKER - AL-E CORE
 * =====================================================
 * 
 * Worker que procesa notification_jobs pendientes
 * Ejecuta cada minuto y envía notificaciones por Telegram
 * 
 * IMPORTANTE: Por ahora solo Telegram, luego email/push
 * =====================================================
 */

import { supabase } from '../db/supabase';
import { decrypt } from '../utils/encryption';
import TelegramBot from 'node-telegram-bot-api';

const WORKER_INTERVAL = 60 * 1000; // 1 minuto

/**
 * Procesar notification_jobs pendientes
 */
export async function processNotifications() {
  try {
    console.log('[WORKER] 🔔 Procesando notificaciones pendientes...');
    
    // Obtener jobs pendientes cuyo run_at <= now
    const { data: jobs, error } = await supabase
      .from('notification_jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('run_at', new Date().toISOString())
      .limit(50);
    
    if (error) {
      console.error('[WORKER] Error fetching jobs:', error);
      return;
    }
    
    if (!jobs || jobs.length === 0) {
      console.log('[WORKER] No hay notificaciones pendientes');
      return;
    }
    
    console.log(`[WORKER] Procesando ${jobs.length} notificaciones`);
    
    for (const job of jobs) {
      try {
        await processJob(job);
      } catch (error: any) {
        console.error(`[WORKER] Error processing job ${job.id}:`, error);
        
        // Marcar como failed
        await supabase
          .from('notification_jobs')
          .update({
            status: 'failed',
            last_error: error.message,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id);
      }
    }
    
  } catch (error: any) {
    console.error('[WORKER] Error general:', error);
  }
}

/**
 * Procesar un job individual
 */
async function processJob(job: any) {
  console.log(`[WORKER] Procesando job ${job.id} - Type: ${job.type}, Channel: ${job.channel}`);
  
  // Por ahora solo Telegram
  if (job.channel === 'telegram') {
    await sendTelegramNotification(job);
  } else {
    console.warn(`[WORKER] Canal no soportado aún: ${job.channel}`);
    
    // Marcar como failed
    await supabase
      .from('notification_jobs')
      .update({
        status: 'failed',
        last_error: `Canal ${job.channel} no implementado`,
        updated_at: new Date().toISOString()
      })
      .eq('id', job.id);
  }
}

/**
 * Enviar notificación por Telegram
 */
async function sendTelegramNotification(job: any) {
  // Obtener bot activo del usuario
  const { data: bot, error: botError } = await supabase
    .from('telegram_bots')
    .select('*')
    .eq('owner_user_id', job.owner_user_id)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  
  if (botError || !bot) {
    throw new Error('Bot de Telegram no configurado para este usuario');
  }
  
  // Obtener chats activos del bot
  const { data: chats, error: chatsError } = await supabase
    .from('telegram_chats')
    .select('chat_id')
    .eq('bot_id', bot.id)
    .order('last_seen_at', { ascending: false })
    .limit(1);
  
  if (chatsError || !chats || chats.length === 0) {
    throw new Error('No hay chats activos para este bot');
  }
  
  const chatId = chats[0].chat_id;
  
  // Preparar mensaje según el tipo
  let message = '';
  
  if (job.type === 'event_reminder') {
    const { title, start_at, location } = job.payload;
    const startDate = new Date(start_at);
    
    message = `🔔 Recordatorio de evento\n\n`;
    message += `📅 ${title}\n`;
    message += `🕒 ${startDate.toLocaleString('es-MX', { 
      weekday: 'long', 
      day: 'numeric', 
      month: 'long', 
      hour: '2-digit', 
      minute: '2-digit' 
    })}\n`;
    
    if (location) {
      message += `📍 ${location}`;
    }
  } else {
    // Fallback genérico
    message = `🔔 Notificación\n\n${JSON.stringify(job.payload, null, 2)}`;
  }
  
  // Enviar mensaje
  const botToken = decrypt(bot.bot_token_enc);
  const telegramBot = new TelegramBot(botToken);
  
  await telegramBot.sendMessage(chatId, message);
  
  console.log(`[WORKER] ✓ Notificación enviada - Job: ${job.id}, Chat: ${chatId}`);
  
  // Marcar como sent
  await supabase
    .from('notification_jobs')
    .update({
      status: 'sent',
      updated_at: new Date().toISOString()
    })
    .eq('id', job.id);
  
  // Guardar mensaje en historial
  await supabase
    .from('telegram_messages')
    .insert({
      owner_user_id: job.owner_user_id,
      bot_id: bot.id,
      chat_id: chatId,
      direction: 'outbound',
      text: message,
      status: 'sent'
    });
}

/**
 * Iniciar worker
 */
export function startNotificationWorker() {
  console.log('[WORKER] 🚀 Notification worker iniciado');
  
  // Ejecutar inmediatamente
  processNotifications();
  
  // Ejecutar cada minuto
  setInterval(() => {
    processNotifications();
  }, WORKER_INTERVAL);
}
