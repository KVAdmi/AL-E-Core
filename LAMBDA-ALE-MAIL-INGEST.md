# AWS LAMBDA: ale-mail-ingest

Función Lambda que procesa correos entrantes desde S3 y notifica al Core de AL-Eon.

## 📋 Resumen

- **Nombre:** ale-mail-ingest
- **Runtime:** Node.js 24.x
- **Trigger:** S3 ObjectCreated en bucket `aleon-mail-inbound` con prefijo `inbound/`
- **Función:** Notificar al Core cuando llega un nuevo correo a S3

## 🏗️ Arquitectura

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   AWS SES    │────▶│   S3 Bucket  │────▶│    Lambda    │────▶│  AL-E Core   │
│   Inbound    │     │ aleon-mail-  │     │ ale-mail-    │     │    Backend   │
│              │     │   inbound    │     │   ingest     │     │              │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                          │                                           │
                          └────────▶ inbound/*.eml                    │
                                                                       │
                                                POST /mail/inbound/ses │
                                                Header: X-Internal-Secret
```

## 📦 Código Completo (index.mjs)

```javascript
/**
 * AWS Lambda: ale-mail-ingest
 * Runtime: Node.js 24.x
 * 
 * Procesa correos entrantes desde S3 y notifica al Core
 */

import https from 'https';
import http from 'http';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const CORE_URL = process.env.CORE_URL || 'https://api.al-eon.com';
const INBOUND_SECRET = process.env.INBOUND_SECRET;
const MAX_RETRIES = 2;
const TIMEOUT_MS = 15000;

// ═══════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════

export const handler = async (event, context) => {
  console.log('[LAMBDA] ale-mail-ingest started');
  console.log('[LAMBDA] Event:', JSON.stringify(event, null, 2));
  
  // Validar secret
  if (!INBOUND_SECRET) {
    console.error('[LAMBDA] ERROR: INBOUND_SECRET not configured');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal configuration error' })
    };
  }
  
  // Procesar registros de S3
  const results = [];
  
  for (const record of event.Records) {
    // Ignorar eventos que no sean de S3
    if (record.eventSource !== 'aws:s3') {
      console.log('[LAMBDA] Skipping non-S3 event');
      continue;
    }
    
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    const region = record.awsRegion;
    
    console.log(`[LAMBDA] Processing: s3://${bucket}/${key}`);
    
    // Ignorar keys que no empiecen con "inbound/"
    if (!key.startsWith('inbound/')) {
      console.log(`[LAMBDA] Skipping key (not inbound/): ${key}`);
      results.push({ key, status: 'skipped', reason: 'not_inbound_prefix' });
      continue;
    }
    
    // Preparar payload para Core
    const payload = {
      bucket,
      key,
      region,
      ts: new Date().toISOString()
    };
    
    // Notificar al Core con reintentos
    const result = await notifyCore(payload);
    results.push({ key, ...result });
  }
  
  console.log('[LAMBDA] Processing complete:', results);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ results })
  };
};

// ═══════════════════════════════════════════════════════════════
// NOTIFICACIÓN AL CORE
// ═══════════════════════════════════════════════════════════════

async function notifyCore(payload) {
  const endpoint = `${CORE_URL}/mail/inbound/ses`;
  const body = JSON.stringify(payload);
  
  console.log(`[LAMBDA] Notifying Core: ${endpoint}`);
  console.log(`[LAMBDA] Payload:`, body);
  
  // Reintentos
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const result = await makeHttpRequest(endpoint, body);
      
      console.log(`[LAMBDA] Core response (attempt ${attempt}):`, result.statusCode);
      console.log(`[LAMBDA] Body:`, result.body.substring(0, 200));
      
      // Éxito en 2xx
      if (result.statusCode >= 200 && result.statusCode < 300) {
        return {
          status: 'success',
          statusCode: result.statusCode,
          body: result.body,
          attempts: attempt
        };
      }
      
      // Error 4xx: no reintentar
      if (result.statusCode >= 400 && result.statusCode < 500) {
        console.error(`[LAMBDA] Client error ${result.statusCode} - not retrying`);
        return {
          status: 'failed',
          statusCode: result.statusCode,
          body: result.body,
          attempts: attempt,
          reason: `client_error_${result.statusCode}`
        };
      }
      
      // Error 5xx: reintentar
      console.warn(`[LAMBDA] Server error ${result.statusCode} - attempt ${attempt}/${MAX_RETRIES + 1}`);
      
      if (attempt <= MAX_RETRIES) {
        await sleep(1000 * attempt); // Backoff exponencial
      }
      
    } catch (error) {
      console.error(`[LAMBDA] Request failed (attempt ${attempt}):`, error.message);
      
      if (attempt <= MAX_RETRIES) {
        await sleep(1000 * attempt);
      } else {
        return {
          status: 'failed',
          statusCode: 0,
          body: '',
          attempts: attempt,
          reason: error.message
        };
      }
    }
  }
  
  return {
    status: 'failed',
    statusCode: 0,
    body: '',
    attempts: MAX_RETRIES + 1,
    reason: 'max_retries_exceeded'
  };
}

// ═══════════════════════════════════════════════════════════════
// HTTP REQUEST (HTTPS/HTTP)
// ═══════════════════════════════════════════════════════════════

