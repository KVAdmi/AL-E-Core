-- Verificar bots registrados
SELECT 
  id,
  owner_user_id,
  bot_username,
  is_active,
  webhook_url,
  webhook_set_at,
  created_at
FROM telegram_bots
ORDER BY created_at DESC;

-- Verificar chats
SELECT 
  tc.id,
  tc.owner_user_id,
  tb.bot_username,
  tc.chat_id,
  tc.telegram_username,
  tc.chat_name,
  tc.auto_send_enabled,
  tc.last_message_at
FROM telegram_chats tc
JOIN telegram_bots tb ON tc.bot_id = tb.id
ORDER BY tc.last_seen_at DESC;

-- Últimos mensajes
SELECT 
  tm.id,
  tb.bot_username,
  tm.direction,
  tm.text,
  tm.status,
  tm.created_at
FROM telegram_messages tm
JOIN telegram_bots tb ON tm.bot_id = tb.id
ORDER BY tm.created_at DESC
LIMIT 20;
