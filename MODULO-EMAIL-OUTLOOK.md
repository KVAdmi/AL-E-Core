# 📧 MÓDULO EMAIL - DISEÑO COMPLETO ESTILO OUTLOOK

## 🎯 OBJETIVO
Crear un módulo de email **IDÉNTICO a Outlook** con TODAS las carpetas y funciones, integrado 100% con AL-EON para que la asistente pueda ejecutar desde el chat.

---

## 📊 ESTADO ACTUAL DEL BACKEND

### ✅ ENDPOINTS YA IMPLEMENTADOS (15 endpoints)

#### 📤 **ENVÍO DE EMAILS**
1. `POST /api/mail/send` - Enviar email nuevo
2. `POST /api/mail/reply` - Responder email
3. `POST /api/mail/drafts/:id/send` - Enviar borrador

#### 📥 **LECTURA DE EMAILS**
4. `GET /api/mail/inbox/:accountId` - Leer inbox de una cuenta
5. `GET /api/mail/inbox` - Leer inbox de todas las cuentas
6. `GET /api/mail/messages` - Listar mensajes con filtros

#### 🗂️ **GESTIÓN DE CARPETAS**
7. `GET /api/mail/folders/:accountId` - Listar carpetas de una cuenta
8. `POST /api/mail/folders` - Crear carpeta personalizada

#### 📝 **BORRADORES**
9. `GET /api/mail/drafts` - Listar borradores
10. `POST /api/mail/drafts` - Crear borrador
11. `PATCH /api/mail/drafts/:id` - Editar borrador
12. `DELETE /api/mail/drafts/:id` - Eliminar borrador

#### 📎 **ATTACHMENTS**
13. `POST /api/mail/attachments/upload` - Subir archivo
14. `GET /api/mail/attachments/:id/download` - Descargar archivo
15. `DELETE /api/mail/attachments/:id` - Eliminar archivo

#### 🗑️ **ACCIONES SOBRE MENSAJES**
16. `PATCH /api/mail/message/:accountId/:messageUid/read` - Marcar como leído
17. `DELETE /api/mail/message/:accountId/:messageUid` - Eliminar mensaje

---

## 🔴 FUNCIONES FALTANTES (CRÍTICAS PARA OUTLOOK)

### 1. **MOVER MENSAJES ENTRE CARPETAS**
```
POST /api/mail/message/:messageId/move
Body: { folderId: "uuid-destino" }
```
**Acción**: Mover email de Inbox → Spam, Trash, Custom, etc.

### 2. **MARCAR COMO NO LEÍDO**
```
PATCH /api/mail/message/:accountId/:messageUid/unread
```
**Acción**: Cambiar `is_read: true` → `is_read: false`

### 3. **MARCAR COMO IMPORTANTE (STARRED)**
```
PATCH /api/mail/message/:messageId/star
Body: { is_starred: true/false }
```
**Acción**: Toggle ⭐ en mensajes importantes

### 4. **MARCAR COMO SPAM**
```
POST /api/mail/message/:messageId/spam
```
**Acción**: Mover a carpeta Spam + marcar contact como spam

### 5. **ARCHIVAR MENSAJES**
```
POST /api/mail/message/:messageId/archive
```
**Acción**: Mover a carpeta "Archivo" (crear si no existe)

### 6. **BUSCAR EMAILS**
```
GET /api/mail/search
Query: ?q=texto&from=email&subject=asunto&dateFrom=fecha&dateTo=fecha
```
**Acción**: Buscar en todos los campos (subject, body, from, to)

### 7. **LISTAR EMAILS POR CARPETA**
```
GET /api/mail/folders/:folderId/messages
Query: ?limit=50&offset=0&sort=date_desc
```
**Acción**: Ver emails de "Enviados", "Spam", "Papelera", carpetas custom

### 8. **VACIAR PAPELERA**
```
DELETE /api/mail/folders/:folderId/empty
```
**Acción**: Eliminar TODOS los mensajes de la carpeta Trash permanentemente

### 9. **REENVIAR EMAIL (FORWARD)**
```
POST /api/mail/message/:messageId/forward
Body: { to: ["email@domain.com"], message: "texto adicional" }
```
**Acción**: Reenviar email a otra persona manteniendo cuerpo original

### 10. **ETIQUETAR MENSAJES (LABELS/TAGS)**
```
POST /api/mail/message/:messageId/labels
Body: { labels: ["Trabajo", "Urgente", "Cliente X"] }
```
**Acción**: Agregar etiquetas de colores como Gmail/Outlook

### 11. **GESTIÓN DE CONTACTOS**
```
GET /api/mail/contacts - Listar contactos
POST /api/mail/contacts - Crear contacto
PATCH /api/mail/contacts/:id - Editar contacto
DELETE /api/mail/contacts/:id - Eliminar contacto
GET /api/mail/contacts/search?q=nombre - Buscar contactos
```

### 12. **AUTO-SINCRONIZACIÓN IMAP**
```
POST /api/mail/sync/:accountId
```
**Acción**: Forzar sync de IMAP → guardar nuevos emails en `email_messages`

