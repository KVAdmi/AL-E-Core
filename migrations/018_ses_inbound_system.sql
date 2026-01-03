-- =====================================================
-- MIGRACIÓN 018: AWS SES INBOUND SYSTEM
-- Sistema completo de correo entrante/saliente
-- Compatible con estructura de Frontend
-- =====================================================

-- =====================================================
-- PASO 1: Extender email_accounts con AWS SES
-- =====================================================

-- Agregar columnas nuevas a email_accounts
ALTER TABLE email_accounts 
ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'smtp',
ADD COLUMN IF NOT EXISTS domain VARCHAR(255),
ADD COLUMN IF NOT EXISTS aws_region VARCHAR(50),
ADD COLUMN IF NOT EXISTS aws_access_key_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS aws_secret_access_key_enc TEXT,
ADD COLUMN IF NOT EXISTS s3_bucket VARCHAR(255),
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

-- Actualizar constraint de provider
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'email_accounts' AND constraint_name LIKE '%provider%'
  ) THEN
    ALTER TABLE email_accounts DROP CONSTRAINT IF EXISTS email_accounts_provider_check;
  END IF;
END $$;

ALTER TABLE email_accounts 
ADD CONSTRAINT email_accounts_provider_check 
CHECK (provider IN ('ses_inbound', 'ses', 'gmail', 'outlook', 'smtp', 'imap'));

-- Actualizar constraint de status
ALTER TABLE email_accounts 
ADD CONSTRAINT email_accounts_status_check 
CHECK (status IN ('active', 'paused', 'error'));

-- Índices adicionales
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider ON email_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
CREATE INDEX IF NOT EXISTS idx_email_accounts_domain ON email_accounts(domain);

COMMENT ON COLUMN email_accounts.provider IS 'Proveedor: ses_inbound, ses, gmail, outlook, smtp, imap';
COMMENT ON COLUMN email_accounts.aws_secret_access_key_enc IS 'AWS Secret Access Key encriptado con AES-256';
COMMENT ON COLUMN email_accounts.s3_bucket IS 'S3 bucket para almacenar correos entrantes (SES Rule Set)';
COMMENT ON COLUMN email_accounts.config IS 'Configuración adicional: firma, banderas, spam, etc.';

-- =====================================================
-- PASO 2: Crear mail_accounts_new (nueva estructura)
-- =====================================================

CREATE TABLE IF NOT EXISTS mail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  provider VARCHAR(50) NOT NULL CHECK (provider IN ('ses_inbound', 'ses', 'gmail', 'outlook', 'imap')),
  domain VARCHAR(255),
  
  -- AWS SES específico
  aws_region VARCHAR(50),
  aws_access_key_id VARCHAR(255),
  aws_secret_access_key_enc TEXT,
  s3_bucket VARCHAR(255),
  
  -- Configuración extendida (firma, spam, banderas)
  config JSONB DEFAULT '{}'::jsonb,
  
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  error_message TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mail_accounts_user ON mail_accounts(user_id);
CREATE INDEX idx_mail_accounts_provider ON mail_accounts(provider);
CREATE INDEX idx_mail_accounts_status ON mail_accounts(status);

ALTER TABLE mail_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_accounts_user_policy ON mail_accounts
  FOR ALL
  USING (user_id = auth.uid());

COMMENT ON TABLE mail_accounts IS 'Cuentas de email con soporte AWS SES inbound/outbound';
COMMENT ON COLUMN mail_accounts.config IS 'Configuración JSON: signature, flags, spam_filter, etc.';

-- =====================================================
-- PASO 3: mail_messages_new (con SES features)
-- =====================================================

