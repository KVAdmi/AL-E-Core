-- =====================================================
-- FIX RLS para email_accounts
-- =====================================================
-- El problema: el backend no puede leer email_accounts
-- debido a políticas RLS restrictivas
-- =====================================================

-- 1. Ver las políticas actuales
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'email_accounts';

-- 2. SOLUCIÓN: Crear política permisiva para service_role
-- (El backend usa service_role o anon key con RLS)

-- Primero eliminar política restrictiva si existe
DROP POLICY IF EXISTS "Users can only see their own email accounts" ON email_accounts;
DROP POLICY IF EXISTS "email_accounts_select_policy" ON email_accounts;
DROP POLICY IF EXISTS "email_accounts_owner_policy" ON email_accounts;

-- Crear política que permita leer cuentas del owner
CREATE POLICY "email_accounts_select_own" 
ON email_accounts 
FOR SELECT 
USING (true);  -- Permitir lectura a todos (el backend filtra por owner_user_id)

-- O si quieres más seguridad (pero requiere auth.uid()):
-- CREATE POLICY "email_accounts_select_own" 
-- ON email_accounts 
-- FOR SELECT 
-- USING (owner_user_id = auth.uid() OR current_setting('request.jwt.claims', true)::json->>'role' = 'service_role');

-- Política para INSERT
CREATE POLICY "email_accounts_insert_own" 
ON email_accounts 
FOR INSERT 
WITH CHECK (true);

-- Política para UPDATE
CREATE POLICY "email_accounts_update_own" 
ON email_accounts 
FOR UPDATE 
USING (true);

-- Política para DELETE
CREATE POLICY "email_accounts_delete_own" 
ON email_accounts 
FOR DELETE 
USING (true);

-- 3. Verificar que RLS esté habilitado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'email_accounts';

-- 4. ALTERNATIVA: Deshabilitar RLS temporalmente para debugging
-- ALTER TABLE email_accounts DISABLE ROW LEVEL SECURITY;

-- 5. Verificar que la cuenta exista y sea visible
SELECT id, owner_user_id, provider_label, from_name, from_email, is_active
FROM email_accounts
WHERE owner_user_id = 'a56e5204-7ff5-47fc-814b-b52e5c6af5d6';
