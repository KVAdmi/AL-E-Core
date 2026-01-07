# 📱 Frontend: Especificación Meetings Module - AL-E Core

**Para:** Equipo Frontend  
**De:** Backend Team (AL-E Core)  
**Fecha:** 7 enero 2026  
**Prioridad:** ALTA

---

## 🎯 Objetivo

Implementar **Modo Reunión (Altavoz)** que capture audio presencial desde el micrófono del móvil/laptop, lo procese en chunks, y genere minutas automáticas.

---

## ⚠️ IMPORTANTE: Tablas en Supabase

La tabla `meetings` ya existe pero **necesita actualizarse** con los siguientes campos que el backend requiere:

### Campos OBLIGATORIOS que deben existir:

```sql
-- EJECUTAR ESTE ALTER en Supabase SQL Editor:

ALTER TABLE meetings 
ADD COLUMN IF NOT EXISTS mode VARCHAR(20) CHECK (mode IN ('live', 'upload')),
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'recording',
ADD COLUMN IF NOT EXISTS error_message TEXT,
ADD COLUMN IF NOT EXISTS participants JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS auto_send_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS send_email BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS send_telegram BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS duration_sec INTEGER,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;

-- Crear índices si no existen
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_updated_at ON meetings(updated_at DESC);
```

### Otras tablas necesarias:

Si **NO existen**, ejecutar el archivo completo: `migrations/023_meetings_module.sql`

Tablas requeridas:
- ✅ `meetings` (actualizar campos arriba)
- ❓ `meeting_assets` (para chunks de audio en S3)
- ❓ `meeting_transcripts` (transcripciones con timestamps)
- ❓ `meeting_minutes` (minutas generadas)
- ❓ `meeting_notifications` (envíos email/telegram)

---

## 🌐 API Endpoints del Backend

### Base URL Producción:
```
https://api.al-eon.com
```

### Base URL Local (testing):
```
http://localhost:4000
```

---

## 📡 Flujo Completo (Modo Altavoz)

### 1. Iniciar Reunión

**Endpoint:** `POST /api/meetings/live/start`

**Headers:**
```
Authorization: Bearer {supabase_jwt_token}
Content-Type: application/json
```

**Body:**
```json
{
  "title": "Reunión con cliente X",
  "description": "Discusión de propuesta Q1 2026",
  "participants": ["Juan Pérez", "María López"],  // OPCIONAL
  "auto_send_enabled": false,  // OPCIONAL
  "send_email": false,         // OPCIONAL
  "send_telegram": false       // OPCIONAL
}
```

**Response 200:**
```json
{
  "success": true,
  "meetingId": "uuid-generado-por-backend",
  "status": "recording",
  "message": "Meeting session started. Start sending audio chunks."
}
```

**Errores:**
- `401` - Token inválido o expirado
- `500` - Error en servidor

---

### 2. Enviar Chunks de Audio (cada 10-20 segundos)

**Endpoint:** `POST /api/meetings/live/:meetingId/chunk`

**Headers:**
```
Authorization: Bearer {supabase_jwt_token}
Content-Type: multipart/form-data
```

**Body (FormData):**
```javascript
const formData = new FormData();
formData.append('chunk', audioBlob, 'chunk.webm');  // ⚠️ Campo DEBE llamarse "chunk"
```

**Formatos soportados:**
- ✅ `audio/webm` (Chrome/Android)
- ✅ `audio/mp4` (Safari/iOS)
- ✅ `audio/aac` (iOS alternativo)
- ✅ `audio/wav`
- ✅ `audio/m4a`

**Response 200:**
```json
{
  "success": true,
  "chunkIndex": 3,
  "assetId": "uuid-del-chunk",
  "sizeBytes": 45123
}
```

**Errores:**
- `400` - No audio file provided
- `401` - Unauthorized
- `404` - Meeting not found
- `500` - Error guardando chunk

---

### 3. Obtener Status en Vivo (Polling cada 5 segundos)

**Endpoint:** `GET /api/meetings/live/:meetingId/status`

**Headers:**
```
Authorization: Bearer {supabase_jwt_token}
```

