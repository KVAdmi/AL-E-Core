# 📧 EMAIL HUB UNIVERSAL - AL-E CORE

## 🎯 Objetivo

Módulo completo para que AL-E pueda conectar cuentas de correo de **CUALQUIER dominio** (Gmail, Outlook, Hostinger, Zoho, etc.) y:
- ✅ Leer emails (IMAP)
- ✅ Enviar emails (SMTP)
- ✅ Almacenar en Supabase
- ✅ Exponer API REST para frontend
- ✅ Sincronización automática cada 5 minutos

**IMPORTANTE:** NO depende de tener dominio al-eon.com ni AWS SES inbound. Este es el MVP funcional.

---

## 📋 Características Implementadas

### 🔐 Seguridad
- ✅ Cifrado AES-256-GCM de credenciales IMAP/SMTP
- ✅ Passwords NUNCA en claro en DB
- ✅ Rate limiting (10 envíos/minuto por cuenta)
- ✅ Validación de hosts y puertos permitidos
- ✅ Autenticación JWT obligatoria

### 📥 IMAP (Lectura)
- ✅ Conexión segura TLS/SSL
- ✅ Sincronización incremental por UID
- ✅ Deduplicación por message-id
- ✅ Parse completo (headers, body, attachments metadata)
- ✅ Soporte folders (INBOX, Sent, Drafts, etc.)
- ✅ Marcar como leído/starred (bidireccional con IMAP)

### 📤 SMTP (Envío)
- ✅ Envío con credenciales del usuario
- ✅ HTML + texto plano
- ✅ CC, BCC, Reply-To
- ✅ Threading (In-Reply-To, References)
- ✅ Validaciones estrictas

### 🗄️ Base de Datos
- ✅ Tablas: `email_accounts`, `email_messages`, `email_folders`, `email_sync_log`
- ✅ Row Level Security (RLS) por `owner_user_id`
- ✅ Sync log para auditoría
- ✅ Búsqueda de mensajes

### 🔄 Sincronización Automática
- ✅ Worker que ejecuta cada 5 minutos
- ✅ Solo cuentas activas con IMAP configurado
- ✅ Manejo de errores sin crashear
- ✅ Logging detallado

---

## 🚀 Setup Inicial

### 1. Instalar Dependencias

```bash
npm install imapflow mailparser nodemailer
npm install --save-dev @types/mailparser @types/nodemailer
```

### 2. Configurar Variable de Entorno

Generar clave de cifrado (ejecutar UNA VEZ):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Agregar al `.env`:

```bash
# Email Hub - Cifrado de credenciales (64 caracteres hex = 32 bytes)
EMAIL_CRED_ENC_KEY=tu_clave_generada_de_64_caracteres_hex_aqui
```

**⚠️ CRÍTICO:** Esta clave NO debe cambiar nunca o perderás acceso a todas las credenciales cifradas.

### 3. Verificar Tablas en Supabase

Las tablas ya existen en tu schema:
- ✅ `email_accounts`
- ✅ `email_messages`
- ✅ `email_folders`
- ✅ `email_sync_log`

Verifica que RLS esté habilitado y las policies estén configuradas.

---

## 📡 API Endpoints

Base URL: `https://api.al-eon.com/api/email`

### 1. Crear Cuenta de Correo

```bash
POST /api/email/accounts
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "provider_label": "Gmail",
  "from_name": "Juan Pérez",
  "from_email": "juan@gmail.com",
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "juan@gmail.com",
  "smtp_pass": "app-password-here",
  "imap_host": "imap.gmail.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "juan@gmail.com",
  "imap_pass": "app-password-here"
}
```

**Respuesta:**
```json
{
  "success": true,
  "account": {
    "id": "uuid",
    "from_email": "juan@gmail.com",
    "is_active": true,
    ...
  },
  "folders": [
    { "folder_name": "INBOX", "folder_type": "inbox", ... }
  ],
  "smtp_test": { "success": true },
  "imap_test": { "success": true }
}
```

**Errores comunes:**
- `SMTP_AUTH_FAILED` → Credenciales SMTP incorrectas
- `IMAP_AUTH_FAILED` → Credenciales IMAP incorrectas
- `IMAP_CONNECT_TIMEOUT` → Host/puerto IMAP incorrecto
- `ENCRYPTION_KEY_NOT_CONFIGURED` → Falta EMAIL_CRED_ENC_KEY

---

### 2. Test de Conexión

```bash
POST /api/email/accounts/:id/test
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "test_type": "both"  // "smtp" | "imap" | "both"
}
```

---

### 3. Forzar Sincronización

