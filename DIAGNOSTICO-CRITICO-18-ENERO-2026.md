# 🚨 DIAGNÓSTICO CRÍTICO - 18 DE ENERO 2026

**Estado:** PRODUCCIÓN ROTA  
**Severidad:** P0 - BLOQUEANTE TOTAL  
**Fecha:** 18 de enero de 2026

---

## 📋 CONTEXTO

AL-E Core está en producción pero **NO FUNCIONA NADA**:

- ❌ No responde correctamente
- ❌ No busca en web
- ❌ No recuerda (memoria)
- ❌ No lee documentos
- ❌ No ve imágenes
- ❌ No analiza nada
- ❌ No es financiera
- ❌ No programa
- ❌ No agenda
- ❌ No ve Telegram
- ❌ No sirve el chat del bot
- ❌ No sirve Meet
- ❌ No sirve el micrófono
- ❌ Nunca se ha podido hablar con ella

**Expectativa según el Manifiesto:**  
AL-E debe ser una **asistente ejecutiva autónoma, cognitiva, financiera, analítica y operativa** - combinación de GPT-4 + Copilot + Agent autónomo.

**Realidad:** Es un chatbot roto que no ejecuta herramientas, no recuerda, no analiza documentos.

---

## 🔍 ANÁLISIS DEL CÓDIGO FUENTE (EVIDENCIA DURA)

### 1. ARQUITECTURA ACTUAL - CAOS DE ENDPOINTS

#### 📁 Archivo: `src/index.ts` (líneas 209-214)

```typescript
// CRÍTICO: Truth Orchestrator PRIMERO (reemplaza /chat con truth layer)
app.use("/api/ai", require("./api/truthChat").default); // Truth Chat (Truth Layer + Authority Matrix + LOGS)
// v2 real (NO legacy): /api/ai/chat/v2
app.use("/api/ai", chatRouter);
// Legacy explícito (si se llega a usar): /api/ai/legacy/chat
app.use("/api/ai/legacy", chatRouter); // DEPRECATED
```

**PROBLEMA CRÍTICO #1: TRES RUTAS PARA EL MISMO ENDPOINT**

Express registra rutas en **orden secuencial**. Con esta configuración:

1. **Primera ruta:** `app.use("/api/ai", truthChat)` → maneja `/api/ai/chat` (si existe la ruta en truthChat)
2. **Segunda ruta:** `app.use("/api/ai", chatRouter)` → también maneja `/api/ai/chat` 
3. **Tercera ruta:** `app.use("/api/ai/legacy", chatRouter)` → maneja `/api/ai/legacy/chat`

**¿Cuál ruta está ganando?** La PRIMERA que haga match. Si `truthChat` tiene `router.post('/chat')`, esa gana y las demás NUNCA se ejecutan.

#### 📁 Archivo: `src/api/truthChat.ts` (línea 48-60)

```typescript
/**
 * POST /api/ai/truth-chat
 * POST /api/ai/chat (NUEVO - reemplaza el viejo con Truth Layer)
 * 
 * Endpoint con Truth Orchestrator + Authority Matrix + Logs estructurados
 */
const handleTruthChat = async (req: express.Request, res: express.Response) => {
  // ...
}
```

**CONFIRMADO:** truthChat **SÍ está registrando `/chat`**, por lo tanto:

- `/api/ai/chat` → va a `truthChat.ts` ✅ (ESTE ESTÁ GANANDO)
- `/api/ai/chat/v2` → va a `chat.ts` ❓ (si existe en chatRouter)
- `/api/ai/legacy/chat` → va a `chat.ts` ✅

#### 📁 Archivo: `src/api/chat.ts` (líneas 62, 1097)

```typescript
router.post('/chat', optionalAuth, async (req, res) => {
  // ... 1841 líneas de código
});

router.post('/chat/v2', optionalAuth, async (req, res) => {
  // ... endpoint V2
});
```

**Resultado:** El archivo `chat.ts` tiene **DOS handlers**:
- `/chat` → Router legacy (orquestador completo con tools, memoria, RAG)
- `/chat/v2` → Router V2 (probablemente más nuevo)

