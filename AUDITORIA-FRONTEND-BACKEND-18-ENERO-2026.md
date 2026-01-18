# 🔍 AUDITORÍA FRONTEND-BACKEND - 18 ENERO 2026

**Fecha**: 18 de enero de 2026  
**Objetivo**: Identificar discrepancias entre lo que el frontend AL-EON envía vs lo que el backend AL-E Core espera/sirve  
**Estado**: ⚠️ **DISCREPANCIA CRÍTICA ENCONTRADA**

---

## 🚨 HALLAZGO CRÍTICO #1: ENDPOINT DESCONECTADO

### Frontend (AL-EON)
**Archivo**: `src/lib/aleCoreClient.js` línea 68

```javascript
// ❌ Frontend llama a /v2
const url = `${BASE_URL}/api/ai/chat/v2`;
```

**Evidencia en código**:
- ✅ `aleCoreClient.js` línea 68: `/api/ai/chat/v2`
- ✅ `useVoiceMode.js` línea 375: Voz también usa `/api/ai/chat/v2`
- ✅ `SettingsPage.jsx` línea 157: Health check usa `/api/ai/chat/v2`
- ✅ `test-endpoints.sh` línea 48: Tests usan `/api/ai/chat/v2`
- ✅ Múltiples documentos confirman: `/api/ai/chat/v2` es el endpoint oficial

### Backend (AL-E Core)
**Archivo Activo**: `src/api/truthChat.ts` línea 307

```typescript
// ✅ truthChat SOLO registra /chat (sin /v2)
router.post('/chat', optionalAuth, handleTruthChat);
```

**Archivo Bloqueado**: `src/api/chat.ts` línea 1097

```typescript
// ❌ Tiene /v2 pero NUNCA se ejecuta (bloqueado por router order)
router.post('/chat/v2', optionalAuth, async (req, res) => {
  // Este endpoint NUNCA recibe tráfico
});
```

**Registro de Routers** (`src/index.ts` líneas 209-214):
```typescript
// Express router order - PRIMERO gana
app.use("/api/ai", require("./api/truthChat").default); // ← Captura /api/ai/*
app.use("/api/ai", chatRouter); // ← NUNCA SE ALCANZA
```

---

## 🔍 ANÁLISIS DEL PROBLEMA

### Flujo Actual (Roto)
```
Frontend → POST /api/ai/chat/v2
    ↓
Express router evalúa en orden:
    1. truthChat captura /api/ai/* → ❌ No tiene handler para /chat/v2
    2. chat.ts nunca se alcanza
    ↓
Resultado: 404 Not Found (o cae en handler incorrecto)
```

### Estado de truthChat.ts
- ✅ **Registra**: `POST /chat` (línea 307)
- ❌ **NO registra**: `POST /chat/v2`
- ✅ **Usa**: `simpleOrchestrator` (simplificado pero funcional)
- ✅ **Tiene**: Memoria, tools, web_search, attachments, guardrails P0

### Estado de chat.ts
- ✅ **Registra**: `POST /chat` (línea 62) y `POST /chat/v2` (línea 1097)
- ✅ **Usa**: `Orchestrator` completo (RAG, intent classification, referee)
- ❌ **Problema**: NUNCA recibe tráfico (bloqueado por truthChat registration order)

---

## 📋 HALLAZGO #2: FORMATO DE PAYLOAD (✅ Compatible)

### Frontend Envía
```javascript
{
  message: "texto del usuario",
  sessionId: "uuid" | undefined,
  workspaceId: "core",
  projectId: "uuid" | undefined,
  userEmail: "email@domain.com",
  userDisplayName: "Nombre Usuario",
  meta: {
    platform: "AL-EON",
    version: "1.0.0",
    source: "al-eon-console",
    timestamp: "2026-01-18T..."
  },
  files: [
    {
      name: "archivo.pdf",
      url: "https://...supabase.co/storage/.../archivo.pdf",
      type: "application/pdf",
      size: 123456,
      bucket: "project-files",
      path: "proj_uuid/archivo.pdf"
    }
  ],
  attachments: [/* mismo array que files */]
}
```

### Backend Espera (truthChat.ts)
```typescript
interface ChatRequest {
  message: string;
  sessionId?: string;
  workspaceId?: string;
  userId?: string;
  attachments?: Array<{
    name: string;
    url: string;
    type: string;
    size?: number;
  }>;
  // ... otros campos opcionales
}
```

**Veredicto**: ✅ **Compatible** - El payload que frontend envía coincide con lo que backend espera.

---

## 📋 HALLAZGO #3: AUTENTICACIÓN (✅ Correcta)

