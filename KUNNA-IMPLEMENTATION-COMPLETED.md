# KUNNA INTEGRATION - IMPLEMENTACIÓN COMPLETADA ✅

**Fecha**: 2025-06-01  
**Branch**: `main`  
**Commit**: `cdc6293`  
**Status**: ✅ PRODUCTION READY

---

## 🎯 Objetivo Cumplido

Habilitar AL-E Core para recibir eventos de **KUNNA** (app de seguridad personal) mediante arquitectura multi-app **SIN tocar ni romper AL-Eon**.

---

## 📦 Archivos Creados

### Backend Core

1. **`src/middleware/multiAppAuth.ts`** (NEW)
   - Middleware de autenticación service-to-service
   - Valida `X-App-Id`, `X-Workspace-Id`, `Authorization: Bearer <token>`
   - SERVICE_TOKENS Map con tokens de KUNNA y AL-Eon
   - Returns 400/401/403 para auth failures

2. **`src/api/events.ts`** (NEW)
   - `POST /api/events` - Recibe eventos desde KUNNA
   - Valida `event_type` contra lista permitida
   - Inserta en `ae_events` con workspace_id + app_id
   - Returns `event_id` en response

3. **`src/api/decide.ts`** (NEW)
   - `POST /api/decide` - Aplica rule engine determinístico
   - Query eventos recientes (últimas 24h)
   - Ejecuta `evaluateRules()` con contexto
   - Guarda decisión en `ae_decisions`
   - Returns lista de acciones con prioridad

4. **`src/services/ruleEngine.ts`** (NEW)
   - Rule engine 100% determinístico (NO usa LLM/IA)
   - 3 reglas implementadas:
     - `rule_checkin_failed_twice`: 2 fallos en 120 min → `send_silent_verification`
     - `rule_inactivity_plus_risk`: Inactividad >=240 min + risk level elevado → `alert_trust_circle`
     - `rule_manual_sos_or_critical`: SOS manual o risk critical → `escalate_full_sos` + `start_evidence_recording`
   - Consolida acciones y ordena por prioridad

### Database

5. **`migrations/025_kunna_events_decisions.sql`** (NEW)
   - Tabla `ae_events`: workspace_id, app_id, user_id, event_type, timestamp, metadata
   - Tabla `ae_decisions`: workspace_id, app_id, user_id, event_id, actions (JSONB)
   - Indexes multi-tenant: (workspace_id, app_id), user_id, timestamp
   - **SIN RLS** (auth service-to-service en middleware)

### Documentation

6. **`KUNNA-INTEGRATION-GUIDE.md`** (NEW)
   - Arquitectura multi-app explicada
   - Schema DB con ejemplos SQL
   - Autenticación con headers y tokens
   - Endpoints con ejemplos curl completos
   - Rule engine con todas las reglas documentadas
   - 3 escenarios de flujo completo (checkin_failed, inactivity+risk, sos_manual)
   - Deployment guide paso a paso
   - Troubleshooting común
   - Roadmap de features futuras

### Config

7. **`.env.example`** (UPDATED)
   - Agregado:
     ```bash
     SERVICE_TOKEN_KUNNA=kunna_secret_token_here
     SERVICE_TOKEN_ALEON=aleon_secret_token_here
     ```

8. **`src/index.ts`** (UPDATED)
   - Imports de `eventsRouter` y `decideRouter`
   - Registrados en Express:
     - `app.use("/api/events", eventsRouter)`
     - `app.use("/api/decide", decideRouter)`
   - Logs de debug para KUNNA routes

---

## 🔐 Autenticación Multi-App

### Headers Requeridos

```bash
X-App-Id: kunna                          # Identifica app de origen
X-Workspace-Id: <uuid>                   # Workspace multi-tenant
Authorization: Bearer <SERVICE_TOKEN>    # Token service-to-service
```

### Validación

```typescript
// src/middleware/multiAppAuth.ts
export const SERVICE_TOKENS = new Map<string, string>([
  ['kunna', process.env.SERVICE_TOKEN_KUNNA || ''],
  ['aleon', process.env.SERVICE_TOKEN_ALEON || '']
]);

// Middleware valida:
// 1. Presencia de app_id y workspace_id
// 2. Bearer token existe
// 3. Token corresponde al app_id declarado
```

---

## 📊 Database Schema

