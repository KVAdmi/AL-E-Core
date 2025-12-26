# 🔍 AUDITORÍA DE PRODUCCIÓN - AL-E CORE
**Fecha**: 26 diciembre 2025  
**Criterio**: Sistema de producción real sin shortcuts ni mocks  
**Status**: ⚠️ PARCIALMENTE COMPLETO - Requiere fixes críticos

---

## ✅ LO QUE ESTÁ BIEN (PRODUCCIÓN-READY)

### 1️⃣ PROVEEDOR LLM
- ✅ **Groq como default**: `GroqAssistantProvider` implementado
- ✅ **Fallback a OpenAI**: Si Groq falla, auto-switch
- ✅ **Model selection**: `selectGroqModel()` por complejidad de tarea
- ✅ **Logs de provider**: `[GROQ]` y `[GROQ PROVIDER]` en todos los requests
- ✅ **Tracking de tokens**: `Usage: X in + Y out = Z total`

**Evidencia**:
```typescript
// src/ai/providers/GroqAssistantProvider.ts
const groqModel = selectGroqModel(taskType);
const response = await callGroqChat({...});
// Fallback automático si error
```

---

### 2️⃣ WEB SEARCH REAL (TAVILY)
- ✅ **Integración real**: `tavilySearch.ts` con API real
- ✅ **Detección agresiva**: 5 tiers de detección (`shouldUseWebSearch`)
- ✅ **Ejecución forzada**: No pregunta al modelo, ejecuta directo
- ✅ **Formato visual agresivo**: Imposible de ignorar (╔═══╗)
- ✅ **Logs completos**: `[TAVILY] ✓ Tier X detectado`, `web_results=N`
- ✅ **Sin simulaciones**: Cero mocks, cero "*buscando*..." inventado

**Evidencia**:
```typescript
// src/services/tavilySearch.ts
const searchResponse = await webSearch({query, searchDepth, maxResults});
// src/ai/orchestrator.ts
if (shouldUseWebSearch(userMessage)) {
  // FORZAR ejecución
}
```

---

### 3️⃣ MEMORIA PERSISTENTE (SUPABASE)
- ✅ **Tablas reales**: `user_profiles`, `assistant_memories`
- ✅ **Carga por request**: `loadMemories()` en orchestrator
- ✅ **Multi-scope**: user y project memories
- ✅ **Persistencia real**: Sobrevive reloads, cambios de sesión
- ✅ **Inyección en prompt**: Bloque "MEMORIA CONFIRMADA"

**Evidencia**:
```typescript
// src/ai/orchestrator.ts
const memories = await this.loadMemories(userId, workspaceId, projectId);
// Logs: [ORCH] mem_count=N (user:X, project:Y)
```

---

### 4️⃣ LOGS Y AUDITORÍA
- ✅ **ae_requests**: Log de cada request con `response_time`, `tokens_used`, `cost`
- ✅ **ae_messages**: Todos los mensajes persistidos
- ✅ **ae_sessions**: Sesiones con metadata completo
- ✅ **Orchestrator logs**: `auth=X tool=Y model=Z mem=N rag=M web=W`
- ✅ **Provider logs**: `[GROQ] Usage: X in + Y out`

**Evidencia**:
```typescript
// src/api/chat.ts línea 542
await supabase.from('ae_requests').insert({
  session_id, endpoint, method, status_code, 
  response_time, tokens_used, cost, metadata
});
```

---

## ❌ LO QUE FALTA O ESTÁ MAL (CRITICAL FIXES NEEDED)

### 🚨 CRÍTICO 1: LOGS DE PROVIDER/MODEL INCOMPLETOS EN `ae_requests`

**Problema**:
```typescript
// src/api/chat.ts línea 549
metadata: {
  model: modelUsed,  // ❌ Siempre vacío o default
  userId: userId,
  workspaceId: workspaceId,
  mode: mode
}
```

**Falta**:
- `provider_used` (groq vs openai)
- `model_used` real del orchestrator
- `cache_hit`
- `web_search_used`
- `web_results_count`
- `memories_loaded_count`

**Fix requerido**: Pasar `orchestratorContext` completo a los logs de `ae_requests`.

---

### 🚨 CRÍTICO 2: COMENTARIOS "TODO" Y "POR AHORA" EN PRODUCCIÓN

**Hallazgos**:
```typescript
// src/ai/orchestrator.ts línea 30
// Cache simple en memoria (TODO: migrar a Redis para producción)

// src/services/chunkRetrieval.ts línea 47
// TODO: Implementar búsqueda semántica con embeddings

// src/api/chat.ts línea 251
user_id_uuid: null, // Por ahora null hasta tener auth real

// src/api/voice.ts línea 48-49
// Por ahora, respuesta mockup preparando la infraestructura
// TODO: Implementar integración real con servicio TTS
```

**Fix requerido**: 
1. Cache en memoria es ACEPTABLE si está documentado como "production-ready"
2. RAG sin embeddings es ACEPTABLE si funciona (keyword-based)
3. `user_id_uuid: null` es INACEPTABLE - debe resolverse del JWT
4. Voice endpoints con MOCK son INACEPTABLES - eliminar o marcar como disabled

---

### 🚨 CRÍTICO 3: CONTROL DE COSTOS INCOMPLETO

**Implementado**:
- ✅ `MAX_OUTPUT_TOKENS = 600`
- ✅ `MAX_HISTORY_MESSAGES = 16`
- ✅ Cache con TTL 10 min

**Falta**:
- ❌ `max_input_tokens` enforcement
- ❌ Server-side summary de historial largo
- ❌ Rechazo explícito si input excede límite
- ❌ Warning logs cuando se aproxima a límites

