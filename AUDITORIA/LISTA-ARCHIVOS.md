# 📦 LISTA DE ARCHIVOS - AUDITORÍA AL-E CORE

## ✅ ARCHIVOS INCLUIDOS (24 archivos)

### 📋 CONTRACTS (1)
- `contracts/runtime-capabilities.json` - Fuente de verdad de features disponibles

### 🗃️ MIGRATIONS (4)
- `migrations/012_calendar_internal.sql` - Calendario interno (calendar_events, notification_jobs)
- `migrations/014_email_extended_tables.sql` - Email completo (6 tablas)
- `migrations/015_add_notification_minutes.sql` - HOTFIX: Columna notification_minutes
- `migrations/016_email_rules_threads_sync.sql` - Email rules, threads, sync log (3 tablas)

### 🧠 ORCHESTRATOR (4)
- `orchestrator/orchestrator.ts` - Pipeline completo de orquestación
- `orchestrator/intentClassifier.ts` - Clasificación de intenciones
- `orchestrator/transactionalExecutor.ts` - Ejecución de acciones transaccionales
- `orchestrator/integrationChecker.ts` - Verificación de integraciones activas

### 🤖 AI (2)
- `src/ai/orchestrator.ts` - (Duplicado, mismo que orchestrator/)
- `src/ai/aleon.ts` - Prompts y personalidad de AL-EON

### 🔧 SERVICES (3)
- `src/services/intentClassifier.ts` - (Duplicado)
- `src/services/transactionalExecutor.ts` - (Duplicado)
- `src/services/integrationChecker.ts` - (Duplicado)

### 🌐 API (3)
- `src/api/calendar.ts` - Endpoints de calendario (5 endpoints)
- `src/api/mail.ts` - Endpoints de email (17 endpoints, 1625 líneas)
- `src/api/health.ts` - Health check bloqueante

### 🔐 MIDDLEWARE & CONFIG (2)
- `src/middleware/auth.ts` - Autenticación JWT
- `src/config/env.ts` - Variables de entorno

### 🗄️ DATABASE (1)
- `src/db/supabase.ts` - Cliente de Supabase

### 📄 DOCUMENTACIÓN (1)
- `README.md` - Guía completa de auditoría con checklist

---

## 🎯 PESO TOTAL
Aproximadamente **50KB** de código TypeScript + SQL

---

## 📦 CÓMO COMPARTIR

1. **Opción 1: ZIP** (Recomendado)
   ```bash
   cd "/Users/pg/Documents/AL-E Core"
   zip -r AUDITORIA-AL-E-CORE.zip AUDITORIA/
   ```
   Enviar el ZIP al programador

2. **Opción 2: GitHub Gist** (Privado)
   - Crear Gist privado en GitHub
   - Subir los archivos más críticos
   - Compartir link con el programador

3. **Opción 3: Google Drive / Dropbox**
   - Subir carpeta AUDITORIA/
   - Compartir con permiso de solo lectura

---

## 🚨 ARCHIVOS CRÍTICOS PARA REVISAR

1. ⭐⭐⭐ `orchestrator/intentClassifier.ts` - ¿Por qué NO detecta transactional?
2. ⭐⭐⭐ `orchestrator/transactionalExecutor.ts` - ¿calendar_create funciona?
3. ⭐⭐⭐ `contracts/runtime-capabilities.json` - ¿Se está usando?
4. ⭐⭐ `src/api/health.ts` - ¿Todas las tablas existen?
5. ⭐⭐ `migrations/015_add_notification_minutes.sql` - ¿Se ejecutó?

---

## ❓ PREGUNTAS PARA EL PROGRAMADOR

1. ¿Por qué el intent classifier clasifica TODO como "stable"?
2. ¿El regex de TRANSACTIONAL_PATTERNS funciona en el código compilado?
3. ¿La migración 015 (notification_minutes) se ejecutó en Supabase?
4. ¿runtime-capabilities.json se está verificando en algún lado?
5. ¿Por qué AL-E dice "Ya creé el evento" cuando toolFailed:true?
6. ¿Existe módulo de RAG/documentos o está completamente faltante?

---

## 📞 SIGUIENTE PASO

Compartir esta carpeta AUDITORIA/ con el programador para que:
1. Revise el flujo de orchestrator → intentClassifier → transactionalExecutor
2. Identifique por qué el regex NO funciona en runtime
3. Verifique que las migraciones estén ejecutadas
4. Proponga solución para integrar runtime-capabilities.json
5. Implemente sistema de provider_event_id/provider_message_id

**Deadline sugerido**: 2-3 días para auditoría completa + reporte
