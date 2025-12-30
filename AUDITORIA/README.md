# 📋 AUDITORÍA DE CÓDIGO - AL-E CORE

**Fecha**: 30 de diciembre de 2025  
**Propósito**: Auditoría completa del sistema para verificar "verdad operativa" vs respuestas del LLM

---

## 📂 ESTRUCTURA DE CARPETAS

```
AUDITORIA/
├── CONTRACTS/
│   └── runtime-capabilities.json ⭐ (Fuente de verdad de features disponibles)
├── migrations/
│   ├── 012_calendar_internal.sql (Calendario interno)
│   ├── 014_email_extended_tables.sql (Email folders, drafts, messages, attachments, contacts)
│   ├── 015_add_notification_minutes.sql (Hotfix calendar)
│   └── 016_email_rules_threads_sync.sql (Email rules, threads, sync log)
└── src/
    ├── ai/
    │   ├── orchestrator.ts ⭐ (Cerebro del sistema)
    │   └── aleon.ts (Prompts y personalidad)
    ├── services/
    │   ├── intentClassifier.ts ⭐ (Clasificación de intenciones)
    │   ├── transactionalExecutor.ts ⭐ (Ejecutor de acciones transaccionales)
    │   └── integrationChecker.ts (Verificación de integraciones activas)
    ├── api/
    │   ├── calendar.ts (Endpoints de calendario)
    │   ├── mail.ts (Endpoints de email - 17 endpoints)
    │   └── health.ts (Health check bloqueante)
    ├── middleware/
    │   └── auth.ts (Autenticación JWT)
    ├── config/
    │   └── env.ts (Variables de entorno)
    └── db/
        └── supabase.ts (Cliente de Supabase)
```

---

## 🎯 ARCHIVOS CLAVE PARA AUDITORÍA

### 1️⃣ **ORQUESTACIÓN Y VERDAD OPERATIVA**

#### `src/ai/orchestrator.ts` ⭐⭐⭐
- **Propósito**: Pipeline completo de orquestación desde mensaje del usuario hasta respuesta
- **Pasos críticos**:
  - STEP 1: Cargar perfil de usuario
  - STEP 2: Detectar idioma
  - STEP 3: Cargar memorias
  - STEP 4: RAG retrieval
  - STEP 4.5: **Clasificar intent** (intentClassifier)
  - STEP 5: **Decidir y ejecutar tool** (transactionalExecutor)
  - STEP 6: Decidir modelo LLM
  - STEP 7: Construir system prompt
  - STEP 8: Llamar a LLM
  - STEP 9: Guardar memoria
- **Verificar**: ¿Está pasando el mensaje correcto a intentClassifier? ¿Los logs muestran la clasificación correcta?

#### `src/services/intentClassifier.ts` ⭐⭐⭐
- **Propósito**: Clasificar intención del usuario en 4 tipos
- **Tipos de intent**:
  1. `transactional` - Email, Calendar, Telegram (PRIORIDAD 1 - SIEMPRE GANA)
  2. `verification` - Búsqueda web explícita
  3. `time_sensitive` - Datos actuales (clima, precios, noticias)
  4. `stable` - Conocimiento general
- **Patterns críticos**:
  - `TRANSACTIONAL_PATTERNS.calendar_action`: Incluye "agenda", "junta", "cita", "evento", "reunión"
  - `TRANSACTIONAL_PATTERNS.email_action`: Incluye "correo", "email", "mail", "mensaje"
- **Verificar**: ¿Los regex detectan las palabras correctas? ¿El scoring funciona? ¿La decisión es correcta?

#### `src/services/transactionalExecutor.ts` ⭐⭐⭐
- **Propósito**: Ejecutar acciones transaccionales (email, calendar, telegram)
- **Funciones implementadas**:
  - `calendar_create` (líneas 314-407): Crear eventos en calendario
  - `email_send`: Enviar emails via SMTP
  - `email_inbox`: Leer emails via IMAP
