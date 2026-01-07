# FIX CRÍTICO: SPF/DKIM para infinitykode.com

## PROBLEMA IDENTIFICADO

Gmail **rechaza TODOS los correos** enviados desde `p.garibay@infinitykode.com` con error:

```
550-5.7.26 Your email has been blocked because the sender is
unauthenticated. 550-5.7.26 Gmail requires all senders to authenticate with
either SPF or DKIM. 550-5.7.26
Authentication results:
550-5.7.26 DKIM = did not pass
550-5.7.26 SPF [infinitykode.com] with ip: [23.83.212.16] = did not pass
```

**Origen del problema:**
- Dominio `infinitykode.com` NO tiene registros SPF configurados
- Dominio `infinitykode.com` NO tiene claves DKIM configuradas
- Gmail bloquea automáticamente correos sin autenticación (política anti-spam)

**Impacto:**
- ❌ NO se pueden enviar correos a Gmail desde infinitykode.com
- ❌ NO se pueden enviar correos a Outlook (misma política)
- ❌ Yahoo, Protonmail y otros también bloquean
- ✅ Solo funciona envío entre cuentas del mismo servidor (Hostinger → Hostinger)

---

## SOLUCIÓN: Configurar SPF + DKIM en Hostinger

### PASO 1: Configurar SPF (Sender Policy Framework)

**¿Qué es SPF?**
- Lista de servidores autorizados para enviar correos desde tu dominio
- Se configura como registro TXT en DNS

**Acción requerida:**

1. Entrar a **Hostinger Panel** → Dominios → `infinitykode.com` → DNS Zone Editor
2. Agregar registro TXT:

```
Tipo: TXT
Nombre: @ (o infinitykode.com)
Valor: v=spf1 include:_spf.hostinger.com ~all
TTL: 14400 (4 horas)
```

**Explicación del valor:**
- `v=spf1` → Versión del protocolo SPF
- `include:_spf.hostinger.com` → Autoriza servidores de Hostinger
- `~all` → Soft fail (marca como sospechoso pero no rechaza)

**Verificación:**
```bash
dig TXT infinitykode.com +short
# Debe mostrar: "v=spf1 include:_spf.hostinger.com ~all"
```

---

### PASO 2: Configurar DKIM (DomainKeys Identified Mail)

**¿Qué es DKIM?**
- Firma criptográfica que prueba que el correo NO fue alterado
- Se configura como registro TXT con clave pública

**Acción requerida:**

1. **Generar clave DKIM en Hostinger:**
   - Panel → Email → Email Accounts → Domain → DKIM Settings
   - Click "Enable DKIM"
   - Copiar registro TXT generado

2. **Agregar registro DNS:**

```
Tipo: TXT
Nombre: default._domainkey (o mail._domainkey)
Valor: v=DKIM1; k=rsa; p=[CLAVE_PÚBLICA_GENERADA_POR_HOSTINGER]
TTL: 14400
```

**Verificación:**
```bash
dig TXT default._domainkey.infinitykode.com +short
# Debe mostrar la clave DKIM
```

---

### PASO 3: Configurar DMARC (opcional pero recomendado)

**¿Qué es DMARC?**
- Política que indica qué hacer si SPF o DKIM fallan
- Recibe reportes de intentos de spoofing

**Acción requerida:**

```
Tipo: TXT
Nombre: _dmarc
Valor: v=DMARC1; p=none; rua=mailto:dmarc@infinitykode.com
TTL: 14400
```

**Explicación:**
- `p=none` → No rechaza correos (solo monitorea)
- `rua=mailto:dmarc@infinitykode.com` → Envía reportes a este correo

**Después de 1-2 semanas de monitoreo, cambiar a:**
```
v=DMARC1; p=quarantine; rua=mailto:dmarc@infinitykode.com
```

---

## PROPAGACIÓN DNS

**Tiempo de espera:**
- TTL mínimo: 4 horas
- Propagación mundial completa: 24-48 horas
- Verificación inmediata: Usar DNS de Google (8.8.8.8)

**Verificar propagación:**
```bash
dig @8.8.8.8 TXT infinitykode.com +short
dig @8.8.8.8 TXT default._domainkey.infinitykode.com +short
```

---

## TESTING POST-CONFIGURACIÓN

### 1. Test SPF Online
- Ir a: https://mxtoolbox.com/spf.aspx
- Ingresar: `infinitykode.com`
- Resultado esperado: ✅ SPF record found

