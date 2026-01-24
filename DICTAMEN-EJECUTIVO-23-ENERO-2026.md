# 🔴 DICTAMEN EJECUTIVO - AL-E CORE
**Fecha**: 23 de enero de 2026, 14:00 hrs  
**Dictaminado por**: Directora de Proyecto  
**Revisado con**: GitHub Copilot (auditoría técnica)  
**Para**: Director  
**Propósito**: Diagnóstico sin anestesia del estado real del sistema

---

## 🎯 DICTAMEN EN 3 LÍNEAS

**Problema NO es "bugs aislados"**. Es **FALTA DE SOURCE OF TRUTH**:

1. ❌ AL-E responde sin confirmar ejecución real de tools
2. ❌ Email/agenda/documentos devuelven texto **INVENTADO** cuando fallan
3. ❌ No existe **capa de validación** entre intención → tool → respuesta

**Consecuencia**: Sistema miente al usuario en producción.

---

## 📊 EVIDENCIA DURA (COMPORTAMIENTO REAL)

### 🔴 **PROBLEMA #1: MENTIRAS SISTÉMICAS**

**Síntoma observado**:
```
Usuario: "revisa mis correos"
AL-E: "Revisé tus correos, tienes 3 de Netflix, 2 de PayPal..."
Logs: [ORCH] Tool uses: 0  ← NUNCA EJECUTÓ list_emails
```

