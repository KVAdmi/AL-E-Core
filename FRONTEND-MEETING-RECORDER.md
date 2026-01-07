# Frontend: Implementación Modo Reunión (Altavoz) PWA

## Objetivo
Permitir que AL-E capture audio presencial desde el micrófono del móvil/laptop, procese en chunks, y genere minutas automáticas.

---

## Realidad PWA que DEBES conocer

### ✅ Android (Chrome PWA)
- MediaRecorder funciona bien
- Puedes grabar audio sin problemas
- Background recording funciona si mantienes la app en primer plano

### ⚠️ iOS (Safari/PWA)
- **Si bloqueas pantalla → grabación MUERE**
- **Si cambias de app → grabación MUERE**
- **Si recibes llamada → grabación MUERE**
- MediaRecorder puede funcionar, pero es frágil

### 🎯 Solución Práctica
1. **Modo Altavoz (chunks)**: Para grabaciones cortas (< 5 min)
2. **Fallback Upload**: Botón "Subir grabación" para archivos grabados externamente

---

## Flow Completo (Modo Altavoz)

```
Usuario toca "Iniciar Reunión" (🎙️)
  ↓
Frontend: POST /api/meetings/live/start
  → Backend crea meeting en DB, status="recording"
  → Respuesta: { meetingId }
  ↓
Frontend: Inicia MediaRecorder
  ↓
Cada 10-20 segundos:
  Frontend: POST /api/meetings/live/:id/chunk (multipart chunk de audio)
  → Backend guarda en S3 + encola job de transcripción
  ↓
Usuario puede ver transcript en vivo:
  Frontend: GET /api/meetings/live/:id/status (polling cada 5s)
  → Respuesta: { transcript, notes, detected_agreements }
  ↓
Usuario toca "Detener Reunión" (⏹️)
  ↓
Frontend: POST /api/meetings/live/:id/stop
  → Backend genera minuta final + ingesta a RAG
  → Respuesta: { status: "processing" }
  ↓
Frontend: Mostrar minuta (GET /api/meetings/:id)
```

---

## Código Frontend (React/TypeScript)

### 1. Hook para grabación

```typescript
// hooks/useMeetingRecorder.ts
import { useState, useRef, useCallback } from 'react';

interface RecorderConfig {
  chunkIntervalMs?: number; // Default: 15000 (15s)
}

export function useMeetingRecorder(config: RecorderConfig = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<number>(0);

  const startRecording = useCallback(async (title?: string) => {
    try {
      // Pedir permisos de micrófono
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000, // Ideal para Whisper
        } 
      });

      // Crear meeting en backend
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/meetings/live/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('supabase.auth.token')}`,
        },
        body: JSON.stringify({
          title: title || 'Reunión sin título',
        }),
      });

      const { meetingId: newMeetingId } = await response.json();
      setMeetingId(newMeetingId);

      // Configurar MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : 'audio/mp4'; // Fallback para iOS

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000,
      });

      mediaRecorderRef.current = mediaRecorder;

      // Enviar chunks cada N segundos
      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          chunksRef.current++;
          await uploadChunk(newMeetingId, event.data, chunksRef.current);
        }
      };

      // Iniciar grabación con timeslice
      const interval = config.chunkIntervalMs || 15000;
      mediaRecorder.start(interval);

      setIsRecording(true);
      console.log('[RECORDER] Recording started:', newMeetingId);
    } catch (error) {
      console.error('[RECORDER] Error starting:', error);
      alert('Error al iniciar grabación. Verifica permisos de micrófono.');
    }
  }, [config.chunkIntervalMs]);

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !meetingId) return;

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());

    setIsRecording(false);

    // Notificar backend que finalizó
    await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/meetings/live/${meetingId}/stop`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('supabase.auth.token')}`,
      },
    });

    console.log('[RECORDER] Recording stopped');
  }, [meetingId]);

  return {
    isRecording,
    meetingId,
    startRecording,
    stopRecording,
  };
}

async function uploadChunk(meetingId: string, blob: Blob, chunkIndex: number) {
  const formData = new FormData();
  formData.append('chunk', blob, `chunk-${chunkIndex}.webm`);

  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/meetings/live/${meetingId}/chunk`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${localStorage.getItem('supabase.auth.token')}`,
    },
    body: formData,
  });

  console.log(`[RECORDER] Chunk ${chunkIndex} uploaded`);
}
```

### 2. Componente UI

```tsx
// components/MeetingRecorder.tsx
'use client';

import { useState, useEffect } from 'react';
import { useMeetingRecorder } from '@/hooks/useMeetingRecorder';

interface MeetingStatus {
  transcript: string;
  notes: string[];
  detected_agreements: string[];
}

