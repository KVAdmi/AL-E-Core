# 🎤 AUDITORÍA VOZ - 19 ENERO 2026

## RESUMEN EJECUTIVO

**Estado:** ❌ **GUARDRAIL DE VOZ NO SE ACTIVA EN PRODUCCIÓN**

El código tiene guardrails implementados pero la arquitectura **no los dispara** porque el `route` no se propaga correctamente entre capas.

---

## 1️⃣ LO BUENO: GUARDRAIL EXISTE

### Ubicación
`src/ai/simpleOrchestrator.ts` líneas 203-211

### Código
```typescript
const isVoiceMode = request.route?.includes('/voice') || 
                    request.userMessage?.toLowerCase().includes('[voice]') ||
                    false;

if (isVoiceMode) {
  console.warn('[GUARDRAIL] 🚫 OPENAI DISABLED - voice_handsfree mode active');
  console.warn('[GUARDRAIL] STT: Groq Whisper ONLY');
  console.warn('[GUARDRAIL] LLM: Groq ONLY');
  console.warn('[GUARDRAIL] Referee: OFF');
  openaiBlocked = true;
}
```

✅ **Política clara:** OpenAI bloqueado en modo voz

---

## 2️⃣ LO MALO: GUARDRAIL NUNCA SE DISPARA

### Flujo actual (ROTO)

```
Frontend mic → POST /api/voice/chat
              ↓
              voice.ts llama POST /api/ai/chat/v2 (internal)
              ↓
              chat.ts llama orchestrator.orchestrate({
                userId,
                userMessage,
                sessionId,
                // ❌ NO PASA route: '/voice'
              })
              ↓
              orchestrator: request.route === undefined
              ↓
              isVoiceMode = false
              ↓
              ❌ GUARDRAIL NO SE ACTIVA
```

### Evidencia

**1. voice.ts línea 485-496:**
```typescript
const chatResponse = await fetch(`http://localhost:${PORT}/api/ai/chat/v2`, {
  headers: { 
    'x-channel': 'voice'  // ← Solo header, no route
  },
  body: JSON.stringify({
    voice: true,  // ← Flag, pero orchestrator no lo usa
    message: transcript
  })
});
```

**2. chat.ts:**
```bash
$ grep -n "route:" src/api/chat.ts
# No matches found
```

❌ `chat.ts` **NO propaga `route`** al orchestrator

**3. Orchestrator línea 203:**
```typescript
const isVoiceMode = request.route?.includes('/voice')  // ← undefined siempre
```

---

## 3️⃣ TOOLS DE MEETINGS: PLACEHOLDER (NO OPERATIVOS)

### `start_live_meeting` (toolRouter.ts línea 400-420)
```typescript
case 'start_live_meeting':
  return {
    success: true,
    data: {
      instruction: 'Este tool se ejecuta desde el frontend. 
                    El backend recibirá chunks de audio vía 
                    POST /api/meetings/live/:id/chunk'
    }
  };
```

❌ **No es un pipeline real**, solo un mensaje

### `search_meetings` (toolRouter.ts línea 390)
```typescript
case 'search_meetings':
  return {
    success: true,
    data: {
      results: [] // ← Siempre vacío
    }
  };
```

❌ **Placeholder**, no busca nada

### Conclusión
Los tools de meetings **no funcionan** porque:
- No hay endpoint real de chunks streaming
- No hay STT conectado en tiempo real
- No hay transcripción live implementada

Esto explica por qué "el micro no sirve para reuniones".

---

## 4️⃣ RUTA DEL FRONTEND (CONFIRMADO)

**Backend espera:** `route: '/voice'` en el request body

**Frontend envía:** ❌ **NADA**

### Código Frontend Confirmado

`src/hooks/useVoiceMode.js` línea 363:
```javascript
const chatResponse = await fetch(`${CORE_BASE_URL}/api/ai/chat/v2`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'x-request-id': chatRequestId,
  },
  body: JSON.stringify({
    message: userText,    // ← Texto del STT
    sessionId,
    workspaceId,
    meta: { ... }
    // ❌ NO PASA route: '/voice'
    // ❌ NO PASA voice: true
    // ❌ NO hay [voice] en mensaje
  })
});
```

### Flujo Real (ROTO)

```
Frontend mic → POST /api/voice/transcribe (STT)
              ↓
              Obtiene texto
              ↓
              POST /api/ai/chat/v2  ← ❌ Llama como chat normal
              {
                message: "hola",
                sessionId: "...",
                // ❌ Sin route, sin voice flag
              }
              ↓
              Orchestrator recibe request sin contexto
              ↓
              isVoiceMode = false  ← ❌ SIEMPRE
              ↓
              Guardrail NO se activa
              ↓
              OpenAI puede ejecutarse si Groq falla