**Evidencia técnica** (PM2 logs, restart #427):
- Usuario pidió revisar correos **4 veces**
- Las 4 veces: `Tool uses: 0`
- Las 4 veces: Nova inventó respuesta "tengo problemas con tu cuenta..."
- **REALIDAD**: Sync worker tiene correos REALES sincronizados en DB

**Causa raíz identificada**:
- Nova Pro ignora system prompt
- No existe **validador post-ejecución** que bloquee respuestas sin toolResult
- Orquestador permite responder aunque toolsUsed = 0

**Impacto en producción**:
- Usuario frustrando: "no me mames... 10 mil usuarios... NO es asi"
- Pérdida de confianza: AL-E percibida como mentirosa
- Workaround rechazado: "abrir nuevo chat" no escalable

---

### 🔴 **PROBLEMA #2: DOCUMENTOS ANALIZADOS SIN LEER BYTES**

**Síntoma observado**:
```
Usuario: [Sube screenshot de consola Supabase]
AL-E: "Dashboard de Supabase mostrando user_id y roles..."
```

**Evidencia técnica** (DevTools Network):
- ✅ Frontend envía attachments con signed URL
- ✅ Payload llega a backend con `files[]`
- ❌ Tool `analyze_document` NO descarga archivo
- ❌ Respuesta usa metadata del request (user_id, role) en vez de contenido del archivo

**Causa raíz**:
- Tool usa **metadata del payload** en vez de OCR/vision sobre bytes reales
- No hay validación: "si OCR retorna vacío → error, no inventar"

**Impacto**:
- Usuario sube factura → AL-E inventa monto sin leer PDF
- Usuario sube contrato → AL-E inventa cláusulas sin leer documento

---

### 🔴 **PROBLEMA #3: AGENDA FANTASMA**

**Síntoma observado**:
```
Usuario: "Agenda reunión mañana 5pm con Dr. López"
AL-E: "✓ Listo, agendé tu reunión"
Usuario revisa Google Calendar: No aparece nada
```

**Evidencia técnica** (código + DB):
- ✅ Tool `create_event` SÍ escribe en tabla `calendar_events` de Supabase
- ❌ NO hay integración con Google Calendar API
- ❌ Frontend lee directo de Supabase, NO usa API `/api/calendar`

**Decisión arquitectónica documentada** (hallazgo en auditoría):
> "Se eliminó OAuth de Google para simplificar"

**Consecuencia**:
- Eventos existen en DB interna (invisible para usuario)
- Usuario no puede ver eventos en su Google Calendar real
- **Producto vendido**: "Agenda tu calendario"
- **Producto entregado**: "Base de datos que solo ve AL-E"

**Opciones reales**:
1. **Camino A** (rápido): Frontend muestra DB interna, NO Google Calendar (cambiar expectativas)
2. **Camino B** (profesional): OAuth + Google Calendar API (implementar de verdad)

---

### 🟡 **PROBLEMA #4: CORREOS - BACKEND FUNCIONA, CEREBRO NO LO USA**

**Síntoma observado**:
```
Usuario: "¿Cuáles son mis últimos correos?"
AL-E: "Netflix te confirmó suscripción, PayPal te envió recibo..."
```

**Evidencia técnica** (PM2 logs + DB query):
- ✅ IMAP sync worker **SÍ funciona**: 2 cuentas sincronizando cada 5 min
- ✅ Tool `list_emails` **SÍ consulta DB correctamente**
- ✅ Correos REALES en tabla `email_messages`:
  ```
  p.garibay@infinitykode.com: ID 7a285444-6799-4187-8037-52826cf5c29f
  l.atristain@vitacard365.com: ID 18271802-e48c-4d85-aa84-c4b2e4759260
  ```
- ❌ Nova Pro **NO ejecuta** `list_emails` cuando usuario lo pide
- ❌ Nova inventa correos sin consultar DB

**NO es problema de**:
- ❌ IMAP/SMTP murió (sync worker operacional)
- ❌ Credenciales malas (ambas cuentas `status: active`)
- ❌ DB vacía (correos sincronizados visibles en Supabase)

**SÍ es problema de**:
- ✅ Flujo "usuario → tool → respuesta" roto por LLM
- ✅ No existe forzado de ejecución de tool
- ✅ No existe validación post-respuesta

---

### 🟡 **PROBLEMA #5: VOZ PIERDE CONTEXTO**

**Síntoma observado**:
```
Usuario ESCRIBE: "Mi nombre es Patricia"
AL-E: "Hola Patricia, ¿en qué puedo ayudarte?"

Usuario HABLA: "¿Cuál es mi nombre?"
AL-E: "No tengo esa información"  ← PERDIÓ CONTEXTO
```

**Evidencia técnica** (DevTools Network):
- ✅ STT (Deepgram) funciona: transcript correcto
- ❌ Frontend NO envía `sessionId` en request de voz
- ❌ Backend crea nueva sesión → pierde contexto

**Causa raíz**:
- Frontend: VoiceButton.tsx no pasa `sessionId` actual
- Backend: crea nueva conversación cuando no recibe `sessionId`

---

## 🔧 CHECKS P0 (NO NEGOCIABLES PARA PRODUCCIÓN)

Estos checks **NO son opinables**. O pasan, o AL-E no sale a producción.

---

### ✅ **CHECK #0: REGLA DE ORO (ANTI-MENTIRAS)**

Cada respuesta que diga **"listo / ya lo hice"** debe traer evidencia:

```typescript
{
  answer: "Agendé tu reunión con Dr. López",
  toolsUsed: ["create_event"],         // ← DEBE > 0
  metadata: {
    tool_trace: [{
      tool: "create_event",
      result: { id: "evt_123", title: "Dr. López" },  // ← EVIDENCIA REAL
      timestamp: 1706023456789
    }]
  }
}
```

**Si `toolsUsed = 0`**: AL-E **NO puede afirmar** resultados. Debe decir:
- "No pude [acción] porque [razón técnica]"
- "Intenté pero falló [error específico]"

**Implementación**:
- Archivo: `src/ai/simpleOrchestrator.ts`
- Validador post-respuesta (ANTES de devolver al frontend):
```typescript
if (intentsRequireTool && toolsUsed.length === 0) {
  return {
    answer: "Error operativo: no se ejecutó ninguna tool para esta acción.",
    error: "TOOL_EXECUTION_REQUIRED",
    toolsUsed: []
  };
}
```

**Estado actual**: ❌ NO EXISTE - Se permite responder sin tools

---

### ✅ **CHECK #1: FRONTEND → BACKEND (CONECTIVIDAD REAL)**

**Evidencia de que SÍ funciona**:
- DevTools muestra: `POST https://api.al-eon.com/api/ai/chat/v2` → 200 OK
- Netlify env vars: `VITE_ALE_CORE_URL = https://api.al-eon.com`
- Response trae: `answer`, `executionTime`, **PERO FALTA `debug`**

**Check que debe pasar**:
```json
// Response de /api/ai/chat/v2 DEBE incluir:
{
  "answer": "...",
  "toolsUsed": ["list_emails"],
  "executionTime": 1234,
  "debug": {                          // ← ESTO FALTA
    "request_id": "req_abc123",
    "model": "amazon.nova-pro-v1:0",
    "tool_trace": [...]
  }
}
```

**Sin `debug`**: Están volando a ciegas. No hay trazabilidad.

**Estado actual**: ⚠️ PARCIAL - Conectividad OK, falta metadata

---

### ✅ **CHECK #2: AGENDA (CREAR EVENTO DE VERDAD)**

**Evidencia de fallo**:
- Tool escribe en DB: `calendar_events` table ✅
- Evento NO aparece en Google Calendar del usuario ❌

**Check P0**:
1. **Decidir HOY**: ¿Agenda = Google Calendar O Agenda = DB interna?

**Opción A** (DB interna):
```typescript
// Frontend debe leer de /api/calendar/events
GET /api/calendar/events?userId=X
Response: [{ id, title, start_at, end_at }]

// UI muestra esos eventos (dentro de AL-EON solamente)
```

**Opción B** (Google Calendar real):
```typescript
// Backend debe implementar OAuth 2.0 + googleapis
import { google } from 'googleapis';
const calendar = google.calendar({ version: 'v3', auth });
await calendar.events.insert({ calendarId: 'primary', resource: event });
```

2. **Si Opción B**: Logs deben mostrar:
```
[CREATE_EVENT] ✅ Google Calendar API: event_id=evt_google_123
[CREATE_EVENT] ✅ Synced to DB: id=evt_local_456
```

3. **Si Opción A**: Marketing debe dejar de decir "sincroniza con tu calendario"

**Estado actual**: ❌ OPCIÓN A (DB interna) pero vendida como OPCIÓN B

---

### ✅ **CHECK #3: CORREOS (LEER ÚLTIMOS 5 REALES)**

**Evidencia de que backend SÍ tiene datos**:
```sql
-- Query real en Supabase:
SELECT id, from_address, subject, date 
FROM email_messages 
WHERE owner_user_id = '56bc3448-6af0-4468-99b9-78779bf84ae8'
ORDER BY date DESC LIMIT 5;

-- Resultado: 5 correos REALES (no inventados)
```

**Check P0**:
1. Cuando usuario dice "revisa correos":
```
[ORCH] 🚨 FORCE EXECUTION: list_emails
[LIST_EMAILS] ✅ Query: SELECT * FROM email_messages WHERE...
[LIST_EMAILS] ✅ Results: 5 correos
[ORCH] toolsUsed: ["list_emails"]
```

2. Response SOLO puede construirse desde esos resultados:
```json
{
  "answer": "Tienes 5 correos: [lista con from/subject/date REALES]",
  "toolsUsed": ["list_emails"],
  "metadata": {
    "tool_trace": [{
      "tool": "list_emails",
      "result": {
        "emails": [
          { "id": "msg_123", "from": "real@example.com", "subject": "..." }
        ]
      }
    }]
  }
}
```

3. **Prohibido**: Responder si `toolsUsed = 0`

**Fix técnico (ya implementado, pendiente validar)**:
- Nuclear fix en `simpleOrchestrator.ts` (líneas 560-610)
- Pre-ejecuta `list_emails` cuando detecta keywords
- **Estado**: ✅ Deploado (restart #427), ⏳ NO VALIDADO

**Validación HOY**:
- Usuario debe probar: "revisa mis correos"
- Logs deben mostrar: `[ORCH] 🚨 FORCE EXECUTION`
- Si falla: Switch de modelo (Nova Pro → Claude 3.5 Sonnet)

---

### ✅ **CHECK #4: ENVIAR CORREO (SMTP REAL)**

**Evidencia de fallo**:
```
Usuario: "Manda correo a p.garibay@..."
AL-E: "Error de autenticación"
```

**Check P0**:
1. SMTP configurado correctamente:
```env
SMTP_HOST=smtp.gmail.com (o smtp.hostinger.com)
SMTP_PORT=587
SMTP_USER=cuenta@dominio.com
SMTP_PASS=app_password_real
```

2. Logs deben mostrar:
```
[SEND_EMAIL] 🔧 Connecting to smtp.gmail.com:587
[SEND_EMAIL] ✅ Authenticated
[SEND_EMAIL] ✅ Email sent: messageId=<abc123@mail.gmail.com>
```

3. Si falla autenticación:
```
[SEND_EMAIL] ❌ Auth failed: Invalid credentials
```

**No aceptar**: "Intenté varias veces" sin log técnico específico

**Estado actual**: ❌ SMTP auth falla, causa desconocida (log incompleto)

---

### ✅ **CHECK #5: WEB SEARCH (CUANDO LO PIDES)**

**Evidencia de inconsistencia**:
- A veces trae resultados ✅
- A veces dice "no encontré nada" sin buscar ❌

**Check P0**:
1. Cuando usuario dice "busca/investiga/en la web":
```
[ORCH] Intent detected: web_search
[WEB_SEARCH] ✅ Serper API query: "Vitacard 365 membresía"
[WEB_SEARCH] ✅ Results: 10 URLs
[ORCH] toolsUsed: ["web_search"]
```

2. Response debe incluir:
```json
{
  "answer": "Encontré 10 resultados sobre Vitacard 365...",
  "toolsUsed": ["web_search"],
  "metadata": {
    "tool_trace": [{
      "tool": "web_search",
      "result": {
        "query": "Vitacard 365 membresía",
        "results": [
          { "title": "...", "url": "...", "snippet": "..." }
        ]
      }
    }]
  }
}
```

**Estado actual**: ⚠️ FUNCIONA pero inconsistente (depende de formulación)

---

### ✅ **CHECK #6: DOCUMENTOS (ANALYZE REAL)**

**Evidencia de fallo**:
- Frontend envía signed URL ✅
- Backend NO descarga archivo ❌
- AL-E "analiza" metadata en vez de contenido ❌

**Check P0**:
1. Tool debe descargar archivo:
```typescript
const response = await axios.get(signedUrl);
const fileBuffer = response.data;
const contentType = response.headers['content-type'];
```

2. Extraer texto real (OCR/vision):
```typescript
if (contentType.includes('image')) {
  const visionResult = await analyzeImageWithVision(fileBuffer);
  return { text: visionResult.text, confidence: 0.95 };
} else if (contentType.includes('pdf')) {
  const pdfText = await extractTextFromPDF(fileBuffer);
  return { text: pdfText };
}
```

3. Si OCR retorna vacío:
```typescript
if (!extractedText || extractedText.length === 0) {
  return {
    success: false,
    error: "NO_TEXT_EXTRACTED: El archivo no contiene texto legible"
  };
}
```

4. Logs:
```
[ANALYZE_DOCUMENT] 📄 Downloading: https://storage.supabase.co/...
[ANALYZE_DOCUMENT] ✅ Downloaded: 245 KB, type=image/png
[ANALYZE_DOCUMENT] 🔍 OCR extracted: 1234 characters
[ANALYZE_DOCUMENT] ✅ Result: "Dashboard de Supabase mostrando user_profiles..."
```

**Estado actual**: ❌ NO DESCARGA, usa metadata del request

---

### ✅ **CHECK #7: VOZ (STT END-TO-END SIN AMNESIA)**

**Check P0**:
1. Frontend envía POST real a `/api/voice/stt`:
```
Network tab:
POST /api/voice/stt
Request: { audio: blob, format: "webm" }
Response: { text: "¿Cuál es mi nombre?" }
```

2. Frontend envía transcript a `/api/ai/chat/v2` **CON sessionId**:
```typescript
const response = await fetch('/api/ai/chat/v2', {
  method: 'POST',
  body: JSON.stringify({
    message: transcript,
    userId: user.id,
    sessionId: currentSessionId  // ← CRÍTICO
  })
});
```

3. Backend NO crea nueva sesión si recibe `sessionId` válido:
```typescript
if (sessionId && await sessionExists(sessionId, userId)) {
  // Reusar sesión existente
  session = await loadSession(sessionId);
} else {
  // Solo ENTONCES crear nueva
  session = await createSession(userId);
}
```

**Estado actual**: ❌ Frontend NO pasa `sessionId`, cada voz = amnesia

---

## 🎯 RESPONSABILIDADES DEFINIDAS (QUIÉN ARREGLA QUÉ)

### 🔴 **CORE (Backend) - P0 HOY**

| Problema | Archivo | Fix |
|----------|---------|-----|
| **Mentiras sistémicas** | `simpleOrchestrator.ts` | Validador post-respuesta: bloquear si `toolsUsed = 0` |
| **Documentos sin leer** | `tools/handlers/analyzeDocument.ts` | Descargar signed URL + OCR real |
| **Correos nuclear fix** | `simpleOrchestrator.ts` (líneas 560-610) | **VALIDAR HOY** con usuario |
| **SMTP auth fail** | `tools/emailTools.ts` | Log completo del error + credenciales correctas |
| **Logs inútiles** | `workers/emailSyncWorker.ts` | "Command failed" → mostrar comando + razón |

### 🟡 **FRONTEND - P1 (después de CORE P0)**

| Problema | Archivo | Fix |
|----------|---------|-----|
| **Voz sin sessionId** | `VoiceButton.tsx` | Pasar `sessionId` actual en request |
| **Agenda fantasma (Opción A)** | `Calendar.tsx` | Leer de `/api/calendar/events` |
| **Email sync auth** | `Email.tsx` | Pasar token de autenticación en manual sync |

### 🟢 **DECISIÓN DE NEGOCIO (DIRECTORA + DIRECTOR)**

| Decisión | Opciones | Impacto |
|----------|----------|---------|
| **Agenda** | A) DB interna<br>B) Google Calendar real | A = 0 horas, B = 8 horas |
| **Telegram** | A) Posponer<br>B) Webhook hoy | A = 0 horas, B = 3 horas |
| **Reuniones** | A) Posponer<br>B) Backend completo | A = 0 horas, B = 12 horas |

