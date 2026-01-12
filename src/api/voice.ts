import express from 'express';
import multer from 'multer';
import Groq from 'groq-sdk';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabase';
import { TTSRequest, TTSResponse, STTRequest, STTResponse } from '../types';

const router = express.Router();
const execPromise = promisify(exec);

// Inicializar Groq para Whisper STT
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Timeouts defensivos
const STT_TIMEOUT_MS = 20000; // 20s para STT
const TTS_TIMEOUT_MS = 15000; // 15s para TTS

// Configurar multer para archivos de audio
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB límite
  },
  fileFilter: (req, file, cb) => {
    // Permitir solo archivos de audio
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo archivos de audio son permitidos'));
    }
  }
});

/**
 * POST /api/voice/tts
 * Convierte texto a voz usando Edge-TTS (Microsoft)
 * 
 * P0: TTS REAL - Edge-TTS
 * - Timeout: 15s
 * - Log obligatorio en ae_requests
 * - Formato: mp3
 * - Voz: es-MX-DaliaNeural (México, femenina) por default
 */
router.post('/tts', async (req, res) => {
  const startTime = Date.now();
  console.log('[TTS] 🔊 Request recibido:', req.body);

  try {
    const { text, voice, format = 'mp3', language, sessionId, userId }: TTSRequest = req.body;

    // Validaciones básicas
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({
        error: 'INVALID_TEXT',
        message: 'El campo text es requerido y no puede estar vacío'
      });
    }

    if (text.length > 5000) {
      return res.status(400).json({
        error: 'TEXT_TOO_LONG',
        message: 'El texto no puede exceder 5000 caracteres'
      });
    }

    // Limpiar texto de Markdown excesivo para TTS
    let cleanText = text
      .replace(/#{1,6}\s/g, '') // Eliminar headers
      .replace(/\*\*([^*]+)\*\*/g, '$1') // Eliminar bold
      .replace(/\*([^*]+)\*/g, '$1') // Eliminar italic
      .replace(/`([^`]+)`/g, '$1') // Eliminar code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Eliminar links
      .replace(/^[-*]\s/gm, '') // Eliminar bullets
      .trim();

    // Limitar a 2 frases para respuestas cortas (modo voz)
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    if (sentences.length > 2) {
      cleanText = sentences.slice(0, 2).join(' ');
      console.log('[TTS] ⚠️ Text truncated to 2 sentences for voice mode');
    }

    console.log(`[TTS] Text length: ${cleanText.length} chars`);

    // Seleccionar voz (default: es-MX-DaliaNeural - México femenina)
    const selectedVoice = voice || 'es-MX-DaliaNeural';

    // Generar archivo temporal
    const tempDir = os.tmpdir();
    const outputFile = path.join(tempDir, `tts_${uuidv4()}.mp3`);

    try {
      // Llamar a edge-tts con timeout
      console.log('[TTS] 🔄 Calling Edge-TTS...');
      
      const ttsCommand = `edge-tts --voice "${selectedVoice}" --text "${cleanText.replace(/"/g, '\\"')}" --write-media "${outputFile}"`;
      
      const ttsPromise = execPromise(ttsCommand, {
        timeout: TTS_TIMEOUT_MS
      });
      
      await ttsPromise;
      
      // Verificar que el archivo se generó
      if (!fs.existsSync(outputFile)) {
        throw new Error('TTS file not generated');
      }

      const audioBuffer = fs.readFileSync(outputFile);
      const latency_ms = Date.now() - startTime;
      const estimatedDuration = Math.ceil(cleanText.length / 15); // ~15 chars/sec promedio

      console.log(`[TTS] ✅ Síntesis completada en ${latency_ms}ms, ${audioBuffer.length} bytes`);

      // Log en ae_requests
      try {
        await supabase.from('ae_requests').insert({
          request_id: uuidv4(),
          session_id: sessionId || null,
          user_id: userId || null,
          endpoint: '/api/voice/tts',
          method: 'POST',
          status_code: 200,
          latency_ms,
          metadata: {
            text_chars: cleanText.length,
            text_original_chars: text.length,
            tts_provider: 'edge-tts',
            tts_voice: selectedVoice,
            audio_size_bytes: audioBuffer.length,
            audio_format: 'mp3',
            estimated_duration_seconds: estimatedDuration,
            truncated: cleanText.length < text.length
          }
        });
      } catch (logError) {
        console.error('[TTS] Error logging request:', logError);
      }

      // Limpiar archivo temporal
      fs.unlinkSync(outputFile);

      // Devolver audio como base64 (más fácil para frontend)
      const response: TTSResponse = {
        audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
        format: 'mp3',
        duration: estimatedDuration
      };

      return res.json(response);

    } catch (ttsError: any) {
      // Limpiar archivo temporal en caso de error
      if (fs.existsSync(outputFile)) {
        fs.unlinkSync(outputFile);
      }

      const latency_ms = Date.now() - startTime;

      // Log error
      try {
        await supabase.from('ae_requests').insert({
          request_id: uuidv4(),
          session_id: sessionId || null,
          user_id: userId || null,
          endpoint: '/api/voice/tts',
          method: 'POST',
          status_code: 500,
          latency_ms,
          metadata: {
            error: ttsError.message,
            error_type: ttsError.killed ? 'TIMEOUT' : 'TTS_ERROR',
            text_chars: cleanText.length,
            tts_provider: 'edge-tts',
            tts_voice: selectedVoice
          }
        });
      } catch (logError) {
        console.error('[TTS] Error logging error:', logError);
      }

      throw ttsError;
    }

  } catch (error: any) {
    console.error('[TTS] ❌ Error:', error);

    if (error.killed) {
      return res.status(504).json({
        error: 'TTS_TIMEOUT',
        message: 'La síntesis de voz tomó demasiado tiempo (>15s)'
      });
    }

    return res.status(500).json({
      error: 'TTS_ERROR',
      message: 'Error interno al procesar TTS'
    });
  }
});

