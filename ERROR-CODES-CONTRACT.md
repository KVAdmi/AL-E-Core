# ERROR CODES CONTRACT - AL-E CORE
**Fecha**: 21 de enero de 2026  
**Para**: Frontend (AL-EON)  
**Propósito**: Contract de error codes para mostrar fallos claros en UI

---

## ESTRUCTURA DE ERROR RESPONSE

Cuando un tool falla, el backend devuelve en el campo `metadata`:

```json
{
  "answer": "No pude enviar el correo...",
  "metadata": {
    "tool_failed": true,
    "tool_name": "send_email",
    "errorCode": "OAUTH_UNAUTHORIZED",
    "errorDetails": {
      "status": 401,
      "account": "user@example.com",
      "message": "Token inválido"
    }
  }
}
```

---

## ERROR CODES POR TOOL

### 📧 SEND_EMAIL

| errorCode | Significado | UI Message (Sugerido) | Acción Usuario |
|-----------|-------------|----------------------|----------------|
| `NO_ACCOUNT` | No tiene cuenta configurada | "No tienes cuentas de correo configuradas" | Ir a Configuración → Email Hub |
| `OAUTH_MISSING` | Tokens OAuth ausentes completamente | "Debes reconectar tu cuenta de Gmail" | Reconectar cuenta en Email Hub |
| `OAUTH_EXPIRED_NO_REFRESH` | Token expiró sin refresh token | "Tu sesión de Gmail expiró. Reconecta tu cuenta" | Reconectar cuenta en Email Hub |
| `OAUTH_UNAUTHORIZED` | Token inválido (401 del API) | "Tu cuenta de Gmail no está autorizada. Reconecta" | Reconectar cuenta en Email Hub |
| `API_ERROR` | Error genérico del API | "Error enviando correo: [mensaje]" | Reintentar o contactar soporte |
| `EXCEPTION` | Exception no manejada | "Error inesperado al enviar correo" | Contactar soporte |

**Ejemplo log backend**:
```
[SEND_EMAIL] ❌ 401 Unauthorized del API
[SEND_EMAIL] 🔐 OAuth Status:
  - Access Token: PRESENT
  - Refresh Token: MISSING
  - Token Expiry: 2026-01-20T10:00:00Z
  - Is Expired: YES
```

---

### 🎤 VOICE (STT/TTS)

| errorCode | Significado | UI Message (Sugerido) | Acción Usuario |
|-----------|-------------|----------------------|----------------|
| `AUDIO_001` | No se recibió archivo de audio | "No recibimos el audio. Intenta de nuevo" | Grabar nuevamente |
| `AUDIO_002` | Audio vacío (0 bytes) | "No detectamos audio. Verifica tu micrófono" | Revisar permisos micrófono |
| `AUDIO_003` | Tipo de archivo inválido | "El archivo debe ser de audio" | Verificar formato |
| `STT_TIMEOUT` | Transcripción tardó >20s | "La transcripción tomó mucho tiempo" | Reintentar con audio más corto |
| `STT_ERROR` | Error genérico STT | "Error al transcribir el audio" | Reintentar |
| `TTS_TIMEOUT` | Síntesis tardó >15s | "La síntesis de voz tomó mucho tiempo" | Reintentar |
| `TTS_ERROR` | Error genérico TTS | "Error al generar audio" | Reintentar |

**Ejemplo log backend**:
```
[VOICE] 📊 AUDIO RECIBIDO EN BACKEND:
  - Bytes: 0
  - MimeType: audio/webm
  - Duración estimada: 0 seg
[VOICE] ❌ Audio vacío (0 bytes)
```

---

### 📬 READ_EMAIL / LIST_EMAILS

| errorCode | Significado | UI Message (Sugerido) | Acción Usuario |
|-----------|-------------|----------------------|----------------|
| `NO_EMAIL_ACCOUNTS` | No tiene cuentas configuradas | "No tienes cuentas de correo. Configura una" | Ir a Email Hub |
| `EMAIL_NOT_FOUND` | Email con UUID no existe | "El correo no existe o fue eliminado" | Verificar lista |
| `FOLDER_NOT_FOUND` | Carpeta solicitada no existe | "La carpeta de correo no existe" | Verificar configuración |
| `IMAP_CONNECTION_ERROR` | No se pudo conectar a IMAP | "No pudimos conectar con tu correo" | Verificar configuración |

---

### 📅 CREATE_EVENT / LIST_EVENTS