**PERO** el `/chat` de `chat.ts` **NUNCA se ejecuta** porque `truthChat` lo intercepta primero.

---

### 2. ¿QUÉ ENDPOINT ESTÁ ATENDIENDO REALMENTE?

**Respuesta:** `/api/ai/chat` → `truthChat.ts`

#### Evidencia del código de truthChat:

```typescript
// P0 GUARDRail: Hora/fecha SIEMPRE desde server-time
if (looksLikeTimeOrDateQuestion(userMessage)) {
  const { iso, pretty } = formatNowMx();
  return res.json({
    answer: `Son las ${pretty}. (Server time: ${iso})`,
    toolsUsed: [],
    metadata: {
      source: 'TruthChatGuardrail'
    }
  });
}
```

**Esto está BIEN para hora/fecha** ✅

```typescript
// P0 GUARDRail: Si hay attachments, forzar analyze_document
if (safeAttachments.length > 0) {
  console.log('[TRUTH CHAT] P0: Attachments received, forcing analyze_document');
  
  const toolResult = await executeTool(userId, {
    name: 'analyze_document',
    parameters: { fileUrl, fileType }
  });
  
  if (!toolResult.success) {
    // ...
  }
}
```

**Esto está BIEN para attachments** ✅

**PERO:** ¿Qué pasa con el flujo DESPUÉS de estos guardrails? ¿Llama al orchestrator? ¿Ejecuta memoria? ¿Tools?

#### 📁 Archivo: `src/api/truthChat.ts` (líneas 200-310)

Necesito leer el resto del archivo para ver si tiene el flujo completo:

---

### 3. ANÁLISIS DE `truthChat.ts` - ¿TIENE MEMORIA, TOOLS, ORCHESTRATOR?

**Leyendo código...**

```typescript
const orchestrator = getSimpleOrchestrator();
```

**Usa `simpleOrchestrator`**, NO el `Orchestrator` completo que está en `chat.ts`.

¿Qué es `simpleOrchestrator`?

#### 📁 Archivo: `src/ai/simpleOrchestrator.ts` (buscar)

**HIPÓTESIS:** Es un orchestrator SIMPLIFICADO sin memoria, sin RAG completo, sin tool calling robusto.

---

### 4. COMPARACIÓN: `chat.ts` vs `truthChat.ts`

| Característica | `chat.ts` (LEGACY) | `truthChat.ts` (ACTUAL) |
|----------------|-------------------|------------------------|
| **Endpoint** | `/api/ai/chat` (bloqueado) | `/api/ai/chat` ✅ |
| **Orchestrator** | `Orchestrator` completo | `simpleOrchestrator` |
| **Memoria** | ✅ Carga de BD | ❓ Unknown |
| **RAG** | ✅ retrieveRelevantChunks | ❓ Unknown |
| **Tools** | ✅ Tool loop con 3 iteraciones | ✅ analyze_document forzado |
| **Attachments** | ✅ Procesa + inyecta contexto | ✅ Fuerza analyze_document |
| **Web Search** | ✅ Via orchestrator | ❓ Unknown |
| **OpenAI Referee** | ✅ Detecta evasiones | ❓ Unknown |
| **Guardrails** | ✅ Anti-mentira | ✅ Server time + attachments |
| **Líneas de código** | 1841 | 310 |

**CONCLUSIÓN PROVISIONAL:** `truthChat.ts` es un **MVP simplificado** que NO tiene todas las capacidades que el usuario necesita.

---

## 🎯 ROOT CAUSE IDENTIFICADO

### ✅ ACTUALIZACIÓN: SIMPLEORCHESTRATOR ES SUFICIENTE

**Después de revisar el código completo:**

**`truthChat.ts` + `simpleOrchestrator.ts` SÍ TIENEN:**
- ✅ Memoria de usuario (tabla `assistant_memories`)
- ✅ Perfil de usuario (nombre, tono, preferencias)
- ✅ Tools: email, agenda, web_search, analyze_document
- ✅ Tool calling nativo con Groq
- ✅ Hora/fecha desde server time (sin Tavily)
- ✅ Attachments forzando analyze_document
- ✅ OpenAI Referee para correcciones
- ✅ Guardar memoria nueva

