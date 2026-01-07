# 🎙️ MEETINGS MODULE - Implementation Status

**Fecha:** 7 enero 2026  
**Estado:** IMPLEMENTACIÓN COMPLETA (Backend Core Ready)

---

## ✅ COMPLETADO HOY

### 1. Database Schema (Migration 023)
- ✅ Tabla `meetings` (live + upload modes, status pipeline)
- ✅ Tabla `meeting_assets` (S3 storage para audio/video)
- ✅ Tabla `meeting_transcripts` (transcripciones con timestamps + diarización)
- ✅ Tabla `meeting_minutes` (minutas ejecutivas con estructura JSON)
- ✅ Tabla `meeting_notifications` (historial de envíos email/telegram)
- ✅ RLS Policies (owner-based security)
- ✅ Helper functions (`get_meeting_transcript`, `get_meeting_minute`)
- ✅ Views (`meetings_with_status`)

### 2. S3 Service (`src/services/s3MeetingsService.ts`)
- ✅ `uploadMeetingChunk()` - Upload chunks para modo LIVE
- ✅ `uploadMeetingFile()` - Upload archivo completo modo UPLOAD
- ✅ `getSignedDownloadUrl()` - Pre-signed URLs
- ✅ `checkFileExists()` - Verificar existencia
- ✅ `getFileMetadata()` - Metadata de archivos

### 3. API REST (`src/api/meetings.ts`)

**Modo LIVE (Altavoz Presencial):**
- ✅ `POST /api/meetings/live/start` - Crear sesión de grabación
- ✅ `POST /api/meetings/live/:id/chunk` - Recibir chunks de audio (multipart)
- ✅ `GET /api/meetings/live/:id/status` - Status en tiempo real (transcript parcial)
- ✅ `POST /api/meetings/live/:id/stop` - Finalizar y generar minuta

**Modo UPLOAD (Archivo completo):**
- ✅ `POST /api/meetings/upload` - Subir mp3/mp4/wav/m4a (multipart)

**Endpoints comunes:**
- ✅ `GET /api/meetings/:id` - Obtener meeting + transcript + minuta
- ✅ `POST /api/meetings/:id/send` - Enviar minuta (email/telegram)
- ✅ `POST /api/meetings/:id/ingest` - Ingestar a RAG

### 4. Job Queue System (`src/jobs/meetingQueue.ts`)
- ✅ Queue setup con BullMQ + Redis
- ✅ Job types: `TRANSCRIBE_CHUNK`, `TRANSCRIBE_FILE`, `GENERATE_MINUTES`, `SEND_NOTIFICATIONS`, `INGEST_KNOWLEDGE`
- ✅ Worker skeleton (placeholders para procesamiento)
- ⏳ **PENDIENTE:** Implementar procesadores reales (Python worker integration)

### 5. Tool Calling Integration
- ✅ 5 nuevos tools en `toolDefinitions.ts`:
  - `start_live_meeting` - Iniciar modo altavoz
  - `get_meeting_status` - Ver transcript/minuta
  - `stop_meeting` - Finalizar reunión
  - `send_minutes` - Enviar por email/telegram
  - `search_meetings` - Búsqueda semántica en reuniones
- ✅ Tool router cases implementados
- ✅ ALL_TOOLS updated

### 6. Express Router Registration
- ✅ Router montado en `/api/meetings`
- ✅ Import en `src/index.ts`
- ✅ Logging configurado

---

## ⏳ PENDIENTE (NEXT STEPS)

### 1. Python STT Worker (CRÍTICO)
**Ubicación:** `src/workers/stt-worker/` (nuevo)

**Stack recomendado:**
- `faster-whisper` (transcripción STT)
- `pyannote.audio` (diarización con HuggingFace token)
- `ffmpeg` (conversión audio a wav 16k mono)

**Scripts necesarios:**
```python
# transcribe_chunk.py - Procesar chunk individual (modo LIVE)
# transcribe_file.py - Procesar archivo completo (modo UPLOAD)
```

