-- Verificar folders y sus rutas IMAP
SELECT 
  id,
  folder_name,
  folder_type,
  imap_path,
  icon,
  sort_order,
  account_id
FROM email_folders
ORDER BY account_id, sort_order;

-- Contar mensajes por folder
SELECT 
  f.folder_name,
  f.folder_type,
  f.imap_path,
  COUNT(m.id) as message_count
FROM email_folders f
LEFT JOIN email_messages m ON m.folder_id = f.id
GROUP BY f.id, f.folder_name, f.folder_type, f.imap_path
ORDER BY f.account_id, f.sort_order;