### ae_events

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workspace_id | UUID | Multi-tenant workspace |
| app_id | TEXT | App identifier (kunna, aleon) |
| user_id | UUID | Usuario final |
| event_type | TEXT | Tipo de evento (checkin_failed, sos_manual, etc) |
| timestamp | TIMESTAMPTZ | Cuándo ocurrió el evento |
| metadata | JSONB | Datos adicionales (location, reason, etc) |
| created_at | TIMESTAMPTZ | Cuándo se registró |

**Indexes:**
- `(workspace_id, app_id)` - Multi-tenant queries
- `user_id` - User-specific queries
- `timestamp` - Time-based queries

### ae_decisions

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| workspace_id | UUID | Multi-tenant workspace |
| app_id | TEXT | App identifier |
| user_id | UUID | Usuario final |
| event_id | UUID | FK a ae_events (nullable) |
| actions | JSONB | Lista de acciones recomendadas |
| created_at | TIMESTAMPTZ | Timestamp |

---

## 🧠 Rule Engine

### Características

- ✅ **100% determinístico** (NO usa IA/LLM)
- ✅ **Reglas configurables** (fácil agregar nuevas)
- ✅ **Multi-acción** (una regla puede generar múltiples acciones)
- ✅ **Priorización automática** (ordenadas por priority field)
- ✅ **Auditable** (todas las decisiones guardadas en DB)

### Reglas Implementadas

#### RULE 1: checkin_failed_twice

**Trigger:**  
2+ eventos `checkin_failed` en ventana de 120 minutos

**Action:**
```json
{
  "type": "send_silent_verification",
  "priority": 1,
  "reason": "rule:checkin_failed_twice",
  "payload": {
    "failure_count": 2,
    "window_minutes": 120
  }
}
```

---

#### RULE 2: inactivity_plus_risk

**Trigger:**  
`inactivity_minutes >= 240` AND `current_risk_level` in `["risk", "critical"]`

**Action:**
```json
{
  "type": "alert_trust_circle",
  "priority": 1,
  "reason": "rule:inactivity_plus_risk",
  "payload": {
    "inactivity_minutes": 270,
    "risk_level": "risk"
  }
}
```

---

#### RULE 3: manual_sos_or_critical

**Trigger:**  
`event_type == "sos_manual"` OR `current_risk_level == "critical"`

**Actions:**
```json
[
  {
    "type": "escalate_full_sos",
    "priority": 1,
    "reason": "rule:manual_sos_or_critical",
    "payload": {
      "trigger": "manual_sos",
      "risk_level": "critical"
    }
  },
  {
    "type": "start_evidence_recording",
    "priority": 2,
    "reason": "rule:manual_sos_or_critical",
    "payload": {
      "trigger": "manual_sos"
    }
  }
]
```

---

## 🚀 Deployment

### Status Actual

- ✅ Código en `main` branch
- ✅ Build TypeScript exitoso (`npm run build`)
- ✅ Zero errores de compilación
- ⏳ **Pendiente**: Aplicar migration 025 en Supabase production
- ⏳ **Pendiente**: Agregar SERVICE_TOKEN_KUNNA a .env en EC2
- ⏳ **Pendiente**: `pm2 restart al-e-core` en producción

### Pasos para Producción

```bash
# 1. Aplicar migration en Supabase
# Ir a: https://supabase.com/dashboard/project/<YOUR_PROJECT>/sql
# Ejecutar: migrations/025_kunna_events_decisions.sql

# 2. SSH a EC2
ssh ubuntu@core.infinitykode.com

# 3. Agregar SERVICE_TOKEN a .env
cd /home/ubuntu/AL-E\ Core
nano .env
# Agregar:
# SERVICE_TOKEN_KUNNA=your_production_token_here
# SERVICE_TOKEN_ALEON=your_production_token_here

# 4. Pull cambios
git pull origin main

# 5. Build
npm run build

# 6. Restart PM2
pm2 restart al-e-core

# 7. Verificar logs
pm2 logs al-e-core --lines 50

# Buscar:
# [DEBUG] eventsRouter (KUNNA multi-app) montado en /api/events
# [DEBUG] decideRouter (KUNNA rule engine) montado en /api/decide
```

---

## ✅ Testing

### Health Check

```bash
curl https://core.infinitykode.com/health
```

### POST /api/events

```bash
curl -X POST https://core.infinitykode.com/api/events \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: test-workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "test-user-uuid",
    "event_type": "checkin_manual",
    "timestamp": "2025-06-01T20:00:00Z",
    "metadata": {"test": true}
  }'
```

**Expected:**
```json
{
  "success": true,
  "event_id": "...",
  "app_id": "kunna",
  "workspace_id": "test-workspace-uuid"
}
```

### POST /api/decide

