# 🔧 PLAN DE EJECUCIÓN - FIXES AL-E
## 17 de enero de 2026

---

## 📋 RESUMEN

Este documento detalla **EXACTAMENTE** qué voy a modificar en el código para arreglar AL-E.

**NO voy a mejorar logs. Voy a ARREGLAR los problemas para que TODO FUNCIONE PERFECTO.**

---

## 🎯 PROBLEMAS A ARREGLAR (EN ORDEN)

### 1. **AL-E dice fecha/hora incorrecta** (P0 - MÁS CRÍTICO)
### 2. **AL-E inventa sin consultar** (P0 - CRÍTICO)
### 3. **AL-E no recuerda al usuario** (P0 - CRÍTICO)
### 4. **OpenAI entra en modo voz** (P0 - CRÍTICO)
### 5. **Voice.ts sin memoria** (P1 - IMPORTANTE)
### 6. **Telegram sin memoria** (P1 - IMPORTANTE)

---

## 🔧 FIX 1: FECHA Y HORA REAL (15 MIN)

### **Problema Actual**:
```
Usuario: "¿Qué día es hoy?"
AL-E: "Hoy es 15 de octubre de 2023"  ← DATO DE ENTRENAMIENTO
```

### **Causa**:
El contexto temporal existe en `orchestrator.ts` línea 775, pero está **DESPUÉS** de otros bloques. El LLM lo puede ignorar.

### **Solución**:
Mover el bloque temporal **AL INICIO ABSOLUTO** del system prompt, antes de TODO lo demás.

### **Archivo a modificar**:
- `src/ai/orchestrator.ts` - Método `buildSystemPrompt()` (línea 763)

### **Cambio exacto**:

**ANTES** (línea 772):
```typescript
private buildSystemPrompt(...): string {
  let systemPrompt = basePrompt;  // ← basePrompt va PRIMERO
  
  // 0. CONTEXTO TEMPORAL ACTUAL (línea 775)
  const now = new Date();
  // ...
  systemPrompt += `CONTEXTO TEMPORAL ACTUAL...`;  // ← Se AGREGA después
}
```

**DESPUÉS**:
```typescript
private buildSystemPrompt(...): string {
  // 0. CONTEXTO TEMPORAL (PRIMERO - LÍNEA 1)
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
  
  let systemPrompt = `
═══════════════════════════════════════════════════════════════
🕐 FECHA Y HORA REAL DEL SISTEMA (USA ESTO - NO TU ENTRENAMIENTO)
═══════════════════════════════════════════════════════════════

HOY ES: ${mexicoTime}

⚠️ INSTRUCCIÓN OBLIGATORIA:
- Si preguntan "qué día es", "qué hora es", "hoy es" → USA ESTA FECHA
- NO uses octubre 2023 (tu entrenamiento)
- Esta es la fecha/hora REAL del servidor

═══════════════════════════════════════════════════════════════

${basePrompt}

`;  // ← Ahora basePrompt va DESPUÉS de la fecha
  
  // Resto de bloques...
}
```

### **Test de Validación**:
```
Input: "¿Qué día es hoy?"
Output esperado: "Hoy es viernes, 17 de enero de 2026"
Output PROHIBIDO: "Hoy es octubre de 2023" o cualquier fecha != 17 enero 2026
```

---

## 🔧 FIX 2: TOOLS OBLIGATORIAS (25 MIN)

### **Problema Actual**:
```
Usuario: "Revisa mi correo"
AL-E: "No encontré correos recientes"  ← SIN EJECUTAR list_emails
```

### **Causa**:
`orchestrator.ts` línea 548 usa `toolChoice: 'auto'`, que le permite a Groq **decidir** no usar tools.

### **Solución**:
Cuando el `intent.tools_required` tenga valores, forzar `toolChoice: 'required'`.

### **Archivos a modificar**:
1. `src/ai/orchestrator.ts` - Método `executeToolLoop()` (línea 525)

### **Cambio exacto**:

**ANTES** (línea 548):
```typescript
const response = await callGroqChat({
  messages,
  systemPrompt: iteration === 1 ? systemPrompt : undefined,
  tools,
  toolChoice: 'auto',  // ← SIEMPRE 'auto'
  model,
  maxTokens: 600
});
```

