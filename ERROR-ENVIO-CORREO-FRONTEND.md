# 🔴 ERROR: No se puede enviar correo

## 📊 Errores Detectados (de la consola)

### 1. Error IMAP - Test de conexión
```
Unexpected token '<', "<!DOCTYPE "... is not valid JSON
```
**Causa:** El frontend está llamando a un endpoint que devuelve HTML en vez de JSON.

**Endpoint incorrecto llamado:**
```
GET https://api.al-eon.com/api/mail/test-imap
```

---

### 2. Error 401 - Sin autorización
```
"UNAUTHORIZED","message":"No se proporcionó token de autorización"
```
**Causa:** El frontend NO está enviando el token JWT en el header `Authorization`.

---

### 3. Error 406 - Envío rechazado
```
POST https://api.al-eon.com/api/mail/send
Status: 406 (Not Acceptable)
```
**Causa:** El endpoint está rechazando la petición por formato incorrecto o falta de token.

---

## ✅ SOLUCIÓN PARA FRONTEND

### 1. Endpoint CORRECTO para enviar correos

```typescript
// ✅ CORRECTO
POST https://api.al-eon.com/api/email/send

// ❌ INCORRECTO (el que están usando)
POST https://api.al-eon.com/api/mail/send
```

---

### 2. Headers requeridos

```javascript
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${supabase.auth.session()?.access_token}` // ⚠️ CRÍTICO
}
```

---

### 3. Body del request

```json
{
  "account_id": "uuid-de-la-cuenta",
  "to": ["destinatario@email.com"],
  "subject": "Asunto del correo",
  "body_text": "Texto plano del correo",
  "body_html": "<p>HTML del correo (opcional)</p>",
  "cc": ["copia@email.com"],           // Opcional
  "bcc": ["copia-oculta@email.com"],   // Opcional
  "reply_to": "responder@email.com",   // Opcional
  "in_reply_to": "message-id-original" // Opcional (para hilos)
}
```

---

### 4. Ejemplo completo en JavaScript

```javascript
async function enviarCorreo(accountId, destinatario, asunto, texto) {
  try {
    // 1. Obtener token de Supabase
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      throw new Error('No hay sesión activa')
    }
    
    // 2. Hacer POST al endpoint correcto
    const response = await fetch('https://api.al-eon.com/api/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}` // ⚠️ IMPORTANTE
      },
      body: JSON.stringify({
        account_id: accountId,
        to: [destinatario],
        subject: asunto,
        body_text: texto,
        body_html: `<p>${texto}</p>`
      })
    })
    
    // 3. Verificar respuesta
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Error al enviar correo')
    }
    
    const result = await response.json()
    console.log('✅ Correo enviado:', result)
    return result
    
  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}
```

---

### 5. Validar que tienes el token

Antes de enviar correos, verifica en consola:

```javascript
// Obtener sesión actual
const { data: { session } } = await supabase.auth.getSession()

// Verificar token
console.log('Token existe:', !!session?.access_token)
console.log('Usuario:', session?.user?.email)

// Si no hay token, hacer login primero
if (!session) {
  console.error('❌ Debes iniciar sesión primero')
}
```

---

## 📋 Checklist para Frontend

```
[ ] Cambiar endpoint de /api/mail/send a /api/email/send
[ ] Agregar header Authorization con Bearer token
[ ] Verificar que el usuario esté autenticado (session existe)
[ ] Enviar account_id correcto (UUID de la cuenta)
[ ] Enviar to como array: ["email@example.com"]
[ ] Enviar subject y body_text mínimos
[ ] Manejar errores 401 (sin auth) y 404 (cuenta no existe)
```

---

## 🔍 Debugging

Si sigue fallando, ejecutar en consola:

```javascript
// 1. Verificar sesión
const { data: { session } } = await supabase.auth.getSession()
console.log('Session:', session)

// 2. Probar envío con curl (desde terminal)
curl -X POST https://api.al-eon.com/api/email/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TU_TOKEN_AQUI" \
  -d '{
    "account_id": "UUID_CUENTA",
    "to": ["destino@email.com"],
    "subject": "Test",
    "body_text": "Hola mundo"
  }'

// 3. Ver respuesta completa
fetch('https://api.al-eon.com/api/email/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + session.access_token
  },
  body: JSON.stringify({
    account_id: 'uuid-aqui',
    to: ['test@test.com'],
    subject: 'Test',
    body_text: 'Test'
  })
})
.then(r => r.json())
.then(console.log)
.catch(console.error)
```

---

## 🎯 Resumen

**Problemas principales:**
1. ❌ Endpoint incorrecto: `/api/mail/send` → ✅ `/api/email/send`
2. ❌ Falta Authorization header con Bearer token
3. ❌ No hay sesión activa / usuario no autenticado

**Solución rápida:**
- Usar `/api/email/send`
- Agregar `Authorization: Bearer ${token}`
- Verificar que `session.access_token` existe antes de enviar

---

## 🔐 Backend está funcionando correctamente

✅ Endpoint `/api/email/send` está activo  
✅ Requiere autenticación (requireAuth middleware)  
✅ Descifra contraseñas correctamente (fix ya aplicado)  
✅ Envía correos via SMTP  

**El problema es 100% frontend: falta token de autorización.**
