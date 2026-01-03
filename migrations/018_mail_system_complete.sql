-- =====================================================
-- MIGRATION 018: Sistema Completo de Correo AWS SES
-- =====================================================
-- Implementa sistema de correo inbound/outbound con:
-- - Cuentas de correo multi-proveedor
-- - Mensajes con soporte S3, spam, banderas
-- - Borradores con envío programado
-- - Adjuntos con storage S3
-- - Filtros y reglas
-- - Log de sincronización
-- =====================================================

-- =====================================================
-- 1. MAIL ACCOUNTS
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Provider
  provider TEXT NOT NULL CHECK (provider IN ('ses_inbound', 'ses', 'gmail', 'outlook', 'imap')),
  email_address TEXT,
  domain TEXT,
  display_name TEXT,
  
  -- AWS SES Config
  aws_region TEXT,
  aws_access_key_id TEXT,
  aws_secret_access_key_enc TEXT, -- Encriptado
  s3_bucket TEXT,
  s3_prefix TEXT DEFAULT 'inbound/',
  
  -- SMTP Config (para outbound)
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_user TEXT,
  smtp_pass_enc TEXT, -- Encriptado
  
  -- OAuth Config (Gmail/Outlook)
  oauth_provider TEXT,
  oauth_access_token_enc TEXT,
  oauth_refresh_token_enc TEXT,
  oauth_token_expires_at TIMESTAMPTZ,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'pending_verification')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  
  -- Signature
  signature_text TEXT,
  signature_image_url TEXT,
  
  -- Filters Config
  spam_filter_enabled BOOLEAN DEFAULT true,
  auto_flag_enabled BOOLEAN DEFAULT false,
  
  -- Metadata
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mail_accounts_user ON mail_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_provider ON mail_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_mail_accounts_domain ON mail_accounts(domain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_accounts_user_email ON mail_accounts(user_id, email_address) WHERE email_address IS NOT NULL;

-- RLS
ALTER TABLE mail_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mail accounts"
  ON mail_accounts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mail accounts"
  ON mail_accounts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mail accounts"
  ON mail_accounts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mail accounts"
  ON mail_accounts FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 2. MAIL MESSAGES
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES mail_accounts(id) ON DELETE SET NULL,
  
  -- Source
  source TEXT NOT NULL DEFAULT 'ses' CHECK (source IN ('ses', 'gmail', 'outlook', 'imap', 'manual')),
  message_id TEXT UNIQUE NOT NULL, -- Email header Message-ID
  
  -- Participants
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  to_name TEXT,
  cc_emails JSONB DEFAULT '[]'::jsonb,
  bcc_emails JSONB DEFAULT '[]'::jsonb,
  reply_to TEXT,
  
  -- Content
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  snippet TEXT, -- First 200 chars
  
  -- Timestamps
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  
  -- S3 Storage
  s3_bucket TEXT,
  s3_key TEXT,
  s3_url TEXT,
  s3_region TEXT DEFAULT 'us-east-1',
  
  -- Headers
  raw_headers JSONB DEFAULT '{}'::jsonb,
  
  -- Status & Organization
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'archived', 'deleted', 'spam', 'unassigned')),
  folder TEXT DEFAULT 'inbox' CHECK (folder IN ('inbox', 'sent', 'drafts', 'spam', 'trash', 'archive')),
  
  -- Flags & Classification
  flag TEXT CHECK (flag IN ('urgent', 'important', 'pending', 'follow_up', 'low_priority')),
  is_starred BOOLEAN DEFAULT false,
  
  -- Spam Detection
  spam_score NUMERIC(5,2),
  is_spam BOOLEAN DEFAULT false,
  spam_reason TEXT,
  
  -- Attachments
  has_attachments BOOLEAN DEFAULT false,
  attachments_json JSONB DEFAULT '[]'::jsonb,
  attachments_count INTEGER DEFAULT 0,
  
  -- Threading
  thread_id UUID,
  in_reply_to TEXT,
  references_text TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mail_messages_user ON mail_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_account ON mail_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_message_id ON mail_messages(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_from ON mail_messages(from_email);
CREATE INDEX IF NOT EXISTS idx_mail_messages_to ON mail_messages(to_email);
CREATE INDEX IF NOT EXISTS idx_mail_messages_received ON mail_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_status ON mail_messages(status);
CREATE INDEX IF NOT EXISTS idx_mail_messages_folder ON mail_messages(folder);
CREATE INDEX IF NOT EXISTS idx_mail_messages_thread ON mail_messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_mail_messages_spam ON mail_messages(is_spam);
CREATE INDEX IF NOT EXISTS idx_mail_messages_flag ON mail_messages(flag) WHERE flag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mail_messages_user_received ON mail_messages(user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_user_status ON mail_messages(user_id, status);

-- RLS
ALTER TABLE mail_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mail messages"
  ON mail_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mail messages"
  ON mail_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mail messages"
  ON mail_messages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mail messages"
  ON mail_messages FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 3. MAIL DRAFTS
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message_id UUID REFERENCES mail_messages(id) ON DELETE CASCADE, -- Si es respuesta
  account_id UUID REFERENCES mail_accounts(id) ON DELETE SET NULL,
  
  -- Recipients
  to_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  cc_emails JSONB DEFAULT '[]'::jsonb,
  bcc_emails JSONB DEFAULT '[]'::jsonb,
  
  -- Content
  subject TEXT,
  draft_text TEXT,
  draft_html TEXT,
  
  -- Attachments
  attachments_json JSONB DEFAULT '[]'::jsonb,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_send', 'sent', 'failed')),
  
  -- Scheduled Send
  scheduled_send_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  sent_message_id TEXT, -- AWS SES message ID
  
  -- Error tracking
  send_error TEXT,
  send_attempts INTEGER DEFAULT 0,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mail_drafts_user ON mail_drafts(user_id);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_message ON mail_drafts(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_account ON mail_drafts(account_id);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_status ON mail_drafts(status);
CREATE INDEX IF NOT EXISTS idx_mail_drafts_scheduled ON mail_drafts(scheduled_send_at) WHERE scheduled_send_at IS NOT NULL;

-- RLS
ALTER TABLE mail_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mail drafts"
  ON mail_drafts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mail drafts"
  ON mail_drafts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own mail drafts"
  ON mail_drafts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own mail drafts"
  ON mail_drafts FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 4. MAIL ATTACHMENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES mail_messages(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES mail_drafts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- File Info
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  
  -- S3 Storage
  s3_bucket TEXT,
  s3_key TEXT,
  s3_region TEXT DEFAULT 'us-east-1',
  download_url TEXT,
  
  -- Inline
  is_inline BOOLEAN DEFAULT false,
  content_id TEXT, -- For inline images
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  CONSTRAINT mail_attachments_check CHECK (
    (message_id IS NOT NULL AND draft_id IS NULL) OR
    (message_id IS NULL AND draft_id IS NOT NULL)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mail_attachments_message ON mail_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_draft ON mail_attachments(draft_id);
CREATE INDEX IF NOT EXISTS idx_mail_attachments_user ON mail_attachments(user_id);

-- RLS
ALTER TABLE mail_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mail attachments"
  ON mail_attachments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own mail attachments"
  ON mail_attachments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own mail attachments"
  ON mail_attachments FOR DELETE
  USING (auth.uid() = user_id);

-- =====================================================
-- 5. MAIL FILTERS
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES mail_accounts(id) ON DELETE CASCADE,
  
  -- Filter Info
  name TEXT NOT NULL,
  description TEXT,
  
  -- Conditions (JSON rules)
  conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example: {"from":"*@spam.com", "subject_contains":"urgent"}
  
  -- Actions (JSON rules)
  actions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Example: {"move_to":"spam", "mark_read":true, "flag":"important"}
  
  -- Priority & Status
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  
  -- Stats
  matches_count INTEGER DEFAULT 0,
  last_matched_at TIMESTAMPTZ,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mail_filters_user ON mail_filters(user_id);
CREATE INDEX IF NOT EXISTS idx_mail_filters_account ON mail_filters(account_id);
CREATE INDEX IF NOT EXISTS idx_mail_filters_active ON mail_filters(is_active);
CREATE INDEX IF NOT EXISTS idx_mail_filters_priority ON mail_filters(priority DESC);

-- RLS
ALTER TABLE mail_filters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own mail filters"
  ON mail_filters FOR ALL
  USING (auth.uid() = user_id);

-- =====================================================
-- 6. MAIL SYNC LOG
-- =====================================================
CREATE TABLE IF NOT EXISTS mail_sync_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
  
  -- Sync Info
  sync_type TEXT NOT NULL CHECK (sync_type IN ('manual', 'auto', 'webhook', 'ses_notification')),
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed', 'running')),
  
  -- Metrics
  messages_fetched INTEGER DEFAULT 0,
  messages_new INTEGER DEFAULT 0,
  messages_updated INTEGER DEFAULT 0,
  messages_skipped INTEGER DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Errors
  errors JSONB DEFAULT '[]'::jsonb,
  
  -- Details
  details JSONB DEFAULT '{}'::jsonb,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mail_sync_log_account ON mail_sync_log(account_id);
CREATE INDEX IF NOT EXISTS idx_mail_sync_log_started ON mail_sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_sync_log_status ON mail_sync_log(status);

-- RLS
ALTER TABLE mail_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own account sync logs"
  ON mail_sync_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM mail_accounts
      WHERE mail_accounts.id = mail_sync_log.account_id
      AND mail_accounts.user_id = auth.uid()
    )
  );

-- =====================================================
-- 7. TRIGGERS (updated_at)
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_mail_accounts_updated_at ON mail_accounts;
CREATE TRIGGER update_mail_accounts_updated_at
  BEFORE UPDATE ON mail_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_mail_messages_updated_at ON mail_messages;
CREATE TRIGGER update_mail_messages_updated_at
  BEFORE UPDATE ON mail_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_mail_drafts_updated_at ON mail_drafts;
CREATE TRIGGER update_mail_drafts_updated_at
  BEFORE UPDATE ON mail_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_mail_filters_updated_at ON mail_filters;
CREATE TRIGGER update_mail_filters_updated_at
  BEFORE UPDATE ON mail_filters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 8. MIGRATION DE DATOS (si existen tablas viejas)
-- =====================================================
-- Si hay email_accounts vieja, migrar a mail_accounts
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'email_accounts') THEN
    INSERT INTO mail_accounts (
      user_id, provider, email_address, domain, display_name,
      status, config, created_at, updated_at
    )
    SELECT
      user_id,
      CASE 
        WHEN provider = 'gmail' THEN 'gmail'
        WHEN provider = 'outlook' THEN 'outlook'
        ELSE 'ses'
      END,
      email,
      SPLIT_PART(email, '@', 2),
      name,
      CASE 
        WHEN is_active THEN 'active'::TEXT
        ELSE 'paused'::TEXT
      END,
      config,
      created_at,
      updated_at
    FROM email_accounts
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Migrated email_accounts → mail_accounts';
  END IF;
END $$;

-- =====================================================
-- 9. COMENTARIOS
-- =====================================================
COMMENT ON TABLE mail_accounts IS 'Cuentas de correo configuradas por usuario (SES, Gmail, Outlook, IMAP)';
COMMENT ON TABLE mail_messages IS 'Mensajes de correo recibidos/enviados con metadata completa';
COMMENT ON TABLE mail_drafts IS 'Borradores de correo (respuestas, envíos programados)';
COMMENT ON TABLE mail_attachments IS 'Adjuntos de correos y borradores almacenados en S3';
COMMENT ON TABLE mail_filters IS 'Reglas de filtrado y clasificación automática';
COMMENT ON TABLE mail_sync_log IS 'Log de sincronizaciones con proveedores externos';

-- =====================================================
-- MIGRATION 018 COMPLETED
-- =====================================================