---

## 📋 PLAN DE ACCIÓN (HOY, AHORA, YA)

### ⏰ **PRÓXIMAS 2 HORAS**

1. **VALIDAR NUCLEAR FIX** (5 min):
   - Usuario prueba: "revisa mis correos"
   - Si falla: Activar Plan B (switch a Claude)

2. **IMPLEMENTAR VALIDADOR POST-RESPUESTA** (30 min):
   ```typescript
   // src/ai/simpleOrchestrator.ts
   if (requiresTool(userIntent) && toolsUsed.length === 0) {
     throw new Error('TOOL_EXECUTION_REQUIRED');
   }
   ```

3. **FIX DOCUMENTOS** (1 hora):
   - Descargar signed URL
   - Extraer texto real (OCR/vision)
   - Loggear bytes descargados

### ⏰ **PRÓXIMAS 4 HORAS**

4. **FIX SMTP** (1 hora):
   - Validar credenciales en `.env`
   - Log completo de conexión
   - Test: enviar correo real

5. **FIX VOZ** (2 horas):
   - Frontend: pasar `sessionId`
   - Backend: validar sesión existe
   - Test: contexto se mantiene

6. **DECISIÓN AGENDA** (1 hora):
   - Si Opción A: Frontend lee DB interna
   - Si Opción B: Posponer demo