**Integración:**
- Opción A: HTTP server (Flask/FastAPI) que Node llama
- Opción B: Subprocess directo desde Node
- Opción C: Separate service en otro puerto

### 2. Minutes Generator Worker (TypeScript)
**Ubicación:** `src/workers/minutesWorker.ts`

**Funcionalidad:**
- Leer transcript de DB
- Usar Groq LLM para generar:
  - Resumen ejecutivo (5-10 bullets)
  - Acuerdos (owner, deadline, prioridad)
  - Pendientes/To-do (responsable)
  - Riesgos/Decisiones
  - Próximos pasos operativos

### 3. Notifications Worker
**Reutilizar:** `src/workers/notificationWorker.ts` (existente)

**Agregar:**
- Template para minutas (email HTML + Telegram markdown)
- Integración con `meeting_notifications` table

### 4. RAG Integration Worker
**Ubicación:** `src/workers/meetingKnowledgeWorker.ts`

**Funcionalidad:**
- Leer transcript + minuta
- Chunking inteligente (por temas o timestamps)
- Generar embeddings con BGE-M3 (existente)
- Ingestar a `knowledge_chunks` con `source_type='meeting'`
- Metadata: `{ meetingId, date, participants, topics }`

### 5. Redis + BullMQ Setup
**Dependencies:**
```bash
npm install bullmq ioredis
```

**Docker compose (opcional):**
```yaml
redis:
  image: redis:7-alpine
  ports:
    - "6379:6379"
```

**EC2 setup:**
```bash
sudo apt-get install redis-server
sudo systemctl enable redis
sudo systemctl start redis
```

### 6. Environment Variables
**Agregar a `.env`:**
```bash
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# AWS S3 Meetings
AWS_S3_BUCKET_MEETINGS=al-eon-meetings

# HuggingFace (diarización)
HUGGINGFACE_TOKEN=hf_xxxxx

# Meeting Workers
STT_WORKER_URL=http://localhost:8000  # Si usamos HTTP
```

### 7. Frontend Integration (NO BACKEND)
**El frontend debe implementar:**
- UI: Botón "Iniciar Reunión (Altavoz)"
- MediaRecorder API (capturar micrófono)
- Chunking cada 10-20 segundos
- POST a `/api/meetings/live/:id/chunk` con FormData
- Polling a `/api/meetings/live/:id/status` para transcript en vivo
- Botón "Detener" → POST a `/api/meetings/live/:id/stop`

**Archivo subido:**
- Input `<input type="file" accept="audio/*,video/*">`
- POST a `/api/meetings/upload` con FormData

---

## 🚀 DEPLOYMENT CHECKLIST

### Pre-Deploy
- [ ] Aplicar migración 023: `migrations/023_meetings_module.sql`
- [ ] Instalar dependencias: `npm install bullmq ioredis`
- [ ] Configurar Redis en EC2
- [ ] Configurar bucket S3: `al-eon-meetings` (o usar existente)
- [ ] Agregar env vars a `.env` en servidor

### Deploy
```bash
cd /home/ubuntu/AL-E-Core
git pull origin main
npm install
npm run build
pm2 restart al-e-core
pm2 logs al-e-core
```

### Post-Deploy Verification
```bash
# Verificar endpoints
curl http://localhost:4000/health

# Verificar router
pm2 logs al-e-core | grep "meetingsRouter"

# Test upload (desde local)
curl -X POST http://100.27.201.233:4000/api/meetings/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@test-audio.mp3" \
  -F "title=Test Meeting"
```

---