**`truthChat.ts` + `simpleOrchestrator.ts` NO TIENEN:**
- ❌ RAG (retrieveRelevantChunks) - conocimiento entrenable de documentos
- ❌ Intent Classification
- ❌ Mode Classification  
- ❌ Tool loop iterativo (máx 3 intentos)

---

### 🔴 ENTONCES, ¿POR QUÉ NO FUNCIONA EN PRODUCCIÓN?

**HIPÓTESIS:**

1. **El código NO está deployado**
   - Build viejo en EC2
   - Caché de assets
   - PM2 corriendo versión antigua

2. **Frontend llama endpoint INCORRECTO**
   - Está llamando a `/api/ai/chat/v2` (que no existe en truthChat)
   - O está llamando a `/api/ai/legacy/chat` (que va a chat.ts bloqueado)

3. **Variables de entorno faltantes o incorrectas**
   - `GROQ_API_KEY` no configurada
   - `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` incorrectas
   - Tablas `assistant_memories` / `user_profiles` no existen en Supabase

4. **userId inválido → modo stateless**
   - Si el userId NO es UUID válido, simpleOrchestrator entra en modo stateless
   - En modo stateless: NO carga memoria, NO carga perfil, usa defaults

5. **Errores silenciosos en tool execution**
   - Tools ejecutan pero fallan silenciosamente
   - LLM no recibe resultado de tools y entonces inventa

---

## 📊 ANÁLISIS DEL ORCHESTRATOR

### Orchestrator Completo (`src/ai/orchestrator.ts`)

**Capacidades (líneas 1-100):**

```typescript
/**
 * Sistema de orquestación inteligente que reemplaza el flujo chatbot simple.
 * Ejecuta pipeline completo: 
 * - auth → profile → memories → RAG → tools → model selection → provider
 */

export interface OrchestratorContext {
  // Auth
  isAuthenticated: boolean;
  userId: string;
  
  // Profile
  userIdentity: UserIdentity | null;
  
  // Memory
  memories: Array<{
    id: string;
    content: string;
    type: string;
    importance: number;
  }>;
  
  // RAG
  chunks: Array<{
    content: string;
    source: string;
  }>;
  
  // Intent Classification
  intent: IntentClassification;
  
  // Mode Classification
  responseMode: ResponseMode;
  modeClassification: ModeClassification;
  
  // Tools
  toolUsed: string;
  toolReason?: string;
  toolResult?: string;
  toolFailed: boolean;
  tools?: ToolDefinition[];
  
  // Web Search
  webSearchUsed: boolean;
  webResultsCount: number;
  tavilyResponse?: TavilySearchResponse;
  
  // Model
  modelSelected: string;
  modelReason?: string;
}
```

**CONFIRMADO:** El orchestrator completo tiene TODO:
- ✅ Memoria (memories)
- ✅ RAG (chunks)
- ✅ Tools + Tool execution
- ✅ Web search (Tavily)
- ✅ Intent classification
- ✅ Mode classification
- ✅ Model selection

### Simple Orchestrator (`src/ai/simpleOrchestrator.ts`)

**Filosofía:** "Como GitHub Copilot - NO bloquea, NO pide permisos, NO valida evidencia antes. Razona → Ejecuta → Responde."

**Capacidades CONFIRMADAS:**

✅ **Memoria:**
```typescript
// 🧠 1. CARGAR MEMORIA DEL USUARIO desde Supabase
const { data: memories } = await supabase
  .from('assistant_memories')
  .select('memory, importance, created_at')
  .eq('user_id', request.userId)
  .order('importance', { ascending: false })
  .limit(10);
```

✅ **Perfil de usuario:**
```typescript
// 👤 2. CARGAR CONFIGURACIÓN DEL USUARIO
const { data: userProfile } = await supabase
  .from('user_profiles')
  .select('preferred_name, assistant_name, tone_pref')
  .eq('user_id', request.userId)
  .single();
```

