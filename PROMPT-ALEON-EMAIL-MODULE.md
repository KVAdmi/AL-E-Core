# 📧 PROMPT PARA AL-EON - MÓDULO EMAIL OUTLOOK

Hola AL-EON,

Necesito que implementes un **módulo de Email COMPLETO** idéntico a Microsoft Outlook dentro de AL-E CORE. Ya tenemos endpoints básicos pero faltan funciones críticas.

---

## 🎯 LO QUE YA TENEMOS (Backend)

### ✅ Endpoints funcionando (17):
- Enviar email, responder, leer inbox
- Crear/editar/eliminar borradores
- Subir/descargar attachments
- Listar carpetas, crear carpetas custom
- Marcar como leído, eliminar mensajes

### ✅ Tablas en DB (6):
- `email_accounts` - Cuentas SMTP/IMAP
- `email_folders` - Carpetas (Inbox, Sent, Drafts, Spam, Trash + custom)
- `email_messages` - Mensajes guardados
- `email_drafts` - Borradores
- `email_attachments` - Archivos adjuntos
- `email_contacts` - Contactos

---

## 🔴 LO QUE FALTA IMPLEMENTAR

### **FASE 1: 10 Endpoints Críticos** (P0)

1. **POST /api/mail/message/:messageId/move**
   - Body: `{ folderId: "uuid-destino" }`
   - Mover email entre carpetas (Inbox → Spam, Trash, Custom, etc)
   - Actualizar `current_folder_id` en `email_messages`

2. **PATCH /api/mail/message/:messageId/star**
   - Body: `{ is_starred: true/false }`
   - Toggle ⭐ en mensajes importantes

3. **POST /api/mail/message/:messageId/spam**
   - Mover a carpeta Spam automáticamente
   - Opcional: Marcar remitente como spam en `email_contacts`

4. **POST /api/mail/message/:messageId/archive**
   - Buscar o crear carpeta "Archivo"
   - Mover mensaje ahí

5. **POST /api/mail/message/:messageId/forward**
   - Body: `{ to: ["email@domain.com"], message: "texto adicional" }`
   - Reenviar email manteniendo cuerpo original + attachments

6. **POST /api/mail/message/:messageId/reply-all**
   - Body: `{ message: "respuesta" }`
   - Responder a TO + CC del email original

7. **GET /api/mail/search**
   - Query: `?q=texto&from=email&subject=asunto&dateFrom=fecha&dateTo=fecha&folderId=uuid`
   - Buscar en `email_messages` usando ILIKE en subject, body_text, from_address

8. **GET /api/mail/folders/:folderId/messages**
   - Query: `?limit=50&offset=0&sort=date_desc&unread_only=false`
   - Listar emails de UNA carpeta específica (Enviados, Spam, Papelera, etc)

9. **DELETE /api/mail/folders/:folderId/empty**
   - Eliminar TODOS los mensajes de la carpeta (para Trash)
   - Validar que sea carpeta "Trash" o custom

10. **GET /api/mail/threads/:threadId**
    - Listar TODOS los emails de una conversación agrupados
    - Ordenar por date ASC
    - JOIN con `email_messages` WHERE thread_id = :threadId

### **FASE 2: Endpoints de Contactos** (P1)

11. **GET /api/mail/contacts**
    - Query: `?limit=50&offset=0&favorites_only=false`
    
12. **POST /api/mail/contacts**
    - Body: `{ email_address, display_name, first_name, last_name, company, phone, notes, tags }`
    
13. **PATCH /api/mail/contacts/:id**
    - Body: Campos a actualizar
    
14. **DELETE /api/mail/contacts/:id**
    
15. **GET /api/mail/contacts/search**
    - Query: `?q=nombre_o_email`

### **FASE 3: Sincronización IMAP** (P1)

16. **POST /api/mail/sync/:accountId**
    - Forzar sync manual de IMAP
    - Guardar nuevos emails en `email_messages`
    - Registrar en `email_sync_log`
    - Retornar: `{ messages_fetched, messages_new, duration_ms }`

### **FASE 4: Reglas/Filtros** (P2)

17. **GET /api/mail/rules**
18. **POST /api/mail/rules**
19. **PATCH /api/mail/rules/:id**
20. **DELETE /api/mail/rules/:id**

---

## 📋 MIGRACIONES A EJECUTAR

### **Migration 016** (Ya creada en `migrations/016_email_rules_threads_sync.sql`)

Crear 3 tablas nuevas:
1. **email_rules** - Reglas automáticas con conditions (JSONB) y actions (JSONB)
2. **email_threads** - Hilos de conversación agrupados
3. **email_sync_log** - Log de sincronizaciones IMAP

También agrega columna `current_folder_id` a `email_messages` para rastrear carpeta actual.

**INSTRUCCIÓN**: Yo ejecutaré esta migración en Supabase. Tú solo implementa los endpoints.

---

## 🤖 INTEGRACIÓN CON transactionalExecutor.ts

AL-EON debe poder ejecutar desde el chat:

### **Comandos que YA funcionan:**
- ✅ "Envía un email a juan@empresa.com diciendo..."
- ✅ "Responde al último email de María con..."
- ✅ "¿Tengo emails nuevos?"
- ✅ "Crea un borrador para..."

