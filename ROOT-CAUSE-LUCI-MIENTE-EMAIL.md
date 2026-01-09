# 🚨 ROOT CAUSE: LUCI MIENTE SOBRE ENVIAR CORREOS

**Fecha:** 9 de enero de 2026  
**Commit actual:** 7592baa  
**Status:** ✅ Paso 1/3 completado

---

## 🔍 ROOT CAUSE ANALYSIS

### Por qué LUCI dice "ya lo envié" sin enviar nada:

1. **System prompt tenía `mail.send: false`** (✅ ARREGLADO en commit 7592baa)
   - El prompt hardcodeado decía que email NO estaba disponible
   - LUCI "simulaba" el envío sin intentar ejecutar la herramienta

2. **Groq NO recibe tool definitions** (❌ PENDIENTE - Paso 2)
   - El orchestrator NUNCA pasa el array de tools a Groq
   - Groq no sabe que existe la función `send_email`
   - Por eso nunca hace tool_call

3. **Flujo viejo bloquea send_email** (✅ YA ESTABA - Línea 336)
   - Detecta que faltan params y se salta el envío
   - Pero el problema real es #2: Groq nunca intenta ejecutarlo

---

## ✅ PASO 1 (COMPLETADO): Activar capability en prompt

```typescript
// src/ai/orchestrator.ts línea 806
- mail.send: false ✗ (AWS SES NO CONFIGURADO)
+ mail.send: true ✓ (EMAIL HUB ACTIVO)
```

**Deploy:** Commit 7592baa

---

## 📋 PASO 2 (PENDIENTE): Pasar tools a Groq

### Problema actual:
El orchestrator llama `callGroqChat()` SIN tools, por eso Groq responde en texto plano sin tool calls.

### Solución:

```typescript
// src/ai/orchestrator.ts - Agregar después de línea 600

import { 
  LIST_EMAILS_TOOL, 
  READ_EMAIL_TOOL, 
  SEND_EMAIL_TOOL,
  CALENDAR_CREATE_TOOL,
  WEB_SEARCH_TOOL
} from './tools/toolDefinitions';

// En función orchestrate(), después de construir systemPrompt:

// Definir tools disponibles según capabilities
const availableTools: any[] = [];

// Email tools (si capability está activa)
if (runtimeCapabilities['mail.send']) {
  availableTools.push(SEND_EMAIL_TOOL);
}
if (runtimeCapabilities['mail.inbox']) {
  availableTools.push(LIST_EMAILS_TOOL, READ_EMAIL_TOOL);
}

// Calendar tools
if (runtimeCapabilities['calendar.create']) {
  availableTools.push(CALENDAR_CREATE_TOOL);
}

// Web search
if (runtimeCapabilities['web.search']) {
  availableTools.push(WEB_SEARCH_TOOL);
}

console.log(`[ORCH] 🔧 Available tools: [${availableTools.map(t => t.function.name).join(', ')}]`);
```

### Luego cambiar la llamada a Groq:

```typescript
// ANTES (línea ~605):
const finalResponse = await callGroqChat({
  messages,
  toolChoice: 'none',
  model,
  maxTokens: 600
});

// DESPUÉS:
// Si hay tools disponibles, usar tool loop
if (availableTools.length > 0) {
  const toolLoopResult = await this.executeToolLoop(
    messages,
    systemPrompt,
    availableTools,
    userId,
    model,
    3 // max iterations
  );
  
  return {
    content: toolLoopResult.content,
    toolExecutions: toolLoopResult.toolExecutions
  };
} else {
  // Sin tools, respuesta directa
  const finalResponse = await callGroqChat({
    messages,
    model,
    maxTokens: 600
  });
  
  return {
    content: finalResponse.content,
    toolExecutions: []
  };
}
```

---

## 📋 PASO 3 (PENDIENTE): Leer runtime-capabilities dinámicamente

### Problema actual:
El prompt tiene capabilities hardcodeadas. Si cambias el JSON, el prompt no se actualiza.

### Solución:

```typescript
// src/ai/orchestrator.ts

import fs from 'fs';
import path from 'path';

// Al inicio de buildSystemPrompt():
const runtimeCapPath = path.join(__dirname, '../../CONTRACTS/runtime-capabilities.json');
const runtimeCapabilities = JSON.parse(fs.readFileSync(runtimeCapPath, 'utf8'));

// Construir dinámicamente el bloque de capabilities:
let capabilitiesBlock = '🚨 REGLA SUPREMA - CAPACIDADES REALES (NO NEGOCIABLE):\n';
capabilitiesBlock += 'El archivo runtime-capabilities.json define qué capacidades están REALMENTE disponibles:\n';

Object.entries(runtimeCapabilities).forEach(([key, enabled]) => {
  const icon = enabled ? '✓' : '✗';
  const status = enabled ? 'ACTIVO' : 'NO DISPONIBLE';
  capabilitiesBlock += `- ${key}: ${enabled} ${icon} (${status})\n`;
});

systemPrompt += capabilitiesBlock;
```

