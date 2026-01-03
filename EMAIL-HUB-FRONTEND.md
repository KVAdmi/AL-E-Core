# 📧 EMAIL HUB UNIVERSAL - Guía de Integración Frontend

**Última actualización:** $(date)  
**Autor:** Equipo Backend  
**Módulo:** Email Hub Universal  
**Endpoint Base:** `/api/email` o `/api/mail`

---

## 🎯 Descripción

Este documento proporciona toda la información necesaria para que el **frontend** integre el **Email Hub Universal** de AL-E Core.

Con este módulo, AL-E puede:
- ✅ Conectar cuentas de correo de **cualquier proveedor** (Gmail, Outlook, Hostinger, Zoho, etc.)
- ✅ Leer emails vía **IMAP** (Inbox, Sent, Drafts, etc.)
- ✅ Enviar emails vía **SMTP**
- ✅ Sincronización automática cada **5 minutos**
- ✅ Seguridad con **encriptación AES-256-GCM**

---

## 📡 Variables de Entorno (Backend)

**No requiere configuración adicional en frontend.**

El backend ya tiene configurado:
```bash
EMAIL_CRED_ENC_KEY=b6151efecddecb39cbf2ae9451bc25fd27283aefccf4e47c548ca0bd5543e51b
```

---

## 🔐 Autenticación

Todos los endpoints requieren **JWT válido** en el header:

```bash
Authorization: Bearer <jwt_token>
```

El token debe contener el `user_id` del usuario autenticado. Este `user_id` se extrae del JWT y se usa para validar que el usuario solo acceda a sus propias cuentas de correo.

---

## 📚 Endpoints Disponibles

### Base URL
```
https://100.27.201.233/api/email
o
https://100.27.201.233/api/mail
```

---

## 1️⃣ Agregar Nueva Cuenta de Email

**Endpoint:** `POST /api/email/accounts`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>",
  "Content-Type": "application/json"
}
```

**Body:**
```json
{
  "email": "usuario@gmail.com",
  "imapHost": "imap.gmail.com",
  "imapPort": 993,
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 587,
  "password": "contraseña_o_app_password",
  "provider": "gmail"
}
```

**Respuesta exitosa (200):**
```json
{
  "account": {
    "id": "uuid-generado",
    "email": "usuario@gmail.com",
    "provider": "gmail",
    "status": "active",
    "last_sync_at": null,
    "created_at": "2025-01-01T12:00:00Z"
  }
}
```

**Ejemplo con cURL:**
```bash
curl -X POST https://100.27.201.233/api/email/accounts \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@gmail.com",
    "imapHost": "imap.gmail.com",
    "imapPort": 993,
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "password": "app_password_de_google",
    "provider": "gmail"
  }'
```

**Ejemplo con Fetch (JavaScript):**
```javascript
const response = await fetch('https://100.27.201.233/api/email/accounts', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    email: 'usuario@gmail.com',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    password: 'app_password_de_google',
    provider: 'gmail'
  })
});

const data = await response.json();
console.log('Cuenta agregada:', data.account);
```

---

## 2️⃣ Probar Conexión de Cuenta

**Endpoint:** `POST /api/email/accounts/:accountId/test`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>"
}
```

**Respuesta exitosa (200):**
```json
{
  "status": "success",
  "message": "Conexión exitosa",
  "details": {
    "imap": "✓ Conectado a imap.gmail.com",
    "smtp": "✓ Conectado a smtp.gmail.com"
  }
}
```

**Ejemplo:**
```bash
curl -X POST https://100.27.201.233/api/email/accounts/uuid-123/test \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## 3️⃣ Sincronizar Mensajes (Manual)

**Endpoint:** `POST /api/email/accounts/:accountId/sync`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>"
}
```

**Respuesta exitosa (200):**
```json
{
  "syncedMessages": 42,
  "message": "Sincronización completada"
}
```

**Ejemplo:**
```bash
curl -X POST https://100.27.201.233/api/email/accounts/uuid-123/sync \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Nota:** La sincronización automática ocurre cada **5 minutos** sin necesidad de llamar este endpoint.

---

## 4️⃣ Listar Inbox de una Cuenta

**Endpoint:** `GET /api/email/accounts/:accountId/inbox?limit=50&offset=0`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>"
}
```

**Query Params:**
- `limit` (opcional): Número de mensajes a retornar (default: 50)
- `offset` (opcional): Paginación (default: 0)

**Respuesta exitosa (200):**
```json
{
  "messages": [
    {
      "id": "uuid-mensaje",
      "subject": "Asunto del email",
      "from_email": "remitente@example.com",
      "from_name": "Nombre Remitente",
      "received_at": "2025-01-01T10:30:00Z",
      "is_read": false,
      "is_starred": false,
      "folder": "INBOX",
      "preview": "Primeras líneas del email..."
    }
  ],
  "total": 150
}
```

