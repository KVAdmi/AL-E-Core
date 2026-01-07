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
  // Implementación en próximo step
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
