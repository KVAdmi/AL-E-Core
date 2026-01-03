# 🚨 URGENTE: Ejecutar Migración 018 en Supabase

## ❌ Error Actual
```
Could not find the 'provider' column of 'email_accounts' in the schema cache
```

## 🎯 Causa
La migración `018_ses_inbound_system.sql` **NO ha sido ejecutada en Supabase**.

Esta migración agrega la columna `provider` que el backend necesita para funcionar.

---

## ✅ Solución: Ejecutar Migración en Supabase

### Opción 1: Desde Supabase Dashboard (RECOMENDADO)

#### Paso 1: Copiar el SQL
El archivo está en: `/Users/pg/Documents/AL-E Core/migrations/018_ses_inbound_system.sql`

O copia desde aquí:

```sql
-- =====================================================
-- MIGRACIÓN 018: AWS SES INBOUND SYSTEM
-- Sistema completo de correo entrante/saliente
-- Compatible con estructura de Frontend
-- =====================================================

-- =====================================================
-- PASO 1: Extender email_accounts con AWS SES
-- =====================================================

-- Agregar columnas nuevas a email_accounts
ALTER TABLE email_accounts 
ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'smtp',
ADD COLUMN IF NOT EXISTS domain VARCHAR(255),
ADD COLUMN IF NOT EXISTS aws_region VARCHAR(50),
ADD COLUMN IF NOT EXISTS aws_access_key_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS aws_secret_access_key_enc TEXT,
ADD COLUMN IF NOT EXISTS s3_bucket VARCHAR(255),
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active',
ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;

-- Actualizar constraint de provider
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'email_accounts' AND constraint_name LIKE '%provider%'
  ) THEN
    ALTER TABLE email_accounts DROP CONSTRAINT IF EXISTS email_accounts_provider_check;
  END IF;
END $$;

ALTER TABLE email_accounts 
ADD CONSTRAINT email_accounts_provider_check 
CHECK (provider IN ('ses_inbound', 'ses', 'gmail', 'outlook', 'smtp', 'imap'));

-- Actualizar constraint de status
ALTER TABLE email_accounts 
ADD CONSTRAINT email_accounts_status_check 
CHECK (status IN ('active', 'paused', 'error'));

-- Índices adicionales
CREATE INDEX IF NOT EXISTS idx_email_accounts_provider ON email_accounts(provider);
CREATE INDEX IF NOT EXISTS idx_email_accounts_status ON email_accounts(status);
CREATE INDEX IF NOT EXISTS idx_email_accounts_domain ON email_accounts(domain);

COMMENT ON COLUMN email_accounts.provider IS 'Proveedor: ses_inbound, ses, gmail, outlook, smtp, imap';
COMMENT ON COLUMN email_accounts.aws_secret_access_key_enc IS 'AWS Secret Access Key encriptado con AES-256';
COMMENT ON COLUMN email_accounts.s3_bucket IS 'S3 bucket para almacenar correos entrantes (SES Rule Set)';
COMMENT ON COLUMN email_accounts.config IS 'Configuración adicional: firma, banderas, spam, etc.';
```

#### Paso 2: Ir a Supabase Dashboard
1. **Ir a:** https://supabase.com/dashboard
2. **Seleccionar proyecto:** AL-E Core (o el nombre de tu proyecto)
3. **Menu izquierdo:** SQL Editor
4. **Clic en:** "New query"

#### Paso 3: Pegar y Ejecutar
1. **Pegar** todo el contenido de `018_ses_inbound_system.sql`
2. **Clic en:** "RUN" (o Ctrl+Enter)
3. **Verificar:** Debe decir "Success. No rows returned"

---

### Opción 2: Desde Terminal (si tienes psql)

```bash
# Obtener connection string de Supabase Dashboard
# Database → Settings → Connection String

psql "postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres" \
  < migrations/018_ses_inbound_system.sql
```

---

## 🔍 Verificar que funcionó

### 1. Desde Supabase Dashboard SQL Editor:
```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'email_accounts' 
  AND column_name IN ('provider', 'status', 'domain', 'aws_region', 'config');
```

**Resultado esperado:**
```
column_name  | data_type
-------------|------------------
provider     | character varying
status       | character varying
domain       | character varying
aws_region   | character varying
config       | jsonb
```

### 2. Desde el frontend:
- Intentar agregar una cuenta de email nuevamente
- El error `'provider' column not found` debe desaparecer
- Debe crear la cuenta exitosamente

---

## 📋 Checklist

- [ ] Abrir Supabase Dashboard
- [ ] Ir a SQL Editor → New query
- [ ] Copiar migrations/018_ses_inbound_system.sql
- [ ] Ejecutar (RUN)
- [ ] Verificar columnas nuevas con SELECT
- [ ] Probar endpoint desde frontend
- [ ] Confirmar que ya NO sale el error

---

## ⚠️ Importante

**Esta migración es SEGURA:**
- Usa `ADD COLUMN IF NOT EXISTS` (no falla si ya existe)
- No modifica datos existentes
- Solo agrega columnas nuevas
- Compatible con cuentas ya creadas

**Una vez ejecutada:**
✅ El endpoint `POST /api/email/accounts` funcionará correctamente
✅ El frontend podrá agregar cuentas Gmail, Outlook, etc.
✅ Se resolverá el error de `ENCRYPTION_KEY` (ya está configurado en EC2)

---

## 🆘 Si hay problemas

**Error al ejecutar:**
- Verificar que tengas permisos de admin en Supabase
- Verificar que la tabla `email_accounts` existe (debe existir desde migración 011)
- Si falla un constraint, ejecutar línea por línea

**Alternativa rápida (solo columna provider):**
```sql
-- Ejecutar solo esto si la migración completa falla:
ALTER TABLE email_accounts 
ADD COLUMN IF NOT EXISTS provider VARCHAR(50) DEFAULT 'smtp';

ALTER TABLE email_accounts 
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
```

Esto es suficiente para que el endpoint funcione básicamente.

---

**¡Ejecuta esto AHORA y el error se resolverá! 🚀**