```

**🚨 CONFIRMADO:** El guardrail NUNCA se activa en producción porque el frontend no identifica las peticiones como "modo voz".

---

## 5️⃣ PLAN DE CIERRE (ORDEN DE EJECUCIÓN)

### P0: Activar guardrail YA (sin romper)

**Opción A (recomendada):** Propagar `route` desde voice.ts
```typescript
// src/api/voice.ts línea 485
body: JSON.stringify({
  userId,
  sessionId,
  message: transcript,
  route: '/voice'  // ← AGREGAR ESTO
})
```

**Opción B (alternativa):** Detectar por flag `voice: true`
```typescript
// src/ai/simpleOrchestrator.ts línea 203
const isVoiceMode = request.route?.includes('/voice') || 
                    request.voice === true ||  // ← AGREGAR
                    request.userMessage?.toLowerCase().includes('[voice]');
```

### P1: Instrumentación mínima obligatoria

Agregar logs en orchestrator para confirmar activación:
```typescript
if (isVoiceMode) {
  console.log('[VOICE MODE] ✅ ACTIVATED');
  console.log('[VOICE MODE] route:', request.route);
  console.log('[VOICE MODE] voice flag:', request.voice);
  console.log('[VOICE MODE] OpenAI blocked:', openaiBlocked);
}
```

### P2: Frontend - Verificar ruta exacta

**NECESITO:** Código del frontend donde se llama al mic para ver:
- ¿Qué URL usa? (`/api/voice/chat` o `/api/chat`?)
- ¿Manda flag `voice: true`?
- ¿Manda `[voice]` en el mensaje?

### P3: Meetings - No prometer hasta tener pipeline real

**NO decir "funciona meetings"** hasta que:
- Exista endpoint `/api/meetings/live/:id/chunk` que procese audio streaming
- STT esté conectado en tiempo real (no batch)
- Transcripción se guarde en DB con timestamps

---

## 6️⃣ RED FLAGS DETECTADOS

🚩 **Guardrail implementado pero arquitectura no lo dispara**
🚩 **`route` no se propaga entre capas (voice → chat → orchestrator)**
🚩 **Tools de meetings son instructivos, no código ejecutable**
🚩 **Frontend posiblemente usando ruta incorrecta**
🚩 **Falta instrumentación para validar que modo voz se activa**

---

## 7️⃣ PREGUNTA CRÍTICA PARA FRONTEND

**¿Qué ruta exacta usa el botón del micrófono?**

Necesito ver el código donde se hace el POST cuando el usuario presiona el mic para confirmar:

1. URL destino (¿`/api/voice/chat`?)
2. Body enviado (¿incluye `voice: true`?)
3. Headers enviados (¿incluye `x-channel: 'voice'`?)

Sin esto, no puedo confirmar si el guardrail debería activarse o no.

---

## 8️⃣ COMMITS PENDIENTES DE DEPLOY

Hay 4 commits listos que NO están en producción:

1. `25c1ac4` - Análisis imágenes contexto real
2. `704a096` - Calendario validar fechas
3. `5ba8091` - Canon tools unificado
4. `a486557` - Limpieza UX

**Estado actual de producción:** commit anterior (no verificado cuál)

---

## 🎯 ACCIÓN INMEDIATA RECOMENDADA

**Antes de prometer que "voz funciona":**

1. Deploy commits pendientes (4 commits)
2. Aplicar fix P0-A (propagar `route` o usar flag `voice`)
3. Validar con logs que guardrail se activa
4. Auditar frontend para confirmar ruta usada
5. Documentar meetings como "EN DESARROLLO" (no funcional)

---

**Fecha:** 19 enero 2026, 16:10 hrs
**Auditor:** GitHub Copilot
**Scope:** Backend AL-E Core (voice mode + orchestrator + tools)
**Repos auditados:** AL-E-Core (backend only, frontend pending)
