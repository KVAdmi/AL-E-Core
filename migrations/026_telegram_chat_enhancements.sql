-- =====================================================
-- MIGRATION 026: TELEGRAM CHAT ENHANCEMENTS
-- =====================================================
-- Agregar campos que el frontend necesita
-- =====================================================

-- Agregar columnas a telegram_chats
ALTER TABLE telegram_chats 
ADD COLUMN IF NOT EXISTS chat_name TEXT,
ADD COLUMN IF NOT EXISTS last_message_text TEXT,
ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS auto_send_enabled BOOLEAN NOT NULL DEFAULT false;

-- Crear índice para ordenar por último mensaje
CREATE INDEX IF NOT EXISTS idx_telegram_chats_last_message 
ON telegram_chats(owner_user_id, last_message_at DESC NULLS LAST);

COMMENT ON COLUMN telegram_chats.chat_name IS 'Nombre del chat/usuario de Telegram';
COMMENT ON COLUMN telegram_chats.last_message_text IS 'Texto del último mensaje recibido';
COMMENT ON COLUMN telegram_chats.last_message_at IS 'Timestamp del último mensaje';
COMMENT ON COLUMN telegram_chats.auto_send_enabled IS 'Si está habilitado el auto-envío de respuestas de AL-E';
