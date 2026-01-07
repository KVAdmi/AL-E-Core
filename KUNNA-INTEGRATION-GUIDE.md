# KUNNA Integration Guide - Multi-App Event System

## Arquitectura

**AL-E Core** ahora soporta **multi-app service-to-service authentication** para recibir eventos de **KUNNA** (app de seguridad personal) sin interferir con la funcionalidad de **AL-Eon** (asistente IA).

### Características

- **Autenticación separada**: Bearer tokens con `X-App-Id` y `X-Workspace-Id` headers
- **Tablas aisladas**: `ae_events` y `ae_decisions` (sin RLS, service-to-service)
- **Rule Engine determinístico**: Sin LLM, solo reglas configurables
- **Zero impact en AL-Eon**: Routes completamente separadas (`/api/events`, `/api/decide`)

## Base de Datos

### Tabla: `ae_events`

```sql
CREATE TABLE ae_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL,
  app_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ae_events_workspace_app ON ae_events(workspace_id, app_id);
CREATE INDEX idx_ae_events_user ON ae_events(user_id);
CREATE INDEX idx_ae_events_timestamp ON ae_events(timestamp);
```

### Tabla: `ae_decisions`

```sql
CREATE TABLE ae_decisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL,
  app_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  event_id UUID REFERENCES ae_events(id),
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ae_decisions_workspace_app ON ae_decisions(workspace_id, app_id);
CREATE INDEX idx_ae_decisions_user ON ae_decisions(user_id);
```

**Aplicar migración:**

```bash
# En Supabase SQL Editor:
# Ejecutar migrations/025_kunna_events_decisions.sql
```

## Autenticación

### Headers requeridos

```bash
X-App-Id: kunna
X-Workspace-Id: <uuid-del-workspace>
Authorization: Bearer <SERVICE_TOKEN_KUNNA>
```

### Variables de entorno

```bash
# .env
SERVICE_TOKEN_KUNNA=your_kunna_secret_token_here
SERVICE_TOKEN_ALEON=your_aleon_secret_token_here
```

## Endpoints

### 1. POST /api/events

Recibe un evento desde KUNNA y lo guarda en `ae_events`.

**Request:**

```bash
curl -X POST https://your-core.com/api/events \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: 123e4567-e89b-12d3-a456-426614174000" \
  -H "Authorization: Bearer kunna_secret_token_here" \
  -d '{
    "user_id": "456e7890-e89b-12d3-a456-426614174000",
    "event_type": "checkin_failed",
    "timestamp": "2025-06-01T17:30:00Z",
    "metadata": {
      "location": {"lat": 40.7128, "lon": -74.0060},
      "reason": "timeout",
      "device_id": "ios-device-123"
    }
  }'
```

**Response (201):**

```json
{
  "success": true,
  "event_id": "789e0123-e89b-12d3-a456-426614174000",
  "app_id": "kunna",
  "workspace_id": "123e4567-e89b-12d3-a456-426614174000"
}
```

**Errores:**

- `400`: Missing fields o invalid `event_type`
- `401`: Missing/invalid Bearer token
- `403`: Invalid app_id or workspace_id
- `500`: Database error

**Event Types permitidos:**

- `checkin_manual`
- `checkin_auto`
- `checkin_failed`
- `location_update`
- `route_started`
- `route_completed`
- `anomaly_detected`
- `risk_level_changed`
- `sos_manual`
- `sos_auto`
- `safe_confirmation`

---

### 2. POST /api/decide

Aplica el rule engine determinístico al contexto del usuario y devuelve acciones recomendadas.

**Request:**

```bash
curl -X POST https://your-core.com/api/decide \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: 123e4567-e89b-12d3-a456-426614174000" \
  -H "Authorization: Bearer kunna_secret_token_here" \
  -d '{
    "user_id": "456e7890-e89b-12d3-a456-426614174000",
    "event_id": "789e0123-e89b-12d3-a456-426614174000",
    "context": {
      "current_risk_level": "alert",
      "last_checkin_at": "2025-06-01T13:00:00Z",
      "inactivity_minutes": 270
    }
  }'
```