- **Verificar**: ¿extractEventInfo() y extractDateTime() funcionan? ¿El INSERT a calendar_events tiene todos los campos? ¿Retorna provider_event_id?

#### `src/services/integrationChecker.ts`
- **Propósito**: Verificar qué integraciones tiene activas el usuario
- **Retorna**: `{ hasEmail, hasCalendar, hasTelegram, emailAccounts, telegramBots }`
- **CRÍTICO**: `hasCalendar` SIEMPRE debe ser `true` (calendario interno)
- **Verificar**: ¿Está consultando correctamente email_accounts con owner_user_id?

---

### 2️⃣ **CALENDAR (ELIMINAR MENTIRAS)**

#### `src/api/calendar.ts`
- **Endpoints implementados**:
  - `POST /api/calendar/events` - Crear evento
  - `GET /api/calendar/events` - Listar eventos
  - `GET /api/calendar/events/:id` - Ver evento
  - `PATCH /api/calendar/events/:id` - Actualizar evento
  - `DELETE /api/calendar/events/:id` - Eliminar evento
- **Tabla**: `calendar_events`
- **Verificar**: ¿Los endpoints existen? ¿Funcionan con RLS? ¿Retornan event.id?

#### `migrations/012_calendar_internal.sql`
- **Tablas creadas**:
  - `calendar_events`: id, owner_user_id, title, description, start_at, end_at, timezone, location, attendees_json, status, created_at, updated_at
  - `notification_jobs`: Para recordatorios vía Telegram/Email
- **RLS**: `owner_user_id = auth.uid()`
- **Verificar**: ¿La tabla tiene todas las columnas? ¿Falta notification_minutes?

#### `migrations/015_add_notification_minutes.sql` ⭐
- **HOTFIX**: Agrega columna `notification_minutes INTEGER DEFAULT 60` a `calendar_events`
- **Causa**: El código en transactionalExecutor.ts intentaba insertar esta columna pero no existía
- **Verificar**: ¿Esta migración ya se ejecutó en Supabase?

---

### 3️⃣ **EMAIL REAL (NO UI, LÓGICA)**

#### `src/api/mail.ts` (1625 líneas) ⭐⭐⭐
- **Endpoints implementados (17)**:
  1. `POST /api/mail/send` - Enviar email (SMTP)
  2. `GET /api/mail/inbox/:accountId` - Leer inbox (IMAP)
  3. `GET /api/mail/inbox` - Inbox de todas las cuentas
  4. `GET /api/mail/messages` - Listar mensajes con filtros
  5. `POST /api/mail/reply` - Responder email
  6. `DELETE /api/mail/message/:accountId/:messageUid` - Eliminar mensaje
  7. `PATCH /api/mail/message/:accountId/:messageUid/read` - Marcar como leído
  8. `GET /api/mail/folders/:accountId` - Listar carpetas
  9. `POST /api/mail/folders` - Crear carpeta custom
  10. `GET /api/mail/drafts` - Listar borradores
  11. `POST /api/mail/drafts` - Crear borrador
  12. `PATCH /api/mail/drafts/:id` - Editar borrador
  13. `DELETE /api/mail/drafts/:id` - Eliminar borrador
  14. `POST /api/mail/drafts/:id/send` - Enviar borrador
  15. `POST /api/mail/attachments/upload` - Subir archivo
  16. `GET /api/mail/attachments/:id/download` - Descargar archivo
  17. `DELETE /api/mail/attachments/:id` - Eliminar archivo

- **Endpoints FALTANTES (ver PROMPT-ALEON-EMAIL-MODULE.md)**:
  - POST /api/mail/message/:messageId/move
  - PATCH /api/mail/message/:messageId/star
  - POST /api/mail/message/:messageId/spam
  - POST /api/mail/message/:messageId/archive
  - POST /api/mail/message/:messageId/forward
  - POST /api/mail/message/:messageId/reply-all
  - GET /api/mail/search
  - GET /api/mail/folders/:folderId/messages
  - DELETE /api/mail/folders/:folderId/empty
  - GET /api/mail/threads/:threadId