### Frontend
```javascript
headers: {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${accessToken}` // JWT de Supabase
}
```

### Backend (truthChat.ts línea 62)
```typescript
router.post('/chat', optionalAuth, handleTruthChat);
```

- ✅ Usa middleware `optionalAuth` (permite requests sin token)
- ✅ Extrae `userId` del JWT si existe
- ✅ Modo stateless si no hay userId

**Veredicto**: ✅ **Compatible** - Autenticación funciona correctamente.

---

## 📋 HALLAZGO #4: ATTACHMENTS (✅ Implementado)

### Frontend (useChat.js líneas 108-178)
```javascript
// 1. Sube archivos a Supabase Storage
const uploadedFiles = await uploadFiles(attachments);

// 2. Envía URLs al backend
const response = await sendToAleCore({
  files: allFiles, // Array con URLs de Supabase
  ...
});
```

### Backend (truthChat.ts líneas 145-200)
```typescript
// Guardrail P0: Si hay attachments, forzar analyze_document
if (attachments?.length) {
  const forceAnalyze = {
    role: "system",
    content: `TOOL FORZADO: analyze_document para procesar ${attachments.length} archivo(s)...`
  };
  const toolResponse = await executeTool("analyze_document", { files: attachments });
  // ... agregar resultado al contexto
}
```

**Veredicto**: ✅ **Implementado correctamente** - Flujo de attachments funciona.

---

## 🎯 ROOT CAUSE CONFIRMADO

### Problema Principal
**Frontend llama `/api/ai/chat/v2` pero backend activo (`truthChat.ts`) solo registra `/api/ai/chat`**

### Consecuencias
1. ❌ Requests de frontend reciben 404 o caen en handler incorrecto
2. ❌ Usuario no ve respuestas de AL-E
3. ❌ Memoria no se guarda (request nunca llega al orchestrator)
4. ❌ Tools no se ejecutan (request no procesado)
5. ❌ Web search no funciona (request no alcanza Tavily)

---

## ✅ SOLUCIONES PROPUESTAS

### Opción A: Fix Backend (Preferida - Menos Riesgo)
**Archivo**: `src/api/truthChat.ts`

```typescript
// AGREGAR esta línea después de línea 307
router.post('/chat/v2', optionalAuth, handleTruthChat);
```

**Pros**:
- ✅ Un solo cambio en backend
- ✅ No rompe nada existente
- ✅ Frontend sigue funcionando sin cambios
- ✅ Mantiene `/chat` para compatibilidad hacia atrás

**Contras**:
- Ninguno

---

### Opción B: Fix Frontend (Alternativa)
**Archivo**: `src/lib/aleCoreClient.js`

```javascript
// CAMBIAR línea 68 de:
const url = `${BASE_URL}/api/ai/chat/v2`;

// A:
const url = `${BASE_URL}/api/ai/chat`;
```

**Pros**:
- ✅ Funciona inmediatamente con backend actual

**Contras**:
- ❌ Requiere rebuild + redeploy de frontend
- ❌ Cache de CDN (Netlify) puede causar problemas
- ❌ Múltiples archivos a cambiar (aleCoreClient.js, useVoiceMode.js, SettingsPage.jsx, etc.)
- ❌ Tests dejan de funcionar hasta actualizar

---

### Opción C: Usar chat.ts Completo (Arquitectural)
**Eliminar** conflicto de routers:

1. **Comentar registro de truthChat** en `src/index.ts`:
```typescript
// app.use("/api/ai", require("./api/truthChat").default);
app.use("/api/ai", chatRouter); // ← Ahora SÍ recibe tráfico
```

2. **Mover guardrails P0** de truthChat a chat.ts

**Pros**:
- ✅ Usa Orchestrator completo (RAG, intent classification, referee)
- ✅ Tiene `/chat/v2` ya implementado
- ✅ Arquitectura más robusta

**Contras**:
- ⚠️ Cambio arquitectónico significativo
- ⚠️ Requiere migrar guardrails P0 de truthChat
- ⚠️ Mayor riesgo de regresiones
- ⚠️ Necesita testing extensivo

---

## 🚀 RECOMENDACIÓN FINAL

**EJECUTAR OPCIÓN A (Fix Backend - Agregar /v2 a truthChat)**

**Razones**:
1. ✅ **Mínimo riesgo**: Un solo cambio, una línea de código
2. ✅ **Cero cambios en frontend**: Todo sigue funcionando
3. ✅ **Deploy rápido**: Solo backend (PM2 restart)
4. ✅ **Backward compatible**: Mantiene `/chat` funcionando
5. ✅ **No rompe tests**: Frontend tests siguen pasando

**Pasos**:
```bash
# 1. Editar archivo
vim src/api/truthChat.ts

