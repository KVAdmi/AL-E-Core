# EVIDENCIA: send_email usa SMTP (nodemailer), NO Gmail API

**Fecha**: 21 de enero de 2026, 20:37 hrs  
**Investigación ejecutada por**: GitHub Copilot  
**Deployment**: EC2 100.27.201.233:3000, PM2 restart #10

---

## ❌ PROBLEMA ORIGINAL

Usuario reportó error 401 en `send_email`.  
Agente asumió incorrectamente que era problema de OAuth (Gmail API).

**ASUNCIÓN INCORRECTA**:
- "OAuth tokens expirados"
- "Requiere Google Cloud Console"
- "No es problema de backend"

---

## ✅ INVESTIGACIÓN REAL

### 1. ARQUITECTURA CONFIRMADA

**Archivo**: `src/api/mail.ts` línea 19
```typescript
import nodemailer from 'nodemailer';
```

**Líneas 99-107** (Método de envío):
```typescript
const transporter = nodemailer.createTransport({
  host: account.smtp_host,    // smtp.gmail.com
  port: account.smtp_port,    // 587 / 465
  secure: account.smtp_secure,
  auth: {
    user: account.smtp_user,  // email@gmail.com
    pass: smtpPass            // ⚠️ PASSWORD SMTP, NO OAUTH TOKEN
  }
});
```

**CONCLUSIÓN**: 
- ✅ `send_email` usa **SMTP directo con nodemailer**
- ❌ NO usa Gmail API (`googleapis`)
- ❌ NO usa `oauth_access_token` para envío

---

### 2. OAUTH TOKENS: SOLO PARA IMAP (LECTURA)

Los campos `oauth_access_token` y `oauth_refresh_token` en `email_accounts`:
- ✅ Se usan para **IMAP sync** (leer correos)
- ❌ NO se usan para **envío SMTP**

**Envío usa**:
- `smtp_host` (ej: smtp.gmail.com)
- `smtp_port` (ej: 587)
- `smtp_user` (ej: user@gmail.com)
- `smtp_pass_enc` (password encriptado)

---

### 3. CAUSA REAL DEL 401

**Si `smtp_host = smtp.gmail.com`**:

❌ **Password normal de Gmail** → Bloqueado por Google desde 2022  
✅ **App Password** (16 chars) → Único método válido

**Proceso para generar App Password**:
1. Activar 2FA en cuenta Google
2. Ir a: https://myaccount.google.com/apppasswords
3. Generar password de 16 caracteres (ej: `abcd efgh ijkl mnop`)
4. Guardar en `email_accounts.smtp_pass_enc` (encriptado)

**Si no es Gmail**:
- Verificar usuario/password SMTP del proveedor
- Verificar host/port correctos

---

## 🔧 CORRECCIONES IMPLEMENTADAS

### emailTools.ts - Diagnóstico correcto

**ANTES** (líneas 376-386):
```typescript
// 🚨 DIAGNÓSTICO OAUTH
if (account.provider === 'gmail') {
  const hasAccessToken = !!account.oauth_access_token;
  const hasRefreshToken = !!account.oauth_refresh_token;
  // ...logs de OAuth...
}
```

**AHORA** (líneas 374-409):
```typescript
// 🚨 DIAGNÓSTICO SMTP (MÉTODO REAL DE ENVÍO)
console.log('[SEND_EMAIL] 🔐 SMTP Configuration:');
console.log('  - Host:', account.smtp_host || 'NOT_SET');
console.log('  - Port:', account.smtp_port || 'NOT_SET');
console.log('  - User:', account.smtp_user || 'NOT_SET');
console.log('  - Password:', account.smtp_pass_enc ? 'ENCRYPTED_PRESENT' : 'MISSING');

// NOTA: OAuth tokens NO SE USAN para SMTP. Solo para IMAP sync.
// El envío usa nodemailer con smtp_host, smtp_port, smtp_user, smtp_pass_enc.

if (!account.smtp_host || !account.smtp_port || !account.smtp_pass_enc) {
  return {
    success: false,
    error: 'SMTP_CREDENTIALS_INCOMPLETE',
    errorCode: 'SMTP_INCOMPLETE',
    errorDetails: { ... }
  };
}

// Si es Gmail, advertir sobre App Password
if (account.smtp_host?.includes('gmail.com')) {
  console.log('[SEND_EMAIL] ⚠️ Gmail detectado - debe usar App Password (16 chars)');
  console.log('[SEND_EMAIL] ℹ️ Password normal de Gmail NO funciona desde 2022');
  console.log('[SEND_EMAIL] ℹ️ Generar en: https://myaccount.google.com/apppasswords');
}
```

### Error 401 - Mensaje correcto