**Ejemplo:**
```bash
curl -X GET "https://100.27.201.233/api/email/accounts/uuid-123/inbox?limit=20&offset=0" \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Ejemplo con Fetch:**
```javascript
const response = await fetch(
  `https://100.27.201.233/api/email/accounts/${accountId}/inbox?limit=20&offset=0`,
  {
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    }
  }
);

const data = await response.json();
console.log('Mensajes:', data.messages);
console.log('Total:', data.total);
```

---

## 5️⃣ Obtener Detalle de un Mensaje

**Endpoint:** `GET /api/email/messages/:messageId`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>"
}
```

**Respuesta exitosa (200):**
```json
{
  "message": {
    "id": "uuid-mensaje",
    "subject": "Asunto completo",
    "from_email": "remitente@example.com",
    "from_name": "Nombre Remitente",
    "to_emails": ["destinatario@example.com"],
    "cc_emails": [],
    "body_text": "Contenido en texto plano",
    "body_html": "<html>...</html>",
    "received_at": "2025-01-01T10:30:00Z",
    "is_read": true,
    "is_starred": false,
    "folder": "INBOX",
    "attachment_count": 2,
    "attachments": [
      {
        "filename": "documento.pdf",
        "content_type": "application/pdf",
        "size": 102400
      }
    ]
  }
}
```

**Ejemplo:**
```bash
curl -X GET https://100.27.201.233/api/email/messages/uuid-mensaje \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## 6️⃣ Enviar Email desde una Cuenta

**Endpoint:** `POST /api/email/send`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>",
  "Content-Type": "application/json"
}
```

**Body:**
```json
{
  "accountId": "uuid-cuenta",
  "to": "destinatario@example.com",
  "subject": "Asunto del email",
  "bodyText": "Texto plano del email",
  "bodyHtml": "<p>HTML del email</p>",
  "cc": ["copia@example.com"],
  "bcc": ["copia_oculta@example.com"]
}
```

**Respuesta exitosa (200):**
```json
{
  "status": "sent",
  "messageId": "smtp-message-id@example.com"
}
```

**Ejemplo con cURL:**
```bash
curl -X POST https://100.27.201.233/api/email/send \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "uuid-cuenta",
    "to": "cliente@example.com",
    "subject": "Respuesta a tu consulta",
    "bodyText": "Hola, aquí está la información solicitada.",
    "bodyHtml": "<p>Hola,</p><p>Aquí está la información solicitada.</p>"
  }'
```

**Ejemplo con Fetch:**
```javascript
const response = await fetch('https://100.27.201.233/api/email/send', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    accountId: accountId,
    to: 'destinatario@example.com',
    subject: 'Asunto del email',
    bodyText: 'Contenido en texto plano',
    bodyHtml: '<p>Contenido en HTML</p>'
  })
});

const data = await response.json();
if (data.status === 'sent') {
  console.log('Email enviado exitosamente');
}
```

---

## 7️⃣ Marcar Mensaje como Leído / Destacado

**Endpoint:** `POST /api/email/messages/:messageId/actions`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>",
  "Content-Type": "application/json"
}
```

**Body:**
```json
{
  "action": "markRead",
  "value": true
}
```

**Acciones disponibles:**
- `markRead` → Marca como leído (`value: true`) o no leído (`value: false`)
- `markStarred` → Marca como destacado (`value: true`) o no destacado (`value: false`)

**Respuesta exitosa (200):**
```json
{
  "success": true
}
```

**Ejemplo:**
```bash
# Marcar como leído
curl -X POST https://100.27.201.233/api/email/messages/uuid-mensaje/actions \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "markRead", "value": true}'

# Marcar como destacado
curl -X POST https://100.27.201.233/api/email/messages/uuid-mensaje/actions \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "markStarred", "value": true}'
```

---

## 8️⃣ Listar Todas las Cuentas del Usuario

**Endpoint:** `GET /api/email/accounts`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>"
}
```

**Respuesta exitosa (200):**
```json
{
  "accounts": [
    {
      "id": "uuid-1",
      "email": "personal@gmail.com",
      "provider": "gmail",
      "status": "active",
      "last_sync_at": "2025-01-01T12:00:00Z"
    },
    {
      "id": "uuid-2",
      "email": "trabajo@outlook.com",
      "provider": "outlook",
      "status": "active",
      "last_sync_at": "2025-01-01T11:55:00Z"
    }
  ]
}
```

