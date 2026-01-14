# 🎤 INTEGRACIÓN DE AUDIO - FRONTEND

Documentación completa para implementar **Chat por Voz** y **Meeting Mode** en el frontend.

---

## 📋 ÍNDICE
1. [Chat por Voz (Manos Libres)](#1-chat-por-voz-manos-libres)
2. [Meeting Mode (Reuniones)](#2-meeting-mode-reuniones)
3. [Configuración del MediaRecorder](#3-configuración-del-mediarecorder)
4. [Manejo de Errores](#4-manejo-de-errores)

---

## 1️⃣ CHAT POR VOZ (Manos Libres)

### Flujo Completo
```
Usuario habla → Grabar audio → Transcribir → Enviar a AL-E → Respuesta
```

### Paso 1: Capturar Audio del Usuario

```typescript
// Obtener permiso del micrófono
const stream = await navigator.mediaDevices.getUserMedia({ 
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  } 
});

// Configurar MediaRecorder
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm;codecs=opus',
  audioBitsPerSecond: 128000
});

const audioChunks: Blob[] = [];

mediaRecorder.ondataavailable = (event) => {
  if (event.data.size > 0) {
    audioChunks.push(event.data);
  }
};

mediaRecorder.onstop = async () => {
  // Cuando termina de grabar, procesar
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  await procesarAudioChat(audioBlob);
};

// Usuario presiona para hablar
function iniciarGrabacion() {
  audioChunks.length = 0; // Limpiar
  mediaRecorder.start();
  console.log('🎤 Grabando...');
}

// Usuario suelta o deja de hablar
function detenerGrabacion() {
  mediaRecorder.stop();
  console.log('⏹️ Grabación detenida');
}
```

### Paso 2: Transcribir el Audio

```typescript
async function transcribirAudio(audioBlob: Blob, token: string): Promise<string> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'voice-message.webm');

  const response = await fetch(`${API_URL}/api/voice/transcribe`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  if (!response.ok) {
    throw new Error('Error al transcribir audio');
  }

  const { text } = await response.json();
  console.log('📝 Transcripción:', text);
  return text;
}
```

**Respuesta del servidor:**
```json
{
  "text": "Flaca puedes revisar mi correo por favor",
  "language": "es",
  "duration": 3.2
}
```

### Paso 3: Enviar a AL-E (Truth Orchestrator)

```typescript
async function enviarMensajeAALE(
  texto: string, 
  userId: string, 
  token: string,
  historialConversacion: Array<{role: string, content: string}> = []
) {
  const messages = [
    ...historialConversacion,
    { role: 'user', content: texto }
  ];

  const response = await fetch(`${API_URL}/api/ai/truth-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messages: messages,
      userId: userId,
      userConfirmed: false // Si es una acción crítica, pedir confirmación
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al obtener respuesta');
  }

  const result = await response.json();
  return result;
}
```

**Respuesta de AL-E:**
```json
{
  "answer": "Tienes 3 correos nuevos. El último es de Team@newsletter.motionarray.com...",
  "wasBlocked": false,
  "evidence": {
    "emails": [
      {
        "emailId": "abc123",
        "from": "Team@newsletter.motionarray.com",
        "subject": "Get assets inspired by Pantone's Color of the Year",
        "preview": "...",
        "date": "2026-01-14T19:57:31.000Z"
      }
    ]
  },
  "metadata": {
    "intent": "list_emails",
    "authorityLevel": "A2",
    "executedTools": ["list_emails"],
    "executionTime": 1234
  }
}
```

### Paso 4: Función Completa Integrada

```typescript
async function procesarAudioChat(audioBlob: Blob) {
  try {
    // 1. Mostrar "Transcribiendo..."
    setEstado('transcribiendo');
    
    // 2. Transcribir
    const texto = await transcribirAudio(audioBlob, token);
    
    // 3. Agregar mensaje del usuario al chat (UI)
    agregarMensajeAlChat({ role: 'user', content: texto });
    
    // 4. Mostrar "AL-E está pensando..."
    setEstado('procesando');
    
    // 5. Enviar a AL-E
    const respuesta = await enviarMensajeAALE(
      texto, 
      userId, 
      token,
      historialConversacion
    );
    
    // 6. Mostrar respuesta de AL-E
    if (respuesta.wasBlocked) {
      agregarMensajeAlChat({ 
        role: 'assistant', 
        content: `⚠️ ${respuesta.blockReason}` 
      });
    } else {
      agregarMensajeAlChat({ 
        role: 'assistant', 
        content: respuesta.answer 
      });
      
      // Opcional: Mostrar evidencia (emails, eventos, etc.)
      if (respuesta.evidence) {
        mostrarEvidencia(respuesta.evidence);
      }
    }
    
    setEstado('listo');
    
  } catch (error) {
    console.error('Error:', error);
    mostrarError('Hubo un error al procesar tu mensaje');
    setEstado('error');
  }
}
```

---

## 2️⃣ MEETING MODE (Reuniones)

### Flujo Completo
```
Iniciar meeting → Grabar continuamente → Enviar chunks cada 5s → 
Detener meeting → Procesar → Obtener transcript + minuta
```

### Paso 1: Iniciar Meeting

```typescript
async function iniciarReunion(
  titulo: string,
  descripcion: string,
  token: string
): Promise<string> {
  const response = await fetch(`${API_URL}/api/meetings/live/start`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      title: titulo,
      description: descripcion,
      happened_at: new Date().toISOString()
    })
  });

  if (!response.ok) {
    throw new Error('Error al iniciar reunión');
  }

  const meeting = await response.json();
  console.log('🎬 Reunión iniciada:', meeting.id);
  return meeting.id; // Guardar este ID
}
```

**Respuesta:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Reunión con cliente",
  "status": "recording",
  "created_at": "2026-01-14T22:00:00Z"
}
```

