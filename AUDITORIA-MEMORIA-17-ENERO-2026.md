# 🚨 AUDITORÍA CRÍTICA COMPLETA: AL-E ESTÁ ROTA
## 17 de enero de 2026 - ANÁLISIS DEFINITIVO

---

## 📋 RESUMEN EJECUTIVO

**AL-E NO ES UNA IA, ES UN CHATBOT QUE MIENTE.**

### 🔴 PROBLEMAS CRÍTICOS CONFIRMADOS (DIRECTOR + AUDITORÍA):

| # | PROBLEMA | IMPACTO | PRIORIDAD |
|---|----------|---------|-----------|
| 1 | **MIENTE Y NO CONSULTA** | AL-E dice "revisé", "encontré" sin ejecutar tools | P0 |
| 2 | **NO SABE FECHA/HORA REAL** | Agenda rota, fechas inventadas | P0 |
| 3 | **MEMORIA NO GOBIERNA** | Carga memoria pero la ignora | P0 |
| 4 | **TOOLS NO SON OBLIGATORIAS** | Responde sin evidencia cuando debería consultar | P0 |
| 5 | **VOZ NO BLINDADA** | OpenAI puede entrar en modo voz | P0 |
| 6 | **NO GUARDA MEMORIA NUEVA** | Memoria vacía después de conversaciones | P0 |
| 7 | **VOZ SIN ORCHESTRATOR** | voice.ts stateless, sin memoria | P1 |
| 8 | **TELEGRAM SIN ORCHESTRATOR** | telegram.ts stateless, sin memoria | P1 |

**VEREDICTO**: AL-E es un **chatbot conversacional con alucinaciones**, no una **asistente ejecutiva autónoma**.

**Incumplimiento TOTAL del Manifiesto Rector (Puntos 1, 2, 8, 11, 13).**

---

## 🔍 ANÁLISIS DETALLADO POR PROBLEMA

---

## 🔴 PROBLEMA 1: AL-E "MIENTE" Y NO CONSULTA NADA REAL

### **Síntoma Real**:
```
Usuario: "Revisa mi correo"
AL-E: "No encontré correos recientes" ← SIN HABER CONSULTADO NADA
```

### **Root Cause (Director)**:

> El orquestador razona → responde, y solo después valida si usó tools.
> La validación post-respuesta solo revisa texto, no verdad factual.
> Si Groq no llama tool, se acepta la respuesta.
> El referee de OpenAI entra tarde, cuando el daño ya está hecho.

### **Evidencia en Código**:

**orchestrator.ts - Línea 1090** (executeToolLoop):
```typescript
// ❌ PROBLEMA: Groq puede responder SIN llamar tools
const llmResponse = await callGroqChat({
  messages,
  tools: toolsAvailable,
  toolChoice: 'auto',  // ← "auto" = OPCIONAL
  model,
  maxTokens: 600
});

// Si NO hay tool_calls, se acepta la respuesta
if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
  return {
    content: llmResponse.content,  // ← RESPUESTA SIN EVIDENCIA
    toolExecutions: []
  };
}
```

**chat.ts - Línea 780** (guardrail POST-respuesta):
```typescript
// ❌ PROBLEMA: Guardrail revisa DESPUÉS de que el LLM ya respondió
guardrailResult = applyAntiLieGuardrail(
  llmResponse.response.text,  // ← Ya está generado
  orchestratorContext.webSearchUsed,
  orchestratorContext.intent,
  orchestratorContext.toolFailed,
  orchestratorContext.toolError
);
```

### **Por qué falla**:
1. `toolChoice: 'auto'` permite que Groq **decida** no usar tools
2. El guardrail entra **DESPUÉS** de generar respuesta
3. OpenAI referee entra **DESPUÉS** del guardrail
4. Resultado: **3 capas de validación POST-hoc en vez de PRE-respuesta**

### **Fix Requerido**:
```typescript
// ✅ SOLUCIÓN: Tool choice FORZADO para queries críticas
if (intent.tools_required.length > 0) {
  toolChoice = 'required';  // ← Groq DEBE usar tools
  
  // Si NO usa tools → ERROR, no respuesta inventada
  if (!llmResponse.tool_calls) {
    throw new Error('TOOL_REQUIRED_NOT_EXECUTED');
  }
}
```

---

## 🔴 PROBLEMA 2: NO SABE FECHA/HORA REAL (AGENDA ROTA)

### **Síntoma Real**:
```
Usuario: "¿Qué día es hoy?"
AL-E: "Es 15 de octubre de 2023" ← DATOS DE ENTRENAMIENTO
```

### **Root Cause (Director)**:

> En el orquestador NO existe una fuente de verdad temporal:
> - No hay now() controlado por timezone del usuario
> - No hay contexto explícito de "hoy"
> - No hay normalización de "mañana", "lunes", etc.
> - El modelo infiere fechas, no las calcula

### **Evidencia en Código**:

**orchestrator.ts - Línea 700** (buildSystemPrompt):
```typescript
// ✅ HAY contexto temporal, pero está DESPUÉS de otros bloques
const now = new Date();
const mexicoTime = new Intl.DateTimeFormat('es-MX', {
  timeZone: 'America/Mexico_City',
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true
}).format(now);

systemPrompt += `

═══════════════════════════════════════════════════════════════
CONTEXTO TEMPORAL ACTUAL
═══════════════════════════════════════════════════════════════

Fecha y hora EXACTA en este momento (Mexico City):
${mexicoTime}

INSTRUCCIÓN: Si el usuario pregunta "qué día es hoy" o "qué hora es", usa ESTA información exacta.
NO uses tu conocimiento de entrenamiento. Esta es la fecha/hora real del sistema.

═══════════════════════════════════════════════════════════════
`;
```

### **Por qué falla**:
1. ✅ El contexto temporal **SÍ EXISTE**
2. ❌ Pero está **DESPUÉS** de otros bloques (memoria, tools)
3. ❌ El LLM puede **ignorarlo** si no está al inicio
4. ❌ No hay **validación** de que la respuesta use la fecha real

### **Fix Requerido**:
```typescript
// ✅ SOLUCIÓN: Fecha/hora PRIMERO en system prompt
systemPrompt = `
🕐 FECHA Y HORA REAL (OBLIGATORIO USAR):
${mexicoTime}

${basePrompt}
${memoryBlock}
${toolBlock}
`;

// ✅ VALIDACIÓN POST-RESPUESTA
if (userMessage.match(/qué día|qué hora|hoy es/i)) {
  if (!llmResponse.text.includes(mexicoTime.split(',')[0])) {
    throw new Error('TEMPORAL_CONTEXT_NOT_USED');
  }
}
```

---

## 🔴 PROBLEMA 3: MEMORIA CARGA, PERO NO GOBIERNA

### **Síntoma Real**:
```
Usuario: "Me llamo Patto"
AL-E: "Perfecto, Patto"

[Nueva sesión]

Usuario: "¿Cómo me llamo?"
AL-E: "¿Cómo te llamas?" ← NO USA MEMORIA CARGADA
```

### **Root Cause (Director)**:

> La memoria se inyecta como texto, no como estado vinculante.
> Si Groq decide ignorarla, nadie lo impide.
> No hay verificación de que la respuesta respete: nombre del usuario, relación, configuración previa.
> Se guarda memoria después, incluso si la respuesta fue incorrecta.

### **Evidencia en Código**:

**orchestrator.ts - Línea 1065** (memoria se carga):
```typescript
// ✅ Memoria SÍ se carga
const memories = isAuthenticated 
  ? await this.loadMemories(userId, workspaceId, projectId)
  : [];
console.log(`[ORCH] STEP 3: ✓ Loaded ${memories.length} memories`);
```

**orchestrator.ts - Línea 486** (memoria se inyecta como texto):
```typescript
// ❌ PROBLEMA: Memoria es solo texto, no estado obligatorio
if (memories.length > 0) {
  systemPrompt += `

═══════════════════════════════════════════════════════════════
MEMORIAS EXPLÍCITAS (${memories.length})
═══════════════════════════════════════════════════════════════

${memories.map((mem, idx) => {
  systemPrompt += `${idx + 1}. [${mem.memory_type.toUpperCase()}] ${mem.content}\n`;
}).join('')}

═══════════════════════════════════════════════════════════════
`;
}
```

