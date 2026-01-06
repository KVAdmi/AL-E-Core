# SES DESHABILITADO - POLÍTICA DE SEGURIDAD

**Fecha:** 6 de enero de 2026  
**Estado:** ❌ **BLOQUEADO COMPLETAMENTE**  
**Razón:** Protección durante fase de construcción de AL-E

---

## 🎯 CONTEXTO

Amazon SES está **COMPLETAMENTE DESHABILITADO** en AL-E Core mientras el producto está en construcción. Esta es una medida de seguridad **NO NEGOCIABLE**.

### ¿Por qué se bloqueó SES?

- **Riesgo de rebotes:** Envíos automáticos pueden generar bounce rate alto
- **Fase de construcción:** El sistema aún está en desarrollo activo
- **Destinatarios dinámicos:** No hay control estricto sobre a quién se envían correos
- **Protección de reputación:** Evitar que la cuenta SES sea suspendida

---

## ✅ CORREOS PERSONALES (FUNCIONANDO NORMAL)

Los correos personales de usuarios **NO están afectados** y funcionan 100% normal.

### Flujo de Envío (SMTP)
```
Usuario → /api/email/send
       → emailHub.ts
       → smtpService.ts
       → nodemailer
       → Gmail/Outlook SMTP directo
```

### Flujo de Recepción (IMAP)
```
Usuario → /api/email/sync
       → emailHub.ts
       → imapService.ts
       → imapflow
       → Gmail/Outlook IMAP directo
```

### Servicios NO Afectados
- ✅ `smtpService.ts` - Envío via SMTP directo
- ✅ `imapService.ts` - Recepción via IMAP directo
- ✅ `emailHub.ts` - API de gestión de correos personales
- ✅ OAuth Gmail/Outlook (si se implementa)

---

## 🚫 PROHIBICIONES ABSOLUTAS

Mientras SES esté deshabilitado, está **PROHIBIDO:**

### 1. Envío via SES
- ❌ `SendEmail`
- ❌ `SendRawEmail`
- ❌ SMTP de SES (`email-smtp.*.amazonaws.com`)
- ❌ Cualquier llamada a AWS SES SDK

### 2. Webhooks y Notificaciones
- ❌ Recibir webhooks SNS de SES
- ❌ Procesar notificaciones de correos entrantes
- ❌ Descargar correos de S3 relacionados con SES

### 3. Automatizaciones
- ❌ Reply automático
- ❌ Forward automático
- ❌ Parsing de correos para reenvío
- ❌ Destinatarios detectados en texto

### 4. Correos del Sistema
- ❌ Confirmación de cuentas por correo
- ❌ Notificaciones transaccionales
- ❌ Respuestas automáticas del inbox

---

## 🔒 IMPLEMENTACIÓN DEL BLOQUEO

### 1. Flag Global
```bash
# .env
ENABLE_SES=false
```

**NO cambiar este valor sin aprobación explícita.**

### 2. Módulo sesBlocker.ts
Valida y bloquea cualquier intento de usar SES:

```typescript
import { SES_BLOCKER } from '../utils/sesBlocker';

// Lanza error si SES está deshabilitado
SES_BLOCKER.throw('contextName');

// Middleware para Express
router.use(SES_BLOCKER.middleware);
```

### 3. Archivos Bloqueados

| Archivo | Estado | Función |
|---------|--------|---------|
| `systemMail.ts` | 🚫 BLOQUEADO | API de correos transaccionales SES |
| `mail-webhook.ts` | 🚫 BLOQUEADO | Webhooks SNS de SES |
| `mail-inbound.ts` | 🚫 BLOQUEADO | Procesamiento de correos S3 |
| `mailService.ts` | 🚫 BLOQUEADO | Descarga de S3 y parsing |
| `sesValidation.ts` | 🚫 BLOQUEADO | Validaciones retornan blocked=true |

### 4. Endpoints Deshabilitados

Todos retornan `403 Forbidden`:

- `POST /api/system/mail/send`
- `POST /api/mail/webhook/ses`
- `POST /mail/inbound/ses`
- `GET /api/system/mail/simulator`
- `GET /api/system/mail/types`

---