### Paso 2: Grabar y Enviar Chunks Continuamente

```typescript
let chunkIndex = 0;
let meetingId: string;
let mediaRecorder: MediaRecorder;

async function iniciarGrabacionReunion(token: string) {
  // 1. Crear meeting
  meetingId = await iniciarReunion('Mi Reunión', 'Descripción', token);
  
  // 2. Obtener audio stream
  const stream = await navigator.mediaDevices.getUserMedia({ 
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    } 
  });
  
  // 3. Configurar MediaRecorder
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: 128000
  });
  
  // 4. Enviar cada chunk cuando esté listo
  mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
      chunkIndex++;
      console.log(`📦 Enviando chunk ${chunkIndex}...`);
      
      try {
        await enviarChunkReunion(meetingId, event.data, chunkIndex, token);
        console.log(`✅ Chunk ${chunkIndex} enviado`);
        
        // Opcional: Actualizar UI con progreso
        actualizarUIProgreso(chunkIndex);
        
      } catch (error) {
        console.error(`❌ Error enviando chunk ${chunkIndex}:`, error);
        // Reintentar o notificar al usuario
      }
    }
  };
  
  mediaRecorder.onerror = (error) => {
    console.error('Error en MediaRecorder:', error);
    detenerGrabacionReunion();
  };
  
  // 5. Iniciar grabación con chunks cada 5 segundos
  mediaRecorder.start(5000);
  console.log('🔴 Grabando reunión...');
}

async function enviarChunkReunion(
  meetingId: string,
  audioBlob: Blob,
  chunkIndex: number,
  token: string
) {
  const formData = new FormData();
  formData.append('chunk', audioBlob, `chunk-${chunkIndex}.webm`);
  
  const response = await fetch(`${API_URL}/api/meetings/live/${meetingId}/chunk`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Error al enviar chunk');
  }
  
  const result = await response.json();
  // result = { success: true, chunkIndex: 3, assetId: "...", sizeBytes: 45678 }
  return result;
}
```

### Paso 3: Ver Progreso en Tiempo Real (Opcional)

```typescript
// Polling cada 10 segundos para ver el transcript parcial
async function obtenerStatusReunion(meetingId: string, token: string) {
  const response = await fetch(`${API_URL}/api/meetings/live/${meetingId}/status`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Error al obtener status');
  }
  
  const status = await response.json();
  return status;
}

// Usar con setInterval
const intervalId = setInterval(async () => {
  if (meetingId) {
    const status = await obtenerStatusReunion(meetingId, token);
    console.log('📊 Status:', status);
    
    // Actualizar UI con transcript parcial
    mostrarTranscriptParcial(status.transcript);
    mostrarNotasParciales(status.notes);
  }
}, 10000); // Cada 10 segundos
```

**Respuesta de status:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "recording",
  "transcript": "Hola equipo, hoy vamos a revisar el proyecto X...",
  "notes": [
    "Proyecto X en revisión"
  ],
  "detected_agreements": [],
  "chunk_count": 12
}
```

### Paso 4: Detener Reunión

```typescript
async function detenerGrabacionReunion() {
  // 1. Detener MediaRecorder
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  
  // 2. Detener tracks del stream
  const stream = mediaRecorder.stream;
  stream.getTracks().forEach(track => track.stop());
  
  // 3. Notificar al backend que terminó
  if (meetingId) {
    await finalizarReunion(meetingId, token);
  }
  
  console.log('⏹️ Reunión detenida');
  
  // 4. Detener polling de status
  if (intervalId) {
    clearInterval(intervalId);
  }
  
  // 5. Redirigir a página de resultados
  irAResultadosReunion(meetingId);
}