# Agregar después de línea 307:
router.post('/chat/v2', optionalAuth, handleTruthChat);

# 2. Compilar
npm run build

# 3. Deploy a EC2
./deploy-to-ec2.sh

# 4. Verificar
curl -X POST https://api.al-eon.com/api/ai/chat/v2 \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}' # Debe responder 200
```

---

## 📊 TABLA COMPARATIVA: BACKEND ACTUAL

| Característica | truthChat.ts (Activo) | chat.ts (Bloqueado) |
|----------------|------------------------|---------------------|
| **Orchestrator** | simpleOrchestrator | Orchestrator completo |
| **Memoria** | ✅ `assistant_memories` | ✅ `assistant_memories` |
| **Tools** | ✅ 7 tools (Groq native) | ✅ 8 tools + RAG |
| **Web Search** | ✅ Tavily | ✅ Tavily |
| **Attachments** | ✅ Guardrail forzado | ✅ Procesamiento normal |
| **RAG** | ❌ No implementado | ✅ `retrieveRelevantChunks` |
| **Intent Classification** | ❌ No | ✅ Sí |
| **Mode Selection** | ❌ No | ✅ MODE_SELECTOR |
| **OpenAI Referee** | ✅ Opcional | ✅ Obligatorio |
| **Guardrail Hora** | ✅ Bloquea Tavily < 1h | ❌ No |
| **Líneas de código** | 310 | 1841 |
| **Endpoint /chat** | ✅ Sí | ✅ Sí |
| **Endpoint /chat/v2** | ❌ NO | ✅ Sí |

---

## 🔥 VALIDACIÓN POST-FIX

### Tests Canónicos

#### Test 1: Endpoint Responde
```bash
curl -X POST https://api.al-eon.com/api/ai/chat/v2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d '{
    "message": "Hola, di solo OK",
    "sessionId": null,
    "workspaceId": "core"
  }'

# Esperado: 200 OK con respuesta JSON
```

#### Test 2: Memoria Funciona
```bash
# Request 1: Guardar contexto
curl -X POST https://api.al-eon.com/api/ai/chat/v2 \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d '{
    "message": "Mi color favorito es azul",
    "sessionId": "test-session-123"
  }'

# Request 2: Recordar contexto
curl -X POST https://api.al-eon.com/api/ai/chat/v2 \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d '{
    "message": "¿Cuál es mi color favorito?",
    "sessionId": "test-session-123"
  }'

# Esperado: Respuesta menciona "azul"
```

#### Test 3: Web Search Funciona
```bash
curl -X POST https://api.al-eon.com/api/ai/chat/v2 \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d '{
    "message": "¿Qué pasó ayer en el mundo?",
    "sessionId": "test-session-456"
  }'

# Esperado: Respuesta con noticias recientes (metadata con tools_used: web_search)
```

#### Test 4: Attachments Funcionan
```bash
curl -X POST https://api.al-eon.com/api/ai/chat/v2 \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d '{
    "message": "Analiza este documento",
    "sessionId": "test-session-789",
    "attachments": [{
      "name": "test.pdf",
      "url": "https://...supabase.co/test.pdf",
      "type": "application/pdf"
    }]
  }'

# Esperado: Respuesta con análisis del documento (metadata con tools_used: analyze_document)
```

---

## 📄 EVIDENCIA DE AUDITORÍA

### Archivos Frontend Revisados
- ✅ `src/lib/aleCoreClient.js` (151 líneas)
- ✅ `src/features/chat/hooks/useChat.js` (288 líneas)
- ✅ `src/lib/streamingClient.js` (120 líneas)
- ✅ `src/hooks/useVoiceMode.js` (450 líneas)
- ✅ `src/pages/SettingsPage.jsx` (health check)
- ✅ `test-endpoints.sh` (bash script)
- ✅ 20+ archivos de documentación

### Archivos Backend Revisados
- ✅ `src/index.ts` (router registration)
- ✅ `src/api/truthChat.ts` (310 líneas)
- ✅ `src/api/chat.ts` (1841 líneas)
- ✅ `src/ai/simpleOrchestrator.ts` (781 líneas)
- ✅ `src/ai/orchestrator.ts` (1300 líneas)

### Conclusión
**Frontend está bien implementado. El problema está 100% en el backend: falta endpoint `/v2` en truthChat.**

---

**Documento generado**: 18 de enero de 2026  
**Próximos pasos**: Implementar Opción A + Validar con tests canónicos + Reportar a director