CREATE TABLE IF NOT EXISTS mail_messages_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
  
  source VARCHAR(50) DEFAULT 'ses' CHECK (source IN ('ses', 'gmail', 'outlook', 'imap')),
  message_id VARCHAR(500) UNIQUE,
  
  -- Direcciones
  from_email VARCHAR(255),
  to_email VARCHAR(255),
  cc_emails JSONB,
  bcc_emails JSONB,
  
  -- Contenido
  subject VARCHAR(1000),
  body_text TEXT,
  body_html TEXT,
  snippet VARCHAR(300),
  
  -- Fechas
  received_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  
  -- S3 storage (para correos entrantes grandes)
  s3_bucket VARCHAR(255),
  s3_key VARCHAR(500),
  s3_url TEXT,
  
  -- Headers completos
  raw_headers JSONB,
  
  -- Estado y organización
  status VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived', 'deleted', 'spam')),
  folder VARCHAR(50) DEFAULT 'inbox',
  
  -- NUEVO: Banderas/clasificación
  flag VARCHAR(50) CHECK (flag IN ('urgent', 'important', 'pending', 'follow_up', 'low_priority')),
  
  -- NUEVO: Anti-spam
  spam_score NUMERIC(5,2),
  is_spam BOOLEAN DEFAULT FALSE,
  spam_reason TEXT,
  
  -- Adjuntos
  has_attachments BOOLEAN DEFAULT FALSE,
  attachments_json JSONB,
  
  -- Threading
  thread_id UUID,
  in_reply_to VARCHAR(500),
  references_text TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mail_messages_new_user ON mail_messages_new(user_id);
CREATE INDEX idx_mail_messages_new_account ON mail_messages_new(account_id);
CREATE INDEX idx_mail_messages_new_status ON mail_messages_new(status);
CREATE INDEX idx_mail_messages_new_folder ON mail_messages_new(folder);
CREATE INDEX idx_mail_messages_new_flag ON mail_messages_new(flag);
CREATE INDEX idx_mail_messages_new_spam ON mail_messages_new(is_spam);
CREATE INDEX idx_mail_messages_new_received ON mail_messages_new(received_at DESC);
CREATE INDEX idx_mail_messages_new_thread ON mail_messages_new(thread_id);
CREATE INDEX idx_mail_messages_new_message_id ON mail_messages_new(message_id);

ALTER TABLE mail_messages_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_messages_new_user_policy ON mail_messages_new
  FOR ALL
  USING (user_id = auth.uid());

COMMENT ON TABLE mail_messages_new IS 'Mensajes de correo con soporte completo AWS SES y features extendidos';
COMMENT ON COLUMN mail_messages_new.flag IS 'Clasificación: urgent, important, pending, follow_up, low_priority';
COMMENT ON COLUMN mail_messages_new.spam_score IS 'Score numérico de spam (0-100)';

-- =====================================================
-- PASO 4: mail_drafts_new
-- =====================================================

CREATE TABLE IF NOT EXISTS mail_drafts_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  message_id VARCHAR(500),
  account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
  
  -- Destinatarios (arrays JSON)
  to_emails JSONB DEFAULT '[]'::jsonb,
  cc_emails JSONB DEFAULT '[]'::jsonb,
  bcc_emails JSONB DEFAULT '[]'::jsonb,
  
  -- Contenido
  subject VARCHAR(1000),
  draft_text TEXT,
  draft_html TEXT,
  
  -- Adjuntos
  attachments_json JSONB,
  
  -- Estado
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'pending_send', 'sent', 'failed')),
  
  -- Envío programado
  scheduled_send_at TIMESTAMPTZ,
  
  -- Threading
  in_reply_to VARCHAR(500),
  references_text TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mail_drafts_new_user ON mail_drafts_new(user_id);
CREATE INDEX idx_mail_drafts_new_account ON mail_drafts_new(account_id);
CREATE INDEX idx_mail_drafts_new_status ON mail_drafts_new(status);
CREATE INDEX idx_mail_drafts_new_scheduled ON mail_drafts_new(scheduled_send_at);

ALTER TABLE mail_drafts_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_drafts_new_user_policy ON mail_drafts_new
  FOR ALL
  USING (user_id = auth.uid());

-- =====================================================
-- PASO 5: mail_attachments_new
-- =====================================================