async function finalizarReunion(meetingId: string, token: string) {
  const response = await fetch(`${API_URL}/api/meetings/live/${meetingId}/stop`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Error al finalizar reunión');
  }
  
  const result = await response.json();
  console.log('✅ Reunión finalizada:', result);
  return result;
}
```

### Paso 5: Obtener Resultados Finales

```typescript
async function obtenerResultadosReunion(meetingId: string, token: string) {
  const response = await fetch(`${API_URL}/api/meetings/${meetingId}/result`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  if (!response.ok) {
    throw new Error('Error al obtener resultados');
  }
  
  const resultado = await response.json();
  return resultado;
}
```

**Respuesta final:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "ready",
  "transcript": "Transcript completo de toda la reunión...",
  "summary": "Resumen generado por AL-E",
  "notes": [
    "Punto 1 discutido",
    "Punto 2 acordado"
  ],
  "action_items": [
    "Juan debe enviar propuesta antes del viernes",
    "María revisará el presupuesto"
  ],
  "detected_agreements": [
    "Aprobación del presupuesto Q1"
  ],
  "participants": ["Juan", "María"],
  "duration_seconds": 1800
}
```

---

## 3️⃣ CONFIGURACIÓN DEL MEDIARECORDER

### Formatos Recomendados por Plataforma

```typescript
function obtenerMimeTypeOptimo(): string {
  // Prioridad de formatos (del mejor al más compatible)
  const formatos = [
    'audio/webm;codecs=opus',  // Mejor compresión, buena calidad
    'audio/webm',              // WebM genérico
    'audio/mp4',               // Fallback 1
    'audio/aac',               // Fallback 2
    'audio/wav'                // Último recurso (sin compresión)
  ];
  
  for (const formato of formatos) {
    if (MediaRecorder.isTypeSupported(formato)) {
      console.log('✅ Usando formato:', formato);
      return formato;
    }
  }
  
  // Fallback final
  console.warn('⚠️ Usando formato por defecto del navegador');
  return '';
}

// Uso
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: obtenerMimeTypeOptimo(),
  audioBitsPerSecond: 128000
});
```

### Configuración de Constraints de Audio

```typescript
const constraints = {
  audio: {
    echoCancellation: true,      // Cancelación de eco
    noiseSuppression: true,       // Supresión de ruido
    autoGainControl: true,        // Control automático de ganancia
    sampleRate: 48000,            // 48kHz (óptimo)
    channelCount: 1               // Mono (reduce tamaño)
  },
  video: false
};

const stream = await navigator.mediaDevices.getUserMedia(constraints);
```

---

## 4️⃣ MANEJO DE ERRORES

### Errores Comunes y Soluciones

```typescript
async function manejarErroresAudio() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // ... resto del código
    
  } catch (error: any) {
    if (error.name === 'NotAllowedError') {
      mostrarError('❌ Permiso de micrófono denegado. Por favor, habilítalo en la configuración del navegador.');
    } else if (error.name === 'NotFoundError') {
      mostrarError('❌ No se encontró ningún micrófono. Conecta uno y recarga la página.');
    } else if (error.name === 'NotReadableError') {
      mostrarError('❌ El micrófono está siendo usado por otra aplicación.');
    } else {
      mostrarError(`❌ Error al acceder al micrófono: ${error.message}`);
    }
  }
}
```

### Reintento Automático de Chunks

```typescript
async function enviarChunkConReintento(
  meetingId: string,
  audioBlob: Blob,
  chunkIndex: number,
  token: string,
  maxReintentos: number = 3
) {
  let intentos = 0;
  
  while (intentos < maxReintentos) {
    try {
      return await enviarChunkReunion(meetingId, audioBlob, chunkIndex, token);
    } catch (error) {
      intentos++;
      console.warn(`⚠️ Intento ${intentos}/${maxReintentos} falló para chunk ${chunkIndex}`);
      
      if (intentos >= maxReintentos) {
        throw new Error(`Error enviando chunk ${chunkIndex} después de ${maxReintentos} intentos`);
      }
      
      // Esperar antes de reintentar (backoff exponencial)
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, intentos)));
    }
  }
}
```

---

## 📊 RESUMEN DE ENDPOINTS

### Chat por Voz
```
POST /api/voice/transcribe          → Transcribir audio a texto
POST /api/ai/truth-chat              → Enviar mensaje a AL-E
```

### Meeting Mode
```
POST /api/meetings/live/start        → Iniciar reunión
POST /api/meetings/live/:id/chunk    → Enviar chunk de audio
GET  /api/meetings/live/:id/status   → Ver progreso en tiempo real
POST /api/meetings/live/:id/stop     → Finalizar reunión
GET  /api/meetings/:id/result        → Obtener resultados finales
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

### Chat por Voz
- [ ] Solicitar permiso de micrófono
- [ ] Configurar MediaRecorder con formato óptimo
- [ ] Implementar botón "Mantener para hablar"
- [ ] Transcribir audio con `/api/voice/transcribe`
- [ ] Enviar texto a `/api/ai/truth-chat`
- [ ] Mostrar respuesta de AL-E en el chat
- [ ] Manejar errores de micrófono

### Meeting Mode
- [ ] Crear UI para iniciar/detener reunión
- [ ] Implementar `/api/meetings/live/start`
- [ ] Configurar MediaRecorder con chunks de 5 segundos
- [ ] Enviar chunks a `/api/meetings/live/:id/chunk`
- [ ] Implementar reintento automático para chunks fallidos
- [ ] Mostrar indicador de grabación activa
- [ ] Opcional: Polling de `/status` para transcript en tiempo real
- [ ] Implementar `/stop` al finalizar
- [ ] Mostrar resultados con `/result`

---

## 🚀 SIGUIENTE PASO

Implementa primero **Chat por Voz** (más simple), luego **Meeting Mode**.

¿Dudas o necesitas ayuda con alguna parte específica?