```bash
POST /api/email/accounts/:id/sync
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "folder_path": "INBOX"  // Opcional, default INBOX
}
```

**Respuesta:**
```json
{
  "success": true,
  "sync": {
    "folder": "INBOX",
    "messages_fetched": 15,
    "messages_new": 12,
    "last_uid": 1234
  }
}
```

---

### 4. Listar Mensajes (Inbox)

```bash
GET /api/email/accounts/:id/inbox?limit=50&offset=0&unread_only=false
Authorization: Bearer {jwt_token}
```

**Query params:**
- `folder_id` (opcional) → ID del folder específico
- `limit` (default 50)
- `offset` (default 0)
- `unread_only` (true/false)
- `starred_only` (true/false)

**Respuesta:**
```json
{
  "success": true,
  "messages": [
    {
      "id": "uuid",
      "from_address": "sender@example.com",
      "from_name": "Sender Name",
      "subject": "Asunto del correo",
      "body_preview": "Primeros 200 caracteres...",
      "date": "2026-01-03T12:00:00Z",
      "is_read": false,
      "is_starred": false,
      "has_attachments": true,
      ...
    }
  ],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

---

### 5. Ver Detalle de Mensaje

```bash
GET /api/email/messages/:msgId
Authorization: Bearer {jwt_token}
```

**Respuesta:**
```json
{
  "success": true,
  "message": {
    "id": "uuid",
    "from_address": "sender@example.com",
    "subject": "...",
    "body_text": "Texto plano...",
    "body_html": "<html>...",
    "to_addresses": ["recipient@example.com"],
    "cc_addresses": [],
    "date": "2026-01-03T12:00:00Z",
    ...
  }
}
```

---

### 6. Enviar Correo

```bash
POST /api/email/send
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "account_id": "uuid",
  "to": ["recipient@example.com"],
  "cc": ["cc@example.com"],
  "subject": "Asunto del correo",
  "body_text": "Texto plano",
  "body_html": "<p>HTML opcional</p>",
  "reply_to": "reply@example.com",
  "in_reply_to": "<message-id@example.com>"
}
```

**Respuesta:**
```json
{
  "success": true,
  "message_id": "<generated-id@smtp.gmail.com>"
}
```

**Errores comunes:**
- `RATE_LIMIT_EXCEEDED` → Máximo 10 envíos/minuto
- `SMTP_AUTH_FAILED` → Credenciales inválidas
- `SMTP_INVALID_RECIPIENT` → Email destinatario inválido
- `SMTP_MESSAGE_TOO_LARGE` → Mensaje excede límite del servidor

---

### 7. Acciones sobre Mensaje

```bash
POST /api/email/messages/:msgId/actions
Authorization: Bearer {jwt_token}
Content-Type: application/json

{
  "action": "mark_read"  // mark_read | mark_unread | star | unstar
}
```

---

### 8. Listar Cuentas del Usuario

```bash
GET /api/email/accounts
Authorization: Bearer {jwt_token}
```

---

### 9. Listar Folders de una Cuenta

```bash
GET /api/email/accounts/:id/folders
Authorization: Bearer {jwt_token}
```

---

## 🔧 Configuración por Proveedor

### Gmail

**Paso previo:** Habilitar "App passwords" en https://myaccount.google.com/apppasswords

```json
{
  "provider_label": "Gmail",
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "imap_host": "imap.gmail.com",
  "imap_port": 993,
  "imap_secure": true
}
```

### Outlook / Office 365

```json
{
  "provider_label": "Outlook",
  "smtp_host": "smtp-mail.outlook.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "imap_host": "outlook.office365.com",
  "imap_port": 993,
  "imap_secure": true
}
```

### Hostinger

```json
{
  "provider_label": "Hostinger",
  "smtp_host": "smtp.hostinger.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "imap_host": "imap.hostinger.com",
  "imap_port": 993,
  "imap_secure": true
}
```

### Zoho Mail

```json
{
  "provider_label": "Zoho",
  "smtp_host": "smtp.zoho.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "imap_host": "imap.zoho.com",
  "imap_port": 993,
  "imap_secure": true
}
```

---

## 🧪 Testing Manual

### 1. Generar clave de cifrado

```bash
cd src/utils
node -e "const { generateEncryptionKey } = require('./emailEncryption.ts'); console.log(generateEncryptionKey());"
```

### 2. Validar clave configurada

```bash
curl -X POST https://api.al-eon.com/api/email/accounts \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider_label": "Test",
    "from_name": "Test",
    "from_email": "test@test.com",
    "smtp_host": "smtp.gmail.com",
    "smtp_port": 587,
    "smtp_secure": false,
    "smtp_user": "test",
    "smtp_pass": "test"
  }'
