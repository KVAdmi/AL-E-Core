# 📧 CONFIGURACIÓN FRONTEND - SISTEMA DE CORREO AL-EON

## 🎯 Variables de Entorno Requeridas

### Archivo: `.env.local` (Frontend Next.js)

```bash
# === BACKEND API ===
NEXT_PUBLIC_API_URL=https://api.al-eon.com

# === SUPABASE (MISMO PROYECTO QUE BACKEND) ===
NEXT_PUBLIC_SUPABASE_URL=https://gptwzuqmuvzttajgjrry.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDU1NzAsImV4cCI6MjA2ODA4MTU3MH0.AAbVhdrI7LmSPKKRX0JhSkYxVg7VOw-ccizKTOh7pV8

# === AWS (PARA SUBIDA DE IMÁGENES DE FIRMA) ===
NEXT_PUBLIC_AWS_REGION=us-east-1
NEXT_PUBLIC_AWS_S3_BUCKET=aleon-mail-attachments

# NOTA: NO pongas AWS credentials en frontend
# Las credenciales AWS solo van en backend
```

---

## 🔐 Arquitectura de Seguridad

### ✅ LO QUE VA EN FRONTEND
- `NEXT_PUBLIC_API_URL` - URL pública del backend
- `NEXT_PUBLIC_SUPABASE_URL` - URL pública de Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Key pública (anon) de Supabase
- `NEXT_PUBLIC_AWS_REGION` - Región de AWS
- `NEXT_PUBLIC_AWS_S3_BUCKET` - Nombre del bucket S3

### ❌ LO QUE NO VA EN FRONTEND (NUNCA)
- `SUPABASE_SERVICE_ROLE_KEY` - Solo backend
- `AWS_ACCESS_KEY_ID` - Solo backend
- `AWS_SECRET_ACCESS_KEY` - Solo backend
- `INBOUND_SECRET` - Solo backend
- `SMTP_PASS` - Solo backend
- Cualquier API key privada

---

## 📡 Endpoints Backend Disponibles

### Base URL
```
https://api.al-eon.com
```

### Autenticación
Todos los endpoints de usuario requieren:
```javascript
headers: {
  'Authorization': `Bearer ${access_token}`,
  'Content-Type': 'application/json'
}
```

El `access_token` se obtiene de Supabase Auth:
```javascript
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;
```

---

## 📬 Endpoints de Correo

### 1. Listar Mensajes
```javascript
GET /api/mail/messages?limit=50&offset=0&status=new&folder=inbox

Response:
{
  "success": true,
  "messages": [...],
  "total": 150,
  "hasMore": true
}
```

### 2. Ver Detalle de Mensaje
```javascript
GET /api/mail/messages/:id

Response:
{
  "success": true,
  "message": {
    "id": "uuid",
    "from_email": "sender@example.com",
    "subject": "...",
    "body_html": "<html>...",
    "attachments_json": [...],
    "presignedUrl": "https://s3.amazonaws.com/..."
  }
}
```

### 3. Marcar como Leído
```javascript
POST /api/mail/messages/:id/read

Response:
{
  "success": true,
  "message": "Message marked as read"
}
```

### 4. Generar Respuesta con AI
```javascript
POST /api/mail/messages/:id/ai-reply
Body: {
  "tone": "professional",
  "language": "es"
}

Response:
{
  "success": true,
  "draft_text": "Estimado/a...",
  "message": "Reply generated successfully"
}
```

### 5. Guardar Borrador
```javascript
POST /api/mail/messages/:id/draft
Body: {
  "draft_text": "...",
  "status": "draft"
}

Response:
{
  "success": true,
  "draft": { "id": "uuid", ... }
}
```

### 6. Listar Borradores
```javascript
GET /api/mail/drafts?status=draft

Response:
{
  "success": true,
  "drafts": [...]
}
```

### 7. Actualizar Bandera
```javascript
PATCH /api/mail/messages/:id/flag
Body: {
  "flag": "urgent"
}

Valores permitidos:
- "urgent"
- "important"
- "pending"
- "follow_up"
- "low_priority"
- null (para quitar bandera)
```

### 8. Marcar como Spam
```javascript
POST /api/mail/messages/:id/spam

Response:
{
  "success": true,
  "message": "Message marked as spam"
}
```

---

## 🗄️ Acceso Directo a Supabase (Tablas)

El frontend puede consultar directamente estas tablas usando Supabase JS Client:

### Tablas Disponibles
1. `mail_accounts` - Cuentas de correo del usuario
2. `mail_messages` - Mensajes de correo
3. `mail_drafts` - Borradores
4. `mail_attachments` - Adjuntos
5. `mail_filters` - Reglas de filtrado
6. `mail_sync_log` - Log de sincronizaciones

### Ejemplo de Query Directo
```javascript
// Obtener mensajes nuevos
const { data, error } = await supabase
  .from('mail_messages')
  .select('*')
  .eq('status', 'new')
  .eq('folder', 'inbox')
  .order('received_at', { ascending: false })
  .limit(50);
```

**IMPORTANTE:** RLS (Row Level Security) está habilitado. Solo verás tus propios mensajes (filtrado automático por `user_id`).

---

## 🔄 Flujo Completo de Trabajo

### 1. Usuario Configura Cuenta
```javascript
// Frontend guarda en mail_accounts
const { data, error } = await supabase
  .from('mail_accounts')
  .insert({
    provider: 'ses_inbound',
    domain: 'al-eon.com',
    aws_region: 'us-east-1',
    s3_bucket: 'aleon-mail-inbound',
    status: 'active',
    spam_filter_enabled: true,
    signature_text: 'Saludos cordiales...'
  });
```