- **Verificar**: ¿Los endpoints existen y funcionan? ¿Retornan provider_message_id?

#### `migrations/014_email_extended_tables.sql` ⭐
- **Tablas creadas (6)**:
  1. `email_accounts`: Cuentas SMTP/IMAP configuradas
  2. `email_folders`: Carpetas (Inbox, Sent, Drafts, Spam, Trash + custom)
  3. `email_messages`: Mensajes guardados con metadata completa
  4. `email_drafts`: Borradores sin enviar
  5. `email_attachments`: Archivos adjuntos
  6. `email_contacts`: Libreta de contactos
- **Trigger**: `create_default_email_folders()` - Auto-crea 5 carpetas al insertar cuenta
- **RLS**: Todas las tablas con `owner_user_id = auth.uid()`
- **Verificar**: ¿Esta migración se ejecutó? ¿Las 6 tablas existen en Supabase?

#### `migrations/016_email_rules_threads_sync.sql`
- **Tablas adicionales (3)**:
  1. `email_rules`: Reglas automáticas (conditions JSONB, actions JSONB)
  2. `email_threads`: Hilos de conversación agrupados
  3. `email_sync_log`: Log de sincronizaciones IMAP
- **También agrega**: Columna `current_folder_id` a `email_messages`
- **Verificar**: ¿Esta migración se ejecutó? (Probablemente NO)

---

### 4️⃣ **RAG / DOCUMENTOS**

**NOTA**: No se encontraron archivos específicos de RAG/documentos en el proyecto actual.

**Verificar**:
- ¿Existe `src/services/rag/` o `src/services/documents/`?
- ¿Existe `src/api/documents.ts`?
- ¿Hay alguna tabla `ae_chunks` o `ae_files` en Supabase?
- ¿El orchestrator.ts llama a alguna función de RAG en STEP 4?

**Usuario reportó**: "no lee los documentos que dejé en una de las carpetas"

---

### 5️⃣ **AUTH & CONTEXTO**

#### `src/middleware/auth.ts`
- **Propósito**: Middleware de autenticación JWT con Supabase
- **Verificar**: ¿Valida el token correctamente? ¿Extrae el userId?

#### `src/config/env.ts`
- **Propósito**: Validación y tipado de variables de entorno
- **Variables críticas**:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `ENCRYPTION_KEY`
  - `GROQ_API_KEY`
- **Verificar**: ¿Todas las variables existen en el servidor?

#### `src/db/supabase.ts`
- **Propósito**: Cliente de Supabase configurado
- **Verificar**: ¿Usa la SERVICE_ROLE_KEY correcta?

---

### 6️⃣ **HEALTH & FLAGS**

#### `src/api/health.ts` ⭐
- **Endpoints**:
  - `GET /_health` - Health check básico
  - `GET /_health/full` - Health check BLOQUEANTE completo
- **Verificaciones en /_health/full**:
  - **migrations_ok**: Verifica que existan 11 tablas requeridas
  - **env_ok**: Verifica que existan 4 ENV vars requeridas
  - **features_verified**: Verifica datos REALES (no solo flags)
    - `email_smtp`: ¿Existe cuenta con smtp_pass_enc?
    - `calendar_internal`: ¿Existe tabla calendar_events?
    - `telegram`: ¿Existe bot con bot_token_enc?
    - `email_imap`: ¿Existe cuenta con imap_pass_enc?
- **CRÍTICO**: Retorna HTTP 500 si migrations_ok=false O env_ok=false
- **Verificar**: ¿El health check está retornando 200 OK? ¿Todas las tablas existen?

#### `CONTRACTS/runtime-capabilities.json` ⭐⭐⭐
- **Propósito**: FUENTE DE VERDAD de qué features están disponibles
- **Regla absoluta**:
  - ON (Frontend): Solo muestra UI si flag es `true`
  - LLM (orchestrator): Solo afirma capacidad si flag es `true`
  - Si es `false`: Respuesta obligatoria = "Esta función aún no está disponible."