**Response (200):**

```json
{
  "success": true,
  "actions": [
    {
      "type": "alert_trust_circle",
      "priority": 1,
      "reason": "rule:inactivity_plus_risk",
      "payload": {
        "inactivity_minutes": 270,
        "risk_level": "alert"
      }
    }
  ],
  "decision_id": "012e3456-e89b-12d3-a456-426614174000",
  "workspace_id": "123e4567-e89b-12d3-a456-426614174000",
  "app_id": "kunna"
}
```

**Errores:**

- `400`: Missing user_id o context inválido
- `401`: Missing/invalid Bearer token
- `403`: Invalid app_id o workspace_id
- `500`: Database error

**Action Types posibles:**

- `send_silent_verification`
- `alert_trust_circle`
- `escalate_full_sos`
- `start_evidence_recording`

---

## Rule Engine

### Reglas Implementadas

#### RULE 1: `checkin_failed_twice`

**Condición:**  
2 o más eventos `checkin_failed` en ventana de 120 minutos.

**Acción:**

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

#### RULE 2: `inactivity_plus_risk`

**Condición:**  
Inactividad >= 240 minutos Y `current_risk_level` en `["risk", "critical"]`.

**Acción:**

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

#### RULE 3: `manual_sos_or_critical`

**Condición:**  
Evento `sos_manual` O `current_risk_level == "critical"`.

**Acciones:**

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

## Ejemplos de Flujo Completo

### Escenario 1: Checkin Fallido

```bash
# 1. Enviar primer checkin_failed
curl -X POST https://core.infinitykode.com/api/events \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "user-uuid",
    "event_type": "checkin_failed",
    "timestamp": "2025-06-01T17:00:00Z",
    "metadata": {"reason": "timeout"}
  }'

# 2. Enviar segundo checkin_failed (dentro de 2 horas)
curl -X POST https://core.infinitykode.com/api/events \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "user-uuid",
    "event_type": "checkin_failed",
    "timestamp": "2025-06-01T18:30:00Z",
    "metadata": {"reason": "no_response"}
  }'

# 3. Solicitar decisión
curl -X POST https://core.infinitykode.com/api/decide \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "user-uuid",
    "context": {
      "current_risk_level": "normal",
      "inactivity_minutes": 90
    }
  }'

# Respuesta esperada:
# {
#   "actions": [
#     {
#       "type": "send_silent_verification",
#       "priority": 1,
#       "reason": "rule:checkin_failed_twice",
#       "payload": {"failure_count": 2, "window_minutes": 120}
#     }
#   ]
# }
```

### Escenario 2: Inactividad + Riesgo Elevado

```bash
curl -X POST https://core.infinitykode.com/api/decide \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "user-uuid",
    "context": {
      "current_risk_level": "risk",
      "last_checkin_at": "2025-06-01T10:00:00Z",
      "inactivity_minutes": 300
    }
  }'

# Respuesta esperada:
# {
#   "actions": [
#     {
#       "type": "alert_trust_circle",
#       "priority": 1,
#       "reason": "rule:inactivity_plus_risk",
#       "payload": {"inactivity_minutes": 300, "risk_level": "risk"}
#     }
#   ]
# }
```

### Escenario 3: SOS Manual

```bash
# 1. Enviar evento sos_manual
curl -X POST https://core.infinitykode.com/api/events \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "user-uuid",
    "event_type": "sos_manual",
    "timestamp": "2025-06-01T19:45:00Z",
    "metadata": {
      "location": {"lat": 40.7128, "lon": -74.0060},
      "trigger_method": "button_long_press"
    }
  }'

# 2. Solicitar decisión con event_id
curl -X POST https://core.infinitykode.com/api/decide \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: workspace-uuid" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d '{
    "user_id": "user-uuid",
    "event_id": "event-uuid-from-step-1",
    "context": {
      "current_risk_level": "critical"
    }
  }'

# Respuesta esperada:
# {
#   "actions": [
#     {
#       "type": "escalate_full_sos",
#       "priority": 1,
#       "reason": "rule:manual_sos_or_critical",
#       "payload": {"trigger": "manual_sos", "risk_level": "critical"}
#     },
#     {
#       "type": "start_evidence_recording",
#       "priority": 2,
#       "reason": "rule:manual_sos_or_critical",
#       "payload": {"trigger": "manual_sos"}
#     }
#   ]
# }
```