### 2. Correo Llega (Backend Automático)
```
Email → AWS SES → S3 → Lambda → Core Backend → Supabase mail_messages
```
**Frontend NO hace nada aquí** - todo automático en backend.

### 3. Frontend Consulta Mensajes
```javascript
// Opción A: Via API REST
const response = await fetch('https://api.al-eon.com/api/mail/messages', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

// Opción B: Via Supabase directo
const { data } = await supabase
  .from('mail_messages')
  .select('*')
  .eq('status', 'new')
  .order('received_at', { ascending: false });
```

### 4. Usuario Lee Correo
```javascript
// Frontend llama al backend
await fetch(`https://api.al-eon.com/api/mail/messages/${id}/read`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

### 5. Usuario Genera Respuesta con AI
```javascript
const response = await fetch(`https://api.al-eon.com/api/mail/messages/${id}/ai-reply`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tone: 'professional',
    language: 'es'
  })
});

const { draft_text } = await response.json();
// Mostrar draft_text en editor para que usuario lo revise
```

### 6. Usuario Guarda Borrador
```javascript
await fetch(`https://api.al-eon.com/api/mail/messages/${id}/draft`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    draft_text: editedText,
    status: 'draft'
  })
});
```

---

## 🎨 UI/UX Recomendaciones

### Bandeja de Entrada
- Mostrar `snippet` (primeros 200 chars) en lista
- Icono de bandera según `flag` (urgent=rojo, important=amarillo)
- Badge de "nuevo" si `status='new'`
- Indicador de adjuntos si `has_attachments=true`

### Detalle de Mensaje
- Usar `body_html` para renderizar (sanitizar con DOMPurify)
- Si `body_html` es null y existe `s3_url`, descargar desde `presignedUrl`
- Mostrar adjuntos desde `attachments_json`

### Borradores
- Guardar automáticamente cada 30 segundos
- Indicador visual de "guardando..."
- Opción de "programar envío" → campo `scheduled_send_at`

---

## 🚨 Manejo de Errores

### Errores Comunes

```javascript
// 401 Unauthorized
{
  "success": false,
  "error": "UNAUTHORIZED",
  "message": "Token inválido o expirado"
}
→ Redirigir a login

// 404 Not Found
{
  "success": false,
  "error": "MESSAGE_NOT_FOUND",
  "message": "El mensaje no existe o no tienes acceso"
}
→ Mostrar error + volver a bandeja

// 429 Rate Limit (AI reply)
{
  "success": false,
  "error": "RATE_LIMIT_EXCEEDED",
  "message": "Máximo 10 generaciones por minuto"
}
→ Mostrar cooldown timer

// 500 Server Error
{
  "success": false,
  "error": "INTERNAL_ERROR",
  "message": "Error al procesar la solicitud"
}
→ Botón "Reintentar"
```

---

## 📊 Estado de Implementación Backend

### ✅ Completado (100%)
- ✅ Migración 018 (6 tablas completas)
- ✅ 9 endpoints REST funcionales
- ✅ Parser de .eml (mailparser)
- ✅ Integración S3 (descarga + presigned URLs)
- ✅ Resolución automática user_id
- ✅ Deduplicación por message_id
- ✅ Respuestas AI con Llama-3.3-70b
- ✅ Action Gateway (comandos de voz)
- ✅ Webhook interno (Lambda→Core)
- ✅ Seguridad JWT + RLS
- ✅ Desplegado en EC2 producción

### 🔄 Pendiente (Config AWS)
- ⏳ Lambda ale-mail-ingest (código listo)
- ⏳ S3 bucket aleon-mail-inbound
- ⏳ AWS SES Receipt Rules
- ⏳ SNS notification opcional

---

## 🧪 Testing en Desarrollo

### Datos de Prueba
Para testing, puedes insertar mensajes fake:

```sql
-- Ejecutar en Supabase SQL Editor
INSERT INTO mail_messages (
  user_id,
  source,
  message_id,
  from_email,
  from_name,
  to_email,
  subject,
  body_text,
  snippet,
  status,
  folder,
  received_at
) VALUES (
  'TU_USER_ID',
  'ses',
  '<test-' || gen_random_uuid() || '@al-eon.com>',
  'test@example.com',
  'Test Sender',
  'tu-email@al-eon.com',
  'Correo de Prueba',
  'Este es un correo de prueba para el desarrollo del frontend.',
  'Este es un correo de prueba...',
  'new',
  'inbox',
  NOW()
);
```

### Endpoint de Health Check
```javascript
GET https://api.al-eon.com/_health

Response:
{
  "status": "ok",
  "timestamp": "2026-01-03T12:00:00Z"
}
```

---

## 📞 Contacto y Soporte

**Backend Lead:** Core (Patricia Garibay)
**Repositorio Backend:** https://github.com/KVAdmi/AL-E-Core
**Servidor Producción:** api.al-eon.com (EC2)
**Base de Datos:** Supabase (proyecto compartido)

### Para Reportar Issues
1. Verificar que el endpoint funciona con curl
2. Verificar que el token JWT es válido
3. Revisar logs del navegador (Network tab)
4. Compartir request/response completos

---

**Última actualización:** 3 de enero de 2026
**Estado:** ✅ Sistema completo y desplegado en producción
