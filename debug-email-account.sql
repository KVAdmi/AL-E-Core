-- Debug completo del registro email_accounts

-- 1. Ver el registro completo
SELECT *
FROM email_accounts
WHERE owner_user_id = 'a56e5204-7ff5-47fc-814b-b52e5c6af5d6';

-- 2. Ver específicamente is_active
SELECT id, owner_user_id, provider_label, is_active
FROM email_accounts
WHERE owner_user_id = 'a56e5204-7ff5-47fc-814b-b52e5c6af5d6';

-- 3. Ver TODOS los registros (sin filtro)
SELECT id, owner_user_id, provider_label, is_active, created_at
FROM email_accounts
ORDER BY created_at DESC
LIMIT 5;

-- 4. Si is_active es NULL o false, activarlo:
UPDATE email_accounts 
SET is_active = true
WHERE owner_user_id = 'a56e5204-7ff5-47fc-814b-b52e5c6af5d6'
AND (is_active IS NULL OR is_active = false);

-- 5. Verificar de nuevo
SELECT id, owner_user_id, provider_label, is_active
FROM email_accounts
WHERE owner_user_id = 'a56e5204-7ff5-47fc-814b-b52e5c6af5d6';
