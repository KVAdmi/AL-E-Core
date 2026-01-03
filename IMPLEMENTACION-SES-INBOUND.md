# IMPLEMENTACIÓN COMPLETADA: AWS SES Inbound/Outbound

## ✅ Cambios Realizados

### 1. Migración 018: SES Inbound System
**Archivo**: `migrations/018_ses_inbound_system.sql`

#### Tablas Nuevas:
- **`mail_accounts`**: Cuentas con soporte AWS SES (inbound/outbound)
- **`mail_messages_new`**: Mensajes con banderas, spam detection, S3 storage
- **`mail_drafts_new`**: Borradores con envío programado
- **`mail_attachments_new`**: Adjuntos almacenados en S3
- **`mail_filters`**: Reglas de clasificación automática
- **`mail_sync_log_new`**: Log de sincronizaciones

#### Extensiones a email_accounts:
- `provider` VARCHAR(50): ses_inbound, ses, gmail, outlook, smtp, imap
- `domain` VARCHAR(255): Dominio verificado en AWS SES
- `aws_region` VARCHAR(50): us-east-1, eu-west-1, etc.
- `aws_access_key_id` VARCHAR(255): IAM Access Key
- `aws_secret_access_key_enc` TEXT: Secret encriptado
- `s3_bucket` VARCHAR(255): Bucket para correos entrantes
- `status` VARCHAR(50): active, paused, error
- `config` JSONB: Configuración extendida (firma, spam, banderas)

### 2. Endpoint Webhook AWS SES
**Archivo**: `src/api/mail-webhook.ts`

#### Funcionalidades:
- **POST /api/mail/webhook/ses**: Recibe notificaciones SNS de AWS SES
- Confirmación automática de suscripción SNS
- Descarga de correos desde S3
- Parseo completo con mailparser
- Verificación de spam (spamVerdict, virusVerdict, SPF, DKIM, DMARC)
- Extracción de adjuntos
- Aplicación automática de filtros
- Log de sincronización

#### Proceso:
1. AWS SES recibe correo → Rule Set guarda en S3 → SNS notifica webhook
2. Backend descarga de S3 y parsea contenido completo
3. Verifica spam con verdicts de AWS SES
4. Guarda en `mail_messages_new` con metadata completa
5. Aplica filtros automáticos (carpetas, banderas, etc.)
6. Registra en `mail_sync_log_new`

### 3. Actualización API Email Accounts
**Archivo**: `src/api/email.ts`

#### Cambios en POST /api/email/accounts:
- Soporte para provider: ses_inbound, ses, gmail, outlook, smtp, imap
- Campos AWS SES: domain, awsRegion, awsAccessKeyId, awsSecretAccessKey, s3Bucket
- Campo `config` (JSONB) para firma, banderas, spam filter
- Validación condicional según tipo de proveedor
- Encriptación de AWS Secret Access Key

### 4. Runtime Capabilities
**Archivo**: `CONTRACTS/runtime-capabilities.json`

```json
{
  "mail.send": true,
  "mail.inbox": true,  ← HABILITADO
  "calendar.create": true,
  ...
}
```

### 5. Integración en index.ts
**Archivo**: `src/index.ts`

- Importado `mailWebhookRouter`
- Montado en `/api/mail/webhook/ses`

---

## 📋 Pendiente para Configuración Completa

### 1. Ejecutar Migración 018 en Supabase
```bash
# Ejecutar en SQL Editor de Supabase:
# migrations/018_ses_inbound_system.sql
```

### 2. Configurar AWS SES Inbound

#### A. Verificar dominio en AWS SES
1. AWS Console → SES → Verified identities
2. Crear dominio (ej: `al-eon.com`)
3. Copiar registros DNS (MX, TXT, DKIM) y configurar en proveedor DNS
4. Esperar verificación

#### B. Crear S3 Bucket para correos
1. AWS Console → S3 → Create bucket
2. Nombre: `al-eon-emails-inbound` (o similar)
3. Region: `us-east-1` (misma que SES)
4. Permisos: Permitir escritura a SES

#### C. Crear IAM User con permisos
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::al-eon-emails-inbound/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail"
      ],
      "Resource": "*"
    }
  ]
}
```

#### D. Crear SES Rule Set
1. AWS Console → SES → Email receiving → Rule sets
2. Crear rule set activo
3. Crear rule:
   - **Recipients**: Dominios permitidos (`@al-eon.com`)
   - **Actions**:
     1. **S3**: Guardar en bucket `al-eon-emails-inbound`
     2. **SNS**: Publicar a tópico SNS

#### E. Crear SNS Topic y Suscripción
1. AWS Console → SNS → Create topic
2. Nombre: `ses-inbound-notifications`
3. Crear suscripción:
   - Protocol: HTTPS
   - Endpoint: `https://api.al-eon.com/api/mail/webhook/ses`
4. **IMPORTANTE**: El webhook confirmará automáticamente la suscripción

### 3. Configurar Registros DNS

#### Registros MX (para recibir correos):
```
al-eon.com   MX   10   inbound-smtp.us-east-1.amazonaws.com
```

#### Registros SPF:
```
al-eon.com   TXT   "v=spf1 include:amazonses.com ~all"
```

#### Registros DKIM (copiar desde AWS SES Console):
```
xxx._domainkey.al-eon.com   CNAME   xxx.dkim.amazonses.com
yyy._domainkey.al-eon.com   CNAME   yyy.dkim.amazonses.com
zzz._domainkey.al-eon.com   CNAME   zzz.dkim.amazonses.com
```

### 4. Instalar Dependencias
```bash
npm install aws-sdk mailparser
```

