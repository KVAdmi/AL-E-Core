-- =====================================================
-- MIGRATION 014: TELEGRAM AUTO-SEND TOGGLE
-- =====================================================
-- Agrega flag auto_send_enabled a telegram_chats
-- Para compatibilidad con frontend telegram_accounts
-- =====================================================

ALTER TABLE telegram_chats
ADD COLUMN IF NOT EXISTS auto_send_enabled BOOLEAN NOT NULL DEFAULT false;

-- Índice para queries frecuentes
CREATE INDEX IF NOT EXISTS idx_telegram_chats_auto_send 
  ON telegram_chats(owner_user_id, auto_send_enabled);

-- Comentario
COMMENT ON COLUMN telegram_chats.auto_send_enabled IS 
  'Si true, AL-E puede enviar mensajes sin confirmación. Si false, requiere aprobación del usuario.';