**Ejemplo:**
```bash
curl -X GET https://100.27.201.233/api/email/accounts \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## 9️⃣ Listar Carpetas de una Cuenta

**Endpoint:** `GET /api/email/accounts/:accountId/folders`

**Headers:**
```json
{
  "Authorization": "Bearer <jwt_token>"
}
```

**Respuesta exitosa (200):**
```json
{
  "folders": [
    {
      "id": "uuid-folder-1",
      "name": "INBOX",
      "path": "INBOX",
      "message_count": 150
    },
    {
      "id": "uuid-folder-2",
      "name": "Sent",
      "path": "Sent",
      "message_count": 45
    },
    {
      "id": "uuid-folder-3",
      "name": "Drafts",
      "path": "Drafts",
      "message_count": 3
    }
  ]
}
```

**Ejemplo:**
```bash
curl -X GET https://100.27.201.233/api/email/accounts/uuid-123/folders \
  -H "Authorization: Bearer $JWT_TOKEN"
```

---

## 🔧 Configuración de Proveedores

### Gmail
```json
{
  "email": "usuario@gmail.com",
  "imapHost": "imap.gmail.com",
  "imapPort": 993,
  "smtpHost": "smtp.gmail.com",
  "smtpPort": 587,
  "password": "app_password_generada",
  "provider": "gmail"
}
```

**Importante:** Debes generar una **App Password** en Google:
1. Ir a https://myaccount.google.com/security
2. Activar verificación en 2 pasos
3. Generar una contraseña de aplicación en "Contraseñas de aplicaciones"

---

### Outlook / Hotmail
```json
{
  "email": "usuario@outlook.com",
  "imapHost": "outlook.office365.com",
  "imapPort": 993,
  "smtpHost": "smtp-mail.outlook.com",
  "smtpPort": 587,
  "password": "contraseña_normal",
  "provider": "outlook"
}
```

---

### Hostinger
```json
{
  "email": "contacto@midominio.com",
  "imapHost": "imap.hostinger.com",
  "imapPort": 993,
  "smtpHost": "smtp.hostinger.com",
  "smtpPort": 587,
  "password": "contraseña_del_email",
  "provider": "hostinger"
}
```

---

### Zoho Mail
```json
{
  "email": "info@miempresa.com",
  "imapHost": "imap.zoho.com",
  "imapPort": 993,
  "smtpHost": "smtp.zoho.com",
  "smtpPort": 587,
  "password": "contraseña_zoho",
  "provider": "zoho"
}
```

---

### Otros Proveedores (Genérico)
```json
{
  "email": "email@dominio.com",
  "imapHost": "mail.dominio.com",
  "imapPort": 993,
  "smtpHost": "mail.dominio.com",
  "smtpPort": 587,
  "password": "contraseña",
  "provider": "custom"
}
```

---

## ⚠️ Manejo de Errores

**Códigos de Estado HTTP:**

| Código | Descripción |
|--------|-------------|
| 200 | Operación exitosa |
| 201 | Recurso creado |
| 400 | Datos inválidos o faltantes |
| 401 | No autorizado (JWT inválido o ausente) |
| 403 | Prohibido (intento de acceder a cuenta de otro usuario) |
| 404 | Cuenta o mensaje no encontrado |
| 500 | Error interno del servidor |

**Ejemplo de error (400):**
```json
{
  "error": "Faltan campos requeridos: email, imapHost, password"
}
```

**Ejemplo de error (401):**
```json
{
  "error": "Token JWT inválido o expirado"
}
```

**Ejemplo de error (500):**
```json
{
  "error": "Error al conectar con el servidor IMAP",
  "details": "Connection timeout after 30s"
}
```

---

## 🔄 Flujo de Integración Recomendado

### 1. Conectar una cuenta de email
```javascript
// Frontend llama POST /api/email/accounts
const account = await connectEmailAccount({
  email: 'usuario@gmail.com',
  imapHost: 'imap.gmail.com',
  imapPort: 993,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  password: 'app_password',
  provider: 'gmail'
});
```

### 2. Probar conexión
```javascript
// Frontend llama POST /api/email/accounts/:id/test
const testResult = await testConnection(account.id);
if (testResult.status === 'success') {
  showNotification('Cuenta conectada exitosamente');
}
```

### 3. Sincronizar mensajes (opcional, el worker lo hace automáticamente)
```javascript
// Frontend llama POST /api/email/accounts/:id/sync
const syncResult = await syncMessages(account.id);
console.log(`${syncResult.syncedMessages} mensajes sincronizados`);
```

### 4. Mostrar Inbox
```javascript
// Frontend llama GET /api/email/accounts/:id/inbox
const inbox = await getInbox(account.id, { limit: 20, offset: 0 });
renderEmailList(inbox.messages);
```

### 5. Ver detalle de un mensaje
```javascript
// Usuario hace clic en un email
// Frontend llama GET /api/email/messages/:messageId
const message = await getMessage(messageId);
renderEmailDetail(message);