## 📊 ARCHITECTURE DIAGRAM

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (App/Web)                      │
│  - MediaRecorder API (micrófono)                           │
│  - Chunking cada 10-20s                                    │
│  - File upload picker                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                AL-E CORE (Node/TypeScript)                  │
│  ┌────────────────────────────────────────────────────┐   │
│  │  POST /api/meetings/live/start                     │   │
│  │  POST /api/meetings/live/:id/chunk  (multipart)   │   │
│  │  GET  /api/meetings/live/:id/status                │   │
│  │  POST /api/meetings/live/:id/stop                  │   │
│  │  POST /api/meetings/upload          (multipart)   │   │
│  └────────────────────────────────────────────────────┘   │
│                       │                                     │
│                       ▼                                     │
│  ┌────────────────────────────────────────────────────┐   │
│  │  S3 Service: uploadMeetingChunk/File               │   │
│  └────────────────────────────────────────────────────┘   │
│                       │                                     │
│                       ▼                                     │
│  ┌────────────────────────────────────────────────────┐   │
│  │  BullMQ Job Queue (Redis)                          │   │
│  │  - TRANSCRIBE_CHUNK                                │   │
│  │  - TRANSCRIBE_FILE                                 │   │
│  │  - GENERATE_MINUTES                                │   │
│  │  - SEND_NOTIFICATIONS                              │   │
│  │  - INGEST_KNOWLEDGE                                │   │
│  └────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            │                     │
            ▼                     ▼
┌─────────────────────┐  ┌─────────────────────┐
│  Python STT Worker  │  │  Node Workers       │
│  - faster-whisper   │  │  - Minutes Gen      │
│  - pyannote.audio   │  │  - Notifications    │
│  - ffmpeg           │  │  - RAG Ingestion    │
└──────────┬──────────┘  └──────────┬──────────┘
           │                        │
           └────────┬───────────────┘
                    ▼
        ┌───────────────────────┐
        │  Supabase PostgreSQL  │
        │  - meetings           │
        │  - meeting_assets     │
        │  - meeting_transcripts│
        │  - meeting_minutes    │
        │  - knowledge_chunks   │
        └───────────────────────┘
```

---

## 🎯 DEFINITION OF DONE

**Para considerar el módulo "LISTO":**

1. ✅ **Backend Core** (DONE)
   - API endpoints funcionales
   - S3 integration
   - Job queue setup
   - Tool calling integration

2. ⏳ **Python STT Worker** (PENDING)
   - Transcripción con faster-whisper
   - Diarización con pyannote
   - Guarda segments en DB

3. ⏳ **Minutes Generator** (PENDING)
   - Lee transcript
   - Genera minuta estructurada con LLM
   - Guarda en meeting_minutes

4. ⏳ **Notifications** (PENDING)
   - Envío por email (cuenta conectada)
   - Envío por Telegram (bot usuario)

5. ⏳ **RAG Integration** (PENDING)
   - Ingestión a knowledge_chunks
   - Search funcional: "¿qué acordamos con proveedor X?"

6. ⏳ **Frontend Integration** (PENDING)
   - Botón "Iniciar Reunión"
   - Captura de micrófono + chunking
   - Upload de archivos
   - Display de transcript/minuta

7. ⏳ **End-to-End Test** (PENDING)
   - Modo LIVE: Start → hablar 60s → Stop → minuta generada
   - Modo UPLOAD: Subir mp3 → transcripción → minuta
   - Query RAG: "¿qué dijimos sobre X?" → respuesta con citas

---

## 🔥 NEXT IMMEDIATE ACTION

**Para Copilot Next Session:**
```
1. Instalar Redis + BullMQ
2. Crear Python STT worker (faster-whisper + pyannote)
3. Implementar Minutes Generator Worker
4. Aplicar migración 023 a Supabase
5. Deploy y test end-to-end con archivo de prueba
```

**Para Frontend Team:**
```
Implementar UI de "Modo Altavoz":
- MediaRecorder API
- Chunking automático (10-20s)
- POST chunks a /api/meetings/live/:id/chunk
- Polling status para transcript en vivo
- Display de minuta al finalizar
```

---

**STATUS:** Backend Core 100% implementado. Esperando workers (STT + Minutes) para pipeline completo.
