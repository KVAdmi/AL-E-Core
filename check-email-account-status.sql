-- Verificar el estado de la cuenta de email
SELECT 
  id,
  owner_user_id,
  provider_label,
  from_name,
  from_email,
  is_active,
  created_at,
  updated_at
FROM email_accounts
WHERE owner_user_id = 'a56e5204-7ff5-47fc-814b-b52e5c6af5d6';

-- Si is_active es false, activarla:
-- UPDATE email_accounts 
-- SET is_active = true 
-- WHERE owner_user_id = 'a56e5204-7ff5-47fc-814b-b52e5c6af5d6';