// Marcar como leído
await markAsRead(messageId, true);
```

### 6. Enviar email
```javascript
// Usuario escribe un email
// Frontend llama POST /api/email/send
const result = await sendEmail({
  accountId: account.id,
  to: 'destinatario@example.com',
  subject: 'Asunto',
  bodyText: 'Contenido',
  bodyHtml: '<p>Contenido HTML</p>'
});

if (result.status === 'sent') {
  showNotification('Email enviado');
}
```

---

## 🔒 Seguridad

1. **Encriptación de Credenciales:**
   - Las contraseñas se almacenan encriptadas con **AES-256-GCM**
   - La clave de encriptación (`EMAIL_CRED_ENC_KEY`) está en el servidor backend
   - El frontend **nunca** debe almacenar contraseñas en localStorage/cookies

2. **Autenticación:**
   - Todos los endpoints requieren JWT válido
   - El `user_id` se extrae del JWT para validar ownership
   - Row Level Security (RLS) en Supabase impide acceso a cuentas de otros usuarios

3. **Rate Limiting:**
   - El envío de emails tiene límite de **10 emails/minuto por cuenta**
   - Esto previene spam y abuso del sistema

4. **Logs de Auditoría:**
   - Todas las sincronizaciones se registran en `email_sync_log`
   - Se guarda timestamp, cuenta, mensajes procesados y errores

---

## 📊 Sincronización Automática

El **Email Sync Worker** se ejecuta automáticamente cada **5 minutos** y:

1. Busca todas las cuentas con `status='active'`
2. Conecta a cada cuenta vía IMAP
3. Sincroniza mensajes nuevos desde el último `uidnext`
4. Actualiza `last_sync_at` en cada cuenta
5. Registra logs en `email_sync_log`

**El frontend NO necesita llamar manualmente al endpoint de sync**, solo si el usuario presiona un botón "Sincronizar ahora".

---

## 🧪 Testing con cURL

### Test completo de flujo:

```bash
# 1. Agregar cuenta
ACCOUNT_ID=$(curl -X POST https://100.27.201.233/api/email/accounts \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@gmail.com",
    "imapHost": "imap.gmail.com",
    "imapPort": 993,
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "password": "app_password",
    "provider": "gmail"
  }' | jq -r '.account.id')

# 2. Probar conexión
curl -X POST https://100.27.201.233/api/email/accounts/$ACCOUNT_ID/test \
  -H "Authorization: Bearer $JWT_TOKEN"

# 3. Sincronizar
curl -X POST https://100.27.201.233/api/email/accounts/$ACCOUNT_ID/sync \
  -H "Authorization: Bearer $JWT_TOKEN"

# 4. Ver inbox
curl -X GET https://100.27.201.233/api/email/accounts/$ACCOUNT_ID/inbox \
  -H "Authorization: Bearer $JWT_TOKEN"

# 5. Enviar email
curl -X POST https://100.27.201.233/api/email/send \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "'$ACCOUNT_ID'",
    "to": "destinatario@example.com",
    "subject": "Test desde AL-E",
    "bodyText": "Este es un email de prueba"
  }'
```

---

## 📝 Notas Importantes

1. **Gmail:** Requiere App Password (no la contraseña normal)
2. **Outlook:** Puede requerir habilitar IMAP en configuración
3. **Hostinger:** Verificar que el plan incluya acceso IMAP/SMTP
4. **Rate Limits:** Máximo 10 emails por minuto por cuenta
5. **Attachments:** Aún no implementado en v1.0 (próximo release)

---

## 🆘 Soporte

**Contacto Backend:**
- Slack: #backend-support
- Email: dev@al-eon.com

**Documentación Técnica:**
- `EMAIL-HUB-UNIVERSAL.md` - Arquitectura completa
- `EMAIL-HUB-PROVIDERS.md` - Configuraciones de proveedores
- `EMAIL-HUB-RESUMEN.md` - Resumen ejecutivo

---

## ✅ Checklist de Integración

- [ ] Obtener JWT válido del sistema de autenticación
- [ ] Implementar formulario para agregar cuenta (email, password, provider)
- [ ] Llamar `POST /api/email/accounts` al guardar
- [ ] Probar conexión con `POST /api/email/accounts/:id/test`
- [ ] Listar inbox con `GET /api/email/accounts/:id/inbox`
- [ ] Mostrar detalle de mensaje con `GET /api/email/messages/:id`
- [ ] Implementar botón "Marcar como leído" con `POST /api/email/messages/:id/actions`
- [ ] Implementar formulario de envío con `POST /api/email/send`
- [ ] Mostrar lista de cuentas con `GET /api/email/accounts`
- [ ] Manejar errores 401/403/500 con notificaciones al usuario

---

**¡Listo para integrar! 🚀**