/**
 * POST /api/voice/stt
 * Convierte voz a texto usando Groq Whisper
 * 
 * P0: STT REAL - Groq Whisper API
 * - Timeout: 20s
 * - Log obligatorio en ae_requests
 * - Soporta: mp3, wav, ogg, webm, m4a
 */
router.post('/stt', upload.single('audio'), async (req, res) => {
  const startTime = Date.now();
  console.log('[STT] 🎤 Request recibido');

  try {
    const { language, sessionId, userId }: STTRequest = req.body;
    const audioFile = req.file;

    // Validaciones
    if (!audioFile) {
      return res.status(400).json({
        error: 'NO_AUDIO_FILE',
        message: 'Se requiere un archivo de audio'
      });
    }
    
    // 🚨 VALIDACIÓN ANTI-MENTIRA: audio.size > 0
    if (!audioFile.size || audioFile.size === 0) {
      console.error('[STT] ❌ Audio file size is 0');
      return res.status(400).json({
        error: 'EMPTY_AUDIO_FILE',
        message: 'El archivo de audio está vacío. Por favor, vuelve a grabar.'
      });
    }

    if (!audioFile.mimetype.startsWith('audio/')) {
      return res.status(400).json({
        error: 'INVALID_FILE_TYPE',
        message: 'Solo se permiten archivos de audio'
      });
    }

    console.log('[STT] Archivo recibido:', {
      originalname: audioFile.originalname,
      mimetype: audioFile.mimetype,
      size: audioFile.size,
      language: language || 'auto'
    });

    // Guardar archivo temporalmente (Groq Whisper requiere file path)
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `stt_${uuidv4()}_${audioFile.originalname}`);
    
    fs.writeFileSync(tempFilePath, audioFile.buffer);
    
    try {
      // Llamar a Groq Whisper API con timeout
      console.log('[STT] 🔄 Calling Groq Whisper API...');
      
      const transcriptionPromise = groq.audio.transcriptions.create({
        file: fs.createReadStream(tempFilePath),
        model: 'whisper-large-v3-turbo',
        language: language || undefined, // auto-detect si no se especifica
        response_format: 'json',
        temperature: 0.0 // Máxima precisión
      });
      
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('STT_TIMEOUT')), STT_TIMEOUT_MS)
      );
      
      const transcription = await Promise.race([transcriptionPromise, timeoutPromise]) as any;
      
      const latency_ms = Date.now() - startTime;
      const audioSeconds = Math.ceil(audioFile.size / 16000); // Estimación aproximada
      
      console.log(`[STT] ✅ Transcripción completada en ${latency_ms}ms`);
      console.log(`[STT] 📊 Duración estimada: ${audioSeconds}s`);
      console.log(`[STT] 🌍 Idioma detectado: ${transcription.language || 'auto'}`);
      console.log(`[STT] Texto: "${transcription.text.substring(0, 100)}..."`);
      
      // Log en ae_requests
      try {
        await supabase.from('ae_requests').insert({
          request_id: uuidv4(),
          session_id: sessionId || null,
          user_id: userId || null,
          endpoint: '/api/voice/stt',
          method: 'POST',
          status_code: 200,
          latency_ms,
          metadata: {
            audio_seconds: audioSeconds,
            audio_size_bytes: audioFile.size,
            audio_mimetype: audioFile.mimetype,
            stt_provider: 'groq',
            stt_model: 'whisper-large-v3-turbo',
            transcript_length: transcription.text.length,
            language: language || 'auto',
            detected_language: transcription.language || 'unknown'
          }
        });
      } catch (logError) {
        console.error('[STT] Error logging request:', logError);
      }
      
      // Limpiar archivo temporal
      fs.unlinkSync(tempFilePath);
      
      const response: STTResponse = {
        transcript: transcription.text,
        confidence: 0.95, // Groq Whisper no devuelve confidence, usar valor alto
        detectedLanguage: transcription.language || language || 'unknown'
      };

      return res.json(response);
      
    } catch (transcriptionError: any) {
      // Limpiar archivo temporal en caso de error
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      
      const latency_ms = Date.now() - startTime;
      
      // Log error
      try {
        await supabase.from('ae_requests').insert({
          request_id: uuidv4(),
          session_id: sessionId || null,
          user_id: userId || null,
          endpoint: '/api/voice/stt',
          method: 'POST',
          status_code: 500,
          latency_ms,
          metadata: {
            error: transcriptionError.message,
            error_type: transcriptionError.message === 'STT_TIMEOUT' ? 'TIMEOUT' : 'STT_ERROR',
            audio_size_bytes: audioFile.size,
            stt_provider: 'groq'
          }
        });
      } catch (logError) {
        console.error('[STT] Error logging error:', logError);
      }
      
      throw transcriptionError;
    }

  } catch (error: any) {
    console.error('[STT] ❌ Error:', error);
    
    if (error.message === 'STT_TIMEOUT') {
      return res.status(504).json({
        error: 'STT_TIMEOUT',
        message: 'La transcripción tomó demasiado tiempo (>20s)'
      });
    }
    
    return res.status(500).json({
      error: 'STT_ERROR',
      message: 'Error interno al procesar STT'
    });
  }
});

/**
 * GET /api/voice/capabilities
 * Información sobre capacidades de voz disponibles
 */
router.get('/capabilities', (req, res) => {
  res.json({
    tts: {
      available: true, // ✅ Edge-TTS implementado
      formats: ['mp3'],
      maxTextLength: 5000,
      voices: [
        'es-MX-DaliaNeural', // México - Femenina (default)
        'es-MX-JorgeNeural', // México - Masculina
        'es-ES-ElviraNeural', // España - Femenina
        'es-AR-ElenaNeural', // Argentina - Femenina
        'en-US-JennyNeural', // USA - Femenina
        'en-US-GuyNeural' // USA - Masculina
      ],
      provider: 'edge-tts',
      timeout_ms: TTS_TIMEOUT_MS
    },
    stt: {
      available: true, // ✅ Groq Whisper implementado
      formats: ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/m4a'],
      maxFileSize: '10MB',
      languages: ['auto', 'es', 'en', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
      provider: 'groq',
      model: 'whisper-large-v3-turbo',
      timeout_ms: STT_TIMEOUT_MS
    },
    status: 'ready' // ✅ Producción lista
  });
});

export { router as voiceRouter };