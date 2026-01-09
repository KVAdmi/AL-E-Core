-- =====================================================
-- FIX SEGURO: Corregir rutas IMAP de folders Hostinger
-- =====================================================
-- 
-- PROBLEMA: Folders 'system' tienen rutas incorrectas
-- SOLUCIÓN: Actualizar SOLO imap_path, NO eliminar nada
-- 
-- ✅ SEGURO PARA MÚLTIPLES USUARIOS
-- =====================================================

-- 1. BACKUP de folders actuales (por seguridad)
CREATE TABLE IF NOT EXISTS email_folders_backup_20250109_v2 AS 
SELECT * FROM email_folders;

-- 2. Ver el estado ANTES del fix
SELECT 
  account_id,
  folder_name,
  folder_type,
  imap_path,
  (SELECT COUNT(*) FROM email_messages WHERE folder_id = email_folders.id) as message_count
FROM email_folders
ORDER BY account_id, sort_order;

-- 3. Actualizar SOLO los folders 'system' con rutas incorrectas
-- NO tocar los folders 'sent' que YA tienen los correos

-- Sent (system) → debe apuntar a 'INBOX.Sent' (donde están los correos reales)
UPDATE email_folders 
SET imap_path = 'INBOX.Sent',
    folder_type = 'sent',
    icon = '📤',
    sort_order = 2
WHERE folder_type = 'system' 
  AND folder_name = 'Enviados'
  AND imap_path = 'Sent';

-- Drafts (system) → debe apuntar a 'INBOX.Drafts'
UPDATE email_folders 
SET folder_type = 'drafts',
    imap_path = 'INBOX.Drafts',
    icon = '📝',
    sort_order = 3
WHERE folder_type = 'system' 
  AND folder_name = 'Borradores'
  AND imap_path = 'Drafts';

-- Spam (system) → debe apuntar a 'INBOX.Spam'
UPDATE email_folders 
SET folder_type = 'spam',
    imap_path = 'INBOX.Spam',
    icon = '⚠️',
    sort_order = 5
WHERE folder_type = 'system' 
  AND folder_name = 'Spam'
  AND imap_path = 'Spam';

-- Trash (system)
UPDATE email_folders 
SET folder_type = 'trash',
    imap_path = 'INBOX.Trash',
    icon = '🗑️',
    sort_order = 4
WHERE folder_type = 'system' 
  AND folder_name = 'Papelera'
  AND imap_path = 'Trash';

-- 4. ELIMINAR folders duplicados 'sent' con imap_path incorrecto
-- Solo si NO tienen mensajes asociados
DELETE FROM email_folders
WHERE folder_type = 'sent'
  AND folder_name = 'Sent'
  AND imap_path = '[Gmail]/Sent Mail'
  AND NOT EXISTS (
    SELECT 1 FROM email_messages WHERE folder_id = email_folders.id
  );

-- 5. Ver el estado DESPUÉS del fix
SELECT 
  account_id,
  folder_name,
  folder_type,
  imap_path,
  (SELECT COUNT(*) FROM email_messages WHERE folder_id = email_folders.id) as message_count
FROM email_folders
ORDER BY account_id, sort_order;
