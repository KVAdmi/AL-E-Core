-- =====================================================
-- MIGRATION 013: TELEGRAM BOT POR USUARIO
-- =====================================================
-- Sistema multi-bot: cada usuario puede tener su bot
-- Webhook: https://api.al-eon.com/api/telegram/webhook/:botId/:secret
-- =====================================================

-- =====================================================
-- 1) TELEGRAM BOTS
-- =====================================================
CREATE TABLE IF NOT EXISTS telegram_bots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  
  bot_username TEXT NOT NULL, -- @mi_bot
  bot_token_enc TEXT NOT NULL, -- Token encriptado con AES-256
  webhook_secret TEXT NOT NULL, -- Secret para validar webhook
  
  webhook_url TEXT, -- URL completa del webhook configurado
  webhook_set_at TIMESTAMPTZ, -- Última vez que se configuró webhook
  
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE UNIQUE INDEX idx_telegram_bots_username ON telegram_bots(bot_username) WHERE is_active = true;
CREATE INDEX idx_telegram_bots_owner ON telegram_bots(owner_user_id);

-- RLS
ALTER TABLE telegram_bots ENABLE ROW LEVEL SECURITY;

CREATE POLICY telegram_bots_owner_policy ON telegram_bots
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- 2) TELEGRAM CHATS
-- =====================================================
CREATE TABLE IF NOT EXISTS telegram_chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  bot_id UUID NOT NULL REFERENCES telegram_bots(id) ON DELETE CASCADE,
  
  chat_id BIGINT NOT NULL, -- Chat ID de Telegram (puede ser negativo para grupos)
  telegram_user_id BIGINT, -- User ID de Telegram (si es chat personal)
  telegram_username TEXT, -- @username de Telegram
  
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE UNIQUE INDEX idx_telegram_chats_bot_chat ON telegram_chats(bot_id, chat_id);
CREATE INDEX idx_telegram_chats_owner ON telegram_chats(owner_user_id);

-- RLS
ALTER TABLE telegram_chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY telegram_chats_owner_policy ON telegram_chats
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- 3) TELEGRAM MESSAGES
-- =====================================================
CREATE TABLE IF NOT EXISTS telegram_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  bot_id UUID NOT NULL REFERENCES telegram_bots(id) ON DELETE CASCADE,
  
  chat_id BIGINT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  
  text TEXT NOT NULL,
  telegram_message_id BIGINT, -- ID del mensaje en Telegram
  
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('sent', 'failed', 'received')),
  error_text TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_telegram_messages_owner ON telegram_messages(owner_user_id);
CREATE INDEX idx_telegram_messages_bot ON telegram_messages(bot_id);
CREATE INDEX idx_telegram_messages_chat ON telegram_messages(chat_id);
CREATE INDEX idx_telegram_messages_created ON telegram_messages(created_at DESC);

-- RLS
ALTER TABLE telegram_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY telegram_messages_owner_policy ON telegram_messages
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- COMENTARIOS
-- =====================================================

COMMENT ON TABLE telegram_bots IS 'Bots de Telegram por usuario (multi-bot architecture)';
COMMENT ON COLUMN telegram_bots.bot_token_enc IS 'Token de bot encriptado con AES-256-GCM';
COMMENT ON COLUMN telegram_bots.webhook_secret IS 'Secret para validar webhooks entrantes';

COMMENT ON TABLE telegram_chats IS 'Chats activos de cada bot';
COMMENT ON TABLE telegram_messages IS 'Historial de mensajes de Telegram';