**Response 200:**
```json
{
  "success": true,
  "meetingId": "uuid",
  "status": "recording",  // 'recording' | 'processing' | 'done'
  "transcript": "Hola, estamos discutiendo el proyecto X...",  // Transcript parcial
  "notes": [
    "Hola, estamos discutiendo el proyecto X",
    "Necesitamos aprobar el presupuesto"
  ],
  "detected_agreements": [
    "Acordamos entregar el viernes",
    "Hay que revisar el documento antes del lunes"
  ],
  "chunkCount": 8
}
```

**Notas:**
- `transcript`: Se va construyendo conforme llegan transcripciones
- `detected_agreements`: Keywords detectados automáticamente (básico)
- Hacer polling **SOLO mientras `status === 'recording'`**

---

### 4. Detener Reunión

**Endpoint:** `POST /api/meetings/live/:meetingId/stop`

**Headers:**
```
Authorization: Bearer {supabase_jwt_token}
```

**Response 200:**
```json
{
  "success": true,
  "meetingId": "uuid",
  "status": "processing",
  "message": "Meeting finalized. Generating minutes..."
}
```

**Siguiente paso:**
Después de `stop`, el backend genera la minuta (puede tomar 10-30 segundos).

Frontend debe:
1. Dejar de enviar chunks
2. Dejar de hacer polling a `/status`
3. Esperar y luego consultar minuta con: `GET /api/meetings/:meetingId`

---

### 5. Obtener Reunión Completa (Transcript + Minuta)

**Endpoint:** `GET /api/meetings/:meetingId`

**Headers:**
```
Authorization: Bearer {supabase_jwt_token}
```

**Response 200:**
```json
{
  "success": true,
  "meeting": {
    "id": "uuid",
    "owner_user_id": "uuid",
    "title": "Reunión con cliente X",
    "mode": "live",
    "status": "done",  // 'recording' | 'processing' | 'done' | 'error'
    "happened_at": "2026-01-07T14:30:00Z",
    "duration_sec": 180,
    "participants": ["Juan", "María"],
    "created_at": "...",
    "finalized_at": "..."
  },
  "transcript": {
    "id": "uuid",
    "text": "Transcript completo de la reunión...",
    "language": "es",
    "raw_json": [
      {
        "start": 0.0,
        "end": 5.2,
        "text": "Hola, buenos días",
        "speaker": "Speaker 1"
      },
      {
        "start": 5.5,
        "end": 12.3,
        "text": "Necesitamos discutir el proyecto",
        "speaker": "Speaker 2"
      }
    ]
  },
  "minutes": {
    "id": "uuid",
    "summary": "Reunión para discutir avances del proyecto X. Se acordó entregar prototipo el viernes. Pendiente revisión de presupuesto con finanzas.",
    "agreements_json": [
      {
        "text": "Entregar prototipo el viernes 10 de enero",
        "owner": "Juan Pérez",
        "deadline": "2026-01-10",
        "priority": "high"
      }
    ],
    "tasks_json": [
      {
        "text": "Revisar presupuesto con finanzas",
        "responsible": "María López",
        "priority": "medium",
        "status": "pending"
      }
    ],
    "decisions_json": [
      {
        "text": "Usar framework React Native para mobile",
        "impact": "high",
        "rationale": "Mejor performance y soporte"
      }
    ],
    "risks_json": [
      {
        "text": "Falta aprobación de presupuesto",
        "severity": "medium",
        "mitigation": "Escalación a gerencia"
      }
    ],
    "next_steps_json": [
      {
        "text": "Agendar follow-up para próxima semana",
        "owner": "Juan",
        "timeline": "Viernes"
      }
    ]
  }
}
```

**Notas:**
- `transcript` será `null` hasta que el STT worker procese
- `minutes` será `null` hasta que se genere la minuta

---

## 🔴 REALIDAD iOS/Safari (CRÍTICO)

### ❌ Limitaciones de iOS Safari/PWA:

1. **Bloqueo de pantalla → grabación SE DETIENE**
2. **Cambio de app → grabación SE DETIENE**
3. **Llamada entrante → grabación SE DETIENE**

### ✅ Solución Backend Implementada:

**Auto-finalize por timeout:** Si el backend no recibe chunks por **2 minutos**, automáticamente:
- Cambia status a `processing`
- Genera minuta con lo que tenga
- Encola jobs de transcripción