## ✅ CRITERIOS DE ACEPTACIÓN

Para confirmar que el bloqueo funciona:

1. ✅ AL-E puede operar sin SES
2. ✅ Gmail y Outlook funcionan normal
3. ✅ Ningún endpoint puede disparar SES
4. ✅ No se generan rebotes ni métricas en SES
5. ✅ Compilación TypeScript sin errores
6. ✅ Test de validación pasa

### Ejecutar Test
```bash
./test-smtp-imap-working.sh
```

---

## 🔄 CRITERIO DE REACTIVACIÓN (FUTURO)

SES **SOLO** podrá reactivarse cuando se cumplan **TODAS** estas condiciones:

### Requisitos Técnicos
1. ✅ Whitelist explícita de destinatarios
2. ✅ Todos los correos hardcodeados (no dinámicos)
3. ✅ NO destinatarios dinámicos detectados en texto
4. ✅ NO reply/forward automático
5. ✅ Uso estrictamente manual

### Requisitos de Proceso
1. ✅ Aprobación explícita del equipo de arquitectura
2. ✅ Plan de monitoreo de bounce rate
3. ✅ Lista de correos de prueba controlados
4. ✅ Proceso de rollback definido
5. ✅ Documentación completa de uso

### Cambios Requeridos
```bash
# 1. Actualizar .env
ENABLE_SES=true

# 2. Configurar credenciales SES
SES_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SES_SMTP_PORT=587
SES_SMTP_USER=YOUR_SMTP_USER
SES_SMTP_PASSWORD=YOUR_SMTP_PASSWORD

# 3. Restart backend
pm2 restart ale-core
```

---

## 📊 MONITOREO

### Logs de Intentos Bloqueados

Todos los intentos de usar SES se registran automáticamente:

```json
{
  "timestamp": "2026-01-06T10:30:00.000Z",
  "event": "SES_ATTEMPT_BLOCKED",
  "enabled": false,
  "endpoint": "/api/system/mail/send",
  "userId": "user_123",
  "action": "send_email",
  "reason": "Intento de envío bloqueado por sesBlocker"
}
```

### Verificar Estado
```bash
# Ver logs de bloqueos
grep "SES_ATTEMPT_BLOCKED" logs/ale-core.log

# Verificar flag
grep "ENABLE_SES" .env
```

---

## 🆘 SOLUCIÓN DE PROBLEMAS

### "No puedo enviar correos"
- ✅ **Correos personales:** Usa `/api/email/send` con cuenta SMTP/IMAP
- ❌ **Correos del sistema:** SES está bloqueado, no disponible

### "Error: SES_DISABLED"
- Normal, es el comportamiento esperado
- Usa SMTP/IMAP directo para correos personales
- No intentes reactivar SES sin aprobación

### "Compilación TypeScript falla"
```bash
# Verificar errores
npx tsc --noEmit

# Si menciona SES, verificar imports
grep -r "aws-sdk.*ses" src/
```

---

## 📝 CHECKLIST DE DESPLIEGUE

Antes de deployar con SES bloqueado:

- [ ] ✅ `ENABLE_SES=false` en `.env`
- [ ] ✅ Test de SMTP/IMAP pasa
- [ ] ✅ Compilación TypeScript sin errores
- [ ] ✅ EmailHub funciona normal
- [ ] ✅ Logs no muestran errores de imports
- [ ] ✅ Endpoints SES retornan 403

---

## 🔗 REFERENCIAS

- **Implementación:** `src/utils/sesBlocker.ts`
- **Test:** `test-smtp-imap-working.sh`
- **Configuración:** `.env.example`
- **Documentación Email Hub:** `EMAIL-HUB-UNIVERSAL.md`

---

## 📞 CONTACTO

Para dudas o solicitud de reactivación de SES:
- **Equipo:** Arquitectura AL-E Core
- **Política:** NO NEGOCIABLE durante construcción
- **Alternativa:** Usar SMTP/IMAP directo

---

**⚠️ IMPORTANTE:** Esta política es temporal durante la fase de construcción. Una vez que AL-E esté estable y con controles adecuados, SES podrá reactivarse siguiendo los criterios definidos arriba.
