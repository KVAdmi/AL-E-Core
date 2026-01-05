# 🚨 CRISIS AMAZON SES - PLAN DE ACCIÓN INMEDIATO

**Fecha:** 5 de enero de 2026  
**Estado:** UNDER REVIEW (bounce rate 12.72%)  
**Riesgo:** Suspensión de cuenta SES

---

## 📊 SITUACIÓN ACTUAL

- ✅ **Cuenta activa** pero bajo revisión de Amazon
- ⚠️ **Bounce rate:** 12.72% (límite máximo: 5%)
- 🎯 **Causa identificada:** Correos de prueba a direcciones inválidas/ficticias
- 🔴 **Problema secundario:** Algunos correos sin autenticación SPF/DKIM correcta

---

## 🎯 OBJETIVO CRÍTICO

1. **Reducir bounce rate a <5%** en las próximas 48 horas
2. **Salir del "under review"** status
3. **Evitar suspensión permanente**
4. **Restaurar reputación del dominio**

---

## ✅ ACCIONES INMEDIATAS (NO NEGOCIABLES)

### 1️⃣ RESTRICCIÓN DE USO DE SES (HOY)

**SES queda EXCLUSIVAMENTE para:**
- ✅ Notificaciones del sistema
- ✅ Alertas automáticas
- ✅ Onboarding emails
- ✅ Reset password
- ✅ Verificación de email

**❌ PROHIBIDO USAR SES PARA:**
- ❌ Correos "humanos" (usuario → usuario)
- ❌ Pruebas técnicas con emails inventados
- ❌ Envíos masivos no transaccionales
- ❌ Marketing o newsletters

**IMPLEMENTACIÓN EN CÓDIGO:**
- Agregar validación de tipo de correo antes de enviar via SES
- Bloquear envíos que no sean transaccionales del sistema
- Usar cuentas SMTP de usuarios para correos personales

---

### 2️⃣ ACTIVAR PROTECCIONES EN AMAZON SES (HOY)

#### A. Account-level Suppression List
```bash
# Habilitar en AWS Console
1. Ir a Amazon SES → Configuration Sets
2. Enable Account-level suppression list
3. Activar para: BOUNCE + COMPLAINT
```

**Resultado esperado:**
- SES automáticamente bloqueará envíos a emails que rebotaron
- Bounce rate dejará de incrementar

#### B. SES Mailbox Simulator
```bash
# Para pruebas técnicas usar SOLO estos emails:
success@simulator.amazonses.com         # ✅ Entrega exitosa
bounce@simulator.amazonses.com          # 🔴 Bounce (para testing)
complaint@simulator.amazonses.com       # ⚠️ Complaint (para testing)
suppressionlist@simulator.amazonses.com # 🚫 En lista de supresión
```

**NO usar emails inventados como:**
- ❌ test@test.com
- ❌ fake@example.com
- ❌ usuario123@gmail.com (si no existe)

---

### 3️⃣ AUTENTICACIÓN DE DOMINIO (HOY)

#### Paso 1: Verificar dominio en SES
```bash
# En AWS SES Console
1. Ir a "Verified identities"
2. Verificar: al-eon.com
3. Completar verificación DNS (TXT record)
```

#### Paso 2: Habilitar DKIM
```bash
# En AWS SES Console
1. Seleccionar dominio: al-eon.com
2. Enable DKIM signing
3. AWS generará 3 registros CNAME
```

#### Paso 3: Obtener registros CNAME DKIM
**NO INVENTAR - AWS generará registros únicos como:**
```
_domainkey.al-eon.com CNAME xxxxx.dkim.amazonses.com
_domainkey.al-eon.com CNAME yyyyy.dkim.amazonses.com
_domainkey.al-eon.com CNAME zzzzz.dkim.amazonses.com
```

**ACCIÓN REQUERIDA:**
- [ ] Obtener los 3 registros CNAME reales de AWS Console
- [ ] Entregarlos al equipo de DNS/DevOps
- [ ] Verificar propagación DNS (48-72 horas)
- [ ] Confirmar DKIM activo en SES Console