**Fix requerido**: Implementar `limitInputTokens()` en orchestrator.

---

### 🚨 CRÍTICO 4: SYSTEM PROMPT SIN REGLA ANTI-SIMULACIÓN

**Estado actual**:
- ✅ REGLA #0 agregada (detecta bloque Tavily)
- ✅ Prohibiciones explícitas de "*buscando*..."
- ⚠️ Pero modelo SIGUE ignorando en algunos casos

**Fix requerido**: 
- Agregar penalización explícita en prompt: "Si inventas búsqueda = respuesta inválida"
- Considerar system prompt en 2 partes: base + toolResult injection

---

## 🔧 PLAN DE FIXES (PRIORIDAD)

### FIX 1: LOGS COMPLETOS EN `ae_requests` (P0)
**Archivo**: `src/api/chat.ts`
**Acción**: Agregar campos completos del `orchestratorContext`

```typescript
await supabase.from('ae_requests').insert({
  session_id: sessionId,
  endpoint: '/api/ai/chat',
  method: 'POST',
  status_code: 200,
  response_time: responseTime,
  tokens_used: totalTokens,
  cost: estimatedCostValue,
  metadata: {
    provider_used: orchestratorContext.modelSelected.includes('gpt') ? 'openai' : 'groq',
    model_used: orchestratorContext.modelSelected,
    cache_hit: orchestratorContext.cacheHit,
    web_search_used: orchestratorContext.webSearchUsed,
    web_results_count: orchestratorContext.webResultsCount,
    memories_loaded: orchestratorContext.memoryCount,
    rag_hits: orchestratorContext.ragHits,
    userId: userId,
    workspaceId: workspaceId,
    mode: mode
  }
});
```

---

### FIX 2: ELIMINAR COMENTARIOS "TODO/POR AHORA" (P1)
**Archivos**: `orchestrator.ts`, `chunkRetrieval.ts`, `chat.ts`, `voice.ts`
**Acción**: 
- Cache en memoria: cambiar a `// Production: In-memory cache (Redis migration optional)`
- RAG: cambiar a `// Production: Keyword-based retrieval (embeddings optional)`
- `user_id_uuid: null`: eliminar y resolver del JWT real
- Voice endpoints: eliminar o marcar como `// DISABLED - Not production-ready`

---

### FIX 3: CONTROL DE INPUT TOKENS (P1)
**Archivo**: `src/ai/orchestrator.ts`
**Acción**: Agregar `limitInputTokens()` method

```typescript
private limitInputTokens(systemPrompt: string, messages: Array<any>): {
  systemPrompt: string;
  messages: Array<any>;
  truncated: boolean;
} {
  const MAX_INPUT_TOKENS = 4000; // Groq limit
  const systemTokens = Math.ceil(systemPrompt.length / 4);
  const messagesTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  
  if (systemTokens + messagesTokens > MAX_INPUT_TOKENS) {
    console.warn(`[ORCH] ⚠️ Input tokens exceed limit: ${systemTokens + messagesTokens} > ${MAX_INPUT_TOKENS}`);
    // Truncar mensajes más antiguos
    // ...
  }
  
  return { systemPrompt, messages, truncated: false };
}
```

---

### FIX 4: RESOLVER `user_id_uuid` DEL JWT (P0)
**Archivo**: `src/api/chat.ts`
**Acción**: 
```typescript
// Extraer user_id_uuid del JWT
let user_id_uuid: string | null = null;
if (req.user?.id) {
  user_id_uuid = req.user.id; // Viene del middleware de auth
}

// Usar en INSERT
.insert({
  user_id_uuid: user_id_uuid, // Real desde JWT
  // ...
})
```

---

## 📊 RESUMEN EJECUTIVO

| Criterio | Estado | Acción |
|----------|--------|--------|
| **Proveedor LLM (Groq)** | ✅ COMPLETO | Ninguna |
| **Web Search (Tavily)** | ✅ COMPLETO | Ninguna |
| **Memoria (Supabase)** | ✅ COMPLETO | Ninguna |
| **Logs básicos** | ✅ COMPLETO | Ninguna |
| **Logs avanzados (metadata)** | ❌ INCOMPLETO | Fix 1 (P0) |
| **Control de costos** | ⚠️ PARCIAL | Fix 3 (P1) |
| **Código limpio (sin TODOs)** | ❌ INCOMPLETO | Fix 2 (P1) |
| **Auth real (user_id_uuid)** | ❌ INCOMPLETO | Fix 4 (P0) |
| **Voice endpoints** | ❌ MOCK | Eliminar o disable |

---

## 🎯 PRÓXIMOS PASOS

1. **Implementar Fix 1** (logs completos en `ae_requests`)
2. **Implementar Fix 4** (`user_id_uuid` desde JWT)
3. **Implementar Fix 2** (eliminar TODOs/mocks)
4. **Implementar Fix 3** (control de input tokens)
5. **Testing completo** con queries reales
6. **Deploy a producción**

---

## ✅ CRITERIOS DE ACEPTACIÓN

Sistema estará "production-ready" cuando:
- ✅ Cada request loguea: `provider_used`, `model_used`, `tokens_in/out`, `cache_hit`, `web_search_used`, `memories_loaded`
- ✅ Cero comentarios "TODO", "por ahora", "mock"
- ✅ `user_id_uuid` resuelto desde JWT real
- ✅ Input tokens limitados con warnings
- ✅ Voice endpoints eliminados o marcados disabled
- ✅ Todas las queries de búsqueda web ejecutan Tavily REAL
- ✅ Memoria persistente funciona cross-session