**chat.ts - Línea 1729** (NO se guarda memoria nueva):
```typescript
return res.json({
  answer: finalAnswer,
  session_id: sessionId,
  memories_to_add: [], // ❌ SIEMPRE VACÍO
  metadata: { /* ... */ }
});
```

### **Por qué falla**:
1. ✅ Memoria **SÍ se carga** desde Supabase
2. ❌ Se inyecta como **texto libre** en system prompt
3. ❌ El LLM puede **ignorarla** sin consecuencias
4. ❌ **NO se guarda** memoria nueva después de conversación
5. ❌ No hay validación de que respuesta respete memoria

### **Fix Requerido**:
```typescript
// ✅ SOLUCIÓN 1: Memoria como ESTADO VINCULANTE
const userMemoryState = {
  name: memories.find(m => m.content.includes('se llama'))?.content,
  preferences: memories.filter(m => m.type === 'preference'),
  agreements: memories.filter(m => m.type === 'agreement')
};

systemPrompt = `
🧠 MEMORIA DEL USUARIO (OBLIGATORIO RESPETAR):
Nombre: ${userMemoryState.name || 'Desconocido'}
Preferencias: ${userMemoryState.preferences.length} registradas
Acuerdos: ${userMemoryState.agreements.length} activos

${basePrompt}
`;

// ✅ SOLUCIÓN 2: Guardar memoria NUEVA
await extractAndSaveMemories(userId, workspaceId, message, finalAnswer);

// ✅ SOLUCIÓN 3: Validar que respuesta respeta memoria
if (userMemoryState.name && userMessage.match(/cómo me llamo/i)) {
  if (!llmResponse.text.includes(userMemoryState.name)) {
    throw new Error('MEMORY_NOT_RESPECTED');
  }
}
```

---

## 🔴 PROBLEMA 4: TOOLS NO SON OBLIGATORIAS CUANDO DEBERÍAN SERLO

### **Síntoma Real**:
```
Usuario: "Revisa mi agenda de hoy"
AL-E: "No tienes eventos hoy" ← SIN EJECUTAR list_events
```

### **Root Cause (Director)**:

> Las tools están disponibles, pero no son obligatorias.
> El modelo puede responder sin usarlas.
> El orquestador no bloquea respuestas sin evidencia.

### **Evidencia en Código**:

**orchestrator.ts - Línea 525** (executeToolLoop):
```typescript
const llmResponse = await callGroqChat({
  messages,
  tools: toolsAvailable,
  toolChoice: 'auto',  // ❌ "auto" = OPCIONAL
  model,
  maxTokens: 600
});

// Si NO hay tool_calls, devuelve respuesta sin evidencia
if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
  return {
    content: llmResponse.content,  // ❌ SIN CONSULTAR
    toolExecutions: []
  };
}
```

### **Detección de intención** (orchestrator.ts - Línea 240):
```typescript
// ❌ PROBLEMA: Intent classifier detecta tools_required, pero NO se fuerza
const intent = this.classifyUserIntent(lastUserMessage);
// intent.tools_required = ['list_events', 'check_email', 'web_search']

// Pero en executeToolLoop, toolChoice sigue siendo 'auto'
```

### **Por qué falla**:
1. Intent classifier **SÍ detecta** que se requiere tool
2. Pero `toolChoice: 'auto'` permite que Groq **no la ejecute**
3. No hay **bloqueo** si tool requerida no se ejecuta
4. Resultado: Respuesta sin evidencia

### **Fix Requerido**:
```typescript
// ✅ SOLUCIÓN: Tool choice FORZADO
const toolChoice = intent.tools_required.length > 0 ? 'required' : 'auto';

const llmResponse = await callGroqChat({
  messages,
  tools: toolsAvailable,
  toolChoice,  // ← REQUIRED si intent lo indica
  model,
  maxTokens: 600
});

// ✅ VALIDACIÓN: Si tool era requerida y NO se ejecutó → ERROR
if (intent.tools_required.length > 0 && !llmResponse.tool_calls) {
  console.error(`[ORCH] ❌ TOOL REQUIRED BUT NOT EXECUTED: ${intent.tools_required.join(', ')}`);
  return {
    content: `No pude consultar la información requerida. Intenta de nuevo.`,
    toolExecutions: [{
      tool: 'none',
      args: {},
      result: { success: false, error: 'TOOL_REQUIRED_NOT_EXECUTED' },
      success: false
    }]
  };
}
```

---

## 🔴 PROBLEMA 5: MODO VOZ NO BLINDADO (OpenAI puede entrar)

### **Root Cause (Director)**:

> El orquestador no separa formalmente modos.
> OpenAI entra por lógica de tools/referee sin validar canal.
> No hay guardrail duro por modo.

### **Evidencia en Código**:

**chat.ts - Línea 784** (OpenAI Referee):
```typescript
// ❌ PROBLEMA: Referee NO valida canal (texto vs voz)
if (needsReferee && process.env.OPENAI_ROLE === 'referee') {
  try {
    console.log(`[ORCH] ⚖️ OPENAI REFEREE INVOKED`);
    
    const refereeResult = await invokeOpenAIReferee({
      userPrompt: userContent,
      groqResponse: llmResponse.response.text,
      // ❌ NO se pasa información de canal (voz vs texto)
    });
    
    llmResponse.response.text = refereeResult.text;
    refereeUsed = true;
  } catch (refereeError: any) {
    console.error(`[ORCH] ❌ REFEREE FAILED: ${refereeError.message}`);
  }
}
```

### **Por qué falla**:
1. Referee se invoca **sin saber** si es voz o texto
2. OpenAI puede entrar en **modo voz** por referee
3. **NO hay validación** de canal antes de invocar OpenAI

### **Fix Requerido**:
```typescript
// ✅ SOLUCIÓN: Blindar referee por modo
const isVoiceMode = req.body.mode === 'voice' || req.headers['x-channel'] === 'voice';

if (needsReferee && process.env.OPENAI_ROLE === 'referee') {
  // ✅ BLOQUEAR OpenAI en modo voz
  if (isVoiceMode) {
    console.warn(`[ORCH] ⚠️ REFEREE BLOCKED - Voice mode detected`);
    // Usar respuesta de Groq sin referee
  } else {
    // Texto: permitir referee
    const refereeResult = await invokeOpenAIReferee({
      userPrompt: userContent,
      groqResponse: llmResponse.response.text,
      channel: 'text'  // ← Pasar canal explícitamente
    });
    
    llmResponse.response.text = refereeResult.text;
    refereeUsed = true;
  }
}
```

---

## 🔴 PROBLEMA 6: NO GUARDA MEMORIA NUEVA

**Ya documentado en sección anterior - Ver PROBLEMA 3**

---

## 🔴 PROBLEMA 7 y 8: VOZ Y TELEGRAM SIN ORCHESTRATOR

**Ya documentado en sección anterior**

---

## 🛠️ PLAN DE REPARACIÓN COMPLETO (HOY - 17 ENERO 2026)

### **ORDEN DE EJECUCIÓN (NO NEGOCIABLE)**:

```
BLOQUE 1: ESTABILIDAD           → 30 min
BLOQUE 2: FECHA/HORA REAL       → 20 min  
BLOQUE 3: TOOLS OBLIGATORIAS    → 40 min
BLOQUE 4: MEMORIA GOBIERNA      → 45 min
BLOQUE 5: GUARDAR MEMORIA       → 30 min
BLOQUE 6: VOZ BLINDADA          → 15 min
BLOQUE 7: VOZ CON ORCHESTRATOR  → 30 min
BLOQUE 8: TELEGRAM CON ORCH     → 20 min
─────────────────────────────────────────
TOTAL:                           3h 50min
```

---

## 🔹 BLOQUE 1: ESTABILIDAD (P0 - 30 MIN)

### **Objetivo**: Errores explícitos > respuestas genéricas

### **Archivos a modificar**:
- `src/ai/orchestrator.ts`
- `src/api/chat.ts`

### **Cambios**:

#### 1.1 **Orchestrator: Detectar fallos silenciosos**

```typescript
// src/ai/orchestrator.ts - Después de línea 1100

// ✅ VALIDACIÓN: Si tool falló, NO permitir respuesta genérica
if (toolFailed) {
  console.error(`[ORCH] ❌ TOOL FAILED: ${toolUsed} - ${toolError}`);
  
  // Respuesta EXPLÍCITA de error
  return {
    content: `No pude consultar ${toolUsed}. Razón: ${toolError}. Intenta de nuevo.`,
    toolExecutions: [{
      tool: toolUsed,
      args: {},
      result: { success: false, error: toolError },
      success: false
    }]
  };
}
```

