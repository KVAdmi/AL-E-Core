-- =====================================================
-- MIGRACIÓN 014: Tablas extendidas de Email
-- Folders, Drafts, Messages, Attachments, Contacts
-- =====================================================

-- =====================================================
-- PASO 1: Habilitar extensión UUID
-- =====================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- PASO 2: TABLA email_folders
-- (Debe existir ANTES de email_messages porque tiene FK)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  folder_name VARCHAR(255) NOT NULL,
  folder_type VARCHAR(50) NOT NULL CHECK (folder_type IN ('system', 'custom')),
  imap_path VARCHAR(500) NOT NULL,
  unread_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  icon VARCHAR(50) DEFAULT 'folder',
  color VARCHAR(20),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, imap_path)
);

CREATE INDEX IF NOT EXISTS idx_email_folders_account ON email_folders(account_id);
CREATE INDEX IF NOT EXISTS idx_email_folders_owner ON email_folders(owner_user_id);

-- =====================================================
-- PASO 3: TABLA email_drafts
-- =====================================================
CREATE TABLE IF NOT EXISTS email_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  to_addresses TEXT[],
  cc_addresses TEXT[],
  bcc_addresses TEXT[],
  subject VARCHAR(500),
  body_text TEXT,
  body_html TEXT,
  in_reply_to VARCHAR(500),
  references TEXT[],
  is_scheduled BOOLEAN DEFAULT FALSE,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_account ON email_drafts(account_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_owner ON email_drafts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_email_drafts_updated ON email_drafts(updated_at DESC);

-- =====================================================
-- PASO 4: TABLA email_messages
-- (Ahora SÍ puede referenciar email_folders)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  folder_id UUID REFERENCES email_folders(id) ON DELETE SET NULL,
  message_uid VARCHAR(255),
  message_id VARCHAR(500),
  from_address VARCHAR(255),
  from_name VARCHAR(255),
  to_addresses TEXT[],
  cc_addresses TEXT[],
  bcc_addresses TEXT[],
  subject VARCHAR(1000),
  body_text TEXT,
  body_html TEXT,
  body_preview VARCHAR(300),
  has_attachments BOOLEAN DEFAULT FALSE,
  attachment_count INTEGER DEFAULT 0,
  is_read BOOLEAN DEFAULT FALSE,
  is_starred BOOLEAN DEFAULT FALSE,
  is_important BOOLEAN DEFAULT FALSE,
  labels TEXT[],
  date TIMESTAMPTZ,
  in_reply_to VARCHAR(500),
  references TEXT[],
  thread_id VARCHAR(255),
  size_bytes BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, message_uid)
);

CREATE INDEX IF NOT EXISTS idx_email_messages_account ON email_messages(account_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_folder ON email_messages(folder_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_owner ON email_messages(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_date ON email_messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(thread_id);

-- =====================================================
-- PASO 5: TABLA email_attachments
-- (Ahora puede referenciar email_messages y email_drafts)
-- =====================================================
CREATE TABLE IF NOT EXISTS email_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID REFERENCES email_messages(id) ON DELETE CASCADE,
  draft_id UUID REFERENCES email_drafts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  filename VARCHAR(500) NOT NULL,
  content_type VARCHAR(200),
  size_bytes BIGINT,
  storage_path VARCHAR(1000),
  download_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_message ON email_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_email_attachments_draft ON email_attachments(draft_id);

-- =====================================================
-- PASO 6: TABLA email_contacts
-- =====================================================
CREATE TABLE IF NOT EXISTS email_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL,
  email_address VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  company VARCHAR(255),
  job_title VARCHAR(255),
  phone VARCHAR(50),
  notes TEXT,
  avatar_url TEXT,
  tags TEXT[],
  is_favorite BOOLEAN DEFAULT FALSE,
  email_count INTEGER DEFAULT 0,
  last_contact_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_user_id, email_address)
);

CREATE INDEX IF NOT EXISTS idx_email_contacts_owner ON email_contacts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_email_contacts_email ON email_contacts(email_address);
CREATE INDEX IF NOT EXISTS idx_email_contacts_favorite ON email_contacts(owner_user_id, is_favorite);

-- =====================================================
-- PASO 7: TRIGGER para auto-crear folders
-- =====================================================
CREATE OR REPLACE FUNCTION create_default_email_folders()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO email_folders (account_id, owner_user_id, folder_name, folder_type, imap_path, icon, sort_order)
  VALUES
    (NEW.id, NEW.owner_user_id, 'Bandeja de entrada', 'system', 'INBOX', 'inbox', 1),
    (NEW.id, NEW.owner_user_id, 'Enviados', 'system', 'Sent', 'send', 2),
    (NEW.id, NEW.owner_user_id, 'Borradores', 'system', 'Drafts', 'draft', 3),
    (NEW.id, NEW.owner_user_id, 'Spam', 'system', 'Spam', 'alert-triangle', 4),
    (NEW.id, NEW.owner_user_id, 'Papelera', 'system', 'Trash', 'trash', 5);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_create_default_folders ON email_accounts;
CREATE TRIGGER trigger_create_default_folders
AFTER INSERT ON email_accounts
FOR EACH ROW
EXECUTE FUNCTION create_default_email_folders();

-- =====================================================
-- PASO 8: RLS POLICIES
-- =====================================================

-- email_folders
ALTER TABLE email_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own email folders" ON email_folders;
CREATE POLICY "Users can manage own email folders"
ON email_folders
FOR ALL
USING (owner_user_id = auth.uid());

-- email_drafts
ALTER TABLE email_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own email drafts" ON email_drafts;
CREATE POLICY "Users can manage own email drafts"
ON email_drafts
FOR ALL
USING (owner_user_id = auth.uid());

-- email_messages
ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own email messages" ON email_messages;
CREATE POLICY "Users can manage own email messages"
ON email_messages
FOR ALL
USING (owner_user_id = auth.uid());

-- email_attachments
ALTER TABLE email_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own email attachments" ON email_attachments;
CREATE POLICY "Users can manage own email attachments"
ON email_attachments
FOR ALL
USING (owner_user_id = auth.uid());

-- email_contacts
ALTER TABLE email_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own email contacts" ON email_contacts;
CREATE POLICY "Users can manage own email contacts"
ON email_contacts
FOR ALL
USING (owner_user_id = auth.uid());

-- =====================================================
-- PASO 9: NOTAS SOBRE STORAGE BUCKET
-- =====================================================
-- 
-- MANUAL: Crear bucket "email-attachments" en Supabase Dashboard
-- - Public: false
-- - File size limit: 25MB
-- - Allowed MIME types: * (todos)
-- 
-- POLICIES SUGERIDAS (ejecutar en Dashboard > Storage):
-- 
-- CREATE POLICY "Users can upload own attachments"
-- ON storage.objects FOR INSERT
-- WITH CHECK (
--   bucket_id = 'email-attachments' 
--   AND (storage.foldername(name))[1] = auth.uid()::text
-- );
-- 
-- CREATE POLICY "Users can read own attachments"
-- ON storage.objects FOR SELECT
-- USING (
--   bucket_id = 'email-attachments' 
--   AND (storage.foldername(name))[1] = auth.uid()::text
-- );
-- 
-- CREATE POLICY "Users can delete own attachments"
-- ON storage.objects FOR DELETE
-- USING (
--   bucket_id = 'email-attachments' 
--   AND (storage.foldername(name))[1] = auth.uid()::text
-- );
