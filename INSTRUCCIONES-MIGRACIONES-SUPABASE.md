# 🗄️ INSTRUCCIONES MIGRACIONES SUPABASE

## ⚠️ IMPORTANTE - LEER ANTES DE EJECUTAR

Estas migraciones deben ejecutarse **EN ORDEN** en el SQL Editor de Supabase.

**NO** ejecutar en producción sin antes probar en staging/dev.

---

## 📋 ORDEN DE EJECUCIÓN

### 1️⃣ Email System (011)
**Archivo:** `migrations/011_email_system.sql`

**Crea:**
- `email_accounts` - Cuentas SMTP/IMAP
- `mail_threads` - Hilos de email
- `mail_messages` - Mensajes

**Duración estimada:** ~5 segundos

### 2️⃣ Calendar Internal (012)
**Archivo:** `migrations/012_calendar_internal.sql`

**Crea:**
- `calendar_events` - Eventos de calendario
- `notification_jobs` - Cola de notificaciones
- Trigger para crear recordatorios automáticos

**Duración estimada:** ~5 segundos

### 3️⃣ Telegram Bots (013)
**Archivo:** `migrations/013_telegram_bots.sql`

**Crea:**
- `telegram_bots` - Bots por usuario
- `telegram_chats` - Chats activos
- `telegram_messages` - Historial

**Duración estimada:** ~5 segundos

---

## 🚀 PASO A PASO

### Opción A: Supabase SQL Editor (RECOMENDADO)

1. **Ir a Supabase Dashboard**
   ```
   https://supabase.com/dashboard/project/YOUR_PROJECT/sql
   ```

2. **Ejecutar Migración 011**
   - Click en "New Query"
   - Copiar todo el contenido de `migrations/011_email_system.sql`
   - Pegar en el editor
   - Click en "Run" (o Cmd/Ctrl + Enter)
   - Verificar que dice "Success. No rows returned"

3. **Ejecutar Migración 012**
   - Repetir proceso con `migrations/012_calendar_internal.sql`

4. **Ejecutar Migración 013**
   - Repetir proceso con `migrations/013_telegram_bots.sql`

5. **Verificar Tablas Creadas**
   - Ir a "Table Editor"
   - Deberías ver 8 tablas nuevas:
     - `email_accounts`
     - `mail_threads`
     - `mail_messages`
     - `calendar_events`
     - `notification_jobs`
     - `telegram_bots`
     - `telegram_chats`
     - `telegram_messages`

---

### Opción B: psql (Si tienes acceso directo)

```bash
# Obtener connection string de Supabase
# Settings → Database → Connection string (Transaction mode)

export DATABASE_URL="postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"

# Ejecutar migraciones en orden
psql $DATABASE_URL -f migrations/011_email_system.sql
psql $DATABASE_URL -f migrations/012_calendar_internal.sql
psql $DATABASE_URL -f migrations/013_telegram_bots.sql
```

---

## ✅ VERIFICACIÓN POST-MIGRACIÓN

### 1. Verificar Tablas
```sql
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN (
  'email_accounts',
  'mail_threads',
  'mail_messages',
  'calendar_events',
  'notification_jobs',
  'telegram_bots',
  'telegram_chats',
  'telegram_messages'
);
```

**Resultado esperado:** 8 filas (las 8 tablas)

### 2. Verificar RLS (Row Level Security)
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN (
  'email_accounts',
  'mail_threads',
  'mail_messages',
  'calendar_events',
  'notification_jobs',
  'telegram_bots',
  'telegram_chats',
  'telegram_messages'
);
```

**Resultado esperado:** Todas con `rowsecurity = true`

### 3. Verificar Políticas RLS
```sql
SELECT tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public'
AND tablename LIKE '%email%' 
   OR tablename LIKE '%calendar%' 
   OR tablename LIKE '%telegram%'
   OR tablename LIKE '%mail%'
   OR tablename LIKE '%notification%';
```

**Resultado esperado:** 8 políticas (una por tabla)

### 4. Verificar Trigger (Recordatorios)
```sql
SELECT trigger_name, event_object_table 
FROM information_schema.triggers 
WHERE trigger_name = 'trigger_create_event_reminders';
```

**Resultado esperado:** 1 fila con `calendar_events`

---

## 🔍 TROUBLESHOOTING

### Error: "relation already exists"
**Causa:** La tabla ya fue creada antes.

**Solución:** Las migraciones usan `CREATE TABLE IF NOT EXISTS`, así que es seguro. Continúa con la siguiente.

### Error: "must be owner of table"
**Causa:** Usuario no tiene permisos suficientes.

**Solución:** Usar el usuario `postgres` o el service role de Supabase.

### Error: "syntax error"
**Causa:** Copia incompleta del SQL.

**Solución:** Copiar TODO el archivo .sql completo, sin omitir líneas.

### Error: "column does not exist"
**Causa:** Migración ejecutada fuera de orden.

**Solución:** Ejecutar en orden: 011 → 012 → 013

---

## 📊 TABLAS CREADAS - RESUMEN

| Tabla | Propósito | Campos Encriptados |
|-------|-----------|-------------------|
| `email_accounts` | Cuentas SMTP/IMAP | `smtp_pass_enc`, `imap_pass_enc` |
| `mail_threads` | Hilos de email | - |
| `mail_messages` | Mensajes enviados/recibidos | - |
| `calendar_events` | Eventos de calendario | - |
| `notification_jobs` | Cola de notificaciones | - |
| `telegram_bots` | Bots de Telegram | `bot_token_enc` |
| `telegram_chats` | Chats activos | - |
| `telegram_messages` | Historial Telegram | - |

**Total:** 8 tablas, 3 campos encriptados

---

## ⚠️ IMPORTANTE - DATOS SENSIBLES

Las siguientes columnas guardan datos encriptados:
- `email_accounts.smtp_pass_enc` - Password SMTP
- `email_accounts.imap_pass_enc` - Password IMAP
- `telegram_bots.bot_token_enc` - Token de bot

**NO** exponer estos campos en APIs públicas.
**OBLIGATORIO** tener `ENCRYPTION_KEY` en .env para desencriptar.

---

## 🔐 SEGURIDAD - RLS ACTIVO

Todas las tablas tienen:
- ✅ Row Level Security habilitado
- ✅ Políticas que filtran por `owner_user_id = auth.uid()`
- ✅ Usuarios solo ven sus propios datos

**NO** desactivar RLS sin autorización explícita.

---

## 📞 SOPORTE

Si encuentras errores:
1. Copia el mensaje de error completo
2. Copia la query que falló
3. Verifica el orden de ejecución (011 → 012 → 013)
4. Revisa troubleshooting arriba

---

## ✅ CHECKLIST POST-EJECUCIÓN

Después de ejecutar las 3 migraciones:

- [ ] 8 tablas creadas
- [ ] RLS activo en todas
- [ ] 8 políticas RLS creadas
- [ ] Trigger de recordatorios creado
- [ ] Sin errores en log de Supabase
- [ ] Backend puede conectarse (verificar con `/_health/full`)

---

**Una vez completado, continuar con el deploy del backend.**

Ver: `deploy-post-migration.sh`