**DESPUÉS**:
```typescript
// ✅ Detectar si tools son OBLIGATORIAS según intent
const toolsRequired = tools.length > 0 && 
  messages.some(m => {
    // Detectar palabras clave que REQUIEREN tools
    const content = m.content?.toLowerCase() || '';
    return content.includes('revisa') || 
           content.includes('consulta') || 
           content.includes('busca') ||
           content.includes('agenda') ||
           content.includes('correo') ||
           content.includes('email');
  });

const toolChoice = toolsRequired ? 'required' : 'auto';

console.log(`[ORCH] 🔧 Tool choice: ${toolChoice} (tools available: ${tools.length})`);

const response = await callGroqChat({
  messages,
  systemPrompt: iteration === 1 ? systemPrompt : undefined,
  tools,
  toolChoice,  // ← 'required' si detecta palabras clave
  model,
  maxTokens: 600
});

// ✅ VALIDACIÓN: Si toolChoice era 'required' y NO se ejecutó → ERROR
if (toolChoice === 'required' && (!response.raw.tool_calls || response.raw.tool_calls.length === 0)) {
  console.error(`[ORCH] ❌ TOOL REQUIRED BUT NOT EXECUTED`);
  
  return {
    content: `No pude consultar la información. Por favor intenta de nuevo o proporciona más detalles.`,
    toolExecutions: [{
      tool: 'none',
      args: {},
      result: { success: false, error: 'TOOL_REQUIRED_NOT_EXECUTED' },
      success: false
    }]
  };
}
```

### **Test de Validación**:
```
Input: "Revisa mi correo"
Validación: DEBE aparecer en logs "[ORCH] 🔧 Tool choice: required"
Validación: DEBE ejecutar list_emails (ver log de tool execution)
Output PROHIBIDO: "No encontré correos" SIN ejecutar tool
```

---

## 🔧 FIX 3: GUARDAR MEMORIA NUEVA (30 MIN)

### **Problema Actual**:
```
Usuario: "Me llamo Patto"
AL-E: "Perfecto, Patto"

[Nueva sesión]

Usuario: "¿Cómo me llamo?"
AL-E: "¿Cómo te llamas?"  ← NO RECUERDA
```

### **Causa**:
`chat.ts` línea 1729 tiene `memories_to_add: []` vacío. **NO existe código** que guarde memoria nueva.

### **Solución**:
1. Crear `src/services/memoryExtractor.ts` - Detecta información importante
2. Modificar `chat.ts` - Llamar a memoryExtractor después de cada respuesta

### **Archivos a crear/modificar**:
1. **CREAR**: `src/services/memoryExtractor.ts` (NUEVO)
2. **MODIFICAR**: `src/api/chat.ts` (línea 1729)

### **Contenido de memoryExtractor.ts**:

```typescript
// src/services/memoryExtractor.ts (ARCHIVO NUEVO)

import { supabase } from '../db/supabase';

/**
 * Extraer y guardar memoria importante de la conversación
 */
export async function extractAndSaveMemories(
  userId: string,
  workspaceId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  console.log(`[MEMORY_EXTRACTOR] Analyzing conversation...`);
  
  const memories: Array<{ content: string; importance: number }> = [];
  
  // 1. Detectar NOMBRE del usuario
  const nameMatch = userMessage.match(/me llamo (\w+)|mi nombre es (\w+)|soy (\w+)/i);
  if (nameMatch) {
    const name = nameMatch[1] || nameMatch[2] || nameMatch[3];
    memories.push({
      content: `[fact] El usuario se llama ${name}`,
      importance: 1.0  // Máxima importancia
    });
    
    // Actualizar user_profile también
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
    
    console.log(`[MEMORY_EXTRACTOR] ✓ User name saved: ${name}`);
  }
  
  // 2. Detectar PREFERENCIAS
  if (userMessage.match(/prefiero|me gusta|quiero que/i)) {
    memories.push({
      content: `[preference] ${userMessage}`,
      importance: 0.7
    });
  }
  
  // 3. Detectar ACUERDOS/DECISIONES
  if (userMessage.match(/quedamos|acordamos|entonces|de acuerdo|ok|perfecto/i)) {
    memories.push({
      content: `[agreement] ${assistantResponse}`,
      importance: 0.8
    });
  }
  
  // 4. Guardar en assistant_memories
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
        console.error(`[MEMORY_EXTRACTOR] ❌ Error saving:`, error);
      } else {
        console.log(`[MEMORY_EXTRACTOR] ✓ Saved: "${mem.content.substring(0, 60)}..." (${mem.importance})`);
      }
    }
  } else {
    console.log(`[MEMORY_EXTRACTOR] ℹ️ No important info to save`);
  }
}
```

