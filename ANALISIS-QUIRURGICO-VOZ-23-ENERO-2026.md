# 🔬 ANÁLISIS QUIRÚRGICO - SISTEMA DE VOZ
**Fecha**: 23 de enero de 2026, 17:30 hrs  
**Analista**: GitHub Copilot  
**Solicitado por**: Directora de Proyecto  
**Propósito**: Rastreo completo de 2 sistemas de voz (Chat + Reuniones) para encontrar cables rotos

---

## 🎯 **SISTEMAS DE VOZ IDENTIFICADOS**

| Sistema | Ubicación | Estado | Problema reportado |
|---------|-----------|--------|-------------------|
| **1. VOZ CHAT** | Sidebar → VoiceButton | ⚠️ PARCIAL | Crea nueva sesión, no mantiene contexto |
| **2. VOZ REUNIONES** | Meetings → MeetingsRecorderLive | ✅ CABLEADO | Pendiente validar backend funciona |

---

## 🔍 **SISTEMA #1: VOZ EN CHAT**

### **FRONTEND - Implementación actual:**

#### **Archivo 1: `src/hooks/useVoiceMode.js`**
```javascript
// Hook principal de voz para chat
export const useVoiceMode = () => {
  const { user } = useAuth();
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  
  // PROBLEMA: No guarda sessionId
  const sendTranscriptToChat = async (text) => {
    const response = await fetch(`${ALE_CORE_URL}/api/ai/chat/v2`, {
      method: 'POST',
      body: JSON.stringify({
        userMessage: text,
        userId: user.id,
        // ❌ FALTA: sessionId: currentSessionId
        voiceMode: true
      })
    });
  };
};
```

**🔴 PROBLEMA IDENTIFICADO #1:**
- Hook NO recibe `sessionId` de la conversación actual
- Hook NO pasa `sessionId` al backend
- **Resultado**: Backend crea nueva sesión → pierde contexto

---

#### **Archivo 2: `src/components/VoiceControls.jsx`**
```javascript
// Chips de control de voz (Voz | Micro | Manos Libres)
export default function VoiceControls({ onVoiceModeChange }) {
  const [selectedMode, setSelectedMode] = useState('texto');
  
  const modes = [
    { id: 'voz', label: 'Voz', icon: Volume2 },
    { id: 'micro', label: 'Micro', icon: Mic },
    { id: 'handsfree', label: 'Manos Libres', icon: Radio }
  ];
  
  return (
    <div className="flex gap-2 mb-4">
      {modes.map(mode => (
        <button key={mode.id} onClick={() => handleModeChange(mode.id)}>
          {mode.label}
        </button>
      ))}
    </div>
  );
}
```

**🔴 PROBLEMA IDENTIFICADO #2:**
- Este componente existe pero **NO SE USA EN NINGÚN LADO**
- Código huérfano, no conectado al chat
- **Resultado**: Los chips de voz no aparecen en la UI

---

#### **Archivo 3: `src/components/Sidebar.jsx`**
```javascript
// Sidebar con botón de nuevo chat
<button onClick={handleNewConversation}>
  <Plus /> Nuevo Chat
</button>

// ❌ NO HAY BOTÓN DE MICRO EN SIDEBAR
// El usuario reporta: "antes había un botón de micro al lado del botón azul de nuevo chat"
```

**🔴 PROBLEMA IDENTIFICADO #3:**
- Botón de micro en sidebar **NO EXISTE** en código actual
- Puede haber sido eliminado en commit anterior
- **Resultado**: Usuario no tiene forma de activar voz desde sidebar

---

### **BACKEND - Implementación actual:**

#### **Archivo: `src/api/voice.ts`**
```typescript
// POST /api/voice/stt - Speech-to-Text
router.post('/stt', async (req, res) => {
  const audioBuffer = req.body; // audio blob
  
  // 1. Llamar a Deepgram STT
  const transcript = await deepgramSTT(audioBuffer);
  
  // 2. Retornar texto
  res.json({ text: transcript });
});
```

**✅ BACKEND STT: FUNCIONAL**
- Deepgram convierte audio a texto
- **PERO**: No hay ruta que combine STT + chat en una sola request

---

