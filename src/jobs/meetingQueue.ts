/**
 * Job Queue para Meetings
 * Usa BullMQ con Redis para procesamiento async
 * 
 * Jobs:
 * - TRANSCRIBE_CHUNK: Transcribir chunk individual (modo live)
 * - TRANSCRIBE_FILE: Transcribir archivo completo (modo upload)
 * - GENERATE_MINUTES: Generar minuta ejecutiva
 * - SEND_NOTIFICATIONS: Enviar por email/telegram
 * - INGEST_KNOWLEDGE: Ingestar a RAG
 */

import { Queue, Worker, Job } from 'bullmq';

// Configuración de conexión Redis (BullMQ maneja la conexión internamente)
const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

// Crear queue
const meetingQueue = new Queue('meetings', { connection: redisConnection });

export type JobType =
  | 'TRANSCRIBE_CHUNK'
  | 'TRANSCRIBE_FILE'
  | 'GENERATE_MINUTES'
  | 'SEND_NOTIFICATIONS'
  | 'INGEST_KNOWLEDGE';

export interface JobData {
  [key: string]: any;
}

/**
 * Encolar job
 */
export async function enqueueJob(type: JobType, data: JobData) {
  await meetingQueue.add(type, data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });

  console.log(`[QUEUE] ✅ Job ${type} enqueued:`, data);
}

/**
 * Worker que procesa jobs
 * NOTA: Este worker debe ejecutarse en un proceso separado (worker.ts)
 */
export function startMeetingWorker() {
  const worker = new Worker(
    'meetings',
    async (job: Job) => {
      console.log(`[WORKER] 🔨 Processing job ${job.name} (${job.id})`);

      switch (job.name as JobType) {
        case 'TRANSCRIBE_CHUNK':
          await processTranscribeChunk(job.data);
          break;

        case 'TRANSCRIBE_FILE':
          await processTranscribeFile(job.data);
          break;

        case 'GENERATE_MINUTES':
          await processGenerateMinutes(job.data);
          break;

        case 'SEND_NOTIFICATIONS':
          await processSendNotifications(job.data);
          break;

        case 'INGEST_KNOWLEDGE':
          await processIngestKnowledge(job.data);
          break;

        default:
          console.error(`[WORKER] Unknown job type: ${job.name}`);
      }

      console.log(`[WORKER] ✅ Job ${job.name} completed`);
    },
    { connection: redisConnection }
  );

  worker.on('completed', (job) => {
    console.log(`[WORKER] 🎉 Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[WORKER] ❌ Job ${job?.id} failed:`, err);
  });

  console.log('[WORKER] 🚀 Meeting worker started');
}

// ==========================================
// JOB PROCESSORS (Placeholder)
// ==========================================

/**
 * Procesar transcripción de chunk (modo live)
 * TODO: Llamar a Python worker
 */
async function processTranscribeChunk(data: JobData) {
  console.log('[WORKER] 🎤 TRANSCRIBE_CHUNK:', data);
  // TODO: Llamar a Python worker via HTTP o subprocess
  // await fetch('http://localhost:8000/transcribe-chunk', { ... })
}

/**
 * Procesar transcripción de archivo completo
 * TODO: Llamar a Python worker
 */
async function processTranscribeFile(data: JobData) {
  console.log('[WORKER] 🎤 TRANSCRIBE_FILE:', data);
  // TODO: Llamar a Python worker via HTTP o subprocess
  // await fetch('http://localhost:8000/transcribe-file', { ... })
}

/**
 * Generar minuta ejecutiva con LLM
 */