- **Estado actual**:
  ```json
  {
    "email": {
      "send": true,
      "inbox": true,
      "reply": true,
      "delete": true,
      "mark_read": true,
      "folders": false,
      "drafts": false,
      "attachments": false,
      "contacts": false
    },
    "calendar": {
      "create": false,  ← ⚠️ DEBERÍA SER TRUE
      "list": false,
      "update": false,
      "delete": false
    },
    "documents": {
      "upload": false,
      "read": false,
      "summarize": false,
      "search": false
    },
    "telegram": {
      "send": false,
      "receive": false,
      "list_chats": false
    },
    "memory": {
      "save": true,
      "retrieve": true,
      "search": true
    }
  }
  ```
- **Verificar**: ¿Este archivo se está usando en el código? ¿calendar.create debería ser true?

---

## 🚨 PROBLEMAS DETECTADOS (USUARIO)

### 1. **Calendar Mentira**
- **Reporte**: "Ya te he creado el evento para el miércoles a la 1pm con el dentista Jorge Reyes"
- **Realidad**: Calendario vacío, UI muestra "Sin eventos" + error "ownerUserId es requerido"
- **Causa potencial**:
  - Intent classifier NO detecta "junta", "agendar" como transactional
  - transactionalExecutor NO se ejecuta
  - calendar_create retorna toolFailed:true pero LLM responde "Ya creé el evento"
  - Falta columna notification_minutes (fixed en migración 015)
  - runtime-capabilities.json dice calendar.create:false

### 2. **Email Mentira**
- **Reporte**: AL-E dice "acabo de enviar el correo a pgaribay@gmail.com" (ese email NO existe)
- **Realidad**: No hay logs de envío de email, cuenta no verificada
- **Causa potencial**:
  - Intent classifier NO detecta "envía email" como transactional
  - integrationChecker NO encuentra la cuenta de email configurada
  - LLM inventa emails y acciones sin verificar

### 3. **RAG/Documents No Funciona**
- **Reporte**: "no puedo proporcionar un resumen detallado de los documentos"
- **Realidad**: Usuario subió documentos pero AL-E no los lee
- **Causa potencial**:
  - No existe módulo de RAG implementado
  - No hay tabla ae_chunks o ae_files
  - Orchestrator STEP 4 no retrieves chunks

### 4. **Intent Classifier Roto**
- **Reporte**: Todos los mensajes se clasifican como "stable" (confidence: 0.30)
- **Realidad**: Regex funciona cuando se prueba manualmente, pero NO en runtime
- **Causa potencial**:
  - El mensaje que llega a classifyIntent() NO es el esperado
  - Hay un problema en la compilación TypeScript
  - El orchestrator NO está llamando a classifyIntent correctamente

---

## ✅ CHECKLIST DE AUDITORÍA

### **ORQUESTACIÓN**
- [ ] orchestrator.ts: ¿Llama a classifyIntent con el mensaje correcto?
- [ ] intentClassifier.ts: ¿Los regex TRANSACTIONAL_PATTERNS funcionan?
- [ ] intentClassifier.ts: ¿La lógica de scoring y decisión es correcta?
- [ ] transactionalExecutor.ts: ¿calendar_create inserta en DB correctamente?
- [ ] transactionalExecutor.ts: ¿Retorna provider_event_id?
- [ ] integrationChecker.ts: ¿Verifica email_accounts con owner_user_id correcto?

### **DATABASE**
- [ ] ¿Migración 012 (calendar_events) ejecutada?
- [ ] ¿Migración 014 (email_folders, email_messages, etc) ejecutada?
- [ ] ¿Migración 015 (notification_minutes) ejecutada?
- [ ] ¿Migración 016 (email_rules, email_threads) ejecutada?
- [ ] ¿Tabla calendar_events tiene columna notification_minutes?
- [ ] ¿Existe cuenta en email_accounts con owner_user_id correcto?
- [ ] ¿RLS policies funcionan correctamente?

