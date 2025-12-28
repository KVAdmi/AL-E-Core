-- =====================================================
-- MIGRACIÓN: Colaboración Multi-Usuario
-- =====================================================
-- Agrega campos para identificar qué usuario escribió cada mensaje
-- en conversaciones compartidas entre múltiples personas

-- Agregar columnas a ae_messages
ALTER TABLE ae_messages 
  ADD COLUMN IF NOT EXISTS user_email TEXT,
  ADD COLUMN IF NOT EXISTS user_display_name TEXT;

-- Crear índice para búsquedas por usuario
CREATE INDEX IF NOT EXISTS idx_ae_messages_user_email 
  ON ae_messages(user_email);

-- Comentarios de documentación
COMMENT ON COLUMN ae_messages.user_email IS 'Email del usuario que escribió el mensaje (para multi-user)';
COMMENT ON COLUMN ae_messages.user_display_name IS 'Nombre visible del usuario (para multi-user)';

-- Verificación
SELECT 
  column_name, 
  data_type, 
  is_nullable 
FROM information_schema.columns 
WHERE table_name = 'ae_messages' 
  AND column_name IN ('user_email', 'user_display_name');
