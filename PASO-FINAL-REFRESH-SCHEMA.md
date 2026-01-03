# ✅ MIGRACIÓN 018 EJECUTADA - Siguiente Paso

## 🎯 Estado Actual

✅ Migración 018 ejecutada en Supabase  
✅ ENCRYPTION_KEY configurado en EC2  
✅ Backend código correcto  
⚠️ **Schema cache de Supabase necesita refrescarse**

---

## 🔄 PASO FINAL: Refrescar Schema Cache de Supabase

El error `"Could not find the 'provider' column"` persiste porque **PostgREST de Supabase tiene un cache del schema**.

### Opción 1: Ejecutar SQL (MÁS RÁPIDO)

1. **Ir a:** https://supabase.com/dashboard
2. **Seleccionar:** Tu proyecto AL-E Core
3. **SQL Editor** → New query
4. **Pegar y ejecutar:**

```sql
NOTIFY pgrst, 'reload schema';
```

5. **Esperar 5 segundos**
6. **Probar endpoint desde frontend**

---

### Opción 2: Desde Dashboard Settings

1. **Ir a:** https://supabase.com/dashboard
2. **Seleccionar:** Tu proyecto
3. **Project Settings** (engranaje) → **API**
4. **Buscar botón:** "Restart API" o "Reload Schema"
5. **Clic en el botón**

---

## 🧪 Verificar que Funcionó

### 1. Ejecutar en SQL Editor:
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'email_accounts'
  AND column_name = 'provider';
```

**Debe retornar:**
```
column_name | data_type         | is_nullable
------------|-------------------|-------------
provider    | character varying | YES
```

### 2. Probar endpoint:

```bash
curl -X POST https://100.27.201.233/api/email/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-id",
    "provider": "gmail",
    "fromName": "Test",
    "fromEmail": "test@gmail.com",
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpUser": "test@gmail.com",
    "smtpPass": "test123"
  }'
```

**Respuesta esperada (sin error de 'provider'):**
```json
{
  "ok": true,
  "message": "Cuenta de email creada exitosamente",
  "account": { ... }
}
```

---

## 📊 Checklist Final

- [x] Migración 018 ejecutada en Supabase
- [x] ENCRYPTION_KEY en .env del servidor
- [x] PM2 reiniciado
- [ ] **Schema cache refrescado** ← HACER ESTO AHORA
- [ ] Endpoint probado desde frontend
- [ ] Confirmar que NO sale el error de 'provider'

---

## ⏱️ Tiempo estimado

- Ejecutar `NOTIFY pgrst, 'reload schema';` → **10 segundos**
- Esperar que cache refresque → **5 segundos**
- Probar desde frontend → **30 segundos**

**Total: menos de 1 minuto** 🚀

---

## 🆘 Si aún no funciona después de refrescar

Ejecuta esto en SQL Editor para diagnóstico:

```sql
-- Ver todas las columnas de email_accounts
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'email_accounts'
ORDER BY ordinal_position;
```

Y mándame el resultado. Puede que necesite revisar los permisos RLS.

---

**¡Ejecuta `NOTIFY pgrst, 'reload schema';` y prueba! 🎉**
