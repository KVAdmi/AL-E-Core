-- =====================================================
-- MIGRATION 016: Email Rules, Threads, Sync Log
-- =====================================================
-- Tablas adicionales para completar módulo Email tipo Outlook
-- =====================================================

-- =====================================================
-- 1) EMAIL RULES (Reglas automáticas)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  
  -- Condiciones (JSON)
  -- Ejemplo: { "from": "spam@domain.com", "subject_contains": "urgente", "has_attachments": true }
  conditions JSONB NOT NULL,
  
  -- Acciones (JSON)
  -- Ejemplo: { "move_to_folder": "uuid-folder", "mark_as_read": true, "add_label": "Importante" }
  actions JSONB NOT NULL,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_rules_account ON email_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_email_rules_active ON email_rules(is_active, priority);
CREATE INDEX IF NOT EXISTS idx_email_rules_owner ON email_rules(owner_user_id);

ALTER TABLE email_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own email rules" ON email_rules;
CREATE POLICY "Users can manage own email rules" 
ON email_rules
FOR ALL 
USING (owner_user_id = auth.uid());

-- =====================================================
-- 2) EMAIL THREADS (Hilos de conversación)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  thread_id VARCHAR(255) NOT NULL,
  subject VARCHAR(1000),
  participants TEXT[], -- ["email1@domain.com", "email2@domain.com"]
  message_count INTEGER DEFAULT 0,
  last_message_date TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT FALSE,
  is_starred BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_email_threads_account ON email_threads(account_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_date ON email_threads(last_message_date DESC);
CREATE INDEX IF NOT EXISTS idx_email_threads_unread ON email_threads(owner_user_id, is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_email_threads_owner ON email_threads(owner_user_id);

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own email threads" ON email_threads;
CREATE POLICY "Users can manage own email threads" 
ON email_threads
FOR ALL 
USING (owner_user_id = auth.uid());

-- =====================================================
-- 3) EMAIL SYNC LOG (Log de sincronizaciones IMAP)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  sync_type VARCHAR(50) NOT NULL CHECK (sync_type IN ('manual', 'auto', 'webhook')),
  status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  messages_fetched INTEGER DEFAULT 0,
  messages_new INTEGER DEFAULT 0,
  messages_updated INTEGER DEFAULT 0,
  errors TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_email_sync_log_account ON email_sync_log(account_id);
CREATE INDEX IF NOT EXISTS idx_email_sync_log_date ON email_sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sync_log_status ON email_sync_log(status);

-- =====================================================
-- 4) Agregar columna current_folder_id a email_messages
-- (Para rastrear en qué carpeta está cada mensaje)
-- =====================================================
DO $$ 
BEGIN
  -- Verificar si la columna ya existe
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'email_messages' 
    AND column_name = 'current_folder_id'
  ) THEN
    ALTER TABLE email_messages 
    ADD COLUMN current_folder_id UUID REFERENCES email_folders(id) ON DELETE SET NULL;
    
    CREATE INDEX idx_email_messages_current_folder ON email_messages(current_folder_id);
  END IF;
END $$;

-- =====================================================
-- 5) Comentarios
-- =====================================================
COMMENT ON TABLE email_rules IS 'Reglas automáticas para filtrar y organizar emails (tipo Outlook/Gmail)';
COMMENT ON TABLE email_threads IS 'Hilos de conversación agrupados por Message-ID';
COMMENT ON TABLE email_sync_log IS 'Log de sincronizaciones IMAP realizadas';
COMMENT ON COLUMN email_rules.conditions IS 'JSON con condiciones: { "from": "email", "subject_contains": "text", "has_attachments": true }';
COMMENT ON COLUMN email_rules.actions IS 'JSON con acciones: { "move_to_folder": "uuid", "mark_as_read": true, "add_label": "Urgente" }';
COMMENT ON COLUMN email_messages.current_folder_id IS 'Carpeta actual del mensaje (para mover entre Inbox, Spam, Trash, etc)';