### **Cambio en chat.ts**:

**ANTES** (línea 1729):
```typescript
return res.json({
  answer: finalAnswer,
  speak_text: markdownToSpeakable(finalAnswer),
  should_speak: shouldSpeak(finalAnswer),
  session_id: sessionId,
  memories_to_add: [], // ❌ SIEMPRE VACÍO
  sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
  metadata: { /* ... */ }
});
```

**DESPUÉS**:
```typescript
// ✅ GUARDAR MEMORIA NUEVA
if (userId && userId !== 'guest') {
  try {
    const { extractAndSaveMemories } = await import('../services/memoryExtractor');
    
    await extractAndSaveMemories(
      userId,
      finalWorkspaceId,
      message,
      finalAnswer
    );
  } catch (memError) {
    console.error('[CHAT] ❌ Error saving memories:', memError);
    // No bloquear respuesta
  }
}

return res.json({
  answer: finalAnswer,
  speak_text: markdownToSpeakable(finalAnswer),
  should_speak: shouldSpeak(finalAnswer),
  session_id: sessionId,
  memories_to_add: [], // Deprecated - se guarda automáticamente
  sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
  metadata: { /* ... */ }
});
```

### **Test de Validación**:
```
Input 1: "Me llamo Patto"
Validación logs: "[MEMORY_EXTRACTOR] ✓ User name saved: Patto"
Validación DB: SELECT * FROM assistant_memories WHERE memory LIKE '%Patto%';

[Reiniciar servidor / nueva sesión]

Input 2: "¿Cómo me llamo?"
Output esperado: "Te llamas Patto"
Output PROHIBIDO: "¿Cómo te llamas?"
```

---

## 🔧 FIX 4: BLOQUEAR OPENAI EN VOZ (10 MIN)

### **Problema Actual**:
OpenAI Referee puede invocarse en modo voz, cuando **SOLO** debe ser Groq.

### **Causa**:
`chat.ts` línea 784 no valida canal (voz vs texto) antes de invocar referee.

### **Solución**:
Detectar modo voz y bloquear referee de OpenAI.

### **Archivo a modificar**:
- `src/api/chat.ts` (línea 784)

### **Cambio exacto**:

**ANTES** (línea 784):
```typescript
if (needsReferee && process.env.OPENAI_ROLE === 'referee') {
  try {
    console.log(`[ORCH] ⚖️ OPENAI REFEREE INVOKED`);
    
    const refereeResult = await invokeOpenAIReferee({
      userPrompt: userContent,
      groqResponse: llmResponse.response.text,
      // ...
    });
    
    llmResponse.response.text = refereeResult.text;
    refereeUsed = true;
  } catch (refereeError: any) {
    console.error(`[ORCH] ❌ REFEREE FAILED: ${refereeError.message}`);
  }
}
```

**DESPUÉS**:
```typescript
// ✅ Detectar modo voz
const isVoiceMode = req.body.voice === true || 
                    req.body.mode === 'voice' || 
                    req.headers['x-channel'] === 'voice';

if (needsReferee && process.env.OPENAI_ROLE === 'referee') {
  
  // ✅ BLOQUEAR OpenAI en voz
  if (isVoiceMode) {
    console.warn(`[ORCH] ⚠️ REFEREE BLOCKED - Voice mode detected (OpenAI forbidden in voice)`);
    // NO invocar referee - usar respuesta de Groq directamente
  } else {
    // Modo texto: permitir referee
    try {
      console.log(`[ORCH] ⚖️ OPENAI REFEREE INVOKED - channel=text`);
      
      const refereeResult = await invokeOpenAIReferee({
        userPrompt: userContent,
        groqResponse: llmResponse.response.text,
        // ...
      });
      
      llmResponse.response.text = refereeResult.text;
      refereeUsed = true;
      
      console.log(`[ORCH] ✅ REFEREE CORRECTED - channel=text`);
      
    } catch (refereeError: any) {
      console.error(`[ORCH] ❌ REFEREE FAILED: ${refereeError.message}`);
    }
  }
}
```

### **Test de Validación**:
```
Request con { "voice": true } o header "x-channel: voice"
Validación logs: "[ORCH] ⚠️ REFEREE BLOCKED - Voice mode detected"
Validación: NO debe aparecer "[ORCH] ⚖️ OPENAI REFEREE INVOKED" en voz
```

---