export function MeetingRecorder() {
  const { isRecording, meetingId, startRecording, stopRecording } = useMeetingRecorder();
  const [status, setStatus] = useState<MeetingStatus | null>(null);
  const [title, setTitle] = useState('');

  // Polling de status mientras está grabando
  useEffect(() => {
    if (!isRecording || !meetingId) return;

    const interval = setInterval(async () => {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/meetings/live/${meetingId}/status`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('supabase.auth.token')}`,
          },
        }
      );
      const data = await response.json();
      setStatus(data);
    }, 5000); // Cada 5 segundos

    return () => clearInterval(interval);
  }, [isRecording, meetingId]);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Modo Reunión (Altavoz)</h2>

      {!isRecording ? (
        <div>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título de la reunión (opcional)"
            className="w-full p-3 border rounded mb-4"
          />
          <button
            onClick={() => startRecording(title)}
            className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700"
          >
            🎙️ Iniciar Reunión
          </button>
          <p className="text-sm text-gray-500 mt-2">
            ⚠️ iOS: Mantén la app en primer plano durante la grabación
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-center mb-4">
            <div className="w-4 h-4 bg-red-600 rounded-full animate-pulse mr-3"></div>
            <span className="text-lg font-semibold">Grabando...</span>
          </div>

          {status && (
            <div className="mb-4 p-4 bg-gray-50 rounded">
              <h3 className="font-semibold mb-2">Transcript en vivo:</h3>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {status.transcript || 'Esperando audio...'}
              </p>
              
              {status.detected_agreements.length > 0 && (
                <div className="mt-3">
                  <h4 className="font-semibold text-sm">Acuerdos detectados:</h4>
                  <ul className="list-disc list-inside text-sm text-gray-600">
                    {status.detected_agreements.map((agreement, i) => (
                      <li key={i}>{agreement}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <button
            onClick={stopRecording}
            className="w-full bg-gray-800 text-white py-3 rounded-lg font-semibold hover:bg-gray-900"
          >
            ⏹️ Detener y Generar Minuta
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## Endpoints Backend (Referencia)

### POST `/api/meetings/live/start`
**Request:**
```json
{
  "title": "Reunión con cliente X",
  "participants": ["Juan", "María"] // opcional
}
```

**Response:**
```json
{
  "success": true,
  "meetingId": "uuid",
  "status": "recording"
}
```

---

### POST `/api/meetings/live/:id/chunk`
**Request:** `multipart/form-data`
- Field: `chunk` (audio blob)

**Response:**
```json
{
  "success": true,
  "chunkIndex": 3,
  "sizeBytes": 45123
}
```

---

### GET `/api/meetings/live/:id/status`
**Response:**
```json
{
  "success": true,
  "meetingId": "uuid",
  "status": "recording",
  "transcript": "Hola, estamos discutiendo el proyecto...",
  "notes": ["Introducción", "Contexto del proyecto"],
  "detected_agreements": ["Acordamos entregar el viernes"],
  "chunkCount": 5
}
```

---

### POST `/api/meetings/live/:id/stop`
**Response:**
```json
{
  "success": true,
  "meetingId": "uuid",
  "status": "processing",
  "message": "Meeting finalized. Generating minutes..."
}
```

---

## Consideraciones de UX

### 1. Permisos de Micrófono
Mostrar UI clara cuando se pidan permisos:
```tsx
if (error?.name === 'NotAllowedError') {
  alert('AL-E necesita acceso al micrófono para grabar reuniones.');
}
```

### 2. Indicador Visual
Mostrar SIEMPRE que está grabando:
- Dot rojo pulsante
- Contador de tiempo
- "Grabando..." en navbar

### 3. iOS: Advertencia
```tsx
<div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
  <p className="text-sm">
    📱 <strong>iOS:</strong> Mantén AL-E en primer plano durante la grabación. 
    Si bloqueas la pantalla, la grabación se detendrá.
  </p>
</div>
```

### 4. Fallback: Upload Manual
Siempre mostrar opción alternativa:
```tsx
<div className="mt-6 text-center">
  <p className="text-sm text-gray-600 mb-2">
    ¿Grabaste con otra app?
  </p>
  <button className="text-blue-600 underline">
    📤 Subir archivo de audio
  </button>
</div>
```

---

## Testing

### En Desarrollo (localhost)
1. Abrir en Chrome: `http://localhost:3000`
2. Permitir micrófono
3. Hablar 30 segundos
4. Verificar que chunks se envían (Network tab)

### En Producción (iOS)
1. Instalar PWA desde Safari
2. Iniciar grabación
3. **NO bloquear pantalla**
4. Hablar 1 minuto
5. Detener → verificar minuta

---

## Variables de Entorno (.env.local)

```bash
NEXT_PUBLIC_API_URL=https://api.al-eon.com
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

---

## Próximos Pasos (Backend)

1. ✅ Endpoints implementados
2. ⏳ Worker Python (Whisper + pyannote)
3. ⏳ Generación de minutas con LLM
4. ⏳ Ingesta a RAG

Frontend puede empezar a implementar **YA**. El transcript llegará cuando el worker Python esté listo.

---

## Preguntas Frecuentes

**Q: ¿Cuánto dura la batería grabando?**
A: En iPhone, ~2 horas. En Android, variable.

**Q: ¿Se puede grabar con pantalla apagada?**
A: NO en iOS. SÍ en Android (si está en foreground service).

**Q: ¿Qué pasa si se cae la conexión?**
A: Los chunks en cola se reintentarán. Worst case: falta 1 chunk de 15s.

**Q: ¿Formatos soportados?**
A: webm (Chrome), mp4 (Safari), wav, m4a, aac. Backend normaliza todo a wav 16k mono.

---

**Implementa esto y tendrás modo altavoz real. 🎙️**