---

## 🚨 RIESGOS PARA LA DEMO

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|-----------|
| **Nuclear fix falla** | 🔴 60% | Preparar demo SIN módulo de correos |
| **Nova miente en vivo** | 🔴 70% | Logs pre-grabados, no demo en vivo |
| **Preguntas por agenda** | 🟡 50% | Honestidad: "DB interna hoy, Google Calendar en roadmap" |
| **Comparación ChatGPT** | 🟡 40% | Enfoque: email sync multi-cuenta (diferenciador) |

---

## 💣 LA VERDAD SIN ANESTESIA

### **Dónde está el error PRINCIPAL**:

**En una frase**:
> AL-E no tiene una capa obligatoria de **ejecución/validación** entre intención del usuario → tools → respuesta.

**Mientras el LLM tenga permiso de "contestar bonito" sin toolResult**, vas a seguir viendo:
- ❌ Mentiras
- ❌ Inventos
- ❌ "No puedo" defensivo

### **Qué NO es el problema**:

- ❌ "Frontend apunta a dominio incorrecto" (FALSO - api.al-eon.com existe y funciona)
- ❌ "IMAP/SMTP murió" (FALSO - sync worker operacional, DB tiene datos)
- ❌ "Bugs aislados" (FALSO - es fallo arquitectónico sistémico)

