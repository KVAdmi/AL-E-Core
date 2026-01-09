# 🚨 RESUMEN PROBLEMAS CORREOS - 9 Enero 2026

## PROBLEMA 1: Gmail rechaza correos enviados ❌

### Diagnóstico
**Error:** `550-5.7.26 Gmail requires all senders to authenticate with SPF or DKIM`

**Causa raíz:**
Estás usando **Gmail SMTP** (`smtp.gmail.com`) para enviar correos desde `p.garibay@infinitykode.com`, pero:
- Gmail NO te deja enviar con direcciones que no sean tuyas
- Gmail reescribe el remitente a `kodigovivo@gmail.com`
- El correo llega sin autenticación SPF/DKIM correcta
- Gmail del destinatario lo RECHAZA

### Solución ✅
**Cambiar a Hostinger SMTP:**

1. **Configurar cuenta en Supabase:**
   ```sql
   UPDATE email_accounts
   SET 
     smtp_host = 'smtp.hostinger.com',
     smtp_port = 465,
     smtp_secure = true,
     smtp_user = 'p.garibay@infinitykode.com',
     smtp_pass_enc = '[CIFRAR_PASSWORD_DE_HOSTINGER]'
   WHERE from_email = 'p.garibay@infinitykode.com';
   ```

2. **Configurar SPF en DNS (Hostinger → DNS Zone Editor):**
   ```
   Tipo: TXT
   Nombre: @
   Valor: v=spf1 include:_spf.hostinger.com ~all
   ```

3. **Habilitar DKIM (Hostinger → Email → DKIM):**
   - Click "Enable DKIM"
   - Copiar registro TXT generado
   - Agregar en DNS Zone Editor:
     ```
     Tipo: TXT
     Nombre: default._domainkey
     Valor: v=DKIM1; k=rsa; p=[CLAVE_PÚBLICA]
     ```

4. **Esperar 1-4 horas** para propagación DNS

5. **Probar envío** desde AL-E Mail

---

## PROBLEMA 2: Folders no se actualizan en frontend ❌

### Diagnóstico
**Error:** `"Could not find the 'folder' column of 'email_messages' in the schema cache"`

**Causa raíz:**
El **frontend** está haciendo un query con `.select('folder')` pero la columna correcta es:
- `folder_id` (ID del folder donde se guardó inicialmente)
- `current_folder_id` (ID del folder actual, si se movió)

### Backend (✅ CORRECTO):
```typescript
// src/repositories/emailMessagesRepo.ts
.select('*, folder_id, current_folder_id')
```

### Frontend (❌ INCORRECTO):
Alguien está usando:
```javascript
// INCORRECTO:
.select('folder')

// CORRECTO:
.select('*, folder_id, current_folder_id')
```

### Solución ✅
**Actualizar frontend** para usar `folder_id` en lugar de `folder`:

```javascript
// Buscar en frontend (React/Next.js):
// ❌ CAMBIAR ESTO:
const { data } = await supabase
  .from('email_messages')
  .select('*, folder')  // ← INCORRECTO

// ✅ POR ESTO:
const { data } = await supabase
  .from('email_messages')
  .select('*, folder_id, current_folder_id, email_folders(*)')
```

**Además, hacer JOIN con folders:**
```javascript
const { data } = await supabase
  .from('email_messages')
  .select(`
    *,
    folder:email_folders!folder_id(id, folder_name, folder_type, imap_path)
  `)
```

---

## PROBLEMA 3: Sync de folders implementado ✅

### Estado actual
**✅ COMPLETADO** - Commit `97eaac5`

El backend ahora sincroniza **TODOS los folders**, no solo INBOX:
- ✅ INBOX (entrada)
- ✅ Sent / [Gmail]/Sent Mail (enviados)
- ✅ Drafts / [Gmail]/Drafts (borradores)
- ✅ Spam / [Gmail]/Spam
- ✅ Trash (papelera)
- ✅ Archive (archivados)

Cada correo se guarda con su `folder_id` correcto en la tabla `email_messages`.

### Verificación
El worker automático (cada 5 min) ya está corriendo. Logs:
```
[SYNC WORKER] 📂 Sincronizando 5 folders
[SYNC WORKER] 📬 Sincronizando folder: INBOX (Inbox)
[SYNC WORKER] 📬 Sincronizando folder: [Gmail]/Sent Mail (Sent)
[SYNC WORKER] 📬 Sincronizando folder: [Gmail]/Spam (Spam)
...
```

---

## CHECKLIST DE CORRECCIÓN

### Backend (AL-E Core) ✅
- [x] Sync de todos los folders (no solo INBOX)
- [x] Guardar correos con `folder_id` correcto
- [x] API `/api/email/accounts/:id/inbox` con filtro por folder

### DNS/Email (Hostinger) 🔄 PENDIENTE
- [ ] Configurar SPF para infinitykode.com
- [ ] Habilitar DKIM en Hostinger
- [ ] Agregar registro DKIM en DNS
- [ ] Esperar propagación DNS (1-4h)

### Frontend (AL-E Mail) 🔧 REQUIERE CAMBIOS
- [ ] Cambiar `.select('folder')` → `.select('folder_id')`
- [ ] Hacer JOIN con `email_folders` para mostrar nombre
- [ ] Filtrar mensajes por `folder_id` en vez de `folder`
- [ ] Actualizar UI para mostrar folders correctamente

### Supabase (Datos) 🔧 REQUIERE CAMBIOS
- [ ] Actualizar cuenta SMTP a Hostinger
- [ ] Verificar que correos tienen `folder_id` asignado
- [ ] Verificar que folders existen en `email_folders`

---

## COMANDO DE VERIFICACIÓN

```bash
# 1. Ver logs del sync worker
pm2 logs al-e-core --lines 100 | grep "SYNC WORKER"

# 2. Verificar DNS SPF
dig TXT infinitykode.com +short

# 3. Verificar DKIM
dig TXT default._domainkey.infinitykode.com +short

# 4. Ver correos sincronizados en Supabase
SELECT 
  em.id,
  em.subject,
  em.from_address,
  ef.folder_name,
  ef.imap_path,
  em.created_at
FROM email_messages em
LEFT JOIN email_folders ef ON em.folder_id = ef.id
WHERE em.owner_user_id = '[USER_ID]'
ORDER BY em.created_at DESC
LIMIT 20;
```

---

## PRÓXIMOS PASOS

1. **URGENTE:** Configurar SPF/DKIM en Hostinger (5 min)
2. **URGENTE:** Actualizar cuenta SMTP en Supabase (2 min)
3. **IMPORTANTE:** Corregir frontend para usar `folder_id` (30 min)
4. **PROBAR:** Enviar correo de prueba a Gmail (1 min)
5. **VERIFICAR:** Que folders se actualicen correctamente en UI

**Tiempo estimado total:** 1 hora
