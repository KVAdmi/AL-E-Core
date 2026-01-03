# 📧 CONFIGURACIÓN PROVEEDORES - EMAIL HUB UNIVERSAL

## Ejemplos de configuración SMTP/IMAP para diferentes proveedores

---

## 🟢 Gmail

**Requisito:** Habilitar "App Password" en https://myaccount.google.com/apppasswords

```json
{
  "provider_label": "Gmail",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@gmail.com",
  
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@gmail.com",
  "smtp_pass": "xxxx xxxx xxxx xxxx",
  
  "imap_host": "imap.gmail.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@gmail.com",
  "imap_pass": "xxxx xxxx xxxx xxxx"
}
```

**Notas:**
- Usar "App Password", NO la contraseña normal
- SMTP: Puerto 587 con STARTTLS
- IMAP: Puerto 993 con SSL/TLS

---

## 🔵 Outlook / Office 365

```json
{
  "provider_label": "Outlook",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@outlook.com",
  
  "smtp_host": "smtp-mail.outlook.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@outlook.com",
  "smtp_pass": "tu-password",
  
  "imap_host": "outlook.office365.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@outlook.com",
  "imap_pass": "tu-password"
}
```

**Notas:**
- Para cuentas empresariales Office 365: mismo config
- Si tienes 2FA, necesitas "App Password"

---

## 🟣 Yahoo Mail

```json
{
  "provider_label": "Yahoo",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@yahoo.com",
  
  "smtp_host": "smtp.mail.yahoo.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@yahoo.com",
  "smtp_pass": "app-password",
  
  "imap_host": "imap.mail.yahoo.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@yahoo.com",
  "imap_pass": "app-password"
}
```

**Notas:**
- Requiere "App Password" generado en configuración de Yahoo
- Ir a: https://login.yahoo.com/account/security

---

## 🟠 Hostinger

```json
{
  "provider_label": "Hostinger",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@tudominio.com",
  
  "smtp_host": "smtp.hostinger.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@tudominio.com",
  "smtp_pass": "tu-password",
  
  "imap_host": "imap.hostinger.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@tudominio.com",
  "imap_pass": "tu-password"
}
```

**Notas:**
- Usar el email completo como usuario
- Password del email (creado en panel de Hostinger)

---

## 🔴 Zoho Mail

```json
{
  "provider_label": "Zoho",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@zoho.com",
  
  "smtp_host": "smtp.zoho.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@zoho.com",
  "smtp_pass": "tu-password",
  
  "imap_host": "imap.zoho.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@zoho.com",
  "imap_pass": "tu-password"
}
```

---

## 🟡 GoDaddy / cPanel (Email Empresarial)

```json
{
  "provider_label": "GoDaddy Email",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@tudominio.com",
  
  "smtp_host": "smtpout.secureserver.net",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@tudominio.com",
  "smtp_pass": "tu-password",
  
  "imap_host": "imap.secureserver.net",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@tudominio.com",
  "imap_pass": "tu-password"
}
```

---

## 🔵 iCloud Mail

```json
{
  "provider_label": "iCloud",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@icloud.com",
  
  "smtp_host": "smtp.mail.me.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@icloud.com",
  "smtp_pass": "app-specific-password",
  
  "imap_host": "imap.mail.me.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@icloud.com",
  "imap_pass": "app-specific-password"
}
```

**Notas:**
- Requiere "App-Specific Password" desde Apple ID settings
- Ir a: https://appleid.apple.com → Security

---

## 🌐 Proveedores Genéricos (cPanel)

Si tienes hosting con cPanel, usa esta configuración genérica:

```json
{
  "provider_label": "Mi Email",
  "from_name": "Tu Nombre",
  "from_email": "tu-email@tudominio.com",
  
  "smtp_host": "mail.tudominio.com",
  "smtp_port": 587,
  "smtp_secure": false,
  "smtp_user": "tu-email@tudominio.com",
  "smtp_pass": "tu-password",
  
  "imap_host": "mail.tudominio.com",
  "imap_port": 993,
  "imap_secure": true,
  "imap_user": "tu-email@tudominio.com",
  "imap_pass": "tu-password"
}
```

**Variantes comunes:**
- `mail.tudominio.com`
- `smtp.tudominio.com` / `imap.tudominio.com`
- `servidor123.hostingprovider.com`

---

## 📋 Puertos Estándar

### SMTP
- **587** - STARTTLS (recomendado) → `smtp_secure: false`
- **465** - SSL/TLS → `smtp_secure: true`
- **25** - Sin cifrado (no recomendado)

### IMAP
- **993** - SSL/TLS (recomendado) → `imap_secure: true`
- **143** - STARTTLS → `imap_secure: false`

---

## ⚠️ Troubleshooting

### Error: SMTP_AUTH_FAILED
- ✅ Verifica usuario/password
- ✅ Si tienes 2FA, usa "App Password"
- ✅ Verifica que SMTP esté habilitado en tu proveedor

### Error: IMAP_CONNECT_TIMEOUT
- ✅ Verifica host/puerto IMAP
- ✅ Verifica que IMAP esté habilitado
- ✅ Algunos proveedores requieren activar IMAP manualmente

### Error: IMAP_AUTH_FAILED
- ✅ Mismo password que SMTP (generalmente)
- ✅ Si tienes 2FA, usa "App Password"

### Gmail específico
- ✅ Habilitar "Less secure app access" (si no usas App Password)
- ✅ O mejor: Usar "App Password" (más seguro)

---

## 🔐 Seguridad

✅ **Recomendaciones:**
1. Usar "App Passwords" cuando esté disponible (Gmail, Yahoo, iCloud)
2. Preferir puerto 587 para SMTP (STARTTLS)
3. Preferir puerto 993 para IMAP (SSL/TLS)
4. Verificar que `smtp_secure` y `imap_secure` sean correctos
5. Nunca compartir passwords en logs o frontend

---

## 🧪 Test de Configuración

Después de crear la cuenta, verifica con:

```bash
curl -X POST https://api.al-eon.com/api/email/accounts/{id}/test \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"test_type": "both"}'
```

Respuesta esperada:
```json
{
  "success": true,
  "results": {
    "smtp": { "success": true },
    "imap": { "success": true }
  }
}
```

---

**Última actualización:** 3 de enero de 2026
