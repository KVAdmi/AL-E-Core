-- =====================================================
-- FIX: Corregir rutas IMAP de folders Gmail
-- =====================================================
-- 
-- PROBLEMA: Todos los folders tienen imap_path='INBOX'
-- SOLUCIÓN: Actualizar con las rutas correctas de Gmail
-- 
-- ⚠️ EJECUTAR SOLO SI USAS GMAIL
-- =====================================================

-- 1. BACKUP de folders actuales
CREATE TABLE IF NOT EXISTS email_folders_backup_20250109 AS 
SELECT * FROM email_folders;

-- 2. Actualizar rutas IMAP para Gmail
-- INBOX
UPDATE email_folders 
SET imap_path = 'INBOX'
WHERE folder_type = 'inbox' 
AND imap_path != 'INBOX';

-- Sent
UPDATE email_folders 
SET imap_path = '[Gmail]/Sent Mail'
WHERE folder_type = 'sent' 
AND (imap_path = 'INBOX' OR imap_path LIKE '%Sent%' AND imap_path != '[Gmail]/Sent Mail');

-- Drafts
UPDATE email_folders 
SET imap_path = '[Gmail]/Drafts'
WHERE folder_type = 'drafts' 
AND (imap_path = 'INBOX' OR imap_path LIKE '%Draft%' AND imap_path != '[Gmail]/Drafts');

-- Spam
UPDATE email_folders 
SET imap_path = '[Gmail]/Spam'
WHERE folder_type = 'spam' 
AND (imap_path = 'INBOX' OR imap_path LIKE '%Spam%' AND imap_path != '[Gmail]/Spam');

-- Trash
UPDATE email_folders 
SET imap_path = '[Gmail]/Trash'
WHERE folder_type = 'trash' 
AND (imap_path = 'INBOX' OR imap_path LIKE '%Trash%' AND imap_path != '[Gmail]/Trash');

-- 3. Verificar cambios
SELECT 
  id,
  folder_name,
  folder_type,
  imap_path,
  icon,
  sort_order
FROM email_folders
ORDER BY account_id, sort_order;

-- 4. Limpiar mensajes duplicados (OPCIONAL - usar con precaución)
-- Este paso elimina mensajes que están en el folder incorrecto
-- Comentado por seguridad - descomentar solo si estás seguro

-- DELETE FROM email_messages
-- WHERE folder_id IN (
--   SELECT id FROM email_folders WHERE folder_type != 'inbox' AND imap_path = 'INBOX'
-- );

-- 5. Resetear UIDs para resincronización completa (OPCIONAL)
-- Esto fuerza al worker a traer todos los mensajes de nuevo
-- Comentado por seguridad

-- UPDATE email_messages
-- SET message_uid = NULL
-- WHERE folder_id IN (SELECT id FROM email_folders WHERE folder_type IN ('sent', 'drafts', 'spam'));