### **Qué SÍ es el problema**:

- ✅ **NO existe validador post-respuesta** (tool ejecutada vs no ejecutada)
- ✅ **NO existe forzado de ejecución** (intención → tool obligatoria)
- ✅ **NO existe grounding** (respuesta SOLO desde toolResults reales)

---

## 📞 **SIGUIENTE PASO INMEDIATO**

**AHORA (próximos 15 minutos)**:
1. Usuario prueba: "revisa mis correos" en al-eon.com
2. Verificar logs PM2: `[ORCH] 🚨 FORCE EXECUTION`
3. Si aparece: **NUCLEAR FIX FUNCIONA** → extender a otros tools
4. Si NO aparece: **NUCLEAR FIX FALLÓ** → switch a Claude 3.5 Sonnet

**Comando para ver logs**:
```bash
ssh ubuntu@100.27.201.233 "pm2 logs al-e-core --lines 50 --nostream | grep -A 10 'FORCE EXECUTION'"
```

---

**🚨 NOTA FINAL**: Este dictamen está basado en evidencia técnica real (logs, código, DB queries, DevTools). No es teoría. Es el mapa del crimen con coordenadas exactas.

**Decisión de negocio**: Si nuclear fix falla, considerar postponer demo 48 horas para implementar validador + switch de modelo. **No salir a producción con un sistema que miente**.

---

**Dictaminado por**: Directora de Proyecto  
**Validado con**: Auditoría técnica GitHub Copilot  
**Logs disponibles**: `ssh ubuntu@100.27.201.233 "pm2 logs al-e-core"`  
**Última actualización**: PM2 restart #427 (commit e8a14ad)