async function processGenerateMinutes(data: JobData) {
  console.log('[WORKER] 📝 GENERATE_MINUTES:', data);
  
  const { meetingId, userId } = data;
  
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    );

    // 1. Obtener todos los transcripts parciales (chunks)
    const { data: transcripts } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });

    // 2. Consolidar texto completo
    const fullText = transcripts?.map(t => t.text).join('\n\n') || '';

    // 3. Si no hay transcripts, generar uno MOCK
    if (!fullText || fullText.length < 10) {
      console.log('[WORKER] ⚠️  No transcripts found, generating MOCK data...');
      
      // Insertar transcript MOCK
      const mockTranscript = {
        meeting_id: meetingId,
        language: 'es',
        raw_json: [
          { start: 0, end: 30, text: 'Bienvenidos a la reunión. Hoy vamos a revisar el progreso del proyecto.', speaker: 'Speaker 1' },
          { start: 31, end: 60, text: 'Perfecto, empecemos con el módulo de reuniones.', speaker: 'Speaker 2' },
          { start: 61, end: 90, text: 'Acordamos que el backend debe estar listo para el viernes.', speaker: 'Speaker 1' },
        ],
        text: 'Bienvenidos a la reunión. Hoy vamos a revisar el progreso del proyecto.\n\nPerfecto, empecemos con el módulo de reuniones.\n\nAcordamos que el backend debe estar listo para el viernes.',
        is_final: true,
        processing_time_sec: 2.5,
      };

      await supabase
        .from('meeting_transcripts')
        .insert(mockTranscript);
    }

    // 4. Generar minuta (MOCK por ahora, luego con LLM real)
    const mockMinutes = {
      meeting_id: meetingId,
      summary: `## Resumen Ejecutivo

- Se revisó el progreso del módulo de reuniones
- El backend está funcionando correctamente
- Frontend está listo para consumir transcripts y minutas
- Se acordaron próximos pasos para completar la integración

## Detalles

Esta reunión cubrió los avances del sistema de reuniones con grabación, transcripción automática y generación de minutas.`,
      
      agreements_json: [
        {
          text: 'Backend debe estar completamente listo para el viernes',
          owner: 'Equipo Backend',
          deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          priority: 'high'
        },
        {
          text: 'Frontend integrará el polling de status para mostrar transcripts en tiempo real',
          owner: 'Equipo Frontend',
          deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          priority: 'medium'
        }
      ],
      
      tasks_json: [
        {
          text: 'Implementar Python worker para STT con faster-whisper',
          responsible: 'Backend',
          priority: 'high',
          status: 'pending'
        },
        {
          text: 'Configurar S3 bucket para meetings en producción',
          responsible: 'DevOps',
          priority: 'high',
          status: 'pending'
        }
      ],
      
      decisions_json: [
        {
          text: 'Usar faster-whisper + pyannote para transcripción y diarización',
          impact: 'high',
          rationale: 'Mayor precisión y velocidad que alternativas'
        }
      ],
      
      risks_json: [
        {
          text: 'La transcripción en tiempo real puede tener latencia en audio de baja calidad',
          severity: 'medium',
          mitigation: 'Implementar fallback a transcripción post-procesada'
        }
      ],
      
      next_steps_json: [
        {
          text: 'Deploy de migración 023 a Supabase',
          owner: 'Backend',
          timeline: 'Hoy'
        },
        {
          text: 'Testing end-to-end del flujo completo',
          owner: 'QA',
          timeline: 'Esta semana'
        }
      ],
      
      generated_by: 'mock',
      processing_time_sec: 1.0,
    };

    await supabase
      .from('meeting_minutes')
      .insert(mockMinutes);

    // 5. Actualizar status del meeting
    await supabase
      .from('meetings')
      .update({ status: 'done' })
      .eq('id', meetingId);

    console.log(`[WORKER] ✅ Minutes generated for meeting ${meetingId} (MOCK)`);
  } catch (error) {
    console.error('[WORKER] ❌ Error generating minutes:', error);
    throw error;
  }
}

/**
 * Enviar notificaciones
 */
async function processSendNotifications(data: JobData) {
  console.log('[WORKER] 📨 SEND_NOTIFICATIONS:', data);
  // Usar servicios existentes de email/telegram
}

/**
 * Ingestar a RAG
 */
async function processIngestKnowledge(data: JobData) {
  console.log('[WORKER] 🧠 INGEST_KNOWLEDGE:', data);
  // Usar servicio existente de embeddings
}

export default {
  enqueueJob,
  startMeetingWorker,
};