#### 1.2 **Chat: Log obligatorio de errores con stack trace**

```typescript
// src/api/chat.ts - Reemplazar catch de línea 1750

} catch (error: any) {
  console.error('[CHAT] ❌ CRITICAL ERROR:', {
    error: error.message,
    stack: error.stack?.substring(0, 500),
    intent: orchestratorContext?.intent?.intent_type,
    tool_used: orchestratorContext?.toolUsed,
    tool_failed: orchestratorContext?.toolFailed,
    timestamp: new Date().toISOString()
  });
  
  // Log en Supabase con contexto completo
  await supabase.from('ae_requests').insert({
    request_id: req.body.request_id || uuidv4(),
    session_id: sessionId,
    user_id: userId,
    endpoint: '/api/ai/chat',
    method: 'POST',
    status_code: 500,
    latency_ms: Date.now() - startTime,
    metadata: {
      error: error.message,
      error_type: error.name,
      stack: error.stack?.substring(0, 1000),
      intent: orchestratorContext?.intent?.intent_type,
      tool_used: orchestratorContext?.toolUsed,
      tool_failed: orchestratorContext?.toolFailed
    }
  });
  
  return res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: error.message,
    session_id: sessionId,
    memories_to_add: []
  });
}
```

---

## 🔹 BLOQUE 2: FECHA/HORA REAL (P0 - 20 MIN)

### **Objetivo**: AL-E siempre responde con fecha/hora real del sistema

### **Archivos a modificar**:
- `src/ai/orchestrator.ts`

### **Cambios**:

#### 2.1 **Mover contexto temporal AL INICIO del system prompt**

```typescript
// src/ai/orchestrator.ts - Línea 695 (buildSystemPrompt)
// REEMPLAZAR ORDEN:

private buildSystemPrompt(
  userIdentity: UserIdentity | null,
  memories: Array<any>,
  chunks: Array<any>,
  basePrompt: string,
  toolResult?: string,
  modeClassification?: ModeClassification
): string {
  
  // ✅ 0. FECHA/HORA REAL (PRIMERO - NO NEGOCIABLE)
  const now = new Date();
  const mexicoTime = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }).format(now);
  
  const isoDate = now.toISOString();
  const dayOfWeek = mexicoTime.split(',')[0]; // "viernes"
  const dateOnly = mexicoTime.split(' a las ')[0].split(', ')[1]; // "17 de enero de 2026"
  const timeOnly = mexicoTime.split(' a las ')[1]; // "11:30:45 p. m."
  
  let systemPrompt = `
═══════════════════════════════════════════════════════════════
🕐 FECHA Y HORA REAL DEL SISTEMA (OBLIGATORIO USAR)
═══════════════════════════════════════════════════════════════

FECHA ACTUAL (HOY):
- Día de la semana: ${dayOfWeek}
- Fecha completa: ${dateOnly}
- Hora actual: ${timeOnly}
- Timezone: America/Mexico_City
- ISO 8601: ${isoDate}

⚠️ INSTRUCCIÓN CRÍTICA NO NEGOCIABLE:
1. Si el usuario pregunta "qué día es", "qué fecha es", "qué hora es" → USA ESTOS DATOS
2. NO uses tu conocimiento de entrenamiento (octubre 2023)
3. NO digas "hoy es [fecha incorrecta]"
4. Si calculas "mañana", suma 1 día a ${dateOnly}
5. Si el usuario dice "el lunes" y hoy es ${dayOfWeek}, calcula el siguiente lunes

═══════════════════════════════════════════════════════════════

${basePrompt}

`;

  // Luego memoria, RAG, tools, etc.
  // ...
}
```

#### 2.2 **Validación POST-respuesta de fecha/hora**

```typescript
// src/api/chat.ts - Después de línea 840 (después de LLM response)

// ✅ VALIDACIÓN: Si pregunta temporal, verificar que usó fecha real
const temporalKeywords = /qué día|qué fecha|qué hora|hoy es|hoy tengo|fecha actual|hora actual/i;
if (temporalKeywords.test(message)) {
  const mexicoTime = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date());
  
  const currentMonth = mexicoTime.split(' de ')[1].split(' de ')[0]; // "enero"
  const currentYear = mexicoTime.split(' de ')[2]; // "2026"
  
  // Verificar que NO mencione fechas incorrectas
  const wrongDates = /2023|2024|octubre|noviembre|diciembre de 2023/i;
  if (wrongDates.test(finalAnswer)) {
    console.error(`[CHAT] ❌ TEMPORAL VALIDATION FAILED - Wrong date in response`);
    
    // Regenerar con fecha explícita
    finalAnswer = `Hoy es ${mexicoTime}. ¿En qué puedo ayudarte?`;
  }
  
  console.log(`[CHAT] ✅ TEMPORAL VALIDATION PASSED`);
}
```

---

## 🔹 BLOQUE 3: TOOLS OBLIGATORIAS (P0 - 40 MIN)

### **Objetivo**: Si intent requiere tool, DEBE ejecutarse o fallar explícitamente

### **Archivos a modificar**:
- `src/ai/orchestrator.ts`
- `src/ai/providers/groqProvider.ts`

### **Cambios**:

#### 3.1 **Forzar toolChoice='required' cuando intent lo indica**

```typescript
// src/ai/orchestrator.ts - Línea 525 (executeToolLoop)

async executeToolLoop(
  userId: string,
  messages: any[],
  systemPrompt: string,
  toolsAvailable: ToolDefinition[],
  model: string,
  maxIterations: number = 3,
  intent?: IntentClassification  // ← AGREGAR intent
): Promise<{ content: string; toolExecutions: any[] }> {
  
  console.log('[ORCH] 🔧 Starting tool execution loop...');
  
  const toolExecutions: any[] = [];
  let iteration = 0;
  
  // ✅ DETERMINAR SI TOOLS SON OBLIGATORIAS
  const toolsRequired = intent?.tools_required && intent.tools_required.length > 0;
  const toolChoice = toolsRequired ? 'required' : 'auto';
  
  console.log(`[ORCH] 🔧 Tool choice: ${toolChoice} (required: ${toolsRequired})`);
  
  while (iteration < maxIterations) {
    iteration++;
    console.log(`[ORCH] 🔄 Tool loop iteration ${iteration}/${maxIterations}`);
    
    const { callGroqChat } = await import('./providers/groqProvider');
    
    const llmResponse = await callGroqChat({
      messages,
      tools: toolsAvailable,
      toolChoice,  // ← 'required' si intent lo indica
      model,
      maxTokens: 600
    });
    
    // ✅ VALIDACIÓN: Si tool era required y NO se ejecutó → ERROR
    if (toolsRequired && (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0)) {
      console.error(`[ORCH] ❌ TOOL REQUIRED BUT NOT EXECUTED`);
      console.error(`[ORCH] ❌ Required tools: ${intent!.tools_required.join(', ')}`);
      
      return {
        content: `No pude consultar la información requerida (${intent!.tools_required.join(', ')}). Por favor intenta de nuevo.`,
        toolExecutions: [{
          tool: 'none',
          args: {},
          result: { 
            success: false, 
            error: 'TOOL_REQUIRED_NOT_EXECUTED',
            required: intent!.tools_required 
          },
          success: false
        }]
      };
    }
    
    // Si NO hay tool_calls y NO eran required → respuesta directa OK
    if (!llmResponse.tool_calls || llmResponse.tool_calls.length === 0) {
      console.log('[ORCH] ℹ️ No tool calls - returning direct response');
      return {
        content: llmResponse.content,
        toolExecutions: []
      };
    }
    
    // Continuar con ejecución de tools...
    // (resto del código existente)
  }
}
```

#### 3.2 **Actualizar llamada en chat.ts para pasar intent**

```typescript
// src/api/chat.ts - Línea 655 (llamada a executeToolLoop)

const toolLoopResult = await orchestrator.executeToolLoop(
  userId,
  conversationMessages,
  orchestratorContext.systemPrompt,
  toolsAvailable,
  modelUsed,
  3,  // Max 3 iteraciones
  orchestratorContext.intent  // ← PASAR intent
);
```

---

## 🔹 BLOQUE 4: MEMORIA GOBIERNA (P0 - 45 MIN)

### **Objetivo**: Memoria no es texto, es estado vinculante