**ANTES**:
```typescript
error: 'OAUTH_UNAUTHORIZED: El token de Gmail no es válido'
```

**AHORA**:
```typescript
let errorMessage = 'SMTP_AUTH_FAILED: Las credenciales SMTP son inválidas.';

if (account.smtp_host?.includes('gmail.com')) {
  errorMessage += '\n\n⚠️ Gmail requiere App Password (NO password normal).\nGenera uno en: https://myaccount.google.com/apppasswords';
} else {
  errorMessage += '\n\nVerifica usuario y password SMTP en Configuración → Email Hub.';
}

return {
  success: false,
  error: errorMessage,
  errorCode: 'SMTP_AUTH_FAILED',
  errorDetails: {
    status: 401,
    smtp_host: account.smtp_host,
    smtp_user: account.smtp_user,
    // ...
  }
};
```

---

## 📋 VALIDACIÓN REQUERIDA

Para confirmar que el problema es credenciales SMTP:

### 1. Revisar tabla `email_accounts`

```sql
SELECT 
  from_email,
  smtp_host,
  smtp_port,
  smtp_user,
  LENGTH(smtp_pass_enc) as pass_length_encrypted,
  provider,
  status
FROM email_accounts
WHERE owner_user_id = 'USER_ID';
```

**Verificar**:
- `smtp_host` correcto (ej: smtp.gmail.com)
- `smtp_port` correcto (587 para TLS, 465 para SSL)
- `smtp_user` correcto
- `smtp_pass_enc` NO NULL (debe estar encriptado)

### 2. Si es Gmail

**Verificar que el password almacenado es App Password**:
- Debe ser 16 caracteres (después de desencriptar)
- Formato: `abcd efgh ijkl mnop` (con espacios o sin ellos)
- NO es el password normal de la cuenta

**Si NO es App Password**:
1. Usuario activa 2FA en Google
2. Genera App Password en https://myaccount.google.com/apppasswords
3. Actualiza en Email Hub de AL-E
4. Backend encripta y guarda en `smtp_pass_enc`

### 3. Logs actualizados

**Próxima vez que falle**, los logs mostrarán:
```
[SEND_EMAIL] 📤 Iniciando envío de correo
[SEND_EMAIL] ✅ Cuenta encontrada: user@gmail.com
[SEND_EMAIL] 🔧 Provider: gmail
[SEND_EMAIL] 🔐 SMTP Configuration:
  - Host: smtp.gmail.com
  - Port: 587
  - User: user@gmail.com
  - Password: ENCRYPTED_PRESENT
[SEND_EMAIL] ⚠️ Gmail detectado - debe usar App Password (16 chars)
[SEND_EMAIL] ℹ️ Password normal de Gmail NO funciona desde 2022
[SEND_EMAIL] ℹ️ Generar en: https://myaccount.google.com/apppasswords
[SEND_EMAIL] 📡 Llamando a /api/mail/send...
[SEND_EMAIL] ❌ 401 Unauthorized del API /api/mail/send
[SEND_EMAIL] Response data: { error: '...', message: '...' }
```

---

## 🎯 ACCIÓN INMEDIATA

1. **Infraestructura** debe verificar `email_accounts`:
   - ¿Qué hay en `smtp_host`, `smtp_port`, `smtp_user`?
   - ¿`smtp_pass_enc` tiene valor?
   - Si es Gmail, ¿es App Password o password normal?

2. **Si es Gmail sin App Password**:
   - Usuario regenera App Password
   - Actualiza en Email Hub
   - Backend lo encripta automáticamente

3. **Si no es Gmail**:
   - Verificar credenciales SMTP del proveedor
   - Probar conexión manual con nodemailer
   - Verificar firewall/puerto

---

## 📊 DEPLOYMENT

- ✅ Compilado sin errores
- ✅ Commit: 2ebcd92
- ✅ Pushed a GitHub
- ✅ Desplegado a EC2
- ✅ PM2 restart #10, PID 3825694, Online
- ✅ Logs activos mostrando diagnóstico correcto

---

## 🔥 LECCIÓN APRENDIDA

**NUNCA asumir OAuth cuando el código usa SMTP**

**SIEMPRE verificar**:
1. ¿Qué biblioteca usa? (`nodemailer` vs `googleapis`)
2. ¿Qué método de auth? (`smtp_user + smtp_pass` vs `oauth_access_token`)
3. ¿Qué dice el error REAL del provider?

**OAuth tokens != SMTP credentials**

---

**Evidencia generada por**: GitHub Copilot  
**Timestamp**: 2026-01-21T20:40:00Z  
**Estado**: ✅ DIAGNÓSTICO CORRECTO IMPLEMENTADO  
**Próximo paso**: Infraestructura valida credenciales SMTP en DB
