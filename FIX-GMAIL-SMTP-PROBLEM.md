# 🚨 PROBLEMA CRÍTICO: Gmail rechaza correos enviados

## DIAGNÓSTICO

**Error en foto 3:**
```
<kodigovivo@gmail.com>: host gmail-smtp-in.l.google.com[74.125.142.26] said:
550-5.7.26 Your email has been blocked because the sender is unauthenticated.
550-5.7.26 Gmail requires all senders to authenticate with either SPF or DKIM.
550-5.7.26 DKIM = did not pass
550-5.7.26 SPF [vitacard365.com] with ip: [23.83.218.253] = did not pass
```

**Problema raíz:**
Estás intentando enviar correos desde `p.garibay@infinitykode.com` usando **Gmail SMTP**, pero Gmail REESCRIBE el remitente a `kodigovivo@gmail.com` porque NO puedes enviar con direcciones que no sean tuyas.

Luego, cuando llega al destinatario, el correo viene de `kodigovivo@gmail.com` pero sin autenticación SPF/DKIM correcta, y Gmail lo RECHAZA.

---

## SOLUCIÓN: Usar SMTP de Hostinger, NO Gmail

### PASO 1: Configurar cuenta SMTP de Hostinger

**En la base de datos (Supabase):**

Tabla: `email_accounts`
- `smtp_host`: `smtp.hostinger.com`
- `smtp_port`: `465` (SSL) o `587` (TLS)
- `smtp_secure`: `true` si 465, `false` si 587
- `smtp_user`: `p.garibay@infinitykode.com`
- `smtp_pass_enc`: [password cifrado]
- `from_email`: `p.garibay@infinitykode.com`
- `from_name`: `Patricia Garibay`

### PASO 2: Configurar SPF en DNS de infinitykode.com

**En Hostinger → DNS Zone Editor:**

```
Tipo: TXT
Nombre: @
Valor: v=spf1 include:_spf.hostinger.com ~all
TTL: 14400
```

Esto autoriza a los servidores de Hostinger para enviar correos desde `@infinitykode.com`.

### PASO 3: Habilitar DKIM en Hostinger

**En Hostinger → Email Accounts → infinitykode.com → DKIM:**

1. Click "Enable DKIM"
2. Copiar el registro TXT generado
3. Agregarlo en DNS Zone Editor:

```
Tipo: TXT
Nombre: default._domainkey
Valor: v=DKIM1; k=rsa; p=[CLAVE_PÚBLICA]
TTL: 14400
```

### PASO 4: Verificar configuración

**Test de DNS:**
```bash
# Verificar SPF
dig TXT infinitykode.com +short

# Verificar DKIM
dig TXT default._domainkey.infinitykode.com +short
```

**Test de envío:**
```bash
curl -X POST https://al-eon.com/api/mail/send \
  -H "Authorization: Bearer [TOKEN]" \
  -H "Content-Type: application/json" \
  -d '{
    "from": {"email": "p.garibay@infinitykode.com", "name": "Patricia Garibay"},
    "to": [{"email": "test@gmail.com"}],
    "subject": "Test SPF/DKIM",
    "bodyText": "Si recibes esto, SPF/DKIM funcionan correctamente"
  }'
```

---

## ¿POR QUÉ NO USAR GMAIL SMTP?

**Limitaciones de Gmail SMTP:**

1. **Solo puedes enviar como TU dirección de Gmail**
   - Si envías desde `p.garibay@infinitykode.com`, Gmail lo reescribe a `kodigovivo@gmail.com`
   - El destinatario ve `kodigovivo@gmail.com`, NO tu dominio profesional

2. **Límite de 500 correos/día**
   - Gmail limita envíos masivos

3. **Autenticación compleja**
   - Requiere "App Passwords" o OAuth2
   - 2FA obligatorio

4. **SPF/DKIM de Gmail, no tuyo**
   - Los correos pasan por servidores de Gmail
   - No tienes control sobre la reputación del dominio

**Usar Hostinger SMTP te da:**
- ✅ Envío con tu dominio profesional (`@infinitykode.com`)
- ✅ Control total sobre SPF/DKIM
- ✅ Sin límites de envío (según plan de Hostinger)
- ✅ Mejor deliverability (menos spam)

---

## PASOS INMEDIATOS

### Para Luis (cuenta de infinitykode.com):

1. **Entrar a Hostinger** → Email Accounts
2. **Crear/verificar** cuenta `p.garibay@infinitykode.com`
3. **Configurar SPF** (DNS TXT): `v=spf1 include:_spf.hostinger.com ~all`
4. **Habilitar DKIM** en panel de Hostinger
5. **Agregar registro DKIM** en DNS (copiar de Hostinger)
6. **Esperar 1-4 horas** para propagación DNS
7. **Actualizar cuenta en AL-E** con SMTP de Hostinger

### Para AL-E Core:

```bash
# Actualizar cuenta SMTP en Supabase
UPDATE email_accounts
SET 
  smtp_host = 'smtp.hostinger.com',
  smtp_port = 465,
  smtp_secure = true,
  smtp_user = 'p.garibay@infinitykode.com',
  smtp_pass_enc = [CIFRAR_PASSWORD_HOSTINGER],
  from_email = 'p.garibay@infinitykode.com'
WHERE from_email = 'p.garibay@infinitykode.com';
```

---

## VERIFICACIÓN FINAL

Una vez configurado todo:

1. **Enviar correo de prueba** a Gmail
2. **Verificar headers** del correo recibido:
   - `SPF: PASS`
   - `DKIM: PASS`
   - `From: p.garibay@infinitykode.com` (NO kodigovivo@gmail.com)

3. **Si sigue fallando:**
   - Verificar DNS con: `dig TXT infinitykode.com`
   - Verificar DKIM con: `dig TXT default._domainkey.infinitykode.com`
   - Esperar más tiempo para propagación DNS (hasta 24-48h)

---

## DOCUMENTACIÓN

- [Hostinger SMTP Settings](https://support.hostinger.com/en/articles/1583291-how-to-set-up-an-email-account-in-an-email-client)
- [SPF Record Checker](https://mxtoolbox.com/spf.aspx)
- [DKIM Record Checker](https://mxtoolbox.com/dkim.aspx)
- [Gmail Sender Guidelines](https://support.google.com/mail/answer/81126)