### **Archivos a crear/modificar**:
- **CREAR**: `src/services/memoryGovernor.ts`
- **MODIFICAR**: `src/ai/orchestrator.ts`

### **Cambios**:

#### 4.1 **Crear Memory Governor (Estado vinculante)**

```typescript
// src/services/memoryGovernor.ts (NUEVO ARCHIVO)

import { supabase } from '../db/supabase';

export interface UserMemoryState {
  userName: string | null;
  preferredName: string | null;
  assistantName: string | null;
  tonePref: string | null;
  preferences: Array<{ content: string; importance: number }>;
  agreements: Array<{ content: string; importance: number }>;
  facts: Array<{ content: string; importance: number }>;
  lastUpdate: string;
}

/**
 * Cargar y estructurar memoria del usuario
 */
export async function loadUserMemoryState(
  userId: string,
  workspaceId: string
): Promise<UserMemoryState> {
  console.log(`[MEMORY_GOVERNOR] Loading state for user: ${userId}`);
  
  // 1. Cargar user_profile
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('display_name, preferred_name, assistant_name, tone_pref')
    .eq('user_id', userId)
    .single();
  
  // 2. Cargar memorias de assistant_memories
  const { data: memories } = await supabase
    .from('assistant_memories')
    .select('memory, importance, created_at')
    .or(`user_id_uuid.eq.${userId},user_id.eq.${userId}`)
    .eq('workspace_id', workspaceId)
    .gte('importance', 0.1)
    .order('importance', { ascending: false })
    .limit(20);
  
  // 3. Estructurar por tipo
  const state: UserMemoryState = {
    userName: profile?.display_name || null,
    preferredName: profile?.preferred_name || null,
    assistantName: profile?.assistant_name || 'AL-E',
    tonePref: profile?.tone_pref || 'profesional',
    preferences: [],
    agreements: [],
    facts: [],
    lastUpdate: new Date().toISOString()
  };
  
  // 4. Clasificar memorias
  for (const mem of memories || []) {
    const content = mem.memory;
    
    if (content.includes('[preference]')) {
      state.preferences.push({ content, importance: mem.importance });
    } else if (content.includes('[agreement]')) {
      state.agreements.push({ content, importance: mem.importance });
    } else if (content.includes('[fact]')) {
      state.facts.push({ content, importance: mem.importance });
    } else {
      // Default: fact
      state.facts.push({ content, importance: mem.importance });
    }
  }
  
  console.log(`[MEMORY_GOVERNOR] ✓ State loaded:`, {
    userName: state.userName,
    preferredName: state.preferredName,
    preferences: state.preferences.length,
    agreements: state.agreements.length,
    facts: state.facts.length
  });
  
  return state;
}

/**
 * Validar que respuesta respeta memoria
 */
export function validateResponseAgainstMemory(
  response: string,
  userMessage: string,
  memoryState: UserMemoryState
): { valid: boolean; reason?: string; correctedResponse?: string } {
  
  // Validación 1: Si pregunta nombre, debe usar memoria
  if (userMessage.match(/cómo me llamo|mi nombre|quién soy/i)) {
    if (!memoryState.preferredName) {
      return {
        valid: true // No hay memoria de nombre, OK responder que no sabe
      };
    }
    
    if (!response.includes(memoryState.preferredName)) {
      return {
        valid: false,
        reason: 'USER_NAME_NOT_USED',
        correctedResponse: `Te llamas ${memoryState.preferredName}.`
      };
    }
  }
  
  // Validación 2: Si hay acuerdos, no debe contradecirlos
  for (const agreement of memoryState.agreements) {
    // TODO: Implementar lógica de contradicción semántica
  }
  
  return { valid: true };
}
```

#### 4.2 **Integrar Memory Governor en Orchestrator**

```typescript
// src/ai/orchestrator.ts - Línea 1060 (método orchestrate)

import { loadUserMemoryState, validateResponseAgainstMemory } from '../services/memoryGovernor';

async orchestrate(request: OrchestratorRequest, basePrompt: string): Promise<OrchestratorContext> {
  // ... código existente ...
  
  // STEP 3: Memories (REEMPLAZAR con Memory Governor)
  console.log('[ORCH] STEP 3: Loading memory state...');
  const memoryState = isAuthenticated 
    ? await loadUserMemoryState(userId, request.workspaceId)
    : null;
  console.log(`[ORCH] STEP 3: ✓ Memory state loaded`);
  
  // ... resto del código ...
  
  // STEP 7: Build system prompt (USAR memoryState)
  const systemPrompt = this.buildSystemPromptWithMemoryState(
    memoryState,  // ← Estado estructurado, no array de texto
    chunks,
    basePrompt,
    toolResult,
    modeClassification
  );
  
  // ... resto del código ...
  
  const context: OrchestratorContext = {
    isAuthenticated,
    userId,
    userIdentity,
    memoryState,  // ← Agregar memoryState al contexto
    memories: memoryState?.facts || [],  // Compatibilidad con código existente
    chunks,
    intent,
    responseMode: modeClassification.mode,
    modeClassification,
    toolUsed,
    toolReason,
    toolResult,
    toolFailed,
    toolError,
    tavilyResponse,
    tools: tools.length > 0 ? tools : undefined,
    modelSelected,
    modelReason,
    systemPrompt,
    memoryCount: (memoryState?.facts.length || 0) + 
                 (memoryState?.preferences.length || 0) + 
                 (memoryState?.agreements.length || 0),
    ragHits: chunks.length,
    webSearchUsed,
    webResultsCount,
    cacheHit: false,
    inputTokens,
    outputTokens: 0,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    answerMode
  };
  
  return context;
}
```

#### 4.3 **Validar respuesta contra memoria**

```typescript
// src/api/chat.ts - Después de línea 840 (después de LLM response)

// ✅ VALIDACIÓN: Respuesta respeta memoria
if (orchestratorContext.memoryState) {
  const { validateResponseAgainstMemory } = await import('../services/memoryGovernor');
  
  const validation = validateResponseAgainstMemory(
    finalAnswer,
    message,
    orchestratorContext.memoryState
  );
  
  if (!validation.valid) {
    console.error(`[CHAT] ❌ MEMORY VALIDATION FAILED: ${validation.reason}`);
    
    // Usar respuesta corregida
    if (validation.correctedResponse) {
      finalAnswer = validation.correctedResponse;
      console.log(`[CHAT] ✓ Response corrected using memory`);
    }
  } else {
    console.log(`[CHAT] ✅ MEMORY VALIDATION PASSED`);
  }
}
```

---

## 🔹 BLOQUE 5: GUARDAR MEMORIA NUEVA (P0 - 30 MIN)

### **Archivos a crear/modificar**:
- **CREAR**: `src/services/memoryExtractor.ts`
- **MODIFICAR**: `src/api/chat.ts`

### **Cambios**:

#### 5.1 **Crear Memory Extractor**

```typescript
// src/services/memoryExtractor.ts (NUEVO ARCHIVO)

import { supabase } from '../db/supabase';

export interface ExtractedMemory {
  content: string;
  type: 'fact' | 'preference' | 'agreement' | 'decision';
  importance: number;
}

/**
 * Extraer memorias importantes de la conversación
 */
export async function extractAndSaveMemories(
  userId: string,
  workspaceId: string,
  userMessage: string,
  assistantResponse: string,
  context?: any
): Promise<void> {
  console.log(`[MEMORY_EXTRACTOR] Analyzing conversation...`);
  
  const memories: ExtractedMemory[] = [];
  
  // 1. Detectar nombre del usuario
  const nameMatch = userMessage.match(/me llamo (\w+)|mi nombre es (\w+)|soy (\w+)/i);
  if (nameMatch) {
    const name = nameMatch[1] || nameMatch[2] || nameMatch[3];
    memories.push({
      content: `[fact] El usuario se llama ${name}`,
      type: 'fact',
      importance: 1.0  // Máxima importancia
    });
    
    // Actualizar user_profile
    await supabase
      .from('user_profiles')
      .upsert({
        user_id: userId,
        preferred_name: name,
        display_name: name,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });
    
    console.log(`[MEMORY_EXTRACTOR] ✓ User name updated: ${name}`);
  }
  
  // 2. Detectar preferencias
  const prefMatch = userMessage.match(/prefiero|me gusta|quiero que|no me gusta/i);
  if (prefMatch) {
    memories.push({
      content: `[preference] ${userMessage}`,
      type: 'preference',
      importance: 0.7
    });
  }
  
  // 3. Detectar acuerdos/decisiones
  const agreementMatch = userMessage.match(/quedamos|acordamos|entonces|de acuerdo|ok|perfecto/i);
  if (agreementMatch) {
    memories.push({
      content: `[agreement] ${assistantResponse}`,
      type: 'agreement',
      importance: 0.8
    });
  }
  
  // 4. Detectar contexto de negocio importante
  const businessMatch = userMessage.match(/proyecto|cliente|empresa|negocio|contrato/i);
  if (businessMatch) {
    memories.push({
      content: `[fact] ${userMessage}`,
      type: 'fact',
      importance: 0.6
    });
  }
  
  // 5. Guardar memorias
  if (memories.length > 0) {
    for (const mem of memories) {
      const { error } = await supabase
        .from('assistant_memories')
        .insert({
          workspace_id: workspaceId,
          user_id: userId,
          user_id_uuid: userId,
          mode: 'universal',
          memory: mem.content,
          importance: mem.importance,
          created_at: new Date().toISOString()
        });
      
      if (error) {
        console.error(`[MEMORY_EXTRACTOR] ❌ Error saving memory:`, error);
      } else {
        console.log(`[MEMORY_EXTRACTOR] ✓ Saved: "${mem.content.substring(0, 80)}..." (importance: ${mem.importance})`);
      }
    }
  } else {
    console.log(`[MEMORY_EXTRACTOR] ℹ️ No important information to save`);
  }
}
```

