/**
 * API de Meetings - Modo Altavoz Presencial + Upload
 * 
 * Endpoints:
 * - POST /api/meetings/live/start - Iniciar sesión de grabación presencial
 * - POST /api/meetings/live/:id/chunk - Enviar chunk de audio
 * - GET /api/meetings/live/:id/status - Status en tiempo real (transcript parcial + notas)
 * - POST /api/meetings/live/:id/stop - Finalizar grabación
 * 
 * - POST /api/meetings/ingest - Subir archivo para transcripción (ENDPOINT UNIFICADO)
 * - GET /api/meetings/:id/status - Status del procesamiento
 * - GET /api/meetings/:id/result - Resultado final (contrato completo)
 * 
 * - POST /api/meetings/upload - Subir archivo completo (mp3/mp4/wav) [LEGACY]
 * - GET /api/meetings/:id - Obtener meeting completo
 * - GET /api/meetings/:id/transcript - Obtener transcript
 * - GET /api/meetings/:id/minutes - Obtener minuta
 * - POST /api/meetings/:id/send - Enviar minuta por email/telegram
 * - POST /api/meetings/:id/ingest - Ingestar a RAG
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { uploadMeetingChunk, uploadMeetingFile } from '../services/s3MeetingsService';
import { enqueueJob } from '../jobs/meetingQueue';
import { logger } from '../utils/logger';

const router = Router();

// Configurar multer para manejar uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
  },
});

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ==========================================
// MODO LIVE (Altavoz Presencial)
// ==========================================

/**
 * POST /api/meetings/live/start
 * Iniciar sesión de reunión presencial
 */