### 13. **RESPONDER A TODOS (REPLY ALL)**
```
POST /api/mail/message/:messageId/reply-all
Body: { message: "respuesta", includeAttachments: true/false }
```
**Acción**: Responder a TO + CC del email original

### 14. **VER THREAD COMPLETO**
```
GET /api/mail/threads/:threadId
```
**Acción**: Ver TODOS los emails de una conversación agrupados

### 15. **CONFIGURAR REGLAS (FILTERS)**
```
POST /api/mail/rules
Body: {
  name: "Mover emails de cliente X a carpeta Y",
  conditions: { from: "cliente@domain.com" },
  actions: { move_to_folder: "uuid-folder" }
}
```

---

## 📋 TABLAS DE BASE DE DATOS

### ✅ TABLAS YA CREADAS (Migración 014)
1. `email_accounts` - Cuentas SMTP/IMAP configuradas
2. `email_folders` - Carpetas (Inbox, Sent, Drafts, Spam, Trash, Custom)
3. `email_messages` - Mensajes guardados con metadata completa
4. `email_drafts` - Borradores sin enviar
5. `email_attachments` - Archivos adjuntos
6. `email_contacts` - Libreta de contactos

### 🔴 TABLAS FALTANTES

#### 1. **email_rules** (Reglas/Filtros automáticos)
```sql
CREATE TABLE email_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  
  -- Condiciones (JSON)
  conditions JSONB NOT NULL,
  -- { "from": "email@domain.com", "subject_contains": "urgente", "has_attachments": true }
  
  -- Acciones (JSON)
  actions JSONB NOT NULL,
  -- { "move_to_folder": "uuid", "mark_as_read": true, "add_label": "Importante" }
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 2. **email_threads** (Hilos de conversación)
```sql
CREATE TABLE email_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  thread_id VARCHAR(255) NOT NULL, -- Message-ID del primer email
  subject VARCHAR(1000),
  participants TEXT[], -- ["email1@domain.com", "email2@domain.com"]
  message_count INTEGER DEFAULT 0,
  last_message_date TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT FALSE,
  is_starred BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, thread_id)
);
```

#### 3. **email_sync_log** (Log de sincronizaciones IMAP)
```sql
CREATE TABLE email_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  sync_type VARCHAR(50) NOT NULL, -- 'manual', 'auto', 'webhook'
  status VARCHAR(50) NOT NULL, -- 'success', 'partial', 'failed'
  messages_fetched INTEGER DEFAULT 0,
  messages_new INTEGER DEFAULT 0,
  messages_updated INTEGER DEFAULT 0,
  errors TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);
```

---

## 🤖 INTEGRACIÓN CON AL-EON (LLM)

### ¿QUÉ DEBE PODER HACER AL-EON?

#### 📥 **LECTURA**
- ✅ "¿Tengo emails nuevos?"
- ✅ "¿Quién me escribió hoy?"
- ✅ "Muéstrame el último email de Juan"
- 🔴 "¿Qué emails tengo en Spam?"
- 🔴 "¿Cuántos emails sin leer tengo?"
- 🔴 "Busca emails de cliente@empresa.com del último mes"
- 🔴 "Muéstrame la conversación completa con María"

#### 📤 **ENVÍO**
- ✅ "Envía un email a juan@empresa.com diciendo..."
- ✅ "Responde al último email de María con..."
- 🔴 "Reenvía el email de Carlos a Pedro"
- 🔴 "Responde a TODOS en el email de la reunión"

#### 🗂️ **ORGANIZACIÓN**
- 🔴 "Mueve el email de X a la carpeta Proyectos"
- 🔴 "Crea una carpeta llamada 'Clientes Importantes'"
- 🔴 "Marca todos los emails de spam@domain.com como spam"
- 🔴 "Archiva todos los emails de hace 6 meses"
- 🔴 "Vacía la papelera"

#### 🏷️ **ETIQUETAS**
- 🔴 "Etiqueta este email como 'Urgente'"
- 🔴 "Marca como importante el email de mi jefe"
- 🔴 "Muéstrame todos los emails etiquetados como 'Trabajo'"

#### 📝 **BORRADORES**
- ✅ "Crea un borrador de email para..."
- ✅ "Edita el borrador de..."
- ✅ "Envía el borrador a juan@empresa.com"

#### 👥 **CONTACTOS**
- 🔴 "¿Cuál es el email de María?"
- 🔴 "Guarda a juan@empresa.com como contacto"
- 🔴 "Muéstrame todos mis contactos frecuentes"

#### ⚙️ **AUTOMATIZACIÓN**
- 🔴 "Crea una regla: todos los emails de cliente@empresa.com van a carpeta 'Cliente X'"
- 🔴 "Sincroniza mi cuenta de email"

---

## 🛠️ PLAN DE IMPLEMENTACIÓN

### **FASE 1: COMPLETAR ENDPOINTS CRÍTICOS** (P0)
1. ✅ Verificar que migración 014 esté ejecutada en Supabase
2. Crear endpoints faltantes:
   - POST /api/mail/message/:messageId/move
   - PATCH /api/mail/message/:messageId/star
   - POST /api/mail/message/:messageId/spam
   - POST /api/mail/message/:messageId/archive
   - POST /api/mail/message/:messageId/forward
   - POST /api/mail/message/:messageId/reply-all
   - GET /api/mail/search
   - GET /api/mail/folders/:folderId/messages
   - GET /api/mail/threads/:threadId
   - DELETE /api/mail/folders/:folderId/empty

### **FASE 2: CONTACTOS** (P1)
1. Implementar CRUD de contactos:
   - GET /api/mail/contacts
   - POST /api/mail/contacts
   - PATCH /api/mail/contacts/:id
   - DELETE /api/mail/contacts/:id
   - GET /api/mail/contacts/search

### **FASE 3: SINCRONIZACIÓN AUTO** (P1)
1. Crear worker que sincronice IMAP cada X minutos
2. Endpoint POST /api/mail/sync/:accountId
3. Tabla email_sync_log

### **FASE 4: REGLAS Y FILTROS** (P2)
1. Crear tabla email_rules
2. Endpoints para CRUD de reglas
3. Procesador automático al recibir emails

### **FASE 5: THREADS** (P2)
1. Crear tabla email_threads
2. Agrupar mensajes por thread_id
3. Endpoint GET /api/mail/threads/:threadId

---

## 📝 SQL PARA EJECUTAR

### **Migration 016: Tablas Faltantes**

```sql
-- =====================================================
-- MIGRATION 016: Email Rules, Threads, Sync Log
-- =====================================================