#### 5.2 **Integrar en chat.ts**

```typescript
// src/api/chat.ts - Después de línea 1729 (antes de return res.json)

// ✅ GUARDAR MEMORIA NUEVA
if (userId && userId !== 'guest' && isAuthenticated) {
  try {
    const { extractAndSaveMemories } = await import('../services/memoryExtractor');
    
    await extractAndSaveMemories(
      userId,
      finalWorkspaceId,
      message,
      finalAnswer,
      { sessionId, orchestratorContext }
    );
  } catch (memError) {
    console.error('[CHAT] ❌ Error saving memories:', memError);
    // No bloquear respuesta por error de memoria
  }
}

return res.json({
  answer: finalAnswer,
  speak_text: markdownToSpeakable(finalAnswer),
  should_speak: shouldSpeak(finalAnswer),
  session_id: sessionId,
  memories_to_add: [], // Deprecated - memoria se guarda automáticamente
  sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
  metadata: {
    latency_ms,
    provider: llmResult.fallbackChain.final_provider,
    model: orchestratorContext.modelSelected,
    intent: orchestratorContext.intent?.intent_type,
    action_executed: orchestratorContext.toolUsed !== 'none',
    guardrail_applied: guardrailResult.sanitized
  }
});
```

---

## 🔹 BLOQUE 6: VOZ BLINDADA (P0 - 15 MIN)

### **Objetivo**: OpenAI NUNCA entra en modo voz

### **Archivos a modificar**:
- `src/api/chat.ts`

### **Cambios**:

```typescript
// src/api/chat.ts - Línea 784 (Referee)

// ✅ DETECTAR MODO VOZ
const isVoiceMode = req.body.mode === 'voice' || 
                    req.headers['x-channel'] === 'voice' ||
                    req.body.voice === true;

if (needsReferee && process.env.OPENAI_ROLE === 'referee') {
  
  // ✅ BLOQUEAR OpenAI en modo voz
  if (isVoiceMode) {
    console.warn(`[ORCH] ⚠️ REFEREE BLOCKED - Voice mode detected`);
    console.warn(`[ORCH] ⚠️ Using Groq response without OpenAI correction`);
    
    // Log obligatorio de bloqueo
    await supabase.from('ae_requests').insert({
      request_id: uuidv4(),
      session_id: sessionId,
      user_id: userId,
      endpoint: '/api/ai/chat',
      method: 'POST',
      status_code: 200,
      latency_ms: Date.now() - startTime,
      metadata: {
        referee_blocked: true,
        reason: 'VOICE_MODE_OPENAI_FORBIDDEN',
        model_used: 'groq',
        channel: 'voice'
      }
    });
    
    // NO invocar referee
  } else {
    // Modo texto: permitir referee
    try {
      console.log(`[ORCH] ⚖️ OPENAI REFEREE INVOKED - channel=text`);
      
      const refereeResult = await invokeOpenAIReferee({
        userPrompt: userContent,
        groqResponse: llmResponse.response.text,
        toolResults: orchestratorContext.toolResult ? { result: orchestratorContext.toolResult } : undefined,
        systemState: {
          tool_used: orchestratorContext.toolUsed,
          tool_failed: orchestratorContext.toolFailed,
          web_search: orchestratorContext.webSearchUsed,
          web_results: orchestratorContext.webResultsCount
        },
        detectedIssue: evasionCheck.reason || 'evidence_mismatch',
        channel: 'text'  // ← Pasar canal explícitamente
      });
      
      llmResponse.response.text = refereeResult.text;
      refereeUsed = true;
      refereeReason = refereeResult.reason;
      refereeCost = refereeResult.cost_estimated_usd;
      refereeLatency = refereeResult.latency_ms;
      
      console.log(`[ORCH] ✅ REFEREE CORRECTED - channel=text`);
      
    } catch (refereeError: any) {
      console.error(`[ORCH] ❌ REFEREE FAILED: ${refereeError.message}`);
    }
  }
}
```

---

## 🔹 BLOQUE 7: VOZ CON ORCHESTRATOR (P1 - 30 MIN)

### **Objetivo**: voice.ts usa orchestrator para tener memoria

### **Archivos a modificar**:
- `src/api/voice.ts`

### **Cambios**:

```typescript
// src/api/voice.ts - Agregar DESPUÉS de línea 453 (final del archivo)

/**
 * POST /api/voice/chat
 * Endpoint completo: STT → Chat con memoria → TTS
 */
router.post('/chat', async (req, res) => {
  const startTime = Date.now();
  console.log('[VOICE_CHAT] 🎤 Request recibido');
  
  try {
    const { userId, sessionId, workspaceId = 'al-eon' } = req.body;
    const audioFile = req.file;
    
    // Validaciones
    if (!audioFile) {
      return res.status(400).json({
        error: 'NO_AUDIO_FILE',
        message: 'No se recibió archivo de audio'
      });
    }
    
    if (!userId) {
      return res.status(400).json({
        error: 'NO_USER_ID',
        message: 'userId es requerido'
      });
    }
    
    // 1. STT: Transcribir audio
    console.log('[VOICE_CHAT] 🔄 Transcribing audio...');
    
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `voice_chat_${uuidv4()}.${audioFile.originalname.split('.').pop()}`);
    fs.writeFileSync(tempFilePath, audioFile.buffer);
    
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3-turbo',
      language: 'es',
      response_format: 'json',
      temperature: 0.0
    });
    
    fs.unlinkSync(tempFilePath);
    
    const transcript = transcription.text;
    console.log(`[VOICE_CHAT] ✓ Transcript: "${transcript}"`);
    
    // 2. CHAT: Procesar con orchestrator (memoria incluida)
    console.log('[VOICE_CHAT] 🧠 Processing with orchestrator...');
    
    const chatResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/ai/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-channel': 'voice'  // ← Marcar canal de voz
      },
      body: JSON.stringify({
        userId,
        sessionId,
        workspaceId,
        mode: 'universal',
        voice: true,  // ← Flag de modo voz
        messages: [{ role: 'user', content: transcript }]
      })
    });
    
    if (!chatResponse.ok) {
      throw new Error(`Chat API error: ${chatResponse.statusText}`);
    }
    
    const chatData = await chatResponse.json();
    console.log(`[VOICE_CHAT] ✓ Chat response received`);
    
    // 3. TTS: Sintetizar respuesta
    console.log('[VOICE_CHAT] 🔊 Synthesizing speech...');
    
    const speakText = chatData.speak_text || chatData.answer;
    
    // Limpiar y truncar para TTS
    let cleanText = speakText
      .replace(/#{1,6}\s/g, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/^[-*]\s/gm, '')
      .trim();
    
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    if (sentences.length > 2) {
      cleanText = sentences.slice(0, 2).join(' ');
    }
    
    const outputFile = path.join(os.tmpdir(), `tts_voice_${uuidv4()}.mp3`);
    
    const ttsCommand = `edge-tts --voice "es-MX-DaliaNeural" --text "${cleanText.replace(/"/g, '\\"')}" --write-media "${outputFile}"`;
    await execPromise(ttsCommand, { timeout: 15000 });
    
    const audioBuffer = fs.readFileSync(outputFile);
    fs.unlinkSync(outputFile);
    
    const latency_ms = Date.now() - startTime;
    console.log(`[VOICE_CHAT] ✅ Completed in ${latency_ms}ms`);
    
    // Log en ae_requests
    await supabase.from('ae_requests').insert({
      request_id: uuidv4(),
      session_id: sessionId,
      user_id: userId,
      endpoint: '/api/voice/chat',
      method: 'POST',
      status_code: 200,
      latency_ms,
      metadata: {
        transcript_length: transcript.length,
        response_length: chatData.answer.length,
        tts_chars: cleanText.length,
        audio_bytes: audioBuffer.length,
        channel: 'voice',
        with_memory: true
      }
    });
    
    return res.json({
      transcript,
      answer: chatData.answer,
      speak_text: cleanText,
      audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
      session_id: chatData.session_id,
      metadata: {
        latency_ms,
        with_memory: true,
        orchestrator_used: true
      }
    });
    
  } catch (error: any) {
    console.error('[VOICE_CHAT] ❌ Error:', error);
    
    return res.status(500).json({
      error: 'VOICE_CHAT_ERROR',
      message: error.message
    });
  }
});

