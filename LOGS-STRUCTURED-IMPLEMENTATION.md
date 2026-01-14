# Sistema de Logs Estructurados - Implementado

**Fecha**: 14 Enero 2026  
**Estado**: ✅ Logger creado, integración parcial completada

---

## 1. LOGGER CENTRALIZADO

**Archivo**: `src/utils/logger.ts`

### Características
- ✅ Formato JSON estructurado
- ✅ Correlación via `request_id` y `meeting_id`
- ✅ Filtrado automático de secrets (passwords, tokens)
- ✅ Stack traces solo en desarrollo
- ✅ Append-only (no modifica logs existentes)

### Métodos Implementados

#### A) Orchestrator Lifecycle
- `aiRequestReceived()` - Entrada de request
- `aiIntentDetected()` - Intent clasificado
- `aiAuthorityResolved()` - Decisión de autoridad
- `aiToolsPlan()` - Planificación de tools
- `aiToolsExecuteStart()` - Inicio de tool
- `aiToolsExecuteResult()` - Resultado de tool
- `aiTruthgateVerdict()` - Decisión del Governor
- `aiResponseSent()` - Respuesta enviada

#### B) Runtime Capabilities
- `runtimeCapabilitiesLoaded()` - Capabilities cargadas
- `runtimeCapabilityBlocked()` - Capability bloqueada

#### C) Meetings
- `meetingsLiveStart()` - Inicio de grabación
- `meetingsLiveChunkReceived()` - Chunk recibido
- `meetingsLiveStop()` - Fin de grabación
- `meetingsQueueEnqueued()` - Job encolado
- `meetingsProcessingStatus()` - Estado del procesamiento
- `meetingsResultServed()` - Resultado servido
- `meetingsSendRequested()` - Envío solicitado
- `meetingsSendResult()` - Resultado de envío

#### D) Email
- `mailAccountsStatus()` - Estado de cuentas
- `mailInboxListResult()` - Resultado de listado
- `mailSendResult()` - Resultado de envío

---

## 2. INTEGRACIÓN COMPLETADA

### ✅ TruthOrchestrator (`src/ai/truthOrchestrator.ts`)

**Logs integrados**:
```typescript
// Entrada
logger.aiRequestReceived({
  request_id: requestId,
  user_id: request.userId,
  workspace_id: request.workspaceId || 'default',
  route: request.route || '/api/ai/truth-chat',
  message_length: request.userMessage.length,
  channel: request.channel || 'api',
});

// Intent detectado
logger.aiIntentDetected({
  request_id: requestId,
  intent: plan.intent,
  required_tools: plan.requiredTools,
  optional_tools: plan.optionalTools || [],
});

// Plan de tools
logger.aiToolsPlan({
  request_id: requestId,
  required_tools: plan.requiredTools,
  tool_count: plan.requiredTools.length,
  runtime_capabilities_snapshot: capabilitiesSnapshot,
});

// Authority resolved
logger.aiAuthorityResolved({
  request_id: requestId,
  authority_current: authorityContext.currentLevel,
  authority_required: plan.authorityRequired,
  confirmation_required: plan.requiresConfirmation,
  user_confirmed: userConfirmed,
  decision: enforcementResult.allowed ? 'approved' : 'blocked',
  reason: enforcementResult.allowed ? undefined : enforcementResult.reason,
});

// Resultado de cada tool
for (const execution of executionReport.executions) {
  logger.aiToolsExecuteResult({
    request_id: requestId,
    tool_name: execution.tool,
    success: execution.success,
    duration_ms: 0,
    evidence_ids: execution.evidenceIds,
    output_size_bytes: execution.output ? JSON.stringify(execution.output).length : undefined,
    error_code: execution.error ? 'execution_failed' : undefined,
    error_message: execution.error || undefined,
  });
}

// Governor verdict
logger.aiTruthgateVerdict({
  request_id: requestId,
  status: governorDecision.status,
  reason: governorDecision.reason,
  failed_tools: governorDecision.failedTools,
  claims_blocked: governorDecision.missingEvidence,
});

// Respuesta enviada
logger.aiResponseSent({
  request_id: requestId,
  status: narrative.wasBlocked ? 'blocked' : 'approved',
  response_type: narrative.wasBlocked ? 'blocked' : 'facts',
  evidence_ids_summary: narrative.evidence,
  latency_ms_total: executionTime,
});
```

### ✅ Meetings API (`src/api/meetings.ts`)

**Logs integrados**:
```typescript
// /live/start
logger.meetingsLiveStart({
  meeting_id: meeting.id,
  title: meeting.title,
  user_id: user.id,
});
```

---

## 3. INTEGRACIÓN PENDIENTE

### ⏳ Meetings API - Endpoints restantes

**Endpoints que necesitan logs**:

#### `/live/:id/chunk`
```typescript
// DESPUÉS DE: await supabase.from('meeting_assets').insert(...)
logger.meetingsLiveChunkReceived({
  meeting_id: meetingId,
  chunk_index: chunkIndex,
  bytes: file.buffer.length,
  duration_ms_estimated: undefined, // TODO: calcular duración
  upload_success: true,
});
```

#### `/live/:id/stop`
```typescript
// DESPUÉS DE: await supabase.from('meetings').update({ status: 'uploaded' })
logger.meetingsLiveStop({
  meeting_id: meetingId,
  total_chunks: chunkCount,
  total_bytes: totalBytes,
  duration_seconds: Math.floor((new Date() - meeting.created_at) / 1000),
});

// Y enqueue job:
logger.meetingsQueueEnqueued({
  meeting_id: meetingId,
  job_id: job.id,
  queue_name: 'meetings',
});
```

#### `/:id/result`
```typescript
// ANTES DE: return res.json({...})
logger.meetingsResultServed({
  meeting_id: meetingId,
  status: transcript && minutes ? 'approved' : 'blocked',
  reason: !transcript ? 'transcript_pending' : !minutes ? 'minutes_pending' : undefined,
  evidence_ids: {
    audio_object_key: meeting.audio_s3_key,
    transcript_id: meeting.id,
    minutes_id: meeting.id,
  },
});
```

#### `/:id/send`
```typescript
// ANTES DE: enviar
logger.meetingsSendRequested({
  meeting_id: meetingId,
  to_count: emailsToSend.length,
  channel: 'email',
});

// DESPUÉS DE: enviar
logger.meetingsSendResult({
  meeting_id: meetingId,
  success: sendResult.success,
  smtp_message_id: sendResult.messageId,
  error_message: sendResult.error,
});
```

### ⏳ Email Tools

**Archivos**:
- `src/services/emailService.ts`
- `src/ai/tools/emailTools.ts`

#### `list_emails` tool
```typescript
// ANTES DE: return result
logger.mailInboxListResult({
  request_id: context.request_id, // Si disponible
  user_id: userId,
  count: emails.length,
  newest_message_id: emails[0]?.message_id,
});
```

#### `send_email` tool
```typescript
// ANTES DE: validar cuentas
const accounts = await getEmailAccounts(userId);
logger.mailAccountsStatus({
  user_id: userId,
  accounts_count: accounts.length,
  blocked_if_zero: accounts.length === 0,
});

// DESPUÉS DE: enviar
logger.mailSendResult({
  request_id: context.request_id,
  user_id: userId,
  success: result.success,
  smtp_message_id: result.messageId,
  to_domain_summary: extractDomainsSummary(to),
  error_code: result.error?.code,
  error_message: result.error?.message,
});
```

### ⏳ Runtime Capabilities

**Archivo**: `src/ai/authority/authorityEngine.ts`

#### Constructor
```typescript
constructor(capabilities: RuntimeCapabilities) {
  this.runtimeCapabilities = capabilities;
  
  // LOG: capabilities cargadas
  logger.runtimeCapabilitiesLoaded({
    source: 'file',
    capabilities: capabilities,
  });
}
```

#### `enforce()` - cuando capability bloqueada
```typescript
if (blockedByCapabilities.length > 0) {
  // LOG cada tool bloqueado
  for (const tool of blockedByCapabilities) {
    logger.runtimeCapabilityBlocked({
      request_id: context.requestId || 'unknown',
      capability_name: this.mapToolToCapability(tool),
      intent: 'unknown', // TODO: pasar intent desde orchestrator
      tool_name: tool,
    });
  }
}
```

---

## 4. EJEMPLO DE EJECUCIÓN COMPLETA

### Request: "envía un email a juan@example.com diciendo hola"

```json
{
  "timestamp": "2026-01-14T20:30:00.000Z",
  "event": "ai.request.received",
  "level": "info",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "user_id": "user_abc123",
  "workspace_id": "default",
  "route": "/api/ai/truth-chat",
  "message_length": 52,
  "channel": "web"
}

{
  "timestamp": "2026-01-14T20:30:00.050Z",
  "event": "ai.intent.detected",
  "level": "info",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "intent": "send_email",
  "required_tools": ["send_email"],
  "optional_tools": []
}

{
  "timestamp": "2026-01-14T20:30:00.080Z",
  "event": "ai.tools.plan",
  "level": "info",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "required_tools": ["send_email"],
  "tool_count": 1,
  "runtime_capabilities_snapshot": {
    "mail.send": true,
    "mail.inbox": true,
    "calendar.create": true,
    "web.search": true
  }
}

{
  "timestamp": "2026-01-14T20:30:00.100Z",
  "event": "ai.authority.resolved",
  "level": "info",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "authority_current": "A0",
  "authority_required": "A2",
  "confirmation_required": true,
  "user_confirmed": false,
  "decision": "blocked",
  "reason": "confirmation_required"
}

{
  "timestamp": "2026-01-14T20:30:00.120Z",
  "event": "ai.truthgate.verdict",
  "level": "warn",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "blocked",
  "reason": "confirmation_required"
}

{
  "timestamp": "2026-01-14T20:30:00.140Z",
  "event": "ai.response.sent",
  "level": "info",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "blocked",
  "response_type": "blocked",
  "latency_ms_total": 140
}
```