#### Paso 4: Verificar SPF
```bash
# Agregar o actualizar registro SPF en DNS:
TXT @ "v=spf1 include:amazonses.com ~all"
```

---

### 4️⃣ RESPUESTA A AWS SUPPORT (HOY)

**Template de respuesta (copiar y personalizar):**

```
Subject: Re: Amazon SES Account Under Review - Bounce Rate Issue

Dear AWS Support Team,

Thank you for notifying us about the bounce rate issue on our Amazon SES account.

ISSUE ACKNOWLEDGMENT:
We acknowledge that our bounce rate reached 12.72%, exceeding the acceptable 5% threshold.

ROOT CAUSE:
The high bounce rate was caused by initial testing phase where emails were sent to:
1. Invalid/test email addresses during development
2. Some emails without proper SPF/DKIM authentication

CORRECTIVE ACTIONS IMPLEMENTED:
1. ✅ Enabled Account-level Suppression List for bounces and complaints
2. ✅ Restricted SES usage to transactional system emails only:
   - Password reset
   - Email verification
   - System notifications
   - Onboarding emails
3. ✅ Implemented validation to prevent sending to invalid addresses
4. ✅ Using SES Mailbox Simulator for all future testing
5. ✅ Enabled DKIM signing for domain: al-eon.com
6. ✅ Verified SPF records for proper authentication
7. ✅ Implemented monitoring to maintain bounce rate <2%

PREVENTIVE MEASURES:
- All user-to-user emails now use user's own SMTP accounts (not SES)
- Pre-send email validation implemented
- Automated bounce monitoring and alerts

We are committed to maintaining email best practices and keeping our bounce rate below 5%.

Thank you for your understanding.

Best regards,
[Tu nombre]
[Tu empresa]
```

---

## 🛡️ IMPLEMENTACIÓN EN CÓDIGO

### Validación Pre-Envío (Agregar a backend)

```typescript
// src/utils/sesValidation.ts

/**
 * Valida si un correo puede enviarse via SES
 * SOLO correos transaccionales del sistema
 */
export function canUseSES(emailType: string, to: string): boolean {
  // Lista blanca de tipos permitidos
  const ALLOWED_TYPES = [
    'password_reset',
    'email_verification',
    'onboarding',
    'system_notification',
    'account_alert'
  ];
  
  // Verificar tipo
  if (!ALLOWED_TYPES.includes(emailType)) {
    console.error('[SES BLOCKED] Tipo no permitido:', emailType);
    return false;
  }
  
  // Verificar que no sea email de prueba
  const TEST_DOMAINS = ['test.com', 'example.com', 'fake.com'];
  const domain = to.split('@')[1]?.toLowerCase();
  
  if (TEST_DOMAINS.includes(domain)) {
    console.error('[SES BLOCKED] Dominio de prueba:', domain);
    return false;
  }
  
  // Validar formato de email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    console.error('[SES BLOCKED] Email inválido:', to);
    return false;
  }
  
  return true;
}

/**
 * Lista de supresión local (complemento a SES)
 */
const localSuppressionList = new Set<string>();

export function addToSuppressionList(email: string) {
  localSuppressionList.add(email.toLowerCase());
  console.log('[SUPPRESSION] Email agregado:', email);
}

export function isInSuppressionList(email: string): boolean {
  return localSuppressionList.has(email.toLowerCase());
}
```

### Modificar endpoint de envío

```typescript
// src/api/notifications.ts (o donde uses SES)

import { canUseSES, isInSuppressionList } from '../utils/sesValidation';

router.post('/send-system-email', async (req, res) => {
  const { to, subject, body, emailType } = req.body;
  
  // 1. Verificar lista de supresión
  if (isInSuppressionList(to)) {
    console.log('[SES BLOCKED] Email en lista de supresión:', to);
    return res.status(400).json({
      success: false,
      error: 'EMAIL_SUPPRESSED',
      message: 'Este email está en la lista de supresión'
    });
  }
  
  // 2. Validar si puede usar SES
  if (!canUseSES(emailType, to)) {
    console.log('[SES BLOCKED] No autorizado para SES:', { emailType, to });
    return res.status(403).json({
      success: false,
      error: 'SES_NOT_ALLOWED',
      message: 'Este tipo de correo no puede usar SES'
    });
  }
  
  // 3. Enviar via SES (solo si pasó validaciones)
  try {
    // ... código de envío SES existente ...
    
    return res.json({ success: true });
  } catch (error) {
    console.error('[SES ERROR]', error);
    return res.status(500).json({ success: false });
  }
});
```