// Configurar multer para /chat endpoint
router.post('/chat', upload.single('audio'), router.post.bind(router));
```

---

## 🔹 BLOQUE 8: TELEGRAM CON ORCHESTRATOR (P1 - 20 MIN)

### **Objetivo**: telegram.ts usa orchestrator para tener memoria

### **Archivos a modificar**:
- `src/api/telegram.ts`

### **Cambios**:

```typescript
// src/api/telegram.ts - REEMPLAZAR línea 339 (TODO)

if (update.message && update.message.text) {
  const chatId = update.message.chat.id;
  const userId = update.message.from.id;
  const username = update.message.from.username;
  const firstName = update.message.from.first_name;
  const lastName = update.message.from.last_name;
  const text = update.message.text;
  const messageId = update.message.message_id;
  const messageDate = new Date(update.message.date * 1000);
  
  const chatName = firstName && lastName 
    ? `${firstName} ${lastName}` 
    : firstName || username || `Usuario ${userId}`;
  
  console.log(`[TELEGRAM] Mensaje de ${chatName} (@${username}) [${chatId}]: ${text}`);
  
  // Registrar/actualizar chat (código existente...)
  // ...
  
  // Guardar mensaje inbound (código existente...)
  // ...
  
  // ✅ PROCESAR CON ORCHESTRATOR (REEMPLAZAR TODO)
  try {
    console.log(`[TELEGRAM] 🧠 Processing with orchestrator...`);
    
    const chatResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/ai/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-channel': 'telegram'
      },
      body: JSON.stringify({
        userId: bot.owner_user_id,
        sessionId: null,  // Nueva sesión por mensaje
        workspaceId: 'al-eon',
        mode: 'universal',
        messages: [{ role: 'user', content: text }],
        userDisplayName: chatName,
        userEmail: username ? `${username}@telegram` : null
      })
    });
    
    if (!chatResponse.ok) {
      throw new Error(`Chat API error: ${chatResponse.statusText}`);
    }
    
    const chatData = await chatResponse.json();
    console.log(`[TELEGRAM] ✓ Chat response received`);
    
    // Enviar respuesta por Telegram
    const botToken = decrypt(bot.bot_token_enc);
    const telegramBot = new TelegramBot(botToken);
    
    await telegramBot.sendMessage(chatId, chatData.answer, {
      parse_mode: 'Markdown'
    });
    
    console.log(`[TELEGRAM] ✓ Response sent to ${chatId}`);
    
    // Guardar mensaje outbound
    await supabase.from('telegram_messages').insert({
      owner_user_id: bot.owner_user_id,
      bot_id: botId,
      chat_id: chatId,
      direction: 'outbound',
      text: chatData.answer,
      status: 'sent',
      metadata: {
        session_id: chatData.session_id,
        with_memory: true,
        orchestrator_used: true
      }
    });
    
  } catch (error: any) {
    console.error('[TELEGRAM] ❌ Error processing message:', error);
    
    // Respuesta de error al usuario
    try {
      const botToken = decrypt(bot.bot_token_enc);
      const telegramBot = new TelegramBot(botToken);
      await telegramBot.sendMessage(chatId, 'Ocurrió un error al procesar tu mensaje. Intenta de nuevo.');
    } catch (sendError) {
      console.error('[TELEGRAM] ❌ Error sending error message:', sendError);
    }
  }
}
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

### **ORDEN DE EJECUCIÓN (PRIORIDAD)**:

- [ ] **BLOQUE 1: ESTABILIDAD** (30 min)
  - [ ] Orquestador: Detectar fallos silenciosos
  - [ ] Chat: Log obligatorio con stack trace
  - [ ] Validar errores explícitos

- [ ] **BLOQUE 2: FECHA/HORA** (20 min)
  - [ ] Mover contexto temporal al inicio
  - [ ] Validación POST-respuesta de fecha
  - [ ] Test: "¿Qué día es hoy?"

- [ ] **BLOQUE 3: TOOLS OBLIGATORIAS** (40 min)
  - [ ] Forzar toolChoice='required'
  - [ ] Validar ejecución de tools
  - [ ] Test: "Revisa mi correo" (DEBE ejecutar list_emails)

- [ ] **BLOQUE 4: MEMORIA GOBIERNA** (45 min)
  - [ ] Crear memoryGovernor.ts
  - [ ] Integrar en orchestrator
  - [ ] Validar respuestas contra memoria
  - [ ] Test: "Me llamo X" → "¿Cómo me llamo?"

- [ ] **BLOQUE 5: GUARDAR MEMORIA** (30 min)
  - [ ] Crear memoryExtractor.ts
  - [ ] Integrar en chat.ts
  - [ ] Validar guardado en Supabase
  - [ ] Test: Verificar assistant_memories después de conversación

- [ ] **BLOQUE 6: VOZ BLINDADA** (15 min)
  - [ ] Detectar modo voz
  - [ ] Bloquear OpenAI referee en voz
  - [ ] Log obligatorio de bloqueo

- [ ] **BLOQUE 7: VOZ CON ORCHESTRATOR** (30 min)
  - [ ] Crear /api/voice/chat
  - [ ] Integrar STT → Chat → TTS
  - [ ] Test: Conversación por voz con memoria

- [ ] **BLOQUE 8: TELEGRAM CON ORCH** (20 min)
  - [ ] Modificar webhook para usar orchestrator
  - [ ] Test: Mensajes de Telegram con memoria

---

## 🎯 TESTS DE VALIDACIÓN

### **Test 1: Fecha/Hora Real**
```
Input: "¿Qué día es hoy?"
Output esperado: "Hoy es viernes, 17 de enero de 2026"
Output prohibido: "Hoy es 15 de octubre de 2023"
```

### **Test 2: Memoria Gobierna**
```
Input 1: "Me llamo Patto"
Output 1: "Perfecto, Patto"

[Nueva sesión]

Input 2: "¿Cómo me llamo?"
Output esperado: "Te llamas Patto"
Output prohibido: "¿Cómo te llamas?"
```

### **Test 3: Tools Obligatorias**
```
Input: "Revisa mi correo"
Validación: DEBE ejecutar list_emails
Output prohibido: "No encontré correos" SIN ejecutar tool
```

### **Test 4: No Inventa**
```
Input: "¿Cuánto cuesta Bitcoin ahora?"
Validación: DEBE ejecutar web_search
Output prohibido: Precio inventado sin web_search
```

### **Test 5: Voz con Memoria**
```
Input (voz): "Me llamo Luis"
Output (voz): "Perfecto, Luis"

[Nueva sesión voz]

Input (voz): "¿Cómo me llamo?"
Output (voz): "Te llamas Luis"
```

---

## 📏 REGLA DE ORO (NO NEGOCIABLE)

> Si algo ya funcionaba y hoy no funciona:
> 👉 es P0
> 👉 se arregla antes de tocar otra cosa
> 👉 no se parcha
> 👉 no se maquilla

---

## 🚀 SIGUIENTE PASO INMEDIATO

**Implementar BLOQUE 1: ESTABILIDAD (30 min)**

