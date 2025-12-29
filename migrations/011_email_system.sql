-- =====================================================
-- MIGRATION 011: EMAIL SYSTEM (SMTP + IMAP)
-- =====================================================
-- Migración completa para sistema de email manual
-- Elimina dependencia de Gmail API
-- =====================================================

-- =====================================================
-- 1) EMAIL ACCOUNTS
-- =====================================================
CREATE TABLE IF NOT EXISTS email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  provider_label TEXT NOT NULL, -- "Gmail SMTP", "Outlook", "Hostinger", "Custom"
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  
  -- SMTP (obligatorio para envío)
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL DEFAULT 587,
  smtp_secure BOOLEAN NOT NULL DEFAULT false, -- true = SSL (465), false = TLS (587)
  smtp_user TEXT NOT NULL,
  smtp_pass_enc TEXT NOT NULL, -- ENCRIPTADO con AES-256
  
  -- IMAP (opcional para recepción)
  imap_host TEXT,
  imap_port INTEGER,
  imap_secure BOOLEAN DEFAULT true,
  imap_user TEXT,
  imap_pass_enc TEXT, -- ENCRIPTADO
  
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_email_accounts_owner ON email_accounts(owner_user_id) WHERE is_active = true;
CREATE INDEX idx_email_accounts_email ON email_accounts(from_email);

-- RLS
ALTER TABLE email_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_accounts_owner_policy ON email_accounts
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- 2) MAIL THREADS
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  subject TEXT NOT NULL,
  participants_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ email, name }]
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_mail_threads_owner ON mail_threads(owner_user_id);
CREATE INDEX idx_mail_threads_last_message ON mail_threads(last_message_at DESC);

-- RLS
ALTER TABLE mail_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_threads_owner_policy ON mail_threads
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- 3) MAIL MESSAGES
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  thread_id UUID REFERENCES mail_threads(id) ON DELETE SET NULL,
  account_id UUID REFERENCES email_accounts(id) ON DELETE CASCADE,
  
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  
  from_email TEXT NOT NULL,
  to_emails_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["email1", "email2"]
  cc_json JSONB,
  bcc_json JSONB,
  
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT,
  attachments_json JSONB, -- [{ filename, size, contentType, url }]
  
  provider_message_id TEXT, -- ID del proveedor (para tracking)
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'received')),
  error_text TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_mail_messages_owner ON mail_messages(owner_user_id);
CREATE INDEX idx_mail_messages_thread ON mail_messages(thread_id);
CREATE INDEX idx_mail_messages_status ON mail_messages(status);
CREATE INDEX idx_mail_messages_direction ON mail_messages(direction);
CREATE INDEX idx_mail_messages_created ON mail_messages(created_at DESC);

-- RLS
ALTER TABLE mail_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_messages_owner_policy ON mail_messages
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- COMENTARIOS
-- =====================================================

COMMENT ON TABLE email_accounts IS 'Cuentas de email configuradas manualmente por usuario (SMTP/IMAP)';
COMMENT ON COLUMN email_accounts.smtp_pass_enc IS 'Password SMTP encriptado con AES-256-GCM';
COMMENT ON COLUMN email_accounts.imap_pass_enc IS 'Password IMAP encriptado con AES-256-GCM';

COMMENT ON TABLE mail_threads IS 'Hilos de conversación de email';
COMMENT ON TABLE mail_messages IS 'Mensajes de email (enviados y recibidos)';