### 2. Test DKIM Online
- Ir a: https://mxtoolbox.com/dkim.aspx
- Ingresar: `default:infinitykode.com`
- Resultado esperado: ✅ DKIM record found

### 3. Test Envío Real
```bash
# Enviar correo de prueba desde p.garibay@infinitykode.com a kodigovivo@gmail.com
# Gmail debe aceptar el correo SIN errores 550-5.7.26
```

### 4. Verificar Headers del Correo Recibido
En Gmail, abrir el correo → Show Original → Buscar:

```
Authentication-Results: mx.google.com;
       dkim=pass header.i=@infinitykode.com
       spf=pass (google.com: domain of p.garibay@infinitykode.com designates 23.83.212.16 as permitted sender)
```

---

## REGISTROS DNS COMPLETOS (RESUMEN)

```dns
# SPF
TXT @ "v=spf1 include:_spf.hostinger.com ~all"

# DKIM (ejemplo, verificar con Hostinger)
TXT default._domainkey "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4..."

# DMARC
TXT _dmarc "v=DMARC1; p=none; rua=mailto:dmarc@infinitykode.com"
```

---

## ALTERNATIVA TEMPORAL: Usar Gmail SMTP

Si necesitas enviar correos **HOY** mientras DNS propaga:

### Configurar cuenta Gmail para SMTP en AL-E

1. **Crear App Password en Gmail:**
   - Ir a: https://myaccount.google.com/apppasswords
   - Generar contraseña para "AL-E Core"

2. **Actualizar cuenta en AL-E:**
```sql
UPDATE email_accounts
SET 
  smtp_host = 'smtp.gmail.com',
  smtp_port = 587,
  smtp_secure = true,
  smtp_user = 'kodigovivo@gmail.com',
  smtp_pass_enc = '[NUEVA_APP_PASSWORD_ENCRIPTADA]',
  from_email = 'kodigovivo@gmail.com'
WHERE id = '57602f9c-de02-4ef7-8e36-c0e0eeb86764';
```

3. **Enviar correos desde Gmail:**
   - Gmail SIEMPRE tiene SPF/DKIM configurado
   - Funciona inmediatamente
   - Límite: 500 correos/día (suficiente para desarrollo)

---

## NEXT STEPS

### Prioridad 1 (HOY):
- [ ] Entrar a Hostinger DNS
- [ ] Agregar registro SPF
- [ ] Habilitar DKIM en Hostinger Email Settings
- [ ] Agregar registro DKIM en DNS
- [ ] Esperar 4 horas (TTL)

### Prioridad 2 (MAÑANA):
- [ ] Verificar propagación con dig
- [ ] Test envío real a Gmail
- [ ] Verificar headers Authentication-Results
- [ ] Agregar registro DMARC

### Prioridad 3 (SEMANA 1):
- [ ] Monitorear reportes DMARC
- [ ] Cambiar DMARC de p=none a p=quarantine
- [ ] Documentar configuración final

---

## RECURSOS

- [Hostinger DKIM Setup](https://support.hostinger.com/en/articles/1583228-how-to-set-up-dkim-for-your-domain)
- [SPF Record Syntax](https://www.spf-record.com/)
- [DMARC Guide](https://dmarc.org/overview/)
- [Gmail Authentication Requirements](https://support.google.com/mail/answer/81126)
- [MXToolbox Tests](https://mxtoolbox.com/)

---

## NOTAS TÉCNICAS

**¿Por qué Gmail rechaza ahora?**
- Desde Feb 2024, Gmail requiere SPF/DKIM obligatorio
- Antes era opcional (solo marcaba como spam)
- Ahora rechaza directamente con error 550-5.7.26

**¿Afecta a correos ENTRANTES?**
- NO. SPF/DKIM solo afectan correos SALIENTES
- El sync worker (IMAP) sigue funcionando normal
- Solo el envío (SMTP) está bloqueado

**¿Cuánto tarda en funcionar?**
- Configuración: 15 minutos
- Propagación DNS: 4-48 horas
- Gmail cache: puede tardar 1 hora adicional

---

**STATUS**: 🔴 BLOQUEADO - Requiere configuración DNS manual en Hostinger
**ETA**: 4-48 horas post-configuración
**WORKAROUND**: Usar Gmail SMTP temporalmente