¿Procedo con la implementación?

---

## 🔴 PROBLEMAS ENCONTRADOS

### 1. **CARGA DE MEMORIA: ✅ FUNCIONA CORRECTAMENTE**

**Ubicación**: `src/ai/orchestrator.ts` línea 1065

```typescript
// STEP 3: Memories
console.log('[ORCH] STEP 3: Loading memories...');
const memories = isAuthenticated 
  ? await this.loadMemories(userId, workspaceId, projectId)
  : [];
console.log(`[ORCH] STEP 3: ✓ Loaded ${memories.length} memories`);
```

**Query que ejecuta** (`src/ai/orchestrator.ts` línea 160):

```typescript
const { data: userMemories, error: userError } = await supabase
  .from('assistant_memories')
  .select('id, memory, importance, created_at, mode, user_id, user_id_uuid, user_id_old')
  .eq('workspace_id', workspaceId)
  .or(`user_id_uuid.eq.${userId},user_id.eq.${userId},user_id_old.eq.${userId}`)
  .gte('importance', 0.1) // Solo memorias con importancia >= 0.1
  .order('importance', { ascending: false })
  .limit(20);
```

**✅ CONCLUSIÓN**: La carga de memoria funciona correctamente y busca en las 3 columnas de user_id.

---

### 2. **GUARDADO DE MEMORIA: ❌ NO EXISTE**

**Ubicación**: `src/api/chat.ts` - TODO el archivo

**Búsqueda realizada**: 
```bash
grep -n "memories_to_add\|saveMemory\|insert.*assistant_memories" src/api/chat.ts
```

**Resultado**: 
- `memories_to_add` aparece **15 veces**
- **TODAS las veces está VACÍO**: `memories_to_add: []`
- **NO existe código** que extraiga memorias de la conversación
- **NO existe código** que inserte en `assistant_memories`

**Ejemplo** (línea 1729):

```typescript
return res.json({
  answer: finalAnswer,
  speak_text: markdownToSpeakable(finalAnswer),
  should_speak: shouldSpeak(finalAnswer),
  session_id: sessionId,
  memories_to_add: [], // ❌ TODO: Implementar extracción de memories
  sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
  metadata: { /* ... */ }
});
```

**❌ CONCLUSIÓN**: NO existe lógica de guardado de memoria nueva.

---

### 3. **VOZ Y TELEGRAM: ❌ NO USAN ORCHESTRATOR**

#### **voice.ts** (`src/api/voice.ts`)

**Búsqueda realizada**:
```bash
grep -n "orchestrate\|Orchestrator\|getUserMemoryContext\|getRelevantMemories\|assistant_memories" src/api/voice.ts
```

**Resultado**: `No matches found`

**❌ CONCLUSIÓN**: `voice.ts` NO carga memoria, NO usa orchestrator.

---

#### **telegram.ts** (`src/api/telegram.ts`)

**Búsqueda realizada**:
```bash
grep -n "orchestrate\|Orchestrator\|getUserMemoryContext\|getRelevantMemories\|assistant_memories" src/api/telegram.ts
```

**Resultado**: 
```typescript
// Línea 339
// TODO: Enviar a orchestrator para procesamiento
```

**❌ CONCLUSIÓN**: `telegram.ts` tiene un TODO pendiente. NO usa orchestrator.

---

## 🔍 LOGS Y TRAZABILIDAD

### **Logs de carga de memoria** (orchestrator.ts)

**Logs existentes**:

```typescript
console.log(`[ORCH] 🔍 Loading memories for userId: ${userId}, workspaceId: ${workspaceId}`);
console.log(`[ORCH] ✅ Loaded ${userMemories?.length || 0} memories from assistant_memories table`);
console.log('[ORCH] 📝 Sample memories:', userMemories.slice(0, 2).map(m => ({
  id: m.id,
  preview: m.memory.substring(0, 80) + '...',
  importance: m.importance,
  mode: m.mode,
  user_id: m.user_id,
  user_id_uuid: m.user_id_uuid,
  user_id_old: m.user_id_old
})));
```

✅ **BUENOS LOGS**: Detallados, con IDs, preview y columnas de user_id.

---

### **Logs de guardado de memoria**

**Logs existentes**: ❌ **NINGUNO**

**Razón**: No existe código de guardado.

---

## 📊 TABLA COMPARATIVA: FLUJOS DE MEMORIA

| Endpoint/Canal | ¿Carga memoria? | ¿Guarda memoria? | ¿Usa orchestrator? |
|----------------|-----------------|------------------|--------------------|
| `/api/ai/chat` | ✅ SÍ (orchestrator) | ❌ NO | ✅ SÍ |
| `/api/voice/stt` | ❌ NO | ❌ NO | ❌ NO |
| `/api/voice/tts` | ❌ NO | ❌ NO | ❌ NO |
| `/api/telegram/webhook` | ❌ NO | ❌ NO | ❌ NO |

---

## 🧬 ROOT CAUSE ANALYSIS

### **¿Qué pasó?**

1. **Se implementó el orchestrator** que SÍ carga memoria (commit reciente).
2. **Se olvidó implementar el guardado** de memoria nueva.
3. **Voice y Telegram** nunca se integraron con el orchestrator.

### **¿Por qué pasó?**

- El sistema evolucionó de forma **fragmentada**.
- **Chat text** usa orchestrator.
- **Voice y Telegram** quedaron como endpoints legacy sin memoria.

### **¿Cuándo pasó?**

- **Reciente**: El orchestrator tiene logs de días recientes.
- **Antes funcionaba**: Existía `assistant-memory-critical.ts` con lógica de memoria.

---

## 🛠️ PLAN DE REPARACIÓN (HOY - 17 ENERO 2026)

### **BLOQUE 1: GUARDADO DE MEMORIA EN CHAT** (P0 - CRÍTICO)

**Objetivo**: Implementar extracción y guardado automático de memoria en `/api/chat`.

**Pasos**:

1. **Crear servicio de extracción de memoria**
   - `src/services/memoryExtractor.ts`
   - Analizar conversación y detectar:
     - Nombre del usuario
     - Preferencias
     - Decisiones importantes
     - Acuerdos
     - Contexto de negocio

2. **Integrar en chat.ts**
   - Después de recibir respuesta del LLM
   - Extraer memorias relevantes
   - Guardar en `assistant_memories` con `importance` calculado

3. **Criterios de guardado**:
   - Guardar si se menciona nombre del usuario
   - Guardar si se toma una decisión
   - Guardar si se define una preferencia
   - **NO** guardar conversación trivial

**Código propuesto**:

```typescript
// src/services/memoryExtractor.ts
export async function extractAndSaveMemories(
  userId: string,
  workspaceId: string,
  userMessage: string,
  assistantResponse: string,
  sessionContext: any
): Promise<void> {
  // 1. Detectar información importante
  const memories = await detectImportantInfo(userMessage, assistantResponse);
  
  // 2. Guardar cada memoria
  for (const mem of memories) {
    await supabase.from('assistant_memories').insert({
      workspace_id: workspaceId,
      user_id: userId,
      user_id_uuid: userId,
      mode: 'universal',
      memory: mem.content,
      importance: mem.importance, // 0.0 - 1.0
      created_at: new Date().toISOString()
    });
    
    console.log(`[MEMORY] ✓ Saved: "${mem.content.substring(0, 80)}..." (importance: ${mem.importance})`);
  }
}

function detectImportantInfo(userMsg: string, assistantMsg: string): Array<{content: string, importance: number}> {
  const memories: Array<{content: string, importance: number}> = [];
  
  // Detectar nombre del usuario
  const nameMatch = userMsg.match(/me llamo (\w+)|mi nombre es (\w+)|soy (\w+)/i);
  if (nameMatch) {
    const name = nameMatch[1] || nameMatch[2] || nameMatch[3];
    memories.push({
      content: `El usuario se llama ${name}`,
      importance: 1.0 // Máxima importancia
    });
  }
  
  // Detectar preferencias
  if (userMsg.match(/prefiero|me gusta|quiero que/i)) {
    memories.push({
      content: `Preferencia: ${userMsg}`,
      importance: 0.7
    });
  }
  
  // Detectar acuerdos
  if (userMsg.match(/quedamos|acordamos|entonces|ok/i)) {
    memories.push({
      content: `Acuerdo: ${assistantMsg}`,
      importance: 0.8
    });
  }
  
  return memories;
}
```