### Request confirmado: "sí, confirmo"

```json
{
  "timestamp": "2026-01-14T20:30:30.000Z",
  "event": "ai.request.received",
  "level": "info",
  "request_id": "660f9500-f39c-52e5-b827-557766551111",
  "user_id": "user_abc123",
  "workspace_id": "default",
  "route": "/api/ai/truth-chat",
  "message_length": 12,
  "channel": "web"
}

{
  "timestamp": "2026-01-14T20:30:30.100Z",
  "event": "ai.authority.resolved",
  "level": "info",
  "request_id": "660f9500-f39c-52e5-b827-557766551111",
  "authority_current": "A2",
  "authority_required": "A2",
  "confirmation_required": true,
  "user_confirmed": true,
  "decision": "approved"
}

{
  "timestamp": "2026-01-14T20:30:30.200Z",
  "event": "mail.accounts.status",
  "level": "info",
  "user_id": "user_abc123",
  "accounts_count": 1,
  "blocked_if_zero": false
}

{
  "timestamp": "2026-01-14T20:30:30.500Z",
  "event": "ai.tools.execute.result",
  "level": "info",
  "request_id": "660f9500-f39c-52e5-b827-557766551111",
  "tool_name": "send_email",
  "success": true,
  "duration_ms": 300,
  "evidence_ids": {
    "messageId": "<abc123@smtp.gmail.com>"
  },
  "output_size_bytes": 456
}

{
  "timestamp": "2026-01-14T20:30:30.520Z",
  "event": "mail.send.result",
  "level": "info",
  "request_id": "660f9500-f39c-52e5-b827-557766551111",
  "user_id": "user_abc123",
  "success": true,
  "smtp_message_id": "<abc123@smtp.gmail.com>",
  "to_domain_summary": "example.com"
}

{
  "timestamp": "2026-01-14T20:30:30.550Z",
  "event": "ai.truthgate.verdict",
  "level": "info",
  "request_id": "660f9500-f39c-52e5-b827-557766551111",
  "status": "approved"
}

{
  "timestamp": "2026-01-14T20:30:30.600Z",
  "event": "ai.response.sent",
  "level": "info",
  "request_id": "660f9500-f39c-52e5-b827-557766551111",
  "status": "approved",
  "response_type": "facts",
  "evidence_ids_summary": {
    "messageId": "<abc123@smtp.gmail.com>"
  },
  "latency_ms_total": 600
}
```

---

## 5. HELPERS DISPONIBLES

### `generateRequestId()`
Genera UUID v4 para correlación.

```typescript
import { generateRequestId } from '../utils/logger';
const requestId = generateRequestId();
```

### `extractDomain(email: string)`
Extrae dominio de email.

```typescript
import { extractDomain } from '../utils/logger';
const domain = extractDomain('juan@example.com'); // "example.com"
```

### `extractDomainsSummary(emails: string[])`
Extrae dominios únicos de múltiples emails.

```typescript
import { extractDomainsSummary } from '../utils/logger';
const summary = extractDomainsSummary([
  'juan@gmail.com',
  'maria@gmail.com',
  'pedro@outlook.com'
]);
// "gmail.com, outlook.com"
```

---

## 6. REGLAS DE SEGURIDAD

### Campos filtrados automáticamente:
- `password`
- `token`
- `jwt`
- `authorization`
- `secret`
- `api_key`
- `smtp_pass`
- `imap_pass`
- `pass_enc`

### Stack traces:
- **Desarrollo**: Incluidos completos
- **Producción**: Removidos automáticamente

---

## 7. PRÓXIMOS PASOS

1. ✅ Logger creado
2. ✅ TruthOrchestrator integrado
3. ✅ Meetings `/live/start` integrado
4. ⏳ Completar integración en meetings endpoints restantes
5. ⏳ Integrar en email tools
6. ⏳ Integrar en runtime capabilities carga
7. ⏳ Testing E2E con logs completos
8. ⏳ Configurar agregación en producción (CloudWatch, Datadog, etc.)

---

## 8. VALIDACIÓN DEMO MAÑANA

**Request para demo**:
```bash
curl -X POST http://localhost:8080/api/meetings/live/start \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Demo Meeting",
    "description": "Testing logs",
    "happened_at": "2026-01-15T10:00:00Z"
  }'
```

**Logs esperados**:
```json
{
  "timestamp": "2026-01-15T10:00:00.123Z",
  "event": "meetings.live.start",
  "level": "info",
  "meeting_id": "meeting_uuid",
  "title": "Demo Meeting",
  "user_id": "user_id"
}
```

---

**LISTO PARA VALIDACIÓN** ✅