### 📱 UX Recomendada:

**Mostrar SIEMPRE en UI:**
```
⚠️ iOS: Mantén AL-E en primer plano durante la grabación.
Si bloqueas la pantalla, la grabación se detendrá.
```

**Botón alternativo obligatorio:**
```
📤 ¿Grabaste con otra app? Subir archivo
```

---

## 📤 Modo Upload (Alternativo)

Si el usuario ya tiene un archivo grabado externamente:

**Endpoint:** `POST /api/meetings/upload`

**Headers:**
```
Authorization: Bearer {supabase_jwt_token}
Content-Type: multipart/form-data
```

**Body (FormData):**
```javascript
const formData = new FormData();
formData.append('file', audioFile, 'reunion.mp3');  // ⚠️ Campo DEBE llamarse "file"
formData.append('title', 'Reunión con cliente Y');
formData.append('participants', JSON.stringify(['Ana', 'Carlos']));  // OPCIONAL
```

**Formatos soportados:**
- ✅ `.mp3`
- ✅ `.mp4`
- ✅ `.wav`
- ✅ `.m4a`
- ✅ `.webm`

**Response 200:**
```json
{
  "success": true,
  "meetingId": "uuid",
  "status": "processing",
  "message": "File uploaded successfully. Transcription in progress..."
}
```

---

## 🎨 Componente React de Ejemplo

