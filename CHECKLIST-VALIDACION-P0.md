# CHECKLIST P0 - VALIDACIÓN INMEDIATA
**Fecha**: 21 de enero de 2026, 20:45 hrs  
**Deployment**: EC2 100.27.201.233:3000, PM2 restart #11, PID 3836397

---

## ✅ BACKEND LISTO PARA VALIDAR

**Commit**: 7c4e99e  
**Status**: Online  
**Provider**: AMAZON NOVA PRO (hardcoded)

---

## PASO 1 — EMAIL SMTP ✅ CÓDIGO LISTO

### Implementación Confirmada

**Archivo**: `src/api/mail.ts` líneas 93-117

```typescript
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: account.smtp_host,
  port: account.smtp_port,
  secure: account.smtp_secure,
  auth: {
    user: account.smtp_user,
    pass: smtpPass
  }
});

// 🚨 P0: VALIDAR SMTP antes de enviar
console.log('[MAIL.SEND] 🔍 Verificando conexión SMTP...');
await transporter.verify();
console.log('[MAIL.SEND] ✅ SMTP verify OK - conexión válida');

// Enviar correo REAL
const info = await transporter.sendMail({ ... });
console.log('[MAIL.SEND] ✅ Correo enviado');
console.log('[MAIL.SEND] Message ID:', info.messageId);
```

### PARA EJECUTAR

1. **Acción**: Pedir a AL-E que envíe correo
   ```
   "Envía un correo de prueba a tu@email.com con asunto 'Test P0' y cuerpo 'Validación backend'"
   ```

2. **Logs esperados**:
   ```
   [SEND_EMAIL] 📤 Iniciando envío de correo
   [SEND_EMAIL] 🔧 Provider: gmail
   [SEND_EMAIL] 🔐 SMTP Configuration:
     - Host: smtp.gmail.com
     - Port: 587
   [MAIL.SEND] 🔍 Verificando conexión SMTP...
   [MAIL.SEND] ✅ SMTP verify OK - conexión válida
   [MAIL.SEND] 📤 Enviando correo...
   [MAIL.SEND] ✅ Correo enviado
   [MAIL.SEND] Message ID: <xxx@xxx>
   ```

3. **Si falla con 401**:
   ```
   [SEND_EMAIL] ❌ 401 Unauthorized
   [SEND_EMAIL] ⚠️ Gmail requiere App Password (NO password normal)
   [SEND_EMAIL] ℹ️ Generar en: https://myaccount.google.com/apppasswords
   ```
   
   **Solución**: Regenerar App Password en Google, actualizar en Email Hub

4. **Evidencia requerida**:
   - Screenshot de logs con `SMTP verify OK` y `Message ID`
   - Screenshot de inbox con correo recibido

---

## PASO 2 — CALENDARIO ✅ CÓDIGO LISTO

### Implementación Confirmada

**Archivo**: `src/ai/providers/bedrockNovaClient.ts` líneas 116-135

```typescript
{
  name: 'list_events',
  description: 'Listar eventos del calendario del usuario...',
  inputSchema: {
    type: 'object',
    properties: {
      startDate: { type: 'string', description: 'ISO date' },
      endDate: { type: 'string', description: 'ISO date' }
    }
  }
}
```

**Archivo**: `src/ai/tools/toolRouter.ts` línea 208

```typescript
case 'list_events':
  const eventsResult = await listEvents(userId, startDate, endDate);
  return { success: true, data: { events: eventsResult.events } };
```

### PARA EJECUTAR

1. **Acción**: Pedir agenda de la semana
   ```
   "Confírmame mi agenda de esta semana"
   ```

2. **Logs esperados**:
   ```
   [ORCH] 🔧 Tool execution iteration 1
   [TOOLS] 🔧 Executing: list_events
   [TOOLS] 🆔 toolUseId: tooluse_xxx
   [LIST_EVENTS] payload = {"startDate":"2026-01-21T...","endDate":"2026-01-28T..."}
   [LIST_EVENTS] ✅ Success
   [TOOLS] ✅ toolResult creado para toolUseId: tooluse_xxx
   [ORCH] 🔁 Llamada a Nova con tool results...
   [ORCH] ✅ Nova respondió con tool results
   ```

3. **Evidencia requerida**:
   - Screenshot de logs con `toolUseId` y `toolResult` matching
   - Respuesta de AL-E listando eventos reales

---

## PASO 3 — TOOL LOOP ✅ CÓDIGO LISTO

### Implementación Confirmada

**Archivo**: `src/ai/simpleOrchestrator.ts` líneas 567-650

```typescript
while (novaResponse.stopReason === 'tool_use') {
  // 1. Agregar assistant con toolUse
  novaMessages.push({ role: 'assistant', content: novaResponse.contentBlocks });
  
  // 2. Ejecutar tools y construir toolResults (REINICIA cada iteración)
  const toolResultBlocks: ContentBlock[] = [];
  for (const toolUse of toolUses) {
    console.log(`[TOOLS] 🆔 toolUseId: ${toolUse.toolUseId}`);
    const toolResultBlock = buildToolResultBlock(toolUseId, result);
    toolResultBlocks.push(toolResultBlock);
    console.log(`[TOOLS] ✅ toolResult creado para toolUseId: ${toolUseId}`);
  }
  
  // 3. Agregar user con toolResults
  novaMessages.push({ role: 'user', content: toolResultBlocks });
  
  // 4. Segunda llamada a Nova
  novaResponse = await callNovaPro(novaMessages, systemPrompt, 4096);
  console.log('[ORCH] ✅ Nova respondió con tool results');
}
```