### **ENDPOINTS**
- [ ] POST /api/calendar/events: ¿Funciona?
- [ ] POST /api/mail/send: ¿Funciona y retorna provider_message_id?
- [ ] GET /_health/full: ¿Retorna 200 OK con todas las verificaciones?

### **CONTRACTS**
- [ ] runtime-capabilities.json: ¿Se usa en el código?
- [ ] runtime-capabilities.json: ¿calendar.create debería ser true?
- [ ] ¿El LLM verifica este archivo antes de responder?

### **LOGS**
- [ ] PM2 logs: ¿Muestran "[INTENT] Classification: transactional"?
- [ ] PM2 logs: ¿Muestran "[CALENDAR_CREATE] Evento creado con ID: ..."?
- [ ] PM2 logs: ¿Muestran "[MAIL] Email enviado con provider_message_id: ..."?

---

## 📋 COMANDOS ÚTILES PARA AUDITORÍA

```bash
# Ver logs en tiempo real
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 "pm2 logs ale-core --lines 100"

# Verificar tabla calendar_events
# En Supabase SQL Editor:
SELECT * FROM calendar_events WHERE owner_user_id = 'aa6e5204-7ff5-47fc-814b-b52e5c6af5d6' LIMIT 10;

# Verificar cuenta de email
SELECT id, from_email, is_active FROM email_accounts WHERE owner_user_id = 'aa6e5204-7ff5-47fc-814b-b52e5c6af5d6';

# Verificar health check
curl http://localhost:3000/_health/full

# Test manual de intent classifier
node -e "
const pattern = /\b(agenda|calendario|calendar|cita|citas|evento|eventos|meet|meets|meeting|meetings|junta|juntas|reunión|reunion|reuniones|videollamada|video call|llamada)\b/i;
const msg = 'Flaca ayúdame a agendar para el 3 de enero junta con Luis';
console.log('Match:', pattern.test(msg));
console.log('Matches:', msg.match(pattern));
"
```

---

## 🎯 RECOMENDACIONES

1. **PRIORIDAD P0**: Arreglar intent classifier
   - Agregar logging detallado en orchestrator.ts antes de llamar classifyIntent
   - Verificar que el mensaje llegue completo y sin modificaciones
   - Verificar que los regex estén compilados correctamente en dist/

2. **PRIORIDAD P0**: Actualizar runtime-capabilities.json
   - Cambiar `calendar.create: true` (ya está implementado)
   - Cambiar `email.send: true` (ya está implementado)
   - Integrar este archivo en orchestrator para que LLM lo verifique antes de responder

3. **PRIORIDAD P1**: Implementar provider_event_id y provider_message_id
   - calendar_create debe retornar event.id en toolResult
   - email_send debe retornar info.messageId en toolResult
   - Orchestrator debe inyectar estos IDs en el system prompt

4. **PRIORIDAD P1**: Completar módulo de Email
   - Implementar 10 endpoints faltantes (ver PROMPT-ALEON-EMAIL-MODULE.md)
   - Ejecutar migración 016 (email_rules, email_threads, email_sync_log)

5. **PRIORIDAD P2**: Implementar RAG/Documents
   - Crear tabla ae_files y ae_chunks
   - Implementar chunking y embedding
   - Integrar en orchestrator STEP 4

---

## 📞 CONTACTO

**Usuario**: Patricia (Patto)  
**Proyecto**: AL-E CORE  
**Servidor**: ubuntu@100.27.201.233 (EC2)  
**Backend**: api.al-eon.com  
**Frontend**: al-eon.com  
**Database**: Supabase (gptwzuqmuvzttajgjrry.supabase.co)  

**PM2 Process**: ale-core (ID: 6)  
**Build**: `npm run build` (TypeScript → dist/)  
**Restart**: `pm2 restart ale-core`  

---

**IMPORTANTE**: Esta auditoría es confidencial. NO compartir con terceros sin autorización de Patricia.