### **Comandos que DEBEN funcionar después:**
- 🔴 "Mueve el email de X a la carpeta Proyectos"
- 🔴 "Marca como importante el email de mi jefe"
- 🔴 "Reenvía el email de Carlos a Pedro"
- 🔴 "Responde a todos en el email de la reunión"
- 🔴 "Busca emails de cliente@empresa.com del último mes"
- 🔴 "¿Qué emails tengo en Spam?"
- 🔴 "Vacía la papelera"
- 🔴 "Muéstrame la conversación completa con María"
- 🔴 "Archiva todos los emails de hace 3 meses"
- 🔴 "Crea una carpeta llamada 'Proyectos Importantes'"
- 🔴 "¿Cuál es el email de contacto de Juan Pérez?"
- 🔴 "Guarda a maria@empresa.com como contacto favorito"

**ACTUALIZAR**: `src/services/transactionalExecutor.ts` para detectar estos intents y llamar a los endpoints correctos.

---

## 📝 CHECKLIST DE IMPLEMENTACIÓN

### FASE 1 (P0) - Endpoints Críticos
- [ ] POST /api/mail/message/:messageId/move
- [ ] PATCH /api/mail/message/:messageId/star
- [ ] POST /api/mail/message/:messageId/spam
- [ ] POST /api/mail/message/:messageId/archive
- [ ] POST /api/mail/message/:messageId/forward
- [ ] POST /api/mail/message/:messageId/reply-all
- [ ] GET /api/mail/search
- [ ] GET /api/mail/folders/:folderId/messages
- [ ] DELETE /api/mail/folders/:folderId/empty
- [ ] GET /api/mail/threads/:threadId

### FASE 2 (P1) - Contactos
- [ ] GET /api/mail/contacts
- [ ] POST /api/mail/contacts
- [ ] PATCH /api/mail/contacts/:id
- [ ] DELETE /api/mail/contacts/:id
- [ ] GET /api/mail/contacts/search

### FASE 3 (P1) - Sync
- [ ] POST /api/mail/sync/:accountId
- [ ] Worker automático (cada 5 minutos)

### FASE 4 (P2) - Reglas
- [ ] CRUD completo de email_rules
- [ ] Procesador automático al recibir emails

### Integración LLM
- [ ] Actualizar transactionalExecutor.ts con nuevos comandos
- [ ] Actualizar intentClassifier.ts con patrones de email avanzados
- [ ] Actualizar prompt de AL-EON con capacidades de email

---

## 🎯 ESTRUCTURA DE CÓDIGO SUGERIDA

Agregar en `src/api/mail.ts` (después de los endpoints existentes):

```typescript
// ═══════════════════════════════════════════════════════════════
// MOVER MENSAJE ENTRE CARPETAS
// ═══════════════════════════════════════════════════════════════
router.post('/message/:messageId/move', async (req, res) => {
  // TODO: Implementar
  // 1. Validar que messageId y folderId existan
  // 2. Verificar owner_user_id
  // 3. UPDATE email_messages SET current_folder_id = :folderId WHERE id = :messageId
  // 4. Retornar mensaje actualizado
});

// ═══════════════════════════════════════════════════════════════
// MARCAR COMO IMPORTANTE (STAR)
// ═══════════════════════════════════════════════════════════════
router.patch('/message/:messageId/star', async (req, res) => {
  // TODO: Implementar
  // 1. Validar messageId existe
  // 2. UPDATE email_messages SET is_starred = :value WHERE id = :messageId
  // 3. Retornar mensaje actualizado
});

// ... continuar con los demás endpoints
```

---

## 🔒 REGLAS ABSOLUTAS

1. **SIEMPRE validar `owner_user_id`** en TODAS las queries (RLS ya lo hace pero doble check)
2. **SIEMPRE retornar provider_message_id** cuando se envíe/reenvíe email
3. **SIEMPRE usar transacciones** para operaciones múltiples (ej: vaciar papelera)
4. **SIEMPRE registrar logs** con formato `[MAIL] Acción - User: {userId}, Result: {ok/error}`
5. **NO usar mocks/stubs** - todo debe ser funcional REAL
6. **Seguir el patrón existente** en mail.ts para consistencia

---

## 📤 ENTREGABLES

1. **Código**: Todos los endpoints implementados en `src/api/mail.ts`
2. **Tests**: Ejemplos de `curl` para cada endpoint
3. **Logs**: Mostrar logs de PM2 de ejecución exitosa
4. **DB Query**: SELECT count(*) de cada tabla después de probar
5. **Commit**: Hash del commit con mensaje descriptivo
6. **Build**: Output de `npm run build` sin errores
7. **PR Checklist**: Marcar todos los ítems cumplidos

---

## ❓ PREGUNTAS PARA TI (AL-EON)

1. ¿Ya entendiste TODO lo que falta implementar?
2. ¿Necesitas alguna aclaración sobre las tablas o endpoints?
3. ¿Tienes dudas sobre cómo integrar con transactionalExecutor.ts?
4. ¿Prefieres implementar FASE 1 completa primero, o endpoint por endpoint?

**Mi recomendación**: Implementa los 10 endpoints de FASE 1 de una sola vez, luego hacemos push, build, restart y pruebo TODO junto.

---

## 📚 ARCHIVOS DE REFERENCIA

- Ver diseño completo: `/MODULO-EMAIL-OUTLOOK.md`
- Migración a ejecutar: `/migrations/016_email_rules_threads_sync.sql`
- Endpoints actuales: `/src/api/mail.ts` (líneas 1-1625)
- Transactional executor: `/src/services/transactionalExecutor.ts`
- Intent classifier: `/src/services/intentClassifier.ts`

---

**¿Listo para implementar?** 🚀

Confirma que entendiste y empezamos con FASE 1.