```

Si falta la clave, verás:
```json
{
  "success": false,
  "error": "ENCRYPTION_KEY_NOT_CONFIGURED",
  "message": "Clave de cifrado no configurada"
}
```

---

## 🐛 Debugging

### Logs del Worker

```bash
# Ver logs del sync worker
tail -f /var/log/al-e-core/output.log | grep "SYNC WORKER"
```

### Logs de IMAP/SMTP

Los servicios loggean automáticamente:
- `[IMAP] 🔌 Probando conexión...`
- `[SMTP] 📤 Enviando correo...`
- `[EMAIL HUB] ✅ Cuenta creada exitosamente`

### Errores Comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `IMAP_AUTH_FAILED` | Password IMAP incorrecto | Verifica credenciales y "App passwords" |
| `SMTP_AUTH_FAILED` | Password SMTP incorrecto | Verifica credenciales y "App passwords" |
| `IMAP_CONNECT_TIMEOUT` | Host/puerto incorrecto | Verifica configuración IMAP del proveedor |
| `ENCRYPTION_KEY_NOT_CONFIGURED` | Falta EMAIL_CRED_ENC_KEY | Agrega la variable al .env |
| `RATE_LIMIT_EXCEEDED` | Más de 10 envíos/min | Espera 1 minuto |

---

## 🔄 Flujo Completo

1. **Usuario conecta cuenta:**
   - Frontend llama `POST /api/email/accounts`
   - Backend cifra credenciales con AES-256-GCM
   - Backend valida conexión SMTP/IMAP
   - Backend guarda cuenta en `email_accounts`
   - Backend sincroniza folders en `email_folders`

2. **Sync automático (cada 5 min):**
   - Worker obtiene cuentas activas
   - Para cada cuenta:
     - Conecta vía IMAP
     - Obtiene último UID sincronizado
     - Fetch mensajes nuevos (max 50)
     - Parse con mailparser
     - Guarda en `email_messages` (con deduplicación)
     - Registra en `email_sync_log`

3. **Usuario lee correo:**
   - Frontend llama `GET /api/email/accounts/:id/inbox`
   - Backend consulta `email_messages` con RLS
   - Retorna lista paginada

4. **Usuario ve detalle:**
   - Frontend llama `GET /api/email/messages/:msgId`
   - Backend retorna mensaje completo
   - Frontend puede llamar `POST .../actions` para marcar como leído

5. **Usuario envía correo:**
   - Frontend llama `POST /api/email/send`
   - Backend verifica rate limit
   - Backend envía vía SMTP con credenciales cifradas
   - Retorna `message_id` del servidor SMTP

---

## 📊 Estado de Implementación

### ✅ Completado (100%)
- ✅ Cifrado AES-256-GCM
- ✅ IMAPService (imapflow)
- ✅ SMTPService (nodemailer)
- ✅ Repositorios DB (4 tablas)
- ✅ 9 endpoints REST
- ✅ Sync worker automático
- ✅ Rate limiting
- ✅ Manejo de errores
- ✅ Integración con index.ts

### 📝 Pendiente (Mejoras Futuras)
- ⏳ Soporte adjuntos (descarga/upload)
- ⏳ Búsqueda full-text
- ⏳ Filtros/reglas automáticas
- ⏳ Threading avanzado
- ⏳ Push notifications en tiempo real
- ⏳ OAuth2 (Gmail/Outlook)

---

## 🔐 Seguridad y Best Practices

### DO ✅
- ✅ Siempre usar `requireAuth` middleware
- ✅ Validar `owner_user_id` en todos los queries
- ✅ Nunca retornar `smtp_pass_enc` o `imap_pass_enc` al frontend
- ✅ Usar rate limiting en envío
- ✅ Validar emails con regex
- ✅ Sanitizar subject y body
- ✅ Loggear sin incluir passwords

### DON'T ❌
- ❌ Nunca guardar passwords en claro
- ❌ Nunca enviar credenciales cifradas al frontend
- ❌ Nunca permitir sync sin autenticación
- ❌ Nunca exponer `EMAIL_CRED_ENC_KEY` en logs
- ❌ Nunca confiar en input del usuario sin validar

---

## 📞 Soporte

**Desarrollado por:** Core (Patricia Garibay)  
**Fecha:** 3 de enero de 2026  
**Repositorio:** https://github.com/KVAdmi/AL-E-Core

Para reportar issues, incluye:
1. Request completo (curl)
2. Response completo
3. Logs del servidor
4. Proveedor de email (Gmail/Outlook/etc.)

---

**🎉 ¡Email Hub Universal listo para producción!**