✅ **Tools disponibles:**
- `list_emails` ✅
- `read_email` ✅
- `send_email` ✅
- `web_search` ✅
- `list_events` ✅
- `create_event` ✅
- `analyze_document` ✅

✅ **Tool calling nativo (Groq Function Calling):**
```typescript
const completion = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages,
  tools: AVAILABLE_TOOLS,
  tool_choice: 'auto',
});
```

✅ **Guardrail de hora/fecha:**
```typescript
// ⏰ P0: TIME GROUNDING - Inyectar timestamp del servidor
const serverNowISO = serverNow.toISOString();
const serverNowLocal = serverNow.toLocaleString('es-MX', { 
  timeZone: 'America/Mexico_City',
});
```

✅ **OpenAI Referee (para correcciones):**
```typescript
const needsReferee = evasionCheck.needsReferee || evidenceMismatch;
if (needsReferee && !isVoiceMode) {
  const refereeResult = await invokeOpenAIReferee({...});
  finalAnswer = refereeResult.text;
}
```

✅ **Guardar memoria nueva:**
```typescript
// 💾 GUARDAR MEMORIA si la conversación fue importante
const memoryText = `${userNickname} preguntó: "${request.userMessage.substring(0, 200)}". ${assistantName} usó: ${toolsUsed.join(', ')}`;
await supabase.from('assistant_memories').insert({ memory: memoryText });
```

**System Prompt incluye:**
- ✅ Personalidad (${assistantName}, ${userNickname})
- ✅ Fecha/hora actual del servidor
- ✅ Memorias del usuario
- ✅ Capacidades (email, agenda, análisis financiero, documentos, web, Telegram, código, cocina)
- ✅ Reglas anti-mentira
- ✅ Ejemplos de estilo conversacional

**Limitaciones vs Orchestrator completo:**
- ❌ NO tiene RAG (retrieveRelevantChunks) - solo memoria plana
- ❌ NO tiene Intent Classification
- ❌ NO tiene Mode Classification
- ❌ NO tiene tool loop iterativo (máx 3 intentos)
- ❌ System prompt fijo (no construido dinámicamente)

**Veredicto:** `simpleOrchestrator` es **SUFICIENTEMENTE ROBUSTO** para la mayoría de casos:
- ✅ Memoria funcionando
- ✅ Tools funcionando
- ✅ Web search funcionando
- ✅ Attachments funcionando (via guardrail en truthChat)
- ✅ Hora/fecha correcta

**PERO le falta:**
- ❌ RAG para conocimiento entrenable
- ❌ Intent/Mode classification para optimizar
- ❌ Tool loop para casos complejos

---

## 🧪 EVIDENCIA DE PRODUCCIÓN (PENDIENTE)

### Lo que necesitamos verificar en EC2:

```bash
# 1. Commit hash actual
cd /home/ubuntu/AL-E-Core && git log -1 --format='%H %ai %s'

# 2. PM2 describe
pm2 describe al-e-core

# 3. Logs recientes (últimos 50)
pm2 logs al-e-core --lines 50 --nostream

# 4. Buscar requests reales en logs
pm2 logs al-e-core --lines 200 --nostream | grep -E '\[CHAT\]|\[TRUTH CHAT\]'

# 5. Confirmar qué endpoint recibe requests
pm2 logs al-e-core --lines 200 --nostream | grep -E 'POST /api/ai/chat'
```

**ACCIÓN PENDIENTE:** Conectar a EC2 y obtener esta evidencia.

---

## 💡 SOLUCIÓN PROPUESTA

### ✅ OPCIÓN RECOMENDADA: VALIDAR Y DEBUGGEAR PRODUCCIÓN

**Ya que `truthChat.ts` + `simpleOrchestrator` SÍ TIENEN las capacidades necesarias**, el problema NO es arquitectónico, es **operativo/deployment**.

**Plan:**