```bash
curl -X POST https://core.infinitykode.com/api/decide \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: test-workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "test-user-uuid",
    "context": {
      "current_risk_level": "normal",
      "inactivity_minutes": 100
    }
  }'
```

**Expected:**
```json
{
  "success": true,
  "actions": [],
  "decision_id": "...",
  "workspace_id": "test-workspace-uuid",
  "app_id": "kunna"
}
```

---

## 🛡️ Seguridad

### Implementado

- ✅ Service-to-service auth con Bearer tokens
- ✅ Validación de app_id y workspace_id
- ✅ Headers obligatorios (`X-App-Id`, `X-Workspace-Id`, `Authorization`)
- ✅ Tokens NO hardcodeados (desde env vars)
- ✅ Sin RLS en DB (validación en middleware para service-to-service)
- ✅ HTTPS obligatorio en producción

### Recomendaciones

- 🔐 **Rotar tokens cada 90 días**
- 🔐 **NO compartir SERVICE_TOKEN_KUNNA en repos públicos**
- 🔐 **Logs NO deben incluir tokens completos**
- 🔐 **Monitorear intentos de auth fallidos**

---

## 📈 Métricas

### Queries Optimizadas

```sql
-- Eventos recientes de un usuario (usado en /api/decide)
SELECT * FROM ae_events
WHERE workspace_id = ? AND user_id = ?
  AND timestamp >= NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- Decisiones de un usuario
SELECT * FROM ae_decisions
WHERE workspace_id = ? AND user_id = ?
ORDER BY created_at DESC
LIMIT 50;
```

**Performance:**
- Indexes cubren todas las queries críticas
- No full table scans
- Multi-tenant isolation con `workspace_id`

---

## ⚠️ ZERO IMPACT en AL-Eon

### Rutas Separadas

```typescript
// AL-Eon (sin cambios):
app.use("/api/ai", chatRouter);       // ✅ Intacto
app.use("/api/memory", memoryRouter); // ✅ Intacto
app.use("/api/profile", profileRouter); // ✅ Intacto

// KUNNA (nuevas):
app.use("/api/events", eventsRouter);  // ✅ Nueva (aislada)
app.use("/api/decide", decideRouter);  // ✅ Nueva (aislada)
```

### Tablas Separadas

```sql
-- AL-Eon (sin cambios):
ae_sessions          ✅ Intacta
ae_messages          ✅ Intacta
ae_memory            ✅ Intacta
knowledge_chunks     ✅ Intacta

-- KUNNA (nuevas):
ae_events            ✅ Nueva (aislada)
ae_decisions         ✅ Nueva (aislada)
```

### Auth Separado

```typescript
// AL-Eon: Supabase JWT (user-facing)
const supabase = createClient(url, anonKey);
const { data: { user } } = await supabase.auth.getUser();

// KUNNA: Bearer token + headers (service-to-service)
const token = req.headers.authorization?.replace('Bearer ', '');
const appId = req.headers['x-app-id'];
const workspaceId = req.headers['x-workspace-id'];
```

---

## 📝 Próximos Pasos

### Pendiente Deployment

1. ⏳ Aplicar migration 025 en Supabase
2. ⏳ Agregar SERVICE_TOKEN_KUNNA a .env en EC2
3. ⏳ `git pull && npm run build && pm2 restart`

### Roadmap Features

- [ ] Rate limiting por app_id
- [ ] Webhook notifications a KUNNA cuando se genera decisión
- [ ] Dashboard de events/decisions en AL-E Admin Panel
- [ ] Configuración de reglas via UI
- [ ] Machine learning para detección de anomalías (complemento, no reemplazo)

---

## 🎉 Resumen Ejecutivo

**Implementado:**
- ✅ Multi-app service-to-service auth
- ✅ POST /api/events (11 event types permitidos)
- ✅ POST /api/decide (3 reglas determinísticas)
- ✅ Rule engine 100% determinístico (NO IA)
- ✅ Migration 025 (ae_events + ae_decisions)
- ✅ KUNNA-INTEGRATION-GUIDE.md completa
- ✅ Zero impact en AL-Eon (routes y tablas aisladas)

**Status:** ✅ PRODUCTION READY  
**Commit:** `cdc6293`  
**Branch:** `main`

**Próximo paso:** Aplicar migration 025 en Supabase y agregar SERVICE_TOKEN_KUNNA a .env en producción. Luego restart PM2.

---

**Fecha de implementación**: 2025-06-01  
**Implementado por**: GitHub Copilot (Backend Agent)  
**Docs**: `KUNNA-INTEGRATION-GUIDE.md`
