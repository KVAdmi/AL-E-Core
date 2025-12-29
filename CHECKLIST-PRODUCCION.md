# ✅ CHECKLIST PRODUCCIÓN - AL-E CORE POST-MIGRACIÓN

## 🎯 OBJETIVO
Verificar que la migración P0 está funcionando correctamente en producción.

---

## 📋 PRE-DEPLOYMENT

### 1. Código
- [x] Compilación sin errores (`npm run build`)
- [x] Verificación pasada (`./verify-migration.sh`)
- [x] Google eliminado (archivos borrados)
- [x] Nuevos endpoints implementados (22 endpoints)
- [x] Worker de notificaciones incluido

### 2. Dependencias
- [x] `nodemailer` instalado
- [x] `imap` instalado
- [x] `mailparser` instalado
- [x] `node-telegram-bot-api` instalado
- [x] Tipos TypeScript instalados

### 3. Base de Datos
- [ ] Migración 011 ejecutada (Email System)
- [ ] Migración 012 ejecutada (Calendar)
- [ ] Migración 013 ejecutada (Telegram)
- [ ] 8 tablas creadas verificadas
- [ ] RLS activo en todas las tablas
- [ ] Políticas RLS verificadas

### 4. Variables de Entorno
- [ ] `ENCRYPTION_KEY` agregada (32 bytes hex)
- [ ] `ENABLE_GOOGLE=false` configurado
- [ ] `ENABLE_OCR=true` configurado
- [ ] `ENABLE_TELEGRAM=true` configurado
- [ ] `ENABLE_IMAP=true` configurado
- [ ] Variables de Supabase presentes
- [ ] Variables de LLM providers presentes

---

## 🚀 DEPLOYMENT

### 1. Build & Deploy
```bash
cd /Users/pg/Documents/AL-E\ Core
./deploy-post-migration.sh
```

- [ ] Build completado sin errores
- [ ] Dependencias instaladas
- [ ] PM2 restart exitoso
- [ ] Proceso corriendo

### 2. Verificación Inicial
```bash
# Health check básico
curl https://api.al-eon.com/health

# Health check completo
curl https://api.al-eon.com/_health/full
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "db_ok": true,
  "features": {
    "google": false,
    "ocr": true,
    "telegram": true,
    "imap": true
  },
  "encryption_key_set": true
}
```

- [ ] `/health` responde OK
- [ ] `/_health/full` responde OK
- [ ] `db_ok: true`
- [ ] `encryption_key_set: true`
- [ ] `features.google: false`

---

## 🧪 TESTING FUNCIONAL

### Test 1: Email Account (SMTP)

**Crear cuenta:**
```bash
curl -X POST https://api.al-eon.com/api/email/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-prod",
    "providerLabel": "Gmail SMTP",
    "fromName": "AL-E Test",
    "fromEmail": "tu-email@gmail.com",
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpSecure": false,
    "smtpUser": "tu-email@gmail.com",
    "smtpPass": "tu-app-password"
  }'
```

**Resultado esperado:**
```json
{
  "ok": true,
  "message": "Cuenta de email creada exitosamente",
  "account": { "id": "...", ... }
}
```

- [ ] Cuenta creada exitosamente
- [ ] ID retornado
- [ ] Password NO visible en respuesta

**Test conexión:**
```bash
curl -X POST https://api.al-eon.com/api/email/accounts/<ACCOUNT_ID>/test
```

- [ ] `smtp.ok: true`
- [ ] Conexión SMTP exitosa

---

### Test 2: Envío de Email

```bash
curl -X POST https://api.al-eon.com/api/mail/send \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-prod",
    "accountId": "<ACCOUNT_ID>",
    "to": ["destinatario@example.com"],
    "subject": "Test AL-E Producción",
    "text": "Email de prueba desde AL-E Core post-migración"
  }'
```

**Resultado esperado:**
```json
{
  "ok": true,
  "message": "Email enviado exitosamente",
  "messageId": "..."
}
```

- [ ] Email enviado exitosamente
- [ ] `messageId` retornado
- [ ] Email recibido en destinatario
- [ ] Remitente correcto

---

### Test 3: Calendario Interno

**Crear evento:**
```bash
curl -X POST https://api.al-eon.com/api/calendar/events \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-prod",
    "title": "Test Calendario AL-E",
    "description": "Evento de prueba",
    "startAt": "2025-12-30T15:00:00Z",
    "endAt": "2025-12-30T16:00:00Z",
    "timezone": "America/Mexico_City"
  }'
```

**Resultado esperado:**
```json
{
  "ok": true,
  "message": "Evento creado exitosamente",
  "event": { "id": "...", ... }
}
```

- [ ] Evento creado exitosamente
- [ ] ID retornado
- [ ] Datos correctos