CREATE TABLE IF NOT EXISTS mail_attachments_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES mail_messages_new(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES mail_drafts_new(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  
  filename VARCHAR(500) NOT NULL,
  content_type VARCHAR(255),
  size_bytes BIGINT,
  
  -- S3 storage
  s3_bucket VARCHAR(255),
  s3_key VARCHAR(500),
  download_url TEXT,
  
  -- Inline vs attachment
  is_inline BOOLEAN DEFAULT FALSE,
  content_id VARCHAR(255),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mail_attachments_new_message ON mail_attachments_new(message_id);
CREATE INDEX idx_mail_attachments_new_draft ON mail_attachments_new(draft_id);
CREATE INDEX idx_mail_attachments_new_user ON mail_attachments_new(user_id);

ALTER TABLE mail_attachments_new ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_attachments_new_user_policy ON mail_attachments_new
  FOR ALL
  USING (user_id = auth.uid());

-- =====================================================
-- PASO 6: mail_filters (reglas de clasificación)
-- =====================================================

CREATE TABLE IF NOT EXISTS mail_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Condiciones (JSON): from, subject, body, has_attachments, etc.
  conditions JSONB NOT NULL,
  
  -- Acciones (JSON): move_to_folder, mark_as_read, set_flag, mark_spam, etc.
  actions JSONB NOT NULL,
  
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mail_filters_user ON mail_filters(user_id);
CREATE INDEX idx_mail_filters_account ON mail_filters(account_id);
CREATE INDEX idx_mail_filters_active ON mail_filters(is_active);
CREATE INDEX idx_mail_filters_priority ON mail_filters(priority DESC);

ALTER TABLE mail_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY mail_filters_user_policy ON mail_filters
  FOR ALL
  USING (user_id = auth.uid());

COMMENT ON TABLE mail_filters IS 'Reglas de filtrado y clasificación automática';
COMMENT ON COLUMN mail_filters.conditions IS 'JSON: {from: "x@y.com", subject_contains: "urgent", ...}';
COMMENT ON COLUMN mail_filters.actions IS 'JSON: {folder: "work", flag: "important", mark_read: true, ...}';

-- =====================================================
-- PASO 7: mail_sync_log_new
-- =====================================================

CREATE TABLE IF NOT EXISTS mail_sync_log_new (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
  
  sync_type VARCHAR(50) CHECK (sync_type IN ('manual', 'auto', 'webhook', 'ses_notification')),
  status VARCHAR(50) CHECK (status IN ('success', 'partial', 'failed')),
  
  messages_fetched INTEGER DEFAULT 0,
  messages_new INTEGER DEFAULT 0,
  messages_updated INTEGER DEFAULT 0,
  
  errors TEXT,
  details JSONB,
  
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX idx_mail_sync_log_new_account ON mail_sync_log_new(account_id);
CREATE INDEX idx_mail_sync_log_new_started ON mail_sync_log_new(started_at DESC);
CREATE INDEX idx_mail_sync_log_new_status ON mail_sync_log_new(status);

COMMENT ON TABLE mail_sync_log_new IS 'Log de sincronizaciones de correo';

-- =====================================================
-- PASO 8: Triggers de updated_at
-- =====================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mail_accounts_updated_at BEFORE UPDATE ON mail_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER mail_messages_new_updated_at BEFORE UPDATE ON mail_messages_new
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER mail_drafts_new_updated_at BEFORE UPDATE ON mail_drafts_new
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER mail_filters_updated_at BEFORE UPDATE ON mail_filters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- PASO 9: Migración de datos (si existen cuentas viejas)
-- =====================================================

-- Migrar email_accounts a mail_accounts (si existen)
INSERT INTO mail_accounts (
  id, user_id, provider, config, status, created_at, updated_at
)
SELECT 
  id,
  owner_user_id,
  'smtp' as provider,
  jsonb_build_object(
    'smtp_host', smtp_host,
    'smtp_port', smtp_port,
    'smtp_secure', smtp_secure,
    'smtp_user', smtp_user,
    'from_email', from_email,
    'from_name', from_name
  ) as config,
  CASE WHEN is_active THEN 'active' ELSE 'paused' END as status,
  created_at,
  updated_at
FROM email_accounts
WHERE NOT EXISTS (SELECT 1 FROM mail_accounts WHERE mail_accounts.id = email_accounts.id)
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- PASO 10: Comentarios finales
-- =====================================================

COMMENT ON TABLE mail_accounts IS 'Sistema completo de correo con AWS SES inbound/outbound';
COMMENT ON TABLE mail_messages_new IS 'Mensajes con banderas, spam detection, y S3 storage';
COMMENT ON TABLE mail_drafts_new IS 'Borradores con envío programado';
COMMENT ON TABLE mail_attachments_new IS 'Adjuntos almacenados en S3';

-- =====================================================
-- FIN MIGRACIÓN 018
-- =====================================================