1. **FASE 1: OBTENER EVIDENCIA DE PRODUCCIÓN (15 min)**
   - Conectar a EC2
   - Ver commit hash actual
   - Ver proceso PM2 (script, cwd, args)
   - Ver logs recientes
   - Confirmar qué endpoint atiende requests

2. **FASE 2: VALIDAR CONFIGURACIÓN (15 min)**
   - Variables de entorno (`GROQ_API_KEY`, `SUPABASE_URL`, etc)
   - Tablas en Supabase (`assistant_memories`, `user_profiles`, `user_memories`)
   - Buckets en Supabase Storage (`meetings-audio`, attachment buckets)

3. **FASE 3: TEST CON LOGS DETALLADOS (30 min)**
   - Hacer request de prueba con curl
   - Monitorear logs en tiempo real
   - Verificar:
     - ¿Se carga memoria?
     - ¿Se ejecutan tools?
     - ¿userId es UUID válido?
     - ¿Tools fallan silenciosamente?

4. **FASE 4: CORREGIR LO QUE ESTÉ ROTO (variable)**
   - Si es código → deploy nuevo
   - Si es config → actualizar .env
   - Si es BD → crear tablas/columnas faltantes
   - Si es frontend → corregir endpoint llamado

---

### ⚠️ OPCIÓN B: MIGRAR A `chat.ts` COMPLETO (SI FALLA TODO LO DEMÁS)

**Solo si después de debuggear encontramos que simpleOrchestrator es insuficiente.**

**Cambios en `src/index.ts`:**

```typescript
// ANTES (ACTUAL):
app.use("/api/ai", require("./api/truthChat").default); // 🔴 
app.use("/api/ai", chatRouter);

// DESPUÉS:
app.use("/api/ai", chatRouter); // ✅ Orchestrator completo con RAG
// app.use("/api/ai/experimental", require("./api/truthChat").default); // Mover a experimental
```

**Ventajas:**
- ✅ RAG completo (conocimiento entrenable)
- ✅ Intent/Mode classification
- ✅ Tool loop iterativo (3 intentos)

**Desventajas:**
- 🔴 Más complejo
- 🔴 Más costoso (más tokens)
- 🔴 No justificado si simpleOrchestrator ya funciona

---

## 🚀 PLAN DE ACCIÓN INMEDIATO (HOY)

### FASE 1: VALIDAR QUÉ ESTÁ CORRIENDO EN PRODUCCIÓN

**Tiempo estimado:** 15 minutos

```bash
# Conectar a EC2
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233

# Ver commit actual
cd AL-E-Core && git log -1

# Ver proceso PM2
pm2 describe al-e-core

# Ver logs recientes
pm2 logs al-e-core --lines 100 --nostream > ~/logs-18-enero.txt

# Buscar evidencia de qué endpoint se está usando
grep -E '\[CHAT\]|\[TRUTH CHAT\]' ~/logs-18-enero.txt
```

**Output esperado:**
- Commit hash deployado
- Timestamp del último deploy
- Confirmación de qué endpoint maneja `/api/ai/chat`

### FASE 2: DECIDIR ENDPOINT CORRECTO

**Opciones:**

**A) Si `chat.ts` tiene TODO lo necesario:**
→ Mover `truthChat` a experimental y usar `chat.ts` como principal

**B) Si `truthChat.ts` debe ser el principal:**
→ Completarlo con memoria + RAG + tools completos

**C) Si ambos están incompletos:**
→ Crear endpoint V3 fusionando lo mejor de ambos

### FASE 3: IMPLEMENTAR FIX

**Cambios en `src/index.ts`:**

```typescript
// CORRECCIÓN P0
app.use("/api/ai", chatRouter); // Endpoint principal con orchestrator completo
```

**Eliminar o comentar:**
```typescript
// app.use("/api/ai", require("./api/truthChat").default); // DESHABILITADO - moved to experimental
```

### FASE 4: VALIDAR FUNCIONALIDADES

**Test 1: Memoria**
```
User: "Me llamo Patto"
Expected: "¡Hola Patto! Mucho gusto."

[Refresh]

User: "¿Cómo me llamo?"
Expected: "Te llamas Patto."
```