**Integración en chat.ts** (después de línea 1729):

```typescript
// ANTES:
return res.json({
  answer: finalAnswer,
  speak_text: markdownToSpeakable(finalAnswer),
  should_speak: shouldSpeak(finalAnswer),
  session_id: sessionId,
  memories_to_add: [], // ❌ TODO: Implementar extracción de memories
  sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
  metadata: { /* ... */ }
});

// DESPUÉS:
// 🧠 EXTRAER Y GUARDAR MEMORIA NUEVA
if (userId && userId !== 'guest') {
  try {
    await extractAndSaveMemories(
      userId,
      finalWorkspaceId,
      message,
      finalAnswer,
      { sessionId, orchestratorContext }
    );
  } catch (memError) {
    console.error('[CHAT] ❌ Error saving memories:', memError);
    // No bloquear respuesta por error de memoria
  }
}

return res.json({
  answer: finalAnswer,
  speak_text: markdownToSpeakable(finalAnswer),
  should_speak: shouldSpeak(finalAnswer),
  session_id: sessionId,
  memories_to_add: [], // Deprecated - memoria se guarda automáticamente
  sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
  metadata: { /* ... */ }
});
```

---

### **BLOQUE 2: INTEGRAR VOICE CON ORCHESTRATOR** (P1 - IMPORTANTE)

**Objetivo**: Que voice.ts use orchestrator para tener memoria.

**Problema actual**: 
- `voice.ts` solo transcribe/sintetiza
- NO procesa intención ni carga contexto

**Solución**:

1. **voice.ts** llama a `/api/ai/chat` internamente
2. Chat devuelve respuesta con memoria
3. Voice sintetiza la respuesta

**Código propuesto**:

```typescript
// voice.ts - Después de STT (línea 350)
router.post('/chat-voice', async (req, res) => {
  const { transcript, sessionId, userId } = req.body;
  
  // 1. Transcribir audio (ya existe)
  // ... código STT existente ...
  
  // 2. Enviar a chat con memoria
  const chatResponse = await fetch('http://localhost:3001/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      sessionId,
      workspaceId: 'al-eon',
      mode: 'universal',
      messages: [{ role: 'user', content: transcript }]
    })
  });
  
  const chatData = await chatResponse.json();
  
  // 3. Sintetizar respuesta
  const ttsResponse = await synthesizeSpeech(chatData.speak_text);
  
  return res.json({
    transcript,
    answer: chatData.answer,
    audioUrl: ttsResponse.audioUrl,
    session_id: chatData.session_id
  });
});
```

---

### **BLOQUE 3: INTEGRAR TELEGRAM CON ORCHESTRATOR** (P1 - IMPORTANTE)

**Objetivo**: Que Telegram use orchestrator para tener memoria.

**Solución**: Similar a voice, delegar a `/api/ai/chat`.

**Código propuesto**:

```typescript
// telegram.ts - Reemplazar TODO de línea 339
if (update.message && update.message.text) {
  const chatId = update.message.chat.id;
  const text = update.message.text;
  
  // Enviar a orchestrator vía chat endpoint
  const chatResponse = await fetch('http://localhost:3001/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: bot.owner_user_id,
      sessionId: null, // Nueva sesión por mensaje
      workspaceId: 'al-eon',
      mode: 'universal',
      messages: [{ role: 'user', content: text }]
    })
  });
  
  const chatData = await chatResponse.json();
  
  // Enviar respuesta por Telegram
  const botToken = decrypt(bot.bot_token_enc);
  const telegramBot = new TelegramBot(botToken);
  await telegramBot.sendMessage(chatId, chatData.answer);
}
```

---

### **BLOQUE 4: AUDITORÍA DE VOZ (GROQ/OPENAI)** (P0 - VERIFICACIÓN)

**Objetivo**: Confirmar que voz usa Groq, NO OpenAI.

**Verificación**:

```bash
grep -n "openai\|OpenAI" src/api/voice.ts
```

**Resultado esperado**: NO debe aparecer.

**Código actual**:

```typescript
// voice.ts - Línea 19
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// voice.ts - Línea 294
const transcription = await groq.audio.transcriptions.create({
  file: fs.createReadStream(tempFilePath),
  model: 'whisper-large-v3-turbo',
  // ...
});
```

✅ **CONFIRMADO**: Voice usa **Groq Whisper**, NO OpenAI.

---

## 📈 MÉTRICAS DE ÉXITO

### **Antes del fix**:
- ❌ AL-E NO recuerda al usuario entre sesiones
- ❌ Memoria vacía después de conversaciones
- ❌ Voice y Telegram sin contexto

### **Después del fix**:
- ✅ AL-E recuerda nombre del usuario
- ✅ AL-E recuerda preferencias y acuerdos
- ✅ Voice tiene continuidad con memoria
- ✅ Telegram tiene continuidad con memoria

### **Criterio de validación**:

**Test 1 - Chat text**:
```
User: "Me llamo Patto"
AL-E: "Perfecto, Patto. Te recordaré."

[Nueva sesión]

User: "¿Cómo me llamo?"
AL-E: "Te llamas Patto."
```

**Test 2 - Voice**:
```
User (voz): "Me llamo Luis"
AL-E (voz): "Perfecto, Luis. Te recordaré."

[Nueva sesión]

User (voz): "¿Cómo me llamo?"
AL-E (voz): "Te llamas Luis."
```

**Test 3 - Telegram**:
```
User (Telegram): "Me llamo Juan"
AL-E (Telegram): "Perfecto, Juan. Te recordaré."

[Nuevo mensaje]

User (Telegram): "¿Cómo me llamo?"
AL-E (Telegram): "Te llamas Juan."
```

---

## 🔒 LOGS OBLIGATORIOS POST-FIX

### **Al guardar memoria**:
```typescript
console.log(`[MEMORY] ✓ Saved memory - user_id=${userId} workspace_id=${workspaceId} importance=${importance} content="${content.substring(0, 80)}..."`);
```

### **Al cargar memoria** (ya existe):
```typescript
console.log(`[ORCH] ✅ Loaded ${userMemories?.length || 0} memories from assistant_memories table`);
```

### **Al fallar guardado**:
```typescript
console.error(`[MEMORY] ❌ Failed to save memory - user_id=${userId} error=${error.message}`);
```

---

## 📝 NOTAS FINALES

### **Archivos que NO tocar**:
- `src/ai/orchestrator.ts` - La carga de memoria funciona bien
- `src/db/supabase.ts` - Cliente funciona
- `assistant_memories` (tabla) - Schema correcto

### **Archivos a modificar**:
- `src/api/chat.ts` - Agregar guardado de memoria (línea ~1729)
- `src/api/voice.ts` - Integrar con orchestrator (nuevo endpoint)
- `src/api/telegram.ts` - Integrar con orchestrator (línea 339)
- **CREAR**: `src/services/memoryExtractor.ts` - Lógica de extracción

### **Prioridad de implementación**:
1. **P0 CRÍTICO**: Guardado de memoria en chat.ts (BLOQUE 1)
2. **P1 IMPORTANTE**: Voice con orchestrator (BLOQUE 2)
3. **P1 IMPORTANTE**: Telegram con orchestrator (BLOQUE 3)
4. **P0 VERIFICACIÓN**: Auditoría Groq/OpenAI (BLOQUE 4) ✅ Ya verificado

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

- [ ] Crear `src/services/memoryExtractor.ts`
- [ ] Integrar `extractAndSaveMemories()` en `chat.ts`
- [ ] Crear `/api/voice/chat-voice` endpoint
- [ ] Modificar `telegram.ts` webhook para usar chat
- [ ] Ejecutar Test 1 (chat text)
- [ ] Ejecutar Test 2 (voice)
- [ ] Ejecutar Test 3 (telegram)
- [ ] Validar logs de guardado en Supabase
- [ ] Validar query de carga incluye nuevas memorias
- [ ] Confirmar que `memories_to_add` se depreca

---

**Fecha**: 17 de enero de 2026  
**Auditor**: GitHub Copilot (Claude 3.7 Sonnet)  
**Estado**: CRÍTICO - REQUIERE FIX INMEDIATO  
**Tiempo estimado de reparación**: 2-3 horas

---

## 🎯 SIGUIENTE PASO INMEDIATO

**Crear `src/services/memoryExtractor.ts` con lógica de detección y guardado.**

¿Procedo con la implementación del BLOQUE 1?