router.post('/live/start', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      title,
      description,
      participants = [],
      auto_send_enabled = false,
      send_email = false,
      send_telegram = false,
      happened_at,     // ← NUEVO: Timestamp del evento (opcional)
      scheduled_at,    // ← NUEVO: Timestamp programado (opcional)
    } = req.body;

    // Crear meeting en DB
    const { data: meeting, error: dbError } = await supabase
      .from('meetings')
      .insert({
        owner_user_id: user.id,
        title: title || 'Reunión sin título',
        description,
        mode: 'live',
        status: 'recording',
        happened_at: happened_at || new Date().toISOString(),  // Usar del body o generar
        scheduled_at: scheduled_at || new Date().toISOString(), // Usar del body o generar
        participants,
        auto_send_enabled,
        send_email,
        send_telegram,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[MEETINGS] Error creating meeting:', dbError);
      return res.status(500).json({ 
        error: 'Failed to create meeting',
        detail: dbError.message,
        code: dbError.code
      });
    }

    console.log(`[MEETINGS] 🎙️ Live meeting started: ${meeting.id}`);

    // LOG: meetings.live.start
    logger.meetingsLiveStart({
      meeting_id: meeting.id,
      title: meeting.title,
      user_id: user.id,
    });

    return res.json({
      success: true,
      meetingId: meeting.id,
      status: 'recording',
      message: 'Meeting session started. Start sending audio chunks.',
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /live/start:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/meetings/live/:id/chunk
 * Recibir chunk de audio (multipart/form-data)
 * SOPORTA: webm, mp4, aac, wav, m4a (PWA irregular de iOS)
 */
router.post('/live/:id/chunk', upload.single('chunk'), async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verificar que el meeting existe y pertenece al usuario
    const { data: meeting, error: meetingError } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_user_id', user.id)
      .single();

    if (meetingError || !meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    if (meeting.status !== 'recording') {
      return res.status(400).json({ error: 'Meeting is not in recording state' });
    }

    // Obtener chunk index (siguiente)
    const { count } = await supabase
      .from('meeting_assets')
      .select('*', { count: 'exact', head: true })
      .eq('meeting_id', meetingId)
      .eq('asset_type', 'chunk');

    const chunkIndex = (count || 0) + 1;

    // Upload a S3 (RAW - normalización en worker Python)
    const s3Result = await uploadMeetingChunk({
      userId: user.id,
      meetingId,
      chunkIndex,
      buffer: file.buffer,
      mimeType: file.mimetype,
    });

    // Guardar en DB
    const { data: asset, error: assetError } = await supabase
      .from('meeting_assets')
      .insert({
        meeting_id: meetingId,
        s3_key: s3Result.s3Key,
        s3_bucket: s3Result.s3Bucket,
        s3_url: s3Result.s3Url,
        filename: file.originalname || `chunk-${chunkIndex}.webm`,
        mime_type: file.mimetype,
        size_bytes: s3Result.sizeBytes,
        asset_type: 'chunk',
        chunk_index: chunkIndex,
      })
      .select()
      .single();

    if (assetError) {
      console.error('[MEETINGS] Error saving asset:', assetError);
      return res.status(500).json({ error: 'Failed to save chunk' });
    }

    // Actualizar updated_at del meeting (para timeout detection)
    await supabase
      .from('meetings')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', meetingId);

    // Encolar job de transcripción
    await enqueueJob('TRANSCRIBE_CHUNK', {
      meetingId,
      assetId: asset.id,
      chunkIndex,
      s3Key: s3Result.s3Key,
      s3Bucket: s3Result.s3Bucket,
      userId: user.id,
    });

    console.log(`[MEETINGS] 📦 Chunk ${chunkIndex} uploaded for meeting ${meetingId} (${file.mimetype})`);

    return res.json({
      success: true,
      chunkIndex,
      assetId: asset.id,
      sizeBytes: s3Result.sizeBytes,
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /live/:id/chunk:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/meetings/live/:id/status
 * Obtener status en tiempo real (transcript parcial + notas + detected_agreements)
 */
router.get('/live/:id/status', async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Obtener meeting
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_user_id', user.id)
      .single();

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Obtener transcripts parciales
    const { data: transcripts } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });

    // Consolidar texto
    const fullText = transcripts?.map(t => t.text).join('\n') || '';

    // Generar "Notas rápidas" (bullets básicos)
    const lines = fullText.split('\n').filter(l => l.trim().length > 0);
    const notes = lines.slice(0, 10); // Primeras 10 líneas como notas

    // Detectar posibles acuerdos (keywords básicos)
    const detectedAgreements: string[] = [];
    const agreementKeywords = ['acordamos', 'quedamos', 'vamos a', 'hay que', 'debemos', 'haremos', 'decidimos'];
    
    for (const line of lines) {
      const lowerLine = line.toLowerCase();
      if (agreementKeywords.some(kw => lowerLine.includes(kw))) {
        detectedAgreements.push(line.trim());
      }
    }

    return res.json({
      success: true,
      meetingId,
      status: meeting.status,
      transcript: fullText,
      notes,
      detected_agreements: detectedAgreements.slice(0, 5), // Max 5
      chunkCount: transcripts?.length || 0,
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /live/:id/status:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/meetings/live/:id/stop
 * Finalizar grabación y generar minuta
 */
router.post('/live/:id/stop', async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verificar meeting
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_user_id', user.id)
      .single();

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Actualizar status
    await supabase
      .from('meetings')
      .update({
        status: 'processing',
        finalized_at: new Date().toISOString(),
      })
      .eq('id', meetingId);

    // Encolar generación de minuta
    await enqueueJob('GENERATE_MINUTES', {
      meetingId,
      userId: user.id,
    });

    console.log(`[MEETINGS] 🛑 Meeting ${meetingId} stopped, generating minutes...`);

    return res.json({
      success: true,
      meetingId,
      status: 'processing',
      message: 'Meeting finalized. Generating minutes...',
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /live/:id/stop:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ==========================================
// MODO UPLOAD (Archivo completo)
// ==========================================

/**
 * POST /api/meetings/upload
 * Subir archivo completo (mp3, mp4, wav, m4a)
 */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      title,
      description,
      participants = [],
      auto_send_enabled = false,
      send_email = false,
      send_telegram = false,
      happened_at,     // ← NUEVO: Timestamp del evento (opcional)
      scheduled_at,    // ← NUEVO: Timestamp programado (opcional)
    } = req.body;

    // Validar y parsear participants si es string
    let parsedParticipants = participants;
    if (typeof participants === 'string') {
      try {
        parsedParticipants = JSON.parse(participants);
      } catch (jsonError) {
        console.error('[MEETINGS] Invalid JSON in participants:', participants);
        return res.status(400).json({ 
          error: 'Invalid participants format', 
          details: 'participants must be valid JSON array' 
        });
      }
    }

    // Crear meeting
    const { data: meeting, error: dbError } = await supabase
      .from('meetings')
      .insert({
        owner_user_id: user.id,
        title: title || file.originalname,
        description,
        mode: 'upload',
        status: 'processing',
        happened_at: happened_at || new Date().toISOString(),  // Usar del body o generar
        scheduled_at: scheduled_at || new Date().toISOString(), // Usar del body o generar
        participants: parsedParticipants,
        auto_send_enabled: auto_send_enabled === 'true' || auto_send_enabled === true,
        send_email: send_email === 'true' || send_email === true,
        send_telegram: send_telegram === 'true' || send_telegram === true,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[MEETINGS] Error creating meeting:', dbError);
      return res.status(500).json({ error: 'Failed to create meeting' });
    }

    // Upload a S3
    const s3Result = await uploadMeetingFile({
      userId: user.id,
      meetingId: meeting.id,
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    });

    // Guardar asset
    const { data: asset, error: assetError } = await supabase
      .from('meeting_assets')
      .insert({
        meeting_id: meeting.id,
        s3_key: s3Result.s3Key,
        s3_bucket: s3Result.s3Bucket,
        s3_url: s3Result.s3Url,
        filename: file.originalname,
        mime_type: file.mimetype,
        size_bytes: s3Result.sizeBytes,
        asset_type: 'original',
      })
      .select()
      .single();

    if (assetError) {
      console.error('[MEETINGS] Error saving asset:', assetError);
      return res.status(500).json({ error: 'Failed to save file' });
    }

    // Encolar transcripción
    await enqueueJob('TRANSCRIBE_FILE', {
      meetingId: meeting.id,
      assetId: asset.id,
      s3Key: s3Result.s3Key,
      s3Bucket: s3Result.s3Bucket,
    });

    console.log(`[MEETINGS] 📤 File uploaded for meeting ${meeting.id}`);

    return res.json({
      success: true,
      meetingId: meeting.id,
      status: 'processing',
      message: 'File uploaded successfully. Transcription in progress...',
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /upload:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ==========================================
// ENDPOINTS COMUNES
// ==========================================

/**
 * GET /api/meetings/:id
 * Obtener meeting completo con transcript y minuta
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Obtener meeting
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_user_id', user.id)
      .single();

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Obtener transcript final
    const { data: transcript } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('meeting_id', meetingId)
      .eq('is_final', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Obtener minuta
    const { data: minute } = await supabase
      .from('meeting_minutes')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return res.json({
      success: true,
      meeting,
      transcript: transcript || null,
      minutes: minute || null,
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /:id:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/meetings/:id/send
 * Enviar minuta por email/telegram
 */
router.post('/:id/send', async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;
    const { email = false, telegram = false } = req.body;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Verificar meeting
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_user_id', user.id)
      .single();

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Encolar notificaciones
    await enqueueJob('SEND_NOTIFICATIONS', {
      meetingId,
      userId: user.id,
      sendEmail: email,
      sendTelegram: telegram,
    });

    console.log(`[MEETINGS] 📨 Notifications queued for meeting ${meetingId}`);

    return res.json({
      success: true,
      message: 'Notifications queued',
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /:id/send:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/meetings/ingest (ENDPOINT UNIFICADO - CONTRATO)
 * Subir audio para transcripción + minuta
 */
router.post('/ingest', upload.single('file'), async (req: Request, res: Response) => {
  const request_id = req.headers['x-request-id'] as string || uuidv4();
  
  try {
    console.log(`[MEETINGS:ingest] 🔵 INICIO - request_id: ${request_id}`);
    console.log(`[MEETINGS:ingest] 📋 Headers:`, { authorization: req.headers.authorization ? 'presente' : 'ausente', contentType: req.headers['content-type'] });

    const file = req.file;
    if (!file) {
      console.log(`[MEETINGS:ingest] ❌ No file provided - request_id: ${request_id}`);
      return res.status(400).json({ error: 'No file provided', request_id });
    }

    console.log(`[MEETINGS:ingest] 📁 File recibido - name: ${file.originalname}, size: ${file.size} bytes, mimetype: ${file.mimetype}`);

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.log(`[MEETINGS:ingest] ❌ No authorization header - request_id: ${request_id}`);
      return res.status(401).json({ error: 'No authorization header', request_id });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log(`[MEETINGS:ingest] 🔐 Verificando auth token...`);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log(`[MEETINGS:ingest] ❌ Unauthorized - error: ${authError?.message || 'No user'}`);
      return res.status(401).json({ error: 'Unauthorized', request_id });
    }

    console.log(`[MEETINGS:ingest] ✅ Usuario autenticado - user_id: ${user.id}`);

    const { title, description, participants = [] } = req.body;
    
    // Validar y parsear participants si es string
    let parsedParticipants = participants;
    if (typeof participants === 'string') {
      try {
        parsedParticipants = JSON.parse(participants);
      } catch (jsonError) {
        console.error(`[MEETINGS:ingest] ❌ Invalid JSON in participants: ${participants.substring(0, 100)}`, { request_id });
        return res.status(400).json({ 
          error: 'Invalid participants format', 
          details: 'participants must be valid JSON array',
          request_id 
        });
      }
    }
    
    console.log(`[MEETINGS:ingest] 📝 Metadata - title: "${title || file.originalname}", participants: ${Array.isArray(parsedParticipants) ? parsedParticipants.length : 0}`);

    // 1. Crear meeting
    console.log(`[MEETINGS:ingest] 💾 Creando registro de meeting...`);
    const { data: meeting, error: dbError } = await supabase
      .from('meetings')
      .insert({
        owner_user_id: user.id,
        title: title || file.originalname,
        description,
        mode: 'upload',
        status: 'processing',
        happened_at: new Date().toISOString(),
        participants: parsedParticipants,
      })
      .select()
      .single();

    if (dbError) {
      console.error(`[MEETINGS:ingest] ❌ Error creating meeting: ${dbError.message}`, dbError);
      return res.status(500).json({ error: 'Failed to create meeting', request_id });
    }

    console.log(`[MEETINGS:ingest] ✅ Meeting created - meeting_id: ${meeting.id}, status: ${meeting.status}`);

    // 2. Upload a S3
    console.log(`[MEETINGS:ingest] ☁️ Subiendo archivo a S3...`);
    const s3Result = await uploadMeetingFile({
      userId: user.id,
      meetingId: meeting.id,
      buffer: file.buffer,
      filename: file.originalname,
      mimeType: file.mimetype,
    });

    console.log(`[MEETINGS:ingest] ✅ S3 upload exitoso - s3_key: ${s3Result.s3Key}, bucket: ${s3Result.s3Bucket}, url: ${s3Result.s3Url}`);

    // 3. Guardar asset
    console.log(`[MEETINGS:ingest] 💾 Guardando asset en DB...`);
    const { data: asset, error: assetError } = await supabase
      .from('meeting_assets')
      .insert({
        meeting_id: meeting.id,
        s3_key: s3Result.s3Key,
        s3_bucket: s3Result.s3Bucket,
        s3_url: s3Result.s3Url,
        filename: file.originalname,
        mime_type: file.mimetype,
        size_bytes: s3Result.sizeBytes,
        asset_type: 'full',
      })
      .select()
      .single();

    if (assetError) {
      console.error(`[MEETINGS:ingest] ❌ Error saving asset: ${assetError.message}`, assetError);
      return res.status(500).json({ error: 'Failed to save file', request_id });
    }

    console.log(`[MEETINGS:ingest] ✅ Asset guardado - asset_id: ${asset.id}, s3_key: ${asset.s3_key}`);

    // 4. Encolar transcripción
    console.log(`[MEETINGS:ingest] 📤 Encolando job de transcripción...`);
    await enqueueJob('TRANSCRIBE_FILE', {
      meetingId: meeting.id,
      assetId: asset.id,
      s3Key: s3Result.s3Key,
      userId: user.id,
      request_id,
    });

    console.log(`[MEETINGS:ingest] ✅ Job encolado exitosamente`);
    console.log(`[MEETINGS:ingest] 🎉 COMPLETADO - meeting_id: ${meeting.id}, request_id: ${request_id}, status: queued`);

    // Respuesta según contrato
    return res.json({
      meeting_id: meeting.id,
      status: 'queued',
      request_id,
    });

  } catch (error: any) {
    console.error(`[MEETINGS:ingest] 💥 EXCEPCIÓN - request_id: ${request_id}`, error);
    console.error(`[MEETINGS:ingest] Stack:`, error.stack);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      request_id
    });
  }
});

/**
 * GET /api/meetings/:id/status (CONTRATO)
 * Obtener status del procesamiento
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;
    console.log(`[MEETINGS:status] 🔵 INICIO - meeting_id: ${meetingId}`);

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.log(`[MEETINGS:status] ❌ No authorization header`);
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log(`[MEETINGS:status] 🔐 Verificando auth...`);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log(`[MEETINGS:status] ❌ Unauthorized - error: ${authError?.message || 'No user'}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`[MEETINGS:status] ✅ Usuario autenticado - user_id: ${user.id}`);
    console.log(`[MEETINGS:status] 🔍 Consultando meeting en DB...`);

    const { data: meeting } = await supabase
      .from('meetings')
      .select('id, status, title, created_at, updated_at')
      .eq('id', meetingId)
      .eq('owner_user_id', user.id)
      .single();

    if (!meeting) {
      console.log(`[MEETINGS:status] ❌ Meeting no encontrado - meeting_id: ${meetingId}, user_id: ${user.id}`);
      return res.status(404).json({ error: 'Meeting not found' });
    }

    console.log(`[MEETINGS:status] ✅ Meeting encontrado - status: ${meeting.status}, title: "${meeting.title}"`);

    // Calcular progress
    let progress = 0;
    if (meeting.status === 'recording') progress = 25;
    if (meeting.status === 'processing') progress = 50;
    if (meeting.status === 'completed') progress = 100;

    console.log(`[MEETINGS:status] 📊 Progress calculado: ${progress}%`);
    console.log(`[MEETINGS:status] 🎉 COMPLETADO - status: ${meeting.status}, progress: ${progress}`);

    return res.json({
      status: meeting.status,
      progress,
      last_error: null,
    });

  } catch (error: any) {
    console.error(`[MEETINGS:status] 💥 EXCEPCIÓN:`, error);
    console.error(`[MEETINGS:status] Stack:`, error.stack);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/meetings/:id/result (CONTRATO COMPLETO)
 * Obtener resultado final de meeting procesado
 */
router.get('/:id/result', async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;
    console.log(`[MEETINGS:result] 🔵 INICIO - meeting_id: ${meetingId}`);

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      console.log(`[MEETINGS:result] ❌ No authorization header`);
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    console.log(`[MEETINGS:result] 🔐 Verificando auth...`);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log(`[MEETINGS:result] ❌ Unauthorized - error: ${authError?.message || 'No user'}`);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log(`[MEETINGS:result] ✅ Usuario autenticado - user_id: ${user.id}`);

    // 1. Obtener meeting
    console.log(`[MEETINGS:result] 🔍 Consultando meeting...`);
    const { data: meeting } = await supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .eq('owner_user_id', user.id)
      .single();

    if (!meeting) {
      console.log(`[MEETINGS:result] ❌ Meeting no encontrado - meeting_id: ${meetingId}`);
      return res.status(404).json({ error: 'Meeting not found' });
    }

    console.log(`[MEETINGS:result] ✅ Meeting encontrado - status: ${meeting.status}, title: "${meeting.title}"`);

    // 2. Verificar que está completado O en procesamiento
    // HONESTIDAD: Si no está listo, retornar estado pending con evidencia
    if (meeting.status !== 'completed' && meeting.status !== 'done') {
      console.log(`[MEETINGS:result] ⚠️ Meeting no completado - status actual: ${meeting.status}`);
      
      // Obtener audio object key si existe
      const { data: assets } = await supabase
        .from('meeting_assets')
        .select('s3_key, s3_url')
        .eq('meeting_id', meetingId)
        .eq('asset_type', 'file') // Audio completo
        .limit(1)
        .single();
      
      return res.json({
        status: 'blocked',
        reason: 'transcript_pending',
        transcript_state: meeting.status, // 'recording', 'processing', 'transcribing', etc.
        evidence_ids: {
          meeting_id: meetingId,
          audio_object_key: assets?.s3_key || null,
        },
        message: `La transcripción está en proceso (estado: ${meeting.status}). Intenta nuevamente en unos minutos.`,
      });
    }

    // 3. Obtener transcript
    console.log(`[MEETINGS:result] 📝 Consultando transcripts...`);
    const { data: transcripts } = await supabase
      .from('meeting_transcripts')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: true });

    console.log(`[MEETINGS:result] ✅ Transcripts obtenidos - count: ${transcripts?.length || 0}`);
    const transcript_full = transcripts?.map(t => t.text).join(' ') || '';
    console.log(`[MEETINGS:result] 📏 Transcript length: ${transcript_full.length} chars`);
    
    // HONESTIDAD: Si no hay transcript, retornar pending
    if (!transcript_full || transcript_full.trim().length === 0) {
      console.log(`[MEETINGS:result] ⚠️ No hay transcript disponible aún`);
      
      const { data: assets } = await supabase
        .from('meeting_assets')
        .select('s3_key')
        .eq('meeting_id', meetingId)
        .limit(1)
        .single();
      
      return res.json({
        status: 'blocked',
        reason: 'transcript_empty',
        transcript_state: 'pending',
        evidence_ids: {
          meeting_id: meetingId,
          audio_object_key: assets?.s3_key || null,
        },
        message: 'El audio se grabó correctamente pero la transcripción aún no está disponible. Worker de transcripción pendiente.',
      });
    }

    // 4. Obtener minuta
    console.log(`[MEETINGS:result] 📋 Consultando meeting minutes...`);
    const { data: minute } = await supabase
      .from('meeting_minutes')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!minute) {
      console.log(`[MEETINGS:result] ⚠️ Meeting minutes no encontradas`);
      
      // HONESTIDAD: Hay transcript pero no minuta - retornar pending
      return res.json({
        status: 'blocked',
        reason: 'minutes_pending',
        transcript_state: 'ready',
        minutes_state: 'pending',
        evidence_ids: {
          meeting_id: meetingId,
          transcript_ids: transcripts?.map(t => t.id) || [],
        },
        message: 'La transcripción está lista pero la minuta aún no se ha generado. Worker de minuta pendiente.',
      });
    }

    console.log(`[MEETINGS:result] ✅ Minutes encontradas - minute_id: ${minute.id}`);
    console.log(`[MEETINGS:result] 📊 Minutes data - summary: ${minute.summary?.length || 0} chars, action_items: ${Array.isArray(minute.action_items) ? minute.action_items.length : 0}, agreements: ${Array.isArray(minute.detected_agreements) ? minute.detected_agreements.length : 0}`);

    // 5. Parsear action_items y agreements
    const tasks = Array.isArray(minute.action_items)
      ? minute.action_items.map((item: any) => ({
          text: item.text || item,
          owner: item.owner || null,
          due_date: item.due_date || null
        }))
      : [];

    const agreements = Array.isArray(minute.detected_agreements)
      ? minute.detected_agreements.map((item: any) => ({
          text: item.text || item,
          participants: item.participants || []
        }))
      : [];

    console.log(`[MEETINGS:result] ✅ Datos parseados - tasks: ${tasks.length}, agreements: ${agreements.length}`);

    // 6. Respuesta según contrato
    const response = {
      transcript_full,
      minutes: minute.content_markdown,
      summary: minute.summary || '',
      agreements,
      tasks,
      calendar_suggestions: [],
      status: 'done',
      evidence_ids: {
        meeting_id: meetingId,
        transcript_ids: transcripts?.map(t => t.id) || [],
        minute_id: minute.id
      }
    };

    console.log(`[MEETINGS:result] 🎉 COMPLETADO - Enviando respuesta completa`);
    console.log(`[MEETINGS:result] 📦 Response summary - transcript: ${response.transcript_full.length} chars, minutes: ${response.minutes.length} chars, tasks: ${tasks.length}, agreements: ${agreements.length}`);

    return res.json(response);

  } catch (error: any) {
    console.error(`[MEETINGS:result] 💥 EXCEPCIÓN:`, error);
    console.error(`[MEETINGS:result] Stack:`, error.stack);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/meetings/:id/ingest (LEGACY - RAG)
 * Ingestar transcript + minuta a RAG
 */
router.post('/:id/ingest', async (req: Request, res: Response) => {
  try {
    const { id: meetingId } = req.params;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Encolar ingesta a RAG
    await enqueueJob('INGEST_KNOWLEDGE', {
      meetingId,
      userId: user.id,
    });

    console.log(`[MEETINGS] 🧠 Knowledge ingestion queued for meeting ${meetingId}`);

    return res.json({
      success: true,
      message: 'Knowledge ingestion queued',
    });
  } catch (error) {
    console.error('[MEETINGS] Error in /:id/ingest:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