function makeHttpRequest(url, body) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Internal-Secret': INBOUND_SECRET
      },
      timeout: TIMEOUT_MS
    };
    
    const req = lib.request(options, (res) => {
      let responseBody = '';
      
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          body: responseBody
        });
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(body);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

## 🔧 Configuración en AWS Console

### 1. Variables de Entorno

```bash
CORE_URL=https://api.al-eon.com
INBOUND_SECRET=<SECRET_COMPARTIDO_CON_CORE>
```

**CRÍTICO:** El `INBOUND_SECRET` debe ser el mismo valor que `process.env.INBOUND_SECRET` en el Core.

### 2. IAM Role (Execution Role)

La Lambda necesita los siguientes permisos:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::aleon-mail-inbound/inbound/*"
    }
  ]
}
```

**Nota:** El permiso `s3:GetObject` es OPCIONAL. La Lambda NO descarga el correo, solo notifica al Core con bucket+key. El Core es quien descarga desde S3.

### 3. Trigger S3

- **Bucket:** `aleon-mail-inbound`
- **Event type:** `s3:ObjectCreated:*`
- **Prefix:** `inbound/`
- **Suffix:** `.eml` (opcional pero recomendado)

### 4. Configuración General

- **Memory:** 128 MB (suficiente para notificación HTTP)
- **Timeout:** 20 segundos
- **Runtime:** Node.js 24.x

## 📝 Testing

### Evento de Prueba (Test Event)

```json
{
  "Records": [
    {
      "eventSource": "aws:s3",
      "eventName": "ObjectCreated:Put",
      "awsRegion": "us-east-1",
      "s3": {
        "bucket": {
          "name": "aleon-mail-inbound"
        },
        "object": {
          "key": "inbound/test-email-12345.eml"
        }
      }
    }
  ]
}
```

### Comando curl para probar Core directamente

```bash
curl -X POST https://api.al-eon.com/mail/inbound/ses \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: YOUR_SECRET" \
  -d '{
    "bucket": "aleon-mail-inbound",
    "key": "inbound/test-email-12345.eml",
    "region": "us-east-1",
    "ts": "2026-01-03T00:00:00.000Z"
  }'
```

**Respuesta esperada:**

```json
{
  "ok": true,
  "inserted": true,
  "id": "uuid-del-mensaje"
}
```

## 🚨 Troubleshooting

### Lambda no se ejecuta

1. Verificar que el trigger S3 está configurado correctamente
2. Verificar que el bucket tiene permisos para invocar Lambda
3. Revisar CloudWatch Logs: `/aws/lambda/ale-mail-ingest`

### Core responde 401 Unauthorized

- El header `X-Internal-Secret` no coincide con `process.env.INBOUND_SECRET` en Core
- Verificar variables de entorno en Lambda y en Core (EC2)

### Core responde 500

- Error al descargar desde S3 (verificar credenciales AWS en Core)
- Error al parsear correo (.eml corrupto)
- Error al insertar en Supabase (verificar migración 018)

### Timeout

- Aumentar timeout de Lambda a 30s
- Verificar que Core responde rápido (debe procesar en < 5s)

## 📊 Logs

### Lambda CloudWatch

```
[LAMBDA] ale-mail-ingest started
[LAMBDA] Processing: s3://aleon-mail-inbound/inbound/email-123.eml
[LAMBDA] Notifying Core: https://api.al-eon.com/mail/inbound/ses
[LAMBDA] Core response (attempt 1): 200
[LAMBDA] Processing complete: [{"key":"inbound/email-123.eml","status":"success"}]
```

### Core Logs (pm2)

```
[MAIL_INBOUND] req_1735862400000 - POST /inbound/ses
[MAIL_INBOUND] req_1735862400000 - Processing: s3://aleon-mail-inbound/inbound/email-123.eml
[MAIL_SERVICE] Downloading s3://aleon-mail-inbound/inbound/email-123.eml
[MAIL_SERVICE] Downloaded 45678 bytes
[MAIL_SERVICE] Parsed: from=sender@example.com, to=user@al-eon.com, subject="Test Email"
[MAIL_SERVICE] ✓ Resolved by domain: al-eon.com → user_id=uuid, account_id=uuid
[MAIL_SERVICE] ✓ Message inserted: uuid
[MAIL_INBOUND] req_1735862400000 - ✓ Success: messageId=uuid, inserted=true
```

## 🔐 Seguridad

1. **NO logs de INBOUND_SECRET:** El código NUNCA loggea el secret
2. **Validación de prefijo:** Solo procesa keys con `inbound/`
3. **Timeout:** Evita que Lambda quede colgada
4. **Reintentos:** Máximo 2 reintentos con backoff exponencial
5. **Error 4xx no retries:** Errores de cliente no se reintentan

## 🎯 Próximos Pasos

1. **Monitoring:** Configurar CloudWatch Alarms para fallos
2. **DLQ:** Agregar Dead Letter Queue para errores persistentes
3. **Metrics:** Publicar métricas custom de correos procesados
4. **Encriptación:** Encriptar INBOUND_SECRET con AWS Secrets Manager

---

**Status:** ✅ Listo para desplegar
**Última actualización:** 3 de enero de 2026