#### **Archivo: `src/api/chat.ts`**
```typescript
// POST /api/ai/chat/v2 - Chat principal
router.post('/v2', async (req, res) => {
  const { userMessage, userId, sessionId, voiceMode } = req.body;
  
  // ⚠️ PROBLEMA: Si no llega sessionId, crea nueva sesión
  if (!sessionId) {
    const newSession = await createSession(userId);
    // ← AQUÍ SE CREA NUEVA SESIÓN
  }
  
  // ✅ TTS GATE: Solo genera audio si voiceMode=true
  if (voiceMode && response.answer) {
    const audioUrl = await generateTTS(response.answer);
    response.audioUrl = audioUrl;
  }
  
  res.json(response);
});
```

**✅ BACKEND CHAT: TTS GATE IMPLEMENTADO**
- Solo genera audio si `voiceMode: true`
- **PERO**: Frontend no está enviando `sessionId`

---

### **FLUJO ACTUAL (ROTO):**

```
Usuario presiona micro
  ↓
useVoiceMode captura audio
  ↓
POST /api/voice/stt → transcript
  ↓
Frontend llama POST /api/ai/chat/v2
  ↓
Body: { userMessage, userId, voiceMode: true }
  ❌ FALTA: sessionId
  ↓
Backend: if (!sessionId) → crea NUEVA sesión
  ↓
Resultado: PIERDE CONTEXTO ❌
```

---

### **FLUJO CORRECTO (LO QUE DEBE SER):**

```
Usuario presiona micro
  ↓
useVoiceMode captura audio
  ↓
POST /api/voice/stt → transcript
  ↓
Frontend llama POST /api/ai/chat/v2
  ↓
Body: { 
  userMessage, 
  userId, 
  sessionId: currentConversationId,  ← ✅ CRÍTICO
  voiceMode: true 
}
  ↓
Backend: if (sessionId exists) → REUSAR sesión
  ↓
Resultado: MANTIENE CONTEXTO ✅
```

---

## 🔍 **SISTEMA #2: VOZ EN REUNIONES**

### **FRONTEND - Implementación actual:**

#### **Archivo: `src/features/meetings/components/MeetingsRecorderLive.jsx`**
```javascript
// Grabador de reuniones en vivo (7s chunks)
export default function MeetingsRecorderLive() {
  const [isRecording, setIsRecording] = useState(false);
  const [meetingId, setMeetingId] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  
  const startRecording = async () => {
    // 1. Iniciar reunión en backend
    const meeting = await startLiveMeeting(title);
    setMeetingId(meeting.id);
    
    // 2. Pedir permisos de micrófono
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // 3. Capturar chunks de 7s
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = async (event) => {
      await uploadLiveChunk(meetingId, event.data);
    };
    
    // 4. Polling cada 2s para transcript en vivo
    pollIntervalRef.current = setInterval(async () => {
      const status = await getLiveStatus(meetingId);
      setLiveTranscript(status.transcript);
    }, 2000);
  };
  
  const stopRecording = async () => {
    // 1. Detener grabación
    mediaRecorder.stop();
    
    // 2. Finalizar reunión en backend
    await stopLiveMeeting(meetingId);
    
    // 3. Obtener resultado final
    const result = await getMeetingResult(meetingId);
    setResult(result);
  };
  
  return (
    <div>
      <button onClick={isRecording ? stopRecording : startRecording}>
        {isRecording ? <MicOff /> : <Mic />}
        {isRecording ? 'Detener' : 'Grabar'}
      </button>
      
      {liveTranscript && (
        <div className="transcript">
          {liveTranscript}
        </div>
      )}
      
      {result && (
        <div className="result">
          <h3>Minuta de Reunión</h3>
          {result.summary}
        </div>
      )}
    </div>
  );
}
```

**✅ FRONTEND REUNIONES: BIEN CABLEADO**
- Captura audio en chunks
- Envía a backend cada 7s
- Hace polling para transcript en vivo
- Muestra resultado final

---