```typescript
import { useState, useRef, useEffect } from 'react';

interface MeetingRecorderProps {
  onComplete?: (meetingId: string) => void;
}

export function MeetingRecorder({ onComplete }: MeetingRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [agreements, setAgreements] = useState<string[]>([]);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksCountRef = useRef(0);

  // 1. Iniciar grabación
  const handleStart = async () => {
    try {
      // Pedir micrófono
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });

      // Crear meeting en backend
      const response = await fetch('https://api.al-eon.com/api/meetings/live/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getSupabaseToken()}`,  // Tu función
        },
        body: JSON.stringify({
          title: 'Nueva reunión',
        }),
      });

      const { meetingId: newMeetingId } = await response.json();
      setMeetingId(newMeetingId);

      // Configurar MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      // Enviar chunks automáticamente
      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          chunksCountRef.current++;
          await uploadChunk(newMeetingId, event.data);
        }
      };

      // Empezar a grabar con chunks cada 15 segundos
      recorder.start(15000);  // ⚠️ timeslice de 15000ms
      setIsRecording(true);

    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error al acceder al micrófono');
    }
  };

  // 2. Detener grabación
  const handleStop = async () => {
    if (!mediaRecorderRef.current || !meetingId) return;

    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    setIsRecording(false);

    // Notificar backend que finalizó
    await fetch(`https://api.al-eon.com/api/meetings/live/${meetingId}/stop`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getSupabaseToken()}`,
      },
    });

    // Callback para que parent maneje la navegación
    onComplete?.(meetingId);
  };

  // 3. Upload de chunk
  const uploadChunk = async (meetingId: string, blob: Blob) => {
    const formData = new FormData();
    formData.append('chunk', blob, `chunk-${chunksCountRef.current}.webm`);  // ⚠️ "chunk" no "audio"

    await fetch(`https://api.al-eon.com/api/meetings/live/${meetingId}/chunk`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getSupabaseToken()}`,
      },
      body: formData,
    });
  };

  // 4. Polling de status (solo mientras graba)
  useEffect(() => {
    if (!isRecording || !meetingId) return;

    const interval = setInterval(async () => {
      const response = await fetch(
        `https://api.al-eon.com/api/meetings/live/${meetingId}/status`,
        {
          headers: {
            'Authorization': `Bearer ${getSupabaseToken()}`,
          },
        }
      );
      const data = await response.json();
      
      setTranscript(data.transcript || '');
      setAgreements(data.detected_agreements || []);
    }, 5000); // Cada 5 segundos

    return () => clearInterval(interval);
  }, [isRecording, meetingId]);

  return (
    <div className="p-6">
      {!isRecording ? (
        <button
          onClick={handleStart}
          className="w-full bg-red-600 text-white py-4 rounded-lg font-bold"
        >
          🎙️ Iniciar Reunión
        </button>
      ) : (
        <div>
          <div className="flex items-center justify-center mb-4">
            <div className="w-4 h-4 bg-red-600 rounded-full animate-pulse mr-3"></div>
            <span className="text-lg font-bold">Grabando... ({chunksCountRef.current} chunks)</span>
          </div>

          {transcript && (
            <div className="mb-4 p-4 bg-gray-50 rounded">
              <h3 className="font-bold mb-2">Transcript en vivo:</h3>
              <p className="text-sm whitespace-pre-wrap">{transcript}</p>
            </div>
          )}

          {agreements.length > 0 && (
            <div className="mb-4 p-4 bg-blue-50 rounded">
              <h3 className="font-bold mb-2">Acuerdos detectados:</h3>
              <ul className="list-disc list-inside text-sm">
                {agreements.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleStop}
            className="w-full bg-gray-800 text-white py-4 rounded-lg font-bold"
          >
            ⏹️ Detener y Generar Minuta
          </button>
        </div>
      )}

      <div className="mt-4 p-3 bg-yellow-50 border-l-4 border-yellow-400">
        <p className="text-sm">
          📱 <strong>iOS:</strong> Mantén AL-E en primer plano. 
          Si bloqueas la pantalla, la grabación se detendrá.
        </p>
      </div>
    </div>
  );
}

// Helper para obtener token de Supabase
function getSupabaseToken(): string {
  // Implementar según tu auth flow
  return localStorage.getItem('supabase.auth.token') || '';
}
```

---

## ✅ Checklist de Implementación

### Backend Setup (YA HECHO):
- ✅ Endpoints `/start`, `/chunk`, `/status`, `/stop` funcionando
- ✅ S3 service para almacenar chunks
- ✅ Job queue (BullMQ) para procesamiento async
- ✅ Meeting timeout worker (auto-finalize >2min)
- ✅ Tool calling para LLM

### Frontend (POR HACER):
- [ ] Pedir permisos de micrófono
- [ ] Implementar MediaRecorder con chunks cada 15s
- [ ] POST chunks a `/api/meetings/live/:id/chunk` con field **"chunk"** (no "audio")
- [ ] Polling a `/status` cada 5s mientras graba
- [ ] Mostrar transcript + agreements en vivo
- [ ] Botón detener → POST `/stop`
- [ ] Mostrar advertencia iOS
- [ ] Implementar fallback "Subir archivo" con `/upload`

### Supabase (CRÍTICO):
- [ ] Actualizar tabla `meetings` con campos del ALTER arriba
- [ ] Verificar que existen tablas: `meeting_assets`, `meeting_transcripts`, `meeting_minutes`

---

## 🐛 Troubleshooting

### Error: "No audio file provided"
→ Verificar que el campo FormData se llame **"chunk"** (no "audio"):
```javascript
formData.append('chunk', blob, 'chunk.webm');  // ✅ Correcto
formData.append('audio', blob, 'chunk.webm');  // ❌ Incorrecto
```

### Error: "Meeting not found"
→ Verificar que el `meetingId` devuelto por `/start` se está usando correctamente

### Error: 401 Unauthorized
→ Token de Supabase expirado o inválido. Renovar con:
```javascript
const { data: { session } } = await supabase.auth.getSession();
const token = session?.access_token;
```

### Chunks no se envían automáticamente
→ Verificar que `MediaRecorder.start(timeslice)` tiene el timeslice configurado:
```javascript
recorder.start(15000);  // ✅ Chunks cada 15s
recorder.start();       // ❌ Solo al detener
```

### iOS: Grabación se detiene sola
→ ESPERADO. iOS mata el MediaRecorder si:
- Usuario bloquea pantalla
- Usuario cambia de app
- Usuario recibe llamada

Solución: Mostrar advertencia + ofrecer "Subir archivo" como alternativo.

---

## 📞 Contacto

Si algo no funciona o necesitan ayuda:
- Backend logs: SSH a EC2 → `pm2 logs al-e-core`
- Verificar endpoints: `curl https://api.al-eon.com/health`
- Revisar docs: `MEETINGS-MODULE-DEPLOYED.md` en repo

---

**¡Frontend puede empezar YA! Backend está listo y esperando chunks.** 🎙️