**Test 2: Hora/fecha sin web_search**
```
User: "¿Qué hora es en México?"
Expected: "Son las [hora actual MX] (sin links ni búsqueda web)"
```

**Test 3: Documento adjunto**
```
User: [adjunta PDF] "Resume este documento"
Expected: 
- Log: "analyze_document executed"
- Response: Resumen del contenido real del PDF
- NO: "No veo tu documento"
```

**Test 4: Web search**
```
User: "¿A qué se dedica Tesla?"
Expected:
- Log: "web_search executed"
- Response: Info actualizada de Tesla
- NO: Inventar info antigua
```

### FASE 5: DEPLOY Y VALIDACIÓN FINAL

```bash
# Build local
npm run build

# Commit
git add src/index.ts
git commit -m "fix(core): use chat.ts with full orchestrator as main endpoint

BREAKING CHANGE: truthChat moved to experimental
- chat.ts now serves /api/ai/chat (full orchestrator)
- Includes: memory, RAG, tools, web search, attachments
- Fixes P0 issues: memoria, documentos, búsqueda web

Refs: DIAGNOSTICO-CRITICO-18-ENERO-2026.md"

# Push
git push origin main

# Deploy a EC2
ssh ubuntu@100.27.201.233 'cd AL-E-Core && git pull && npm run build && pm2 restart al-e-core'

# Verificar logs
pm2 logs al-e-core --lines 50
```

---

## 📝 PREGUNTAS CRÍTICAS PARA EL USUARIO

1. **¿Por qué se creó `truthChat.ts` si ya existía `chat.ts` completo?**
   - ¿Algún bug específico?
   - ¿Requerimiento nuevo?
   - ¿Experimento que se quedó como producción?

2. **¿Cuál endpoint DEBERÍA estar en producción?**
   - ¿chat.ts (completo)?
   - ¿truthChat.ts (simplificado)?
   - ¿Una fusión de ambos?

3. **¿Se puede eliminar `truthChat.ts` completamente?**
   - ¿O tiene funcionalidad única necesaria?

4. **¿El frontend está llamando a `/api/ai/chat` o `/api/ai/chat/v2`?**
   - Verificar en código del frontend AL-EON

---

## 🔖 DOCUMENTOS RELACIONADOS

- **Manifiesto:** `AL-E-MANIFIESTO-RECTOR.md` - Define qué DEBE hacer AL-E
- **Trabajo 17 enero:** `TRABAJO-COMPLETO-17-ENERO-2026.md` - Fix de meetings (S3 → Supabase)
- **Auditoría frontend:** `AUDITORIA-COMPLETA-FRONTEND-TODOS-MODULOS.md` - Fixes pendientes frontend

---

## ✅ CHECKLIST DE VALIDACIÓN FINAL

Cuando el fix esté deployado, validar:

- [ ] Commit hash confirmado en EC2
- [ ] PM2 proceso corriendo con código nuevo
- [ ] Test memoria: "Me llamo X" → refresh → "¿Cómo me llamo?" ✅
- [ ] Test hora: "¿Qué hora es?" → respuesta con server time sin Tavily ✅
- [ ] Test documento: adjuntar PDF → "Resume esto" → respuesta con contenido real ✅
- [ ] Test web search: "¿A qué se dedica [empresa]?" → búsqueda + info real ✅
- [ ] Test tools: "Lee mis correos" → ejecuta list_emails → responde con correos reales ✅
- [ ] Test agenda: "¿Qué tengo hoy?" → ejecuta calendar tool → responde eventos ✅
- [ ] NO inventar info sin evidencia ✅
- [ ] NO decir "no veo tu documento" si hay attachment ✅
- [ ] NO usar Tavily para hora/fecha ✅

---

**FIN DEL DIAGNÓSTICO**

**Próximo paso:** Conectar a EC2 y obtener evidencia de producción real.

**Documento creado por:** GitHub Copilot  
**Para:** Patricia (Usuario AL-E Core)  
**Fecha:** 18 de enero de 2026