## 🔧 FIX 5: VOICE.TS CON MEMORIA (25 MIN)

### **Problema Actual**:
`voice.ts` no usa orchestrator. Es completamente stateless.

### **Solución**:
Crear `/api/voice/chat` que:
1. Hace STT (Groq Whisper)
2. Llama a `/api/chat` internamente (con memoria)
3. Hace TTS (Edge-TTS)

### **Archivo a modificar**:
- `src/api/voice.ts` (agregar al final, línea 453)

### **Código a agregar**:

```typescript
// AGREGAR AL FINAL DE voice.ts (después de línea 453)

/**
 * POST /api/voice/chat
 * Endpoint completo: STT → Chat con memoria → TTS
 */
router.post('/chat', upload.single('audio'), async (req, res) => {
  const startTime = Date.now();
  console.log('[VOICE_CHAT] 🎤 Request recibido');
  
  try {
    const { userId, sessionId, workspaceId = 'al-eon' } = req.body;
    const audioFile = req.file;
    
    // Validaciones
    if (!audioFile || !userId) {
      return res.status(400).json({
        error: 'MISSING_PARAMS',
        message: 'Se requiere audio y userId'
      });
    }
    
    // 1. STT: Transcribir
    console.log('[VOICE_CHAT] 🔄 Transcribing...');
    const tempFilePath = path.join(os.tmpdir(), `voice_chat_${uuidv4()}.webm`);
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
    
    // 2. CHAT: Procesar con orchestrator (tiene memoria)
    console.log('[VOICE_CHAT] 🧠 Processing with orchestrator...');
    
    const chatResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/ai/chat`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-channel': 'voice'  // ← Marcar como voz (bloquea OpenAI referee)
      },
      body: JSON.stringify({
        userId,
        sessionId,
        workspaceId,
        mode: 'universal',
        voice: true,  // ← Flag de voz
        messages: [{ role: 'user', content: transcript }]
      })
    });
    
    const chatData = await chatResponse.json();
    console.log(`[VOICE_CHAT] ✓ Chat response received`);
    
    // 3. TTS: Sintetizar
    console.log('[VOICE_CHAT] 🔊 Synthesizing...');
    const speakText = chatData.speak_text || chatData.answer;
    
    // Truncar a 2 frases para voz
    let cleanText = speakText.replace(/\*\*|\*|`|#/g, '').trim();
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    if (sentences.length > 2) {
      cleanText = sentences.slice(0, 2).join(' ');
    }
    
    const outputFile = path.join(os.tmpdir(), `tts_${uuidv4()}.mp3`);
    await execPromise(
      `edge-tts --voice "es-MX-DaliaNeural" --text "${cleanText.replace(/"/g, '\\"')}" --write-media "${outputFile}"`,
      { timeout: 15000 }
    );
    
    const audioBuffer = fs.readFileSync(outputFile);
    fs.unlinkSync(outputFile);
    
    console.log(`[VOICE_CHAT] ✅ Completed in ${Date.now() - startTime}ms`);
    
    return res.json({
      transcript,
      answer: chatData.answer,
      speak_text: cleanText,
      audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
      session_id: chatData.session_id,
      with_memory: true
    });
    
  } catch (error: any) {
    console.error('[VOICE_CHAT] ❌ Error:', error);
    return res.status(500).json({
      error: 'VOICE_CHAT_ERROR',
      message: error.message
    });
  }
});
```

### **Test de Validación**:
```
POST /api/voice/chat con audio + userId
Validación logs: 
- "[VOICE_CHAT] ✓ Transcript: ..."
- "[VOICE_CHAT] 🧠 Processing with orchestrator..."
- "[VOICE_CHAT] ✅ Completed in Xms"

Input voz: "Me llamo Luis"
[Nueva request voz]
Input voz: "¿Cómo me llamo?"
Output esperado: "Te llamas Luis"
```

---

## 🔧 FIX 6: TELEGRAM CON MEMORIA (20 MIN)

### **Problema Actual**:
`telegram.ts` línea 339 tiene `// TODO: Enviar a orchestrator`. No usa memoria.

### **Solución**:
Modificar webhook para llamar a `/api/chat` internamente.

### **Archivo a modificar**:
- `src/api/telegram.ts` (línea 339)

### **Cambio exacto**:

**ANTES** (línea 339):
```typescript
// TODO: Enviar a orchestrator para procesamiento
// Por ahora, responder con mensaje simple
try {
  const botToken = decrypt(bot.bot_token_enc);
  const telegramBot = new TelegramBot(botToken);
  
  await telegramBot.sendMessage(chatId, `Recibí tu mensaje: "${text}"\n\nIntegración con AL-E en proceso...`);
  
  console.log(`[TELEGRAM] ✓ Respuesta enviada a ${chatId}`);
} catch (error) {
  console.error('[TELEGRAM] Error sending response:', error);
}
```

**DESPUÉS**:
```typescript
// ✅ PROCESAR CON ORCHESTRATOR (con memoria)
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
      userDisplayName: chatName
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
      with_memory: true
    }
  });
  
} catch (error: any) {
  console.error('[TELEGRAM] ❌ Error processing:', error);
  
  // Respuesta de error
  try {
    const botToken = decrypt(bot.bot_token_enc);
    const telegramBot = new TelegramBot(botToken);
    await telegramBot.sendMessage(chatId, 'Ocurrió un error. Intenta de nuevo.');
  } catch (sendError) {
    console.error('[TELEGRAM] ❌ Error sending error message:', sendError);
  }
}
```

### **Test de Validación**:
```
Enviar mensaje por Telegram
Validación logs: "[TELEGRAM] 🧠 Processing with orchestrator..."
Validación: Respuesta debe venir del orchestrator, no mensaje genérico

Input Telegram: "Me llamo Juan"
[Nuevo mensaje]
Input Telegram: "¿Cómo me llamo?"
Output esperado: "Te llamas Juan"
```

---

## ✅ ORDEN DE EJECUCIÓN

```
1. FIX 1: Fecha/hora real        (15 min) ← EMPEZAR AQUÍ
2. FIX 2: Tools obligatorias     (25 min)
3. FIX 3: Guardar memoria        (30 min)
4. FIX 4: Bloquear OpenAI en voz (10 min)
5. FIX 5: Voice con memoria      (25 min)
6. FIX 6: Telegram con memoria   (20 min)
───────────────────────────────────────────
TOTAL:                            2h 5min
```

---

## 🎯 TESTS FINALES

### **Test 1: Fecha Real**
```bash
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "workspaceId": "al-eon",
    "messages": [{"role": "user", "content": "¿Qué día es hoy?"}]
  }'

# Esperado: "Hoy es viernes, 17 de enero de 2026"
# Prohibido: "Hoy es octubre de 2023"
```

### **Test 2: Tools Obligatorias**
```bash
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "workspaceId": "al-eon",
    "messages": [{"role": "user", "content": "Revisa mi correo"}]
  }'

# Validar logs: "[ORCH] 🔧 Tool choice: required"
# Validar logs: "[ORCH] ✓ Tool list_emails executed: SUCCESS"
```

### **Test 3: Memoria**
```bash
# Request 1
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-memory-user",
    "workspaceId": "al-eon",
    "messages": [{"role": "user", "content": "Me llamo Patto"}]
  }'

# Validar logs: "[MEMORY_EXTRACTOR] ✓ User name saved: Patto"

# Request 2 (nueva sesión)
curl -X POST http://localhost:3001/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-memory-user",
    "workspaceId": "al-eon",
    "messages": [{"role": "user", "content": "¿Cómo me llamo?"}]
  }'

# Esperado: "Te llamas Patto"
# Prohibido: "¿Cómo te llamas?"
```

---

## 📝 NOTAS IMPORTANTES

1. **NO tocar** mientras esto se ejecuta:
   - `src/db/supabase.ts`
   - `src/types.ts`
   - Migraciones de DB

2. **Backup automático**: Git commit antes de cada fix

3. **Rollback si falla**: `git reset --hard HEAD~1`

4. **Logs a monitorear**:
   - `[ORCH]` - Orchestrator
   - `[CHAT]` - Chat API
   - `[MEMORY_EXTRACTOR]` - Guardado de memoria
   - `[VOICE_CHAT]` - Voz con memoria
   - `[TELEGRAM]` - Telegram con memoria

---

## 🚨 CRITERIO DE ÉXITO

AL-E es **FUNCIONAL** cuando:

✅ Dice la fecha/hora correcta (17 enero 2026, no oct 2023)
✅ Ejecuta tools cuando se requiere (no inventa)
✅ Recuerda al usuario entre sesiones
✅ Groq ONLY en voz (OpenAI bloqueado)
✅ Voz tiene memoria
✅ Telegram tiene memoria

---

**¿VALIDAR ESTE PLAN ANTES DE EJECUTAR?**