---

## Deployment

### 1. Aplicar migración en Supabase

```bash
# En Supabase SQL Editor:
# Ejecutar migrations/025_kunna_events_decisions.sql
```

### 2. Configurar .env en producción

```bash
# En EC2 o donde esté AL-E Core:
nano /home/ubuntu/AL-E\ Core/.env

# Agregar:
SERVICE_TOKEN_KUNNA=your_production_token_here
SERVICE_TOKEN_ALEON=your_production_token_here
```

### 3. Restart PM2

```bash
cd /home/ubuntu/AL-E\ Core
npm run build
pm2 restart al-e-core
pm2 logs al-e-core --lines 100
```

### 4. Verificar logs

```bash
# Buscar en logs:
# [DEBUG] eventsRouter (KUNNA multi-app) montado en /api/events
# [DEBUG] decideRouter (KUNNA rule engine) montado en /api/decide
```

---

## Testing

### Health check

```bash
curl https://core.infinitykode.com/health
# Esperado: {"status":"ok", "service":"al-e-core", ...}
```

### Test POST /api/events

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

### Test POST /api/decide

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

---

## Seguridad

### ⚠️ IMPORTANTE

- **NO compartir SERVICE_TOKEN_KUNNA en repositorios públicos**
- **Rotar tokens cada 90 días**
- **Logs NO deben incluir tokens completos**
- **HTTPS obligatorio en producción**

### Validaciones implementadas

- `validateMultiAppAuth` middleware verifica:
  - Presencia de `X-App-Id` header
  - Presencia de `X-Workspace-Id` header (UUID válido)
  - Bearer token válido contra `SERVICE_TOKENS` Map
  - Token corresponde al app_id declarado

---

## Troubleshooting

### Error 401: Unauthorized

```bash
# Verificar token en .env
grep SERVICE_TOKEN_KUNNA /home/ubuntu/AL-E\ Core/.env

# Verificar headers en curl
curl -v https://core.infinitykode.com/api/events ...
# Debe incluir: Authorization: Bearer <token>
```

### Error 400: Invalid event_type

```bash
# Ver lista permitida:
# checkin_manual, checkin_auto, checkin_failed, location_update,
# route_started, route_completed, anomaly_detected, risk_level_changed,
# sos_manual, sos_auto, safe_confirmation
```

### Error 500: Database error

```bash
# Verificar migración aplicada:
psql <SUPABASE_DB_URL> -c "SELECT * FROM ae_events LIMIT 1;"

# Verificar SUPABASE_SERVICE_ROLE_KEY en .env
```

---

## Roadmap

### Próximas features (no implementadas aún)

- [ ] Rate limiting por app_id
- [ ] Webhook notifications a KUNNA cuando se genera decisión
- [ ] Dashboard de events/decisions en AL-E Admin Panel
- [ ] Configuración de reglas via UI (sin código)
- [ ] Machine learning para detección de anomalías (opcional, sin reemplazar reglas)

---

## Contacto

Para preguntas o soporte:

- **Equipo**: AL-E Core Backend Team
- **Docs**: [KUNNA-INTEGRATION-GUIDE.md](./KUNNA-INTEGRATION-GUIDE.md)
- **Migrations**: `migrations/025_kunna_events_decisions.sql`
- **Code**: `src/api/events.ts`, `src/api/decide.ts`, `src/middleware/multiAppAuth.ts`, `src/services/ruleEngine.ts`

---

**Última actualización**: 2025-06-01  
**Versión**: 1.0.0  
**Status**: ✅ PRODUCTION READY