-- 1) EMAIL RULES
CREATE TABLE IF NOT EXISTS email_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  priority INTEGER DEFAULT 0,
  conditions JSONB NOT NULL,
  actions JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_email_rules_account ON email_rules(account_id);
CREATE INDEX idx_email_rules_active ON email_rules(is_active, priority);

ALTER TABLE email_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own email rules" ON email_rules
FOR ALL USING (owner_user_id = auth.uid());

-- 2) EMAIL THREADS
CREATE TABLE IF NOT EXISTS email_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  thread_id VARCHAR(255) NOT NULL,
  subject VARCHAR(1000),
  participants TEXT[],
  message_count INTEGER DEFAULT 0,
  last_message_date TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT FALSE,
  is_starred BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, thread_id)
);

CREATE INDEX idx_email_threads_account ON email_threads(account_id);
CREATE INDEX idx_email_threads_date ON email_threads(last_message_date DESC);
CREATE INDEX idx_email_threads_unread ON email_threads(owner_user_id, is_read) WHERE is_read = false;

ALTER TABLE email_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own email threads" ON email_threads
FOR ALL USING (owner_user_id = auth.uid());

-- 3) EMAIL SYNC LOG
CREATE TABLE IF NOT EXISTS email_sync_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  sync_type VARCHAR(50) NOT NULL,
  status VARCHAR(50) NOT NULL,
  messages_fetched INTEGER DEFAULT 0,
  messages_new INTEGER DEFAULT 0,
  messages_updated INTEGER DEFAULT 0,
  errors TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX idx_email_sync_log_account ON email_sync_log(account_id);
CREATE INDEX idx_email_sync_log_date ON email_sync_log(started_at DESC);

-- 4) Agregar columna 'folder_id' a email_messages si no existe
-- (Para rastrear en qué carpeta está cada mensaje)
ALTER TABLE email_messages 
ADD COLUMN IF NOT EXISTS current_folder_id UUID REFERENCES email_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_current_folder ON email_messages(current_folder_id);

COMMENT ON TABLE email_rules IS 'Reglas automáticas para filtrar y organizar emails';
COMMENT ON TABLE email_threads IS 'Hilos de conversación agrupados por Message-ID';
COMMENT ON TABLE email_sync_log IS 'Log de sincronizaciones IMAP realizadas';
```

---

## 🎯 RESUMEN PARA AL-EON

**Patricia quiere**:
- Módulo de Email IDÉNTICO a Outlook
- TODAS las carpetas funcionales (Inbox, Sent, Drafts, Spam, Trash, Custom)
- TODAS las acciones: Mover, Archivar, Marcar, Etiquetar, Buscar, Threads
- AL-EON debe poder ejecutar TODO desde el chat
- Backend 100% funcional ANTES de diseño UI

**Ya tenemos**:
- ✅ 17 endpoints básicos (send, inbox, reply, drafts, attachments, folders)
- ✅ 6 tablas (accounts, folders, messages, drafts, attachments, contacts)
- ✅ SMTP/IMAP funcionando
- ✅ Encryption de credenciales
- ✅ RLS policies

**Falta implementar**:
- 🔴 10 endpoints críticos (move, star, spam, archive, forward, reply-all, search, etc)
- 🔴 3 tablas (rules, threads, sync_log)
- 🔴 Worker de sincronización automática
- 🔴 Procesador de reglas automáticas
- 🔴 Integración completa con transactionalExecutor.ts

**Siguiente paso**: Ejecutar Migration 016 y crear los 10 endpoints faltantes.
