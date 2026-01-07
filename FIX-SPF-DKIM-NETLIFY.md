# GUÍA: Configurar SPF/DKIM en Netlify para infinitykode.com

## CONTEXTO

- **Dominio:** infinitykode.com
- **DNS:** Netlify (NSOne servers: dns1-4.p07.nsone.net)
- **Email hosting:** Hostinger (MX: mx1/mx2.hostinger.com)
- **Web hosting:** Netlify
- **Problema:** Gmail rechaza correos por falta SPF/DKIM

**DIAGNÓSTICO:**
```bash
$ dig NS infinitykode.com +short
dns1.p07.nsone.net
dns2.p07.nsone.net
dns3.p07.nsone.net
dns4.p07.nsone.net
```
✅ Nameservers apuntan a Netlify → DNS se configura en Netlify

---

## PASO 1: Obtener clave DKIM de Hostinger

### 1.1 Entrar a Hostinger Email Settings

1. Ir a: https://hpanel.hostinger.com
2. Email Accounts → Select domain: **infinitykode.com**
3. Click en **"Email Authentication"** o **"DKIM Settings"**
4. Enable DKIM
5. **Copiar el registro TXT generado**

Ejemplo de clave DKIM (será diferente para ti):
```
v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC5N3l...
```

---

## PASO 2: Configurar registros DNS en Netlify

### 2.1 Acceder a Netlify DNS

1. Ir a: https://app.netlify.com
2. Seleccionar tu site (infinitykode.com)
3. **Site settings** → **Domain management**
4. Scroll down a **DNS records**
5. Click **"Add new record"**

---

### 2.2 Agregar registro SPF

```
Type: TXT
Name: @ (o dejar vacío para root domain)
Value: v=spf1 include:_spf.hostinger.com ~all
TTL: 3600
```

Click **"Save"**

---

### 2.3 Agregar registro DKIM

```
Type: TXT
Name: default._domainkey
Value: [PEGAR LA CLAVE QUE COPIASTE DE HOSTINGER]
TTL: 3600
```

Ejemplo completo:
```
Name: default._domainkey
Value: v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC5N3l...
```

**IMPORTANTE:** 
- Si Hostinger usa otro selector (mail, dkim, k1), usar ese
- El valor debe incluir `v=DKIM1; k=rsa; p=` completo

Click **"Save"**

---

### 2.4 Agregar registro DMARC (opcional pero recomendado)

```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=none; rua=mailto:p.garibay@infinitykode.com
TTL: 3600
```

Click **"Save"**

---

## PASO 3: Verificar registros MX (ya deberían estar)

En Netlify DNS, verificar que existan estos registros MX:

```
Type: MX
Name: @ (o infinitykode.com)
Priority: 5
Value: mx1.hostinger.com
TTL: 3600

Type: MX
Name: @ (o infinitykode.com)
Priority: 10
Value: mx2.hostinger.com
TTL: 3600
```

Si NO existen, agregarlos.

---

## PASO 4: Esperar propagación

**Tiempo de propagación:**
- TTL configurado: 3600 segundos (1 hora)
- Propagación global: 2-4 horas
- Gmail cache: puede tardar 1 hora adicional

**Verificar propagación:**
```bash
# Verificar SPF
dig TXT infinitykode.com +short | grep spf

# Verificar DKIM
dig TXT default._domainkey.infinitykode.com +short | grep DKIM

# Verificar DMARC
dig TXT _dmarc.infinitykode.com +short | grep DMARC
```

---

## PASO 5: Testing

### 5.1 Ejecutar script de diagnóstico

```bash
./check-dns-authentication.sh
```

Resultado esperado:
```
✅ SPF configurado
✅ DKIM configurado
✅ DMARC configurado
✅ ESTADO: Configuración completa
```

---

### 5.2 Test de envío real

Enviar correo de prueba desde AL-E:

```bash
curl -X POST http://100.27.201.233:3000/api/mail/send \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "7a285444-6799-4187-8037-52826cf5c29f",
    "to": ["kodigovivo@gmail.com"],
    "subject": "Test SPF/DKIM - infinitykode.com",
    "body": "Este correo debe llegar sin error 550-5.7.26",
    "userId": "[USER_ID]"
  }'
```