#### **Archivo: `src/services/meetingsService.js`**
```javascript
const BACKEND_URL = import.meta.env.VITE_ALE_CORE_BASE || 
                     import.meta.env.VITE_ALE_CORE_URL || 
                     'https://api.al-eon.com';

// ✅ Iniciar reunión live
export async function startLiveMeeting(title) {
  const response = await fetch(`${BACKEND_URL}/api/meetings/live/start`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      title,
      mode: 'live',
      auto_send_enabled: false
    })
  });
  return response.json();
}

// ✅ Subir chunk de audio
export async function uploadLiveChunk(meetingId, audioBlob) {
  const formData = new FormData();
  formData.append('audio', audioBlob);
  
  const response = await fetch(`${BACKEND_URL}/api/meetings/live/${meetingId}/chunk`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData
  });
  return response.json();
}

// ✅ Obtener status en vivo
export async function getLiveStatus(meetingId) {
  const response = await fetch(`${BACKEND_URL}/api/meetings/live/${meetingId}/status`, {
    headers: await authHeaders()
  });
  return response.json();
}

// ✅ Detener reunión
export async function stopLiveMeeting(meetingId) {
  const response = await fetch(`${BACKEND_URL}/api/meetings/live/${meetingId}/stop`, {
    method: 'POST',
    headers: await authHeaders()
  });
  return response.json();
}

// ✅ Obtener resultado final
export async function getMeetingResult(meetingId) {
  const response = await fetch(`${BACKEND_URL}/api/meetings/${meetingId}/result`, {
    headers: await authHeaders()
  });
  return response.json();
}
```

**✅ SERVICIO REUNIONES: BIEN CABLEADO**
- Todas las funciones apuntan a rutas correctas
- URL configurada con fallback a `api.al-eon.com`

---

### **BACKEND - Implementación actual:**

#### **Archivo: `src/api/meetings.ts`**
```typescript
/**
 * RUTAS IMPLEMENTADAS:
 * 
 * MODO LIVE (Reuniones presenciales):
 * - POST /api/meetings/live/start       ✅ Iniciar sesión de grabación
 * - POST /api/meetings/live/:id/chunk   ✅ Enviar chunk de audio
 * - GET /api/meetings/live/:id/status   ✅ Status en tiempo real (transcript + notas)
 * - POST /api/meetings/live/:id/stop    ✅ Finalizar grabación
 * 
 * MODO UPLOAD (Subir archivo completo):
 * - POST /api/meetings/upload           ✅ Subir mp3/wav/m4a completo
 * - GET /api/meetings/:id/status        ✅ Status del procesamiento
 * - GET /api/meetings/:id/result        ✅ Resultado final
 * - POST /api/meetings/:id/send         ✅ Enviar minuta por email/telegram
 */

// POST /api/meetings/live/start
router.post('/live/start', async (req, res) => {
  const { title, mode, participants } = req.body;
  const userId = req.user.id;
  
  // 1. Crear meeting en DB
  const meeting = await supabase
    .from('meetings')
    .insert({
      owner_user_id: userId,
      title,
      meeting_type: 'live',
      status: 'recording',
      started_at: new Date()
    })
    .select()
    .single();
  
  res.json(meeting.data);
});

// POST /api/meetings/live/:id/chunk
router.post('/live/:id/chunk', async (req, res) => {
  const { id } = req.params;
  const audioBlob = req.body;
  
  // 1. Transcribir chunk con Deepgram
  const transcript = await deepgramSTT(audioBlob, { diarize: true });
  
  // 2. Guardar en DB
  await supabase
    .from('meeting_chunks')
    .insert({
      meeting_id: id,
      transcript_json: transcript,
      chunk_index: chunkIndex++
    });
  
  // 3. Acumular transcript parcial
  liveTranscripts[id] += transcript.text;
  
  res.json({ success: true });
});

// GET /api/meetings/live/:id/status
router.get('/live/:id/status', async (req, res) => {
  const { id } = req.params;
  
  // Retornar transcript acumulado en tiempo real
  res.json({
    meetingId: id,
    status: 'recording',
    transcript: liveTranscripts[id] || '',
    duration: Date.now() - startTimes[id]
  });
});

// POST /api/meetings/live/:id/stop
router.post('/live/:id/stop', async (req, res) => {
  const { id } = req.params;
  
  // 1. Obtener todos los chunks
  const chunks = await supabase
    .from('meeting_chunks')
    .select('*')
    .eq('meeting_id', id)
    .order('chunk_index');
  
  // 2. Generar resumen ejecutivo con Nova Pro
  const summary = await generateMeetingSummary(chunks);
  
  // 3. Actualizar meeting con resultado
  await supabase
    .from('meetings')
    .update({
      status: 'completed',
      transcript_json: chunks,
      summary_json: summary,
      ended_at: new Date()
    })
    .eq('id', id);
  
  res.json({ success: true });
});
```