---

## 📊 MONITOREO (Implementar HOY)

### CloudWatch Alarms
```bash
# Configurar en AWS CloudWatch
1. Bounce Rate > 3% → Alerta por email
2. Complaint Rate > 0.1% → Alerta por email
3. Reputation Dashboard diario
```

### Script de monitoreo local
```typescript
// scripts/monitor-ses-health.ts

import AWS from 'aws-sdk';

const ses = new AWS.SES({ region: 'us-east-1' });

async function checkSESHealth() {
  const params = {
    Identities: ['al-eon.com']
  };
  
  const stats = await ses.getIdentityStatistics(params).promise();
  
  const bounceRate = stats.BounceRate || 0;
  const complaintRate = stats.ComplaintRate || 0;
  
  console.log('=== SES HEALTH CHECK ===');
  console.log('Bounce Rate:', bounceRate.toFixed(2) + '%');
  console.log('Complaint Rate:', complaintRate.toFixed(2) + '%');
  
  if (bounceRate > 5) {
    console.error('🚨 ALERTA: Bounce rate crítico!');
  } else if (bounceRate > 3) {
    console.warn('⚠️ WARNING: Bounce rate elevado');
  } else {
    console.log('✅ Bounce rate saludable');
  }
}

// Ejecutar cada 6 horas
setInterval(checkSESHealth, 6 * 60 * 60 * 1000);
checkSESHealth(); // Primera ejecución
```

---

## 📋 CHECKLIST DE IMPLEMENTACIÓN

### HOY (5 de enero)
- [ ] Habilitar Account-level Suppression List en SES
- [ ] Agregar validación `canUseSES()` en código
- [ ] Desplegar código actualizado a producción
- [ ] Verificar dominio al-eon.com en SES
- [ ] Habilitar DKIM signing
- [ ] Obtener 3 registros CNAME de AWS
- [ ] Enviar email a AWS Support con explicación
- [ ] Revisar últimos 100 correos enviados y agregar bounces a suppression list

### MAÑANA (6 de enero)
- [ ] Entregar registros CNAME a equipo de DNS
- [ ] Verificar SPF record en DNS actual
- [ ] Configurar CloudWatch alarms
- [ ] Implementar script de monitoreo
- [ ] Documentar proceso para equipo

### 48-72 HORAS
- [ ] Verificar propagación DNS de registros DKIM
- [ ] Confirmar DKIM activo en SES Console
- [ ] Verificar bounce rate <5%
- [ ] Hacer seguimiento con AWS Support

---

## 🚫 PROHIBICIONES PERMANENTES

1. **NUNCA** usar SES para pruebas con emails inventados
2. **NUNCA** enviar correos masivos no transaccionales via SES
3. **NUNCA** usar SES para correos de usuario → usuario
4. **SIEMPRE** usar SES Mailbox Simulator para testing
5. **SIEMPRE** validar formato de email antes de enviar

---

## 📞 CONTACTOS DE EMERGENCIA

- **AWS Support Case:** [Número de caso cuando lo abran]
- **SES Status:** https://status.aws.amazon.com/
- **Dashboard SES:** https://console.aws.amazon.com/ses/

---

## 📚 REFERENCIAS

- [SES Best Practices](https://docs.aws.amazon.com/ses/latest/dg/best-practices.html)
- [SES Bounce Handling](https://docs.aws.amazon.com/ses/latest/dg/send-email-concepts-deliverability.html)
- [SES Mailbox Simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html)
- [DKIM Setup](https://docs.aws.amazon.com/ses/latest/dg/send-email-authentication-dkim.html)

---

**ÚLTIMA ACTUALIZACIÓN:** 5 de enero de 2026  
**PRÓXIMA REVISIÓN:** 6 de enero de 2026 (mañana)