**Gmail debe aceptar sin errores ✅**

---

### 5.3 Verificar headers en Gmail

1. Abrir el correo recibido en Gmail
2. Click en **"⋮"** (menú) → **"Show original"**
3. Buscar sección **"Authentication-Results"**

Debe mostrar:
```
Authentication-Results: mx.google.com;
       dkim=pass header.i=@infinitykode.com header.s=default
       spf=pass (google.com: domain of p.garibay@infinitykode.com designates [IP] as permitted sender)
       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=infinitykode.com
```

✅ **dkim=pass** y **spf=pass** = Correo autenticado correctamente

---

## TROUBLESHOOTING

### ❌ SPF no se encuentra después de 4 horas

**Causa:** Netlify puede requerir formato específico

**Solución:** Verificar en Netlify DNS que el registro esté como:
```
Type: TXT
Name: @ (NO "infinitykode.com", solo @)
Value: "v=spf1 include:_spf.hostinger.com ~all" (con comillas)
```

---

### ❌ DKIM no se encuentra

**Causa:** Selector incorrecto

**Solución:** Verificar en Hostinger qué selector usa:
- Puede ser: `default._domainkey`
- O: `mail._domainkey`
- O: `dkim._domainkey`

Usar el mismo selector en Netlify DNS.

---

### ❌ Gmail sigue rechazando después de configurar

**Causa:** Cache de Gmail

**Solución:** Esperar 2-4 horas más, o:
1. Enviar desde otra IP (reiniciar conexión SMTP)
2. Limpiar cache: Cambiar TTL a 300, esperar 5 min, volver a enviar
3. Verificar logs de Hostinger SMTP

---

## RESUMEN VISUAL

```
┌─────────────────────────────────────────────────┐
│  ARQUITECTURA ACTUAL                            │
├─────────────────────────────────────────────────┤
│                                                 │
│  infinitykode.com (dominio)                     │
│           │                                     │
│           ├─ DNS: Netlify (NSOne)               │
│           │   ├─ SPF TXT record ✅              │
│           │   ├─ DKIM TXT record ✅             │
│           │   ├─ DMARC TXT record ✅            │
│           │   └─ MX → Hostinger ✅              │
│           │                                     │
│           ├─ Web: Netlify (hosting)             │
│           │   └─ Site pages                     │
│           │                                     │
│           └─ Email: Hostinger (email server)    │
│               ├─ SMTP (envío)                   │
│               ├─ IMAP (recepción)               │
│               └─ DKIM key generation            │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Flujo de configuración:**
1. Hostinger genera clave DKIM privada (servidor)
2. Hostinger te da clave DKIM pública (para DNS)
3. Agregas clave pública en Netlify DNS
4. Gmail verifica firma DKIM con clave pública
5. ✅ Correo autenticado

---

## CHECKLIST FINAL

- [ ] 1. Habilitar DKIM en Hostinger Email Settings
- [ ] 2. Copiar clave DKIM generada
- [ ] 3. Entrar a Netlify DNS (site settings → domain management)
- [ ] 4. Agregar SPF TXT record
- [ ] 5. Agregar DKIM TXT record con clave de Hostinger
- [ ] 6. Agregar DMARC TXT record
- [ ] 7. Esperar 2-4 horas (propagación)
- [ ] 8. Ejecutar ./check-dns-authentication.sh
- [ ] 9. Test envío real a Gmail
- [ ] 10. Verificar headers "Authentication-Results"

---

## NEXT STEPS

**Si SPF/DKIM configurados correctamente:**
- ✅ Gmail aceptará correos desde infinitykode.com
- ✅ Outlook/Yahoo también aceptarán
- ✅ Emails llegarán a inbox (no spam)
- ✅ Mejor deliverability score

**Monitoreo continuo:**
- Revisar reportes DMARC semanalmente
- Después de 2 semanas, cambiar DMARC de `p=none` a `p=quarantine`
- Mantener registros DNS actualizados

---

**ETA:** 2-4 horas post-configuración  
**WORKAROUND:** Usar Gmail SMTP mientras propaga (funciona HOY)  
**SOPORTE:** Ver FIX-SPF-DKIM-INFINITYKODE.md para troubleshooting detallado