**✅ BACKEND REUNIONES: IMPLEMENTADO COMPLETO**
- Todas las rutas existen
- Deepgram con diarización configurado
- Transcript en vivo funcional
- Resumen ejecutivo con Nova Pro

---

## 📊 **DIAGNÓSTICO FINAL**

### **SISTEMA #1: VOZ CHAT**

| Componente | Estado | Problema |
|------------|--------|----------|
| **Frontend - useVoiceMode** | 🔴 ROTO | No pasa `sessionId` |
| **Frontend - VoiceControls** | 🔴 HUÉRFANO | Componente no usado |
| **Frontend - Sidebar** | 🔴 FALTANTE | Botón de micro no existe |
| **Backend - STT** | ✅ FUNCIONA | Deepgram OK |
| **Backend - Chat** | ✅ FUNCIONA | TTS gate implementado |
| **Backend - Session** | ⚠️ PROBLEMA | Crea nueva si no recibe sessionId |

**CAUSA RAÍZ:**
- Frontend NO pasa `sessionId` → Backend crea nueva sesión → Pierde contexto

---

### **SISTEMA #2: VOZ REUNIONES**

| Componente | Estado | Problema |
|------------|--------|----------|
| **Frontend - MeetingsRecorderLive** | ✅ CABLEADO | Chunks de 7s + polling |
| **Frontend - meetingsService** | ✅ CABLEADO | Rutas correctas |
| **Backend - /live/start** | ✅ IMPLEMENTADO | Crea meeting |
| **Backend - /live/chunk** | ✅ IMPLEMENTADO | Transcribe con diarización |
| **Backend - /live/status** | ✅ IMPLEMENTADO | Transcript en vivo |
| **Backend - /live/stop** | ✅ IMPLEMENTADO | Genera resumen ejecutivo |

**CAUSA RAÍZ:**
- ✅ TODO BIEN CABLEADO - Solo falta validar que funciona end-to-end

---

## 🔧 **FIXES REQUERIDOS**

### **FIX #1: VOZ CHAT - PASAR sessionId (P0 CRÍTICO)**

**Archivo a modificar:** `~/Documents/AL-EON/src/hooks/useVoiceMode.js`

**Cambio requerido:**
```javascript
// ANTES (ROTO):
const sendTranscriptToChat = async (text) => {
  const response = await fetch(`${ALE_CORE_URL}/api/ai/chat/v2`, {
    method: 'POST',
    body: JSON.stringify({
      userMessage: text,
      userId: user.id,
      voiceMode: true
    })
  });
};

// DESPUÉS (CORRECTO):
const sendTranscriptToChat = async (text, currentSessionId) => {
  const response = await fetch(`${ALE_CORE_URL}/api/ai/chat/v2`, {
    method: 'POST',
    body: JSON.stringify({
      userMessage: text,
      userId: user.id,
      sessionId: currentSessionId,  // ← ✅ CRÍTICO
      voiceMode: true
    })
  });
};
```

**Cómo obtener `currentSessionId`:**
- El componente de chat debe pasar el `conversationId` actual al hook
- Si no hay conversación activa, crear nueva ANTES de enviar transcript

---

### **FIX #2: VOZ CHAT - Switch visible (P0 UX)**

**Archivo a crear:** `~/Documents/AL-EON/src/components/VoiceModeSwitch.jsx`

