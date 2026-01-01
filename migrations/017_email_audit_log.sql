-- =====================================================
-- MIGRACIÓN 017: email_audit_log (P0 CRÍTICO)
-- Auditoría de envíos de correo con evidencia SMTP
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLA: email_audit_log
-- =====================================================
-- Registro obligatorio de TODOS los envíos de correo
-- NO se permite success=true sin registro en esta tabla
-- =====================================================

CREATE TABLE IF NOT EXISTS email_audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Destinatario y remitente
  "to" VARCHAR(500) NOT NULL,
  "from" VARCHAR(500) NOT NULL,
  
  -- Contenido
  subject VARCHAR(1000) NOT NULL,
  body_text TEXT,
  body_html TEXT,
  
  -- Proveedor SMTP
  provider VARCHAR(50) NOT NULL, -- 'aws_ses', 'gmail', 'custom_smtp'
  provider_message_id VARCHAR(500), -- CRÍTICO: Message-ID del proveedor
  
  -- Estado
  status VARCHAR(50) NOT NULL CHECK (status IN ('sent', 'failed', 'pending')),
  error_message TEXT, -- Si status='failed'
  
  -- Auditoría
  sent_by_user_id UUID, -- Usuario que envió (puede ser NULL para sistema)
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_email_audit_to ON email_audit_log("to");
CREATE INDEX IF NOT EXISTS idx_email_audit_from ON email_audit_log("from");
CREATE INDEX IF NOT EXISTS idx_email_audit_provider ON email_audit_log(provider);
CREATE INDEX IF NOT EXISTS idx_email_audit_status ON email_audit_log(status);
CREATE INDEX IF NOT EXISTS idx_email_audit_user ON email_audit_log(sent_by_user_id);
CREATE INDEX IF NOT EXISTS idx_email_audit_sent_at ON email_audit_log(sent_at DESC);

-- Índice único para evitar duplicados por provider_message_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_audit_provider_msg_id 
  ON email_audit_log(provider_message_id) 
  WHERE provider_message_id IS NOT NULL;

-- =====================================================
-- RLS (Row Level Security) - DESHABILITADO
-- =====================================================
-- Nota: Para auditoría, NO usamos RLS
-- El backend tiene acceso total via service_role_key
-- =====================================================

ALTER TABLE email_audit_log DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- COMENTARIOS
-- =====================================================

COMMENT ON TABLE email_audit_log IS 'Auditoría P0 de envíos de correo con evidencia SMTP real';
COMMENT ON COLUMN email_audit_log.provider_message_id IS 'Message-ID devuelto por SMTP (AWS SES, etc). CRÍTICO para validar envío real.';
COMMENT ON COLUMN email_audit_log.status IS 'sent = enviado con éxito, failed = error SMTP, pending = en cola';

-- =====================================================
-- MIGRACIÓN COMPLETADA
-- =====================================================