| errorCode | Significado | UI Message (Sugerido) | Acción Usuario |
|-----------|-------------|----------------------|----------------|
| `NO_GOOGLE_ACCOUNT` | No tiene cuenta Google conectada | "Conecta tu cuenta de Google Calendar" | Ir a Configuración |
| `CALENDAR_NOT_FOUND` | Calendario no existe | "El calendario no existe" | Verificar permisos |
| `EVENT_CONFLICT` | Conflicto de horario | "Ya tienes un evento a esa hora" | Elegir otro horario |
| `INVALID_DATE` | Fecha inválida | "La fecha no es válida" | Corregir fecha |

---

### 🌐 WEB_SEARCH

| errorCode | Significado | UI Message (Sugerido) | Acción Usuario |
|-----------|-------------|----------------------|----------------|
| `SEARCH_TIMEOUT` | Búsqueda tardó >30s | "La búsqueda web tomó mucho tiempo" | Reintentar |
| `SEARCH_API_ERROR` | Error del proveedor de búsqueda | "Error al buscar en internet" | Reintentar |
| `NO_RESULTS` | No se encontraron resultados | "No encontré información sobre eso" | Reformular pregunta |

---

### 🤖 TELEGRAM

| errorCode | Significado | UI Message (Sugerido) | Acción Usuario |
|-----------|-------------|----------------------|----------------|
| `NO_TELEGRAM_BOT` | No tiene bot configurado | "Configura tu bot de Telegram primero" | Ir a Configuración |
| `NO_TELEGRAM_CHATS` | Bot sin conversaciones | "Envía /start a tu bot en Telegram" | Abrir Telegram |
| `TELEGRAM_SEND_ERROR` | Error enviando mensaje | "No pude enviar el mensaje a Telegram" | Reintentar |

---

## PAYLOAD RECIBIDO DEL FRONTEND

Cuando frontend llama a `/api/ai/chat/v2`, el backend logea:

```typescript
console.log('[CHAT] 📥 PAYLOAD RECIBIDO:');
console.log('  - sessionId:', sessionId || 'NO_SESSION');
console.log('  - userId:', userId);
console.log('  - message length:', message.length);
console.log('  - hasAttachments:', !!attachments);
console.log('  - timestamp:', new Date().toISOString());
```

**Estructura esperada**:
```json
{
  "message": "¿Qué dice mi último correo?",
  "sessionId": "uuid-de-sesion",
  "userId": "uuid-de-usuario",
  "workspaceId": "al-eon",
  "attachments": [] // opcional
}
```

---

## METADATA EN RESPONSE

Todas las respuestas incluyen `metadata` con información útil:

```json
{
  "answer": "Respuesta de AL-E...",
  "sessionId": "uuid-de-sesion",
  "metadata": {
    "provider": "AMAZON_NOVA_PRO",
    "model": "amazon.nova-pro-v1:0",
    "tools_used": ["read_email"],
    "context_loaded": true,
    "memory_loaded": true,
    "tool_failed": false
  }
}
```

Cuando hay error de tool:
```json
{
  "answer": "No pude enviar el correo por un error de autenticación",
  "metadata": {
    "tool_failed": true,
    "tool_name": "send_email",
    "errorCode": "OAUTH_UNAUTHORIZED",
    "errorDetails": {
      "status": 401,
      "account": "user@example.com"
    }
  }
}
```

---

## FRONTEND DEBE:

1. **Parsear `metadata.errorCode`** y mostrar mensaje claro en UI
2. **Mostrar loader** mientras tool se ejecuta: "Enviando correo...", "Buscando en internet...", etc
3. **Mostrar éxito** cuando tool funciona: "✓ Correo enviado"
4. **Desactivar features rotas** si errorCode es recurrente (ej: desactivar micrófono si AUDIO_002 se repite)
5. **Logear sessionId** que envía en cada request para debugging

---

## TESTING

Para validar que los error codes funcionan:

```bash
# Probar send_email sin OAuth
curl -X POST http://localhost:3000/api/ai/chat/v2 \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Envía un correo a test@example.com",
    "userId": "uuid-test",
    "sessionId": "uuid-session"
  }'
```

Respuesta esperada:
```json
{
  "answer": "No pude enviar el correo porque no tienes cuentas configuradas",
  "metadata": {
    "tool_failed": true,
    "tool_name": "send_email",
    "errorCode": "NO_ACCOUNT"
  }
}
```

---

**Actualizado**: 21 de enero de 2026, 20:30 hrs  
**Commitment**: Frontend DEBE mostrar estos errores claramente en UI