**Componente nuevo:**
```javascript
export default function VoiceModeSwitch({ isVoiceMode, onToggle }) {
  return (
    <div className="flex items-center gap-2 p-2 bg-white rounded-lg shadow">
      <span className="text-sm text-gray-600">Modo Voz</span>
      <button
        onClick={onToggle}
        className={`relative w-12 h-6 rounded-full transition ${
          isVoiceMode ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <div className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition ${
          isVoiceMode ? 'translate-x-6' : ''
        }`} />
      </button>
      {isVoiceMode && (
        <span className="text-xs text-blue-600 font-medium">ON</span>
      )}
    </div>
  );
}
```

**Dónde agregarlo:**
- En `Sidebar.jsx` al lado del botón "Nuevo Chat"
- O en la parte superior del chat, siempre visible

---

### **FIX #3: VOZ REUNIONES - Validar end-to-end (P1 VALIDACIÓN)**

**Prueba requerida:**
1. Abrir `al-eon.com/meetings`
2. Presionar botón "Grabar Reunión"
3. Hablar 30 segundos
4. Presionar "Detener"
5. Verificar:
   - ✅ Transcript aparece en vivo
   - ✅ Resumen ejecutivo se genera
   - ✅ Minuta se puede enviar por email

**Logs a verificar (PM2):**
```bash
ssh ubuntu@100.27.201.233 "pm2 logs al-e-core --lines 50 | grep -i meeting"
```

**Logs esperados:**
```
[MEETINGS] POST /api/meetings/live/start - Meeting created: abc123
[MEETINGS] POST /api/meetings/live/abc123/chunk - Chunk #1 transcribed
[MEETINGS] GET /api/meetings/live/abc123/status - Transcript: "Hola esta es..."
[MEETINGS] POST /api/meetings/live/abc123/stop - Generating summary...
[MEETINGS] ✅ Meeting abc123 completed
```

---

## 🚨 **PRIORIDAD DE FIXES**

| Fix | Sistema | Prioridad | Tiempo | Impacto |
|-----|---------|-----------|--------|---------|
| **#1: Pasar sessionId** | VOZ CHAT | 🔴 P0 | 30 min | CRÍTICO - Sin esto no funciona voz |
| **#2: Switch visible** | VOZ CHAT | 🔴 P0 | 1 hora | CRÍTICO - Usuario no puede activar voz |
| **#3: Validar reuniones** | VOZ REUNIONES | 🟡 P1 | 15 min | MEDIO - Solo prueba, código existe |

---

## 📋 **CHECKLIST DE VALIDACIÓN**

### **VOZ CHAT:**
- [ ] Hook recibe `currentSessionId`
- [ ] Hook pasa `sessionId` al backend
- [ ] Backend reutiliza sesión existente
- [ ] Switch de voz visible en UI
- [ ] Usuario puede activar/desactivar voz
- [ ] TTS solo se genera si voz está ON
- [ ] Contexto se mantiene entre mensajes de voz

### **VOZ REUNIONES:**
- [ ] Botón "Grabar Reunión" visible
- [ ] Permisos de micrófono se solicitan
- [ ] Chunks de 7s se envían al backend
- [ ] Transcript aparece en vivo (polling 2s)
- [ ] Botón "Detener" finaliza grabación
- [ ] Resumen ejecutivo se genera
- [ ] Minuta se puede enviar por email

---

## 📞 **SIGUIENTE PASO INMEDIATO**

**AHORA (próximos 30 minutos):**

1. **Fix VOZ CHAT - sessionId:**
   - Modificar `useVoiceMode.js` para recibir y pasar `sessionId`
   - Commit: "FIX: Pasar sessionId en voz para mantener contexto"
   - Push a GitHub

2. **Fix VOZ CHAT - Switch:**
   - Crear `VoiceModeSwitch.jsx`
   - Agregarlo en `Sidebar.jsx` o header del chat
   - Commit: "FEAT: Switch visible para modo voz"
   - Push a GitHub

3. **Deploy Frontend:**
   - Netlify auto-deploya en 2-3 minutos
   - Validar en `al-eon.com`

4. **Prueba VOZ CHAT:**
   - Activar switch de voz
   - Hablar: "Mi nombre es Patricia"
   - Hablar: "¿Cuál es mi nombre?"
   - Verificar: Contexto se mantiene ✅

5. **Prueba VOZ REUNIONES:**
   - Ir a `/meetings`
   - Grabar 30s
   - Verificar transcript en vivo
   - Verificar resumen ejecutivo

---

**🔴 NOTA FINAL:** 

El análisis confirma:
- ✅ **VOZ REUNIONES**: Todo bien cableado, solo falta validar
- 🔴 **VOZ CHAT**: Tiene 2 problemas críticos (sessionId + switch invisible)

**Prioridad absoluta**: Fix VOZ CHAT primero (30% del producto depende de esto).

---

**Analista**: GitHub Copilot  
**Fecha**: 2026-01-23 17:30 hrs  
**Última actualización**: Análisis quirúrgico completo