**Listar eventos:**
```bash
curl "https://api.al-eon.com/api/calendar/events?ownerUserId=test-user-prod"
```

- [ ] Evento aparece en lista
- [ ] Campos completos
- [ ] Fechas correctas

---

### Test 4: Telegram Bot

**Conectar bot:**
```bash
curl -X POST https://api.al-eon.com/api/telegram/bots/connect \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-prod",
    "botUsername": "@tu_bot_test",
    "botToken": "123456789:ABC-DEF-GHI-JKL-MNO"
  }'
```

**Resultado esperado:**
```json
{
  "ok": true,
  "message": "Bot conectado exitosamente",
  "bot": {
    "id": "...",
    "username": "@tu_bot_test",
    "webhookUrl": "https://api.al-eon.com/api/telegram/webhook/.../..."
  }
}
```

- [ ] Bot conectado exitosamente
- [ ] Webhook URL retornada
- [ ] Formato correcto: `https://api.al-eon.com/api/telegram/webhook/:botId/:secret`

**Verificar webhook en Telegram:**
```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

- [ ] URL configurada correctamente
- [ ] `pending_update_count: 0`
- [ ] Sin errores

**Enviar mensaje test:**
```bash
curl -X POST https://api.al-eon.com/api/telegram/send \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-prod",
    "chatId": <TU_CHAT_ID>,
    "text": "Test desde AL-E Core 🚀"
  }'
```

- [ ] Mensaje enviado exitosamente
- [ ] Mensaje recibido en Telegram
- [ ] `messageId` retornado

**Test webhook (enviar mensaje al bot):**
- [ ] Enviar mensaje al bot desde Telegram
- [ ] Webhook recibe mensaje
- [ ] Bot responde (respuesta temporal)
- [ ] Mensaje guardado en DB

---

## 📊 MONITORING

### Logs PM2
```bash
pm2 logs al-e-core --lines 50
```

**Verificar:**
- [ ] Sin errores críticos
- [ ] Worker de notificaciones activo
- [ ] Endpoints montados correctamente
- [ ] Sin errores de conexión DB

### Proceso PM2
```bash
pm2 status
pm2 info al-e-core
```

- [ ] Proceso `online`
- [ ] Uptime > 1 minuto
- [ ] Sin restarts frecuentes
- [ ] Memoria uso normal (<500MB)

### Database Queries
```sql
-- Verificar cuentas de email
SELECT COUNT(*) FROM email_accounts WHERE is_active = true;

-- Verificar eventos
SELECT COUNT(*) FROM calendar_events WHERE status = 'scheduled';

-- Verificar bots
SELECT COUNT(*) FROM telegram_bots WHERE is_active = true;

-- Verificar mensajes enviados
SELECT COUNT(*) FROM mail_messages WHERE status = 'sent';
```

- [ ] Queries funcionan
- [ ] Datos test visibles
- [ ] RLS funciona (solo datos del usuario)

---

## 🔒 SEGURIDAD

### Verificación de Encriptación
- [ ] Passwords SMTP no visibles en respuestas API
- [ ] Tokens Telegram no visibles en respuestas API
- [ ] `ENCRYPTION_KEY` NO está en código fuente
- [ ] `ENCRYPTION_KEY` solo en .env servidor

### RLS (Row Level Security)
- [ ] Usuarios solo ven sus datos
- [ ] Intentar acceder a datos de otro usuario falla
- [ ] Políticas RLS activas en todas las tablas

### Webhooks
- [ ] Telegram webhook usa `:secret` en URL
- [ ] Requests sin secret son rechazados
- [ ] No hay webhooks públicos sin autenticación

---

## 🚨 ROLLBACK (Si es necesario)

En caso de problemas críticos:

1. **Revertir código:**
```bash
git checkout <commit-anterior>
npm install
npm run build
pm2 restart al-e-core
```

2. **NO revertir migraciones DB** (son seguras, no rompen nada)

3. **Notificar equipo**

---

## ✅ SIGN-OFF PRODUCCIÓN

Una vez completado TODO el checklist:

- [ ] Todas las pruebas pasadas
- [ ] Sin errores en logs
- [ ] Monitoring activo
- [ ] Documentación actualizada
- [ ] Equipo notificado

**Firma y fecha:**
```
Responsable: _________________
Fecha: 29 de diciembre de 2025
Estado: [ ] APROBADO  [ ] RECHAZADO
```

---

## 📞 CONTACTO DE EMERGENCIA

En caso de problemas:
1. Revisar logs: `pm2 logs al-e-core`
2. Verificar health: `/_health/full`
3. Revisar `TROUBLESHOOTING.md` (crear si no existe)

---

**IMPORTANTE:** Este checklist debe completarse ANTES de dar luz verde a frontend.

**Regla:** NO frontend hasta que backend esté estable y validado.
