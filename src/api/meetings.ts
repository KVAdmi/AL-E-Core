/**
 * API de Meetings - Modo Altavoz Presencial + Upload
 * 
 * Endpoints:
 * - POST /api/meetings/live/start - Iniciar sesión de grabación presencial
 * - POST /api/meetings/live/:id/chunk - Enviar chunk de audio
 * - GET /api/meetings/live/:id/status - Status en tiempo real (transcript parcial + notas)
 * - POST /api/meetings/live/:id/stop - Finalizar grabación
 * 
 * - POST /api/meetings/upload - Subir archivo completo (mp3/mp4/wav)
 * - GET /api/meetings/:id - Obtener meeting completo
 * - GET /api/meetings/:id/transcript - Obtener transcript
 * - GET /api/meetings/:id/minutes - Obtener minuta
 * - POST /api/meetings/:id/send - Enviar minuta por email/telegram
 * - POST /api/meetings/:id/ingest - Ingestar a RAG
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { uploadMeetingChunk, uploadMeetingFile } from '../services/s3MeetingsService';
import { enqueueJob } from '../jobs/meetingQueue';

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
        happened_at: new Date().toISOString(),
        participants,
        auto_send_enabled,
        send_email,
        send_telegram,
      })
      .select()
      .single();

    if (dbError) {
      console.error('[MEETINGS] Error creating meeting:', dbError);
      return res.status(500).json({ error: 'Failed to create meeting' });
    }

    console.log(`[MEETINGS] 🎙️ Live meeting started: ${meeting.id}`);

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
    } = req.body;

    // Crear meeting
    const { data: meeting, error: dbError } = await supabase
      .from('meetings')
      .insert({
        owner_user_id: user.id,
        title: title || file.originalname,
        description,
        mode: 'upload',
        status: 'processing',
        happened_at: new Date().toISOString(),
        participants: typeof participants === 'string' ? JSON.parse(participants) : participants,
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
 * POST /api/meetings/:id/ingest
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