### 5. Actualizar .env en EC2
```bash
# Ya existe:
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_USER=AKIA6OPTJECMR6UBUR6I
SMTP_PASS=BPplEpZt83yDd7BKiS6yXk5J1uOmE3RX9d5BhpRGwFoK

# Agregar (para IAM user con acceso S3 + SES):
AWS_SES_REGION=us-east-1
AWS_SES_ACCESS_KEY_ID=AKIA... (nuevo IAM user)
AWS_SES_SECRET_ACCESS_KEY=... (nuevo IAM user)
AWS_S3_BUCKET_INBOUND=al-eon-emails-inbound
```

---

## 🔧 Endpoints Disponibles

### Correo Saliente (Outbound)
- **POST /api/mail/send**: Enviar correo con AWS SES (ya activo ✅)

### Correo Entrante (Inbound)
- **POST /api/mail/webhook/ses**: Webhook SNS (recibe notificaciones)

### Gestión de Cuentas
- **POST /api/email/accounts**: Crear cuenta (SMTP o SES)
- **GET /api/email/accounts**: Listar cuentas
- **PATCH /api/email/accounts/:id**: Actualizar cuenta
- **DELETE /api/email/accounts/:id**: Desactivar cuenta

### Próximos Endpoints (recomendados)
- **GET /api/mail/messages**: Listar mensajes (inbox, sent, etc.)
- **GET /api/mail/messages/:id**: Ver mensaje específico
- **PATCH /api/mail/messages/:id**: Actualizar estado (leer, archivar, flag)
- **DELETE /api/mail/messages/:id**: Eliminar mensaje
- **GET /api/mail/filters**: Listar filtros
- **POST /api/mail/filters**: Crear filtro
- **GET /api/mail/sync/status**: Estado de sincronización

---

## 🎯 Features Implementados

### ✅ Banderas/Clasificación
- Campo `flag` en `mail_messages_new`
- Valores: urgent, important, pending, follow_up, low_priority
- Aplicable vía filtros automáticos

### ✅ Anti-Spam
- `spam_score` (0-100)
- `is_spam` (booleano)
- `spam_reason` (texto descriptivo)
- Usa AWS SES verdicts: spamVerdict, virusVerdict, SPF, DKIM, DMARC

### ✅ Firma de Correo
- Almacenada en `config` (JSONB) de `email_accounts`
- Frontend guarda texto + imagen (base64)
- Backend puede inyectar firma al enviar

### ✅ Filtros Automáticos
- Tabla `mail_filters` con condiciones y acciones
- Condiciones: from, subject_contains, has_attachments, etc.
- Acciones: move_to_folder, set_flag, mark_read, mark_spam
- Aplicación automática al recibir correos

### ✅ S3 Storage
- Correos completos almacenados en S3
- `s3_bucket`, `s3_key`, `s3_url` en cada mensaje
- Permite descargar RAW email cuando sea necesario

### ✅ Headers Completos
- `raw_headers` (JSONB) con todos los headers HTTP del correo
- Útil para threading, reply-to, references, etc.

### ✅ Threading
- `thread_id` para agrupar conversaciones
- `in_reply_to` y `references_text` para cadenas de respuesta

---

## 🚀 Próximos Pasos Recomendados

### Backend
1. Crear endpoints CRUD para mensajes (`GET /api/mail/messages`, etc.)
2. Implementar búsqueda de correos (full-text search en body_text)
3. Worker para sincronización periódica (opcional si webhook falla)
4. Endpoint para aplicar filtros manualmente
5. Detección de spam con ML (opcional, mejorar spam_score)

### Frontend
1. Vista de bandeja de entrada con banderas visuales
2. Filtro de spam (mostrar/ocultar)
3. Gestión de reglas de filtrado (UI)
4. Visualización de firma al componer correos
5. Soporte para adjuntos desde S3

### Infraestructura
1. Configurar SNS Dead Letter Queue (DLQ) para reintentos
2. CloudWatch logs para debugging de SES
3. Alertas de quota de AWS SES
4. Backup automático de S3 bucket

---

## 📝 Notas Técnicas

### Seguridad
- AWS Secret Access Key encriptado con AES-256
- RLS habilitado en todas las tablas
- Webhook valida tipo de mensaje SNS
- No exponer passwords/keys en respuestas API

### Performance
- Índices en todas las columnas de búsqueda frecuente
- JSONB para configuración flexible sin ALTER TABLE
- S3 para correos grandes (no llenar PostgreSQL)

### Compatibilidad
- `email_accounts` extendido (no reemplazado) para backward compatibility
- `mail_messages_new` (nuevo nombre) coexiste con tablas viejas
- Migración automática de datos existentes incluida en 018

---

## 🎉 Estado Actual

### ✅ Completado
- Migración 018 creada
- Webhook AWS SES implementado
- API de cuentas actualizada
- Runtime capabilities habilitado (`mail.inbox=true`)
- Integración en index.ts

### ⏳ Pendiente
- Ejecutar migración 018 en Supabase (SQL)
- Configurar AWS SES inbound (dominio, S3, SNS, Rule Set)
- Instalar dependencias (`aws-sdk`, `mailparser`)
- Desplegar a EC2
- Crear endpoints CRUD de mensajes

### 🎯 Listo para Configuración
El sistema está **listo para recibir correos** una vez:
1. Se ejecute la migración 018
2. Se configure AWS SES inbound (dominio + S3 + SNS)
3. Se despliegue el código a EC2

---

**Autor**: Core  
**Fecha**: 3 de enero de 2026  
**Versión**: 1.0.0