---

## 🧪 TESTING

### Test Case 1: Enviar correo nuevo
```
Usuario: "Envíale un correo a p.garibay@infinitykode.com diciéndole que está confirmada la junta del lunes con IGS"

Resultado esperado:
[GROQ] 🔧 LLM requested 1 tool call(s)
[GROQ]    - send_email({"to":"p.garibay@infinitykode.com", "subject":"Confirmación junta lunes con IGS", "body":"..."})
[TOOL ROUTER] ✅ send_email SUCCESS
[ORCH] ✅ Email sent via send_email
```

### Test Case 2: Responder correo
```
Usuario (con un email abierto): "Respóndele que sí está confirmado"

Resultado esperado:
[GROQ] 🔧 LLM requested 1 tool call(s)
[GROQ]    - send_email({"to":"[from del email abierto]", "subject":"Re: ...", "body":"...", "inReplyTo":"[id del email]"})
[TOOL ROUTER] ✅ send_email SUCCESS
```

### Test Case 3: Listar correos
```
Usuario: "¿Tengo correos nuevos?"

Resultado esperado:
[GROQ] 🔧 LLM requested 1 tool call(s)
[GROQ]    - list_emails({"unreadOnly":true,"limit":10})
[TOOL ROUTER] ✅ list_emails SUCCESS - 3 emails found
```

---

## 🚀 DEPLOYMENT PLAN

### Commit 1: Paso 2 - Agregar tools a Groq
```bash
git add src/ai/orchestrator.ts
git commit -m "fix(email): paso 2/3 - agregar tool definitions a Groq"
git push
```

### Commit 2: Paso 3 - Leer capabilities dinámicamente
```bash
git add src/ai/orchestrator.ts
git commit -m "fix(email): paso 3/3 - leer runtime-capabilities.json dinámicamente"
git push
```

### Deploy a producción:
```bash
ssh ubuntu@100.27.201.233
cd /home/ubuntu/AL-E-Core
git pull
npm run build
pm2 restart al-e-core
pm2 logs al-e-core --lines 50
```

### Verificar logs:
```bash
# Buscar tool calls
pm2 logs al-e-core | grep "GROQ.*tool"

# Buscar send_email
pm2 logs al-e-core | grep "send_email"

# Ver resultado
pm2 logs al-e-core | grep "Email sent"
```

---

## ⚠️ CUIDADO CON:

1. **No llamar executeToolLoop() dos veces**
   - Ya hay un flujo viejo (decideAndExecuteTool)
   - Y un flujo nuevo (executeToolLoop)
   - Deben ser mutuamente excluyentes

2. **Validar que tools no estén vacíos**
   - Si `availableTools.length === 0`, NO llamar executeToolLoop
   - Groq va a fallar si le pasas `tools: []`

3. **Runtime capabilities debe existir**
   - Si el archivo no existe, el sistema crashea
   - Agregar try-catch al leer el JSON

4. **Groq puede omitir argumentos**
   - Aunque el schema dice `required`, Groq a veces omite campos
   - El parser en executeToolLoop ya tiene logs para esto (línea 497-512)
   - Si faltan to/subject/body, el TOOL ROUTER rechaza (línea 125)

---

## 📊 MÉTRICAS DE ÉXITO

Después del deploy, verificar:

- [ ] Prompt muestra `mail.send: true ✓`
- [ ] Logs muestran `[ORCH] 🔧 Available tools: [send_email, list_emails, ...]`
- [ ] Al pedirle enviar correo, muestra `[GROQ] 🔧 LLM requested 1 tool call(s)`
- [ ] Muestra `[GROQ]    - send_email({...})` con argumentos completos
- [ ] Muestra `[TOOL ROUTER] ✅ send_email SUCCESS`
- [ ] El correo SE ENVÍA REALMENTE (verificar en Gmail)
- [ ] LUCI responde "Listo, envié..." solo DESPUÉS del tool SUCCESS

---

## 🎯 RESUMEN EJECUTIVO

**El problema NO era "OpenAI no pasa parámetros".**

**El problema ERA:**
1. ❌ System prompt decía `mail.send: false` (✅ arreglado)
2. ❌ Groq no recibía tool definitions (pendiente)
3. ❌ Por lo tanto, Groq respondía en texto plano simulando el envío

**La solución ES:**
1. ✅ Activar capability en prompt
2. ⏳ Pasar tools array a Groq con SEND_EMAIL_TOOL
3. ⏳ Leer capabilities dinámicamente del JSON

**Tiempo estimado:** 30 minutos implementación + 10 min testing = 40 minutos total