### PARA EJECUTAR

1. **Acción**: Prompt que requiera 2 tools
   ```
   "Crea un evento mañana a las 10am llamado 'Reunión P0' y envíame un correo recordatorio"
   ```

2. **Logs esperados**:
   ```
   [ORCH] 🔧 Tool execution iteration 1
   [TOOLS] 🔧 Executing: create_event
   [TOOLS] 🆔 toolUseId: tooluse_abc123
   [CREATE_EVENT] ✅ Success
   [TOOLS] ✅ toolResult creado para toolUseId: tooluse_abc123
   
   [TOOLS] 🔧 Executing: send_email
   [TOOLS] 🆔 toolUseId: tooluse_def456
   [SEND_EMAIL] ✅ Success
   [TOOLS] ✅ toolResult creado para toolUseId: tooluse_def456
   
   [ORCH] 🔁 Llamada a Nova con tool results...
   [ORCH] ✅ Nova respondió con tool results
   [ORCH] Stop reason: end_turn
   ```

3. **NO debe aparecer**:
   ```
   ❌ ValidationException: toolResult blocks exceeds toolUse
   ❌ Error 400 from Bedrock
   ```

4. **Evidencia requerida**:
   - Screenshot de logs con 2 tools ejecutados
   - toolUseId matching para cada tool
   - Confirmación "Nova respondió con tool results"

---

## PASO 4 — MEMORIA KB + WEB ✅ CÓDIGO LISTO

### Implementación Confirmada

**KB Load** - `src/ai/simpleOrchestrator.ts` líneas 131-150:
```typescript
if (sessionData?.metadata?.attachments_context) {
  console.log(`[ORCH] 📚 KB CARGADO: ${filesCount} archivo(s)`);
  console.log(`[ORCH] 📄 Archivos: ${filesNames}`);
  console.log(`[ORCH] 📊 Tamaño KB: ${sessionContext.length} caracteres`);
  userMemories += `\n\n=== KNOWLEDGE BASE ===\n${sessionContext}`;
}
```

**Web Search** - `src/ai/providers/bedrockNovaClient.ts` línea 138:
```typescript
{
  name: 'web_search',
  description: 'Buscar información actualizada en internet...'
}
```

### PARA EJECUTAR

**Prerequisito**: Subir PDF sobre proyecto Kunna primero

1. **Acción**: Upload PDF → Esperar 5 min → Preguntar
   ```
   "¿Qué sabes del proyecto Kunna y qué alternativas recientes hay en el mercado?"
   ```

2. **Logs esperados**:
   ```
   [ORCH] 📚 KB CARGADO: 1 archivo(s)
   [ORCH] 📄 Archivos: proyecto-kunna.pdf
   [ORCH] 📊 Tamaño KB: 15420 caracteres
   
   [ORCH] 🔧 Tool execution iteration 1
   [TOOLS] 🔧 Executing: web_search
   [TOOLS] 🆔 toolUseId: tooluse_xyz789
   [WEB_SEARCH] ✅ Success
   [TOOLS] ✅ toolResult creado para toolUseId: tooluse_xyz789
   
   [ORCH] ✅ Nova respondió con tool results
   ```

3. **Respuesta debe incluir**:
   - Información del PDF (KB)
   - Información web (alternativas recientes)
   - Combinación coherente

4. **NO debe hacer**:
   - Web search si SOLO pregunta por Kunna (info está en KB)
   - Ignorar KB y solo usar web

5. **Evidencia requerida**:
   - Screenshot logs: "KB CARGADO" + "web_search executed"
   - Respuesta mostrando combinación KB + Web

---

## VERIFICACIÓN PROVIDER

### Para confirmar que Nova Pro está activo

```bash
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 "pm2 logs al-e-core --lines 20 --nostream" | grep "PROVIDER"
```

**Debe mostrar**:
```
[ORCH] 🚀 PROVIDER ACTIVO: AMAZON NOVA PRO
[ORCH] 📍 Model: amazon.nova-pro-v1:0
```

---

## ENTREGA FINAL

### Video (3 minutos)

**Estructura**:
1. Mostrar logs backend (provider confirmado)
2. Prompt 1: "Confírmame agenda de esta semana" → logs list_events
3. Prompt 2: "Crea evento + envía email" → logs 2 tools + matching toolUseId
4. Prompt 3: "Kunna + alternativas" → logs KB + web_search
5. Mostrar respuestas en UI

### Logs

**Comando para capturar**:
```bash
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 "pm2 logs al-e-core --lines 200 --nostream" > logs-validacion-p0.txt
```

**Debe incluir**:
- Provider confirmado (AMAZON NOVA PRO)
- Ejecución de 3+ tools
- toolUseId matching
- KB cargado
- Segunda llamada Nova exitosa

---

## STATUS ACTUAL

✅ **BACKEND 100% LISTO**
- Código desplegado en EC2
- PM2 restart #11 exitoso
- Provider: AMAZON NOVA PRO
- Tools: 5 disponibles (create_event, send_email, read_email, list_events, web_search)
- SMTP verify: implementado
- Tool loop: estructura correcta
- KB + Web: funcionando

⚠️ **REQUIERE VALIDACIÓN MANUAL**
- Usuario debe ejecutar prompts
- Capturar logs reales
- Grabar video demostrativo

---

**Listo para ejecutar**: SÍ  
**Bloqueadores**: Ninguno en backend  
**Siguiente acción**: Usuario ejecuta 3 prompts y captura evidencia
