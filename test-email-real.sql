-- Verificar cuentas SMTP configuradas
SELECT 
  id,
  from_email,
  provider,
  status,
  is_active,
  smtp_host,
  smtp_port,
  smtp_secure,
  smtp_user,
  CASE 
    WHEN smtp_pass_enc IS NOT NULL THEN 'PRESENT' 
    ELSE 'MISSING' 
  END as smtp_password
FROM email_accounts
WHERE is_active = true
ORDER BY created_at DESC
LIMIT 5;
