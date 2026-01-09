-- =====================================================
-- FIX EMAIL RLS POLICIES - PRODUCCIÓN
-- =====================================================
-- 
-- PROBLEMA: Las políticas RLS son demasiado restrictivas
-- SOLUCIÓN: Permitir acceso a mensajes de cuentas del usuario
-- 
-- Fecha: 2026-01-08
-- =====================================================

-- 1. Verificar que email_messages tiene owner_user_id correcto
-- (Solo para debug - no ejecutar en producción)
-- SELECT DISTINCT owner_user_id FROM email_messages LIMIT 10;

-- 2. RECREAR política de email_messages (más permisiva)
DROP POLICY IF EXISTS "Users can manage own email messages" ON email_messages;

CREATE POLICY "Users can access email messages from their accounts"
ON email_messages
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM email_accounts 
    WHERE email_accounts.id = email_messages.account_id 
    AND email_accounts.owner_user_id = auth.uid()
  )
);

-- 3. RECREAR política de email_attachments
DROP POLICY IF EXISTS "Users can manage own email attachments" ON email_attachments;

CREATE POLICY "Users can access attachments from their messages"
ON email_attachments
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM email_messages 
    JOIN email_accounts ON email_accounts.id = email_messages.account_id
    WHERE email_messages.id = email_attachments.message_id
    AND email_accounts.owner_user_id = auth.uid()
  )
);

-- 4. Asegurar que email_accounts tenga RLS correcto
DROP POLICY IF EXISTS "email_accounts_owner_policy" ON email_accounts;

CREATE POLICY "Users can manage their own email accounts"
ON email_accounts
FOR ALL
USING (owner_user_id = auth.uid());

-- 5. RECREAR política de email_folders
DROP POLICY IF EXISTS "Users can manage own email folders" ON email_folders;

CREATE POLICY "Users can access folders from their accounts"
ON email_folders
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM email_accounts 
    WHERE email_accounts.id = email_folders.account_id 
    AND email_accounts.owner_user_id = auth.uid()
  )
);

-- =====================================================
-- COMENTARIOS IMPORTANTES:
-- =====================================================
-- 
-- La política anterior era:
--   USING (owner_user_id = auth.uid())
-- 
-- Esto fallaba si owner_user_id en email_messages 
-- no coincidía exactamente con auth.uid()
-- 
-- La nueva política verifica:
--   1. El mensaje pertenece a una cuenta
--   2. La cuenta pertenece al usuario autenticado
-- 
-- Esto es más robusto y correcto arquitectónicamente
-- =====================================================
