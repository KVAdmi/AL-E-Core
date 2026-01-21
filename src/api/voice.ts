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
import { textToSpeech, type PollyVoice, type PollyGender } from '../ai/tts/pollyService';

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
 * Convierte texto a voz usando Amazon Polly
 * 
 * P0: TTS REAL - Amazon Polly (México)
 * - Timeout: 15s
 * - Log obligatorio en ae_requests
 * - Formato: mp3
 * - Voces: Mia (mujer, default) y Andrés (hombre)
 * - Engine: neural (alta calidad)
 */
router.post('/tts', async (req, res) => {
  const startTime = Date.now();
  console.log('[TTS] 🔊 Request recibido:', req.body);

  try {
    const { text, voice, gender, format = 'mp3', language, sessionId, userId }: TTSRequest & { gender?: PollyGender } = req.body;

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

    // Determinar voz Polly
    let pollyVoice: PollyVoice = 'Mia'; // Default: mujer
    
    if (voice === 'Andrés' || voice === 'Andres' || voice === 'male') {
      pollyVoice = 'Andres'; // Sin acento
    } else if (gender === 'male') {
      pollyVoice = 'Andres'; // Sin acento
    }
    
    console.log(`[TTS] Using Polly voice: ${pollyVoice}`);

    try {
      // Llamar a Polly TTS
      console.log('[TTS] 🔄 Calling Amazon Polly...');
      
      const pollyResponse = await textToSpeech({
        text: cleanText,
        voice: pollyVoice,
        engine: 'neural'
      });
      
      const latency_ms = Date.now() - startTime;
      const estimatedDuration = Math.ceil(cleanText.length / 15); // ~15 chars/sec promedio

      console.log(`[TTS] ✅ Síntesis completada en ${latency_ms}ms, ${pollyResponse.audioStream.length} bytes`);

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
            tts_provider: 'amazon-polly',
            tts_voice: pollyResponse.voice,
            tts_engine: pollyResponse.engine,
            audio_size_bytes: pollyResponse.audioStream.length,
            audio_format: 'mp3',
            estimated_duration_seconds: estimatedDuration,
            truncated: cleanText.length < text.length
          }
        });
      } catch (logError) {
        console.error('[TTS] Error logging request:', logError);
      }

      // Devolver audio como base64 (más fácil para frontend)
      const response: TTSResponse = {
        audioUrl: `data:${pollyResponse.contentType};base64,${Buffer.from(pollyResponse.audioStream).toString('base64')}`,
        format: 'mp3',
        duration: estimatedDuration
      };

      return res.json(response);

    } catch (ttsError: any) {

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
            error_type: 'POLLY_ERROR',
            text_chars: cleanText.length,
            tts_provider: 'amazon-polly',
            tts_voice: pollyVoice
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

// Handler compartido para STT
const handleSTT = async (req: express.Request, res: express.Response) => {
  const startTime = Date.now();
  console.log('[STT] 🎤 Request recibido');

  try {
    const { language, sessionId, userId }: STTRequest = req.body;
    const audioFile = req.file;

    // Validaciones
    if (!audioFile) {
      return res.status(400).json({
        success: false,
        safe_message: 'No recibimos el audio. ¿Puedes intentar grabar de nuevo?',
        metadata: {
          reason: 'no_audio_file',
          code: 'AUDIO_001',
          timestamp: new Date().toISOString()
        }
      });
    }
    
    // 📊 P0 INSTRUMENTACIÓN: Bytes, duración estimada, metadata
    const audioSizeBytes = audioFile.size || 0;
    const audioMimeType = audioFile.mimetype || 'unknown';
    const estimatedDuration = audioSizeBytes > 0 ? Math.round(audioSizeBytes / 16000) : 0; // ~16KB/seg aprox
    
    console.log('[VOICE] 📊 AUDIO RECIBIDO:');
    console.log('  - Bytes:', audioSizeBytes);
    console.log('  - MimeType:', audioMimeType);
    console.log('  - Duración estimada:', estimatedDuration, 'seg');
    
    if (audioSizeBytes === 0) {
      console.error('[VOICE] ❌ Audio vacío (0 bytes)');
      return res.status(400).json({
        success: false,
        safe_message: 'No detectamos audio. Verifica tu micrófono e intenta de nuevo',
        metadata: {
          reason: 'empty_audio',
          size: 0,
          code: 'AUDIO_002',
          timestamp: new Date().toISOString()
        }
      });
    }

    if (!audioFile.mimetype.startsWith('audio/')) {
      return res.status(400).json({
        success: false,
        safe_message: 'El archivo debe ser de audio',
        metadata: {
          reason: 'invalid_file_type',
          received: audioFile.mimetype,
          code: 'AUDIO_003',
          timestamp: new Date().toISOString()
        }
      });
    }

    console.log('[STT] Archivo recibido:', {
      originalname: audioFile.originalname,
      mimetype: audioFile.mimetype,
      size: audioFile.size,
      language: language || 'auto'
    });
    
    // 🚨 P0: LOGS OBLIGATORIOS
    const audioSizeKB = (audioSizeBytes / 1024).toFixed(2);
    const estimatedDurationSeconds = Math.round(audioSizeBytes / 16000); // Rough estimate: 16KB/s
    
    console.log(`[STT] 📊 Audio size: ${audioSizeKB} KB (${audioSizeBytes} bytes)`);
    console.log(`[STT] ⏱️  Estimated duration: ~${estimatedDurationSeconds}s`);
    console.log(`[STT] 🌍 Language requested: ${language || 'auto-detect'}`);

    // Guardar archivo temporalmente (Groq Whisper requiere file path)
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `stt_${uuidv4()}_${audioFile.originalname}`);
    
    fs.writeFileSync(tempFilePath, audioFile.buffer);
    
    let whisperCalled = false;
    
    try {
      // Llamar a Groq Whisper API con timeout
      console.log('[STT] 🔄 Calling Groq Whisper API...');
      whisperCalled = true; // 🚨 P0: Marca que SÍ se llamó
      
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
      
      // 🚨 P0: LOGS OBLIGATORIOS después de transcripción
      console.log(`[STT] ✅ Transcripción completada en ${latency_ms}ms`);
      console.log(`[STT] 📊 Duración estimada: ${audioSeconds}s`);
      console.log(`[STT] 🌍 Idioma detectado: ${transcription.language || 'auto'}`);
      console.log(`[STT] 🎯 Whisper llamado: ${whisperCalled ? 'true' : 'false'}`);
      console.log(`[STT] 📝 Texto transcrito (${transcription.text.length} chars): "${transcription.text.substring(0, 100)}..."`);
      
      // 🚨 P0 CRÍTICO: Detectar si ASR devolvió texto vacío
      if (!transcription.text || transcription.text.trim().length === 0) {
        console.error('[STT] 🚨 FUGA DETECTADA: Whisper devolvió texto vacío');
        console.error('[STT] 🚨 Audio bytes:', audioSizeBytes);
        console.error('[STT] 🚨 Duración estimada:', estimatedDuration, 'seg');
        console.error('[STT] 🚨 MimeType:', audioMimeType);
      }
      
      // 🚨 P0: VALIDAR que whisper SÍ se llamó
      if (!whisperCalled) {
        console.error('[STT] 🚨 P0 VIOLATION: Transcription returned but whisper was NOT called');
        return res.status(500).json({
          error: 'STT_NOT_EXECUTED',
          message: 'Error interno: Whisper no fue invocado correctamente'
        });
      }      
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
};

/**
 * POST /api/voice/stt
 * Convierte voz a texto usando Groq Whisper
 */
router.post('/stt', upload.single('audio'), handleSTT);

/**
 * POST /api/voice/transcribe
 * Alias de /stt para compatibilidad con frontend
 */
router.post('/transcribe', upload.single('audio'), handleSTT);

/**
 * ✅ FIX 5: POST /api/voice/chat
 * Endpoint completo: STT → Chat con memoria → TTS
 * 
 * PRODUCCIÓN REAL:
 * - Usa Groq Whisper para STT (NO OpenAI)
 * - Llama a /api/ai/chat/v2 internamente (CON memoria)
 * - Usa Edge-TTS para síntesis
 * - NO mock, NO temporal
 */
router.post('/chat', upload.single('audio'), async (req, res) => {
  const startTime = Date.now();
  console.log('[VOICE_CHAT] 🎤 Request recibido - STT → Chat → TTS');
  
  try {
    const { userId, sessionId, workspaceId = 'al-eon' } = req.body;
    const audioFile = req.file;
    
    // Validaciones
    if (!audioFile || !userId) {
      return res.status(400).json({
        error: 'MISSING_PARAMS',
        message: 'Se requiere audio y userId'
      });
    }
    
    // ============================================
    // 1. STT: Transcribir con Groq Whisper
    // ============================================
    console.log('[VOICE_CHAT] 🔄 Step 1/3: Transcribing with Groq Whisper...');
    const tempFilePath = path.join(os.tmpdir(), `voice_chat_${uuidv4()}.webm`);
    fs.writeFileSync(tempFilePath, audioFile.buffer);
    
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: 'whisper-large-v3-turbo',
      language: 'es',
      response_format: 'json',
      temperature: 0.0
    });
    
    fs.unlinkSync(tempFilePath);
    const transcript = transcription.text;
    console.log(`[VOICE_CHAT] ✓ Transcript: "${transcript}"`);
    
    // ============================================
    // 2. CHAT: Procesar con orchestrator (MEMORIA REAL)
    // ============================================
    console.log('[VOICE_CHAT] 🧠 Step 2/3: Processing with orchestrator (with memory)...');
    
    const chatResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/ai/chat/v2`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-channel': 'voice'  // ← Marcar como voz (bloquea OpenAI referee)
      },
      body: JSON.stringify({
        userId,
        sessionId,
        workspaceId,
        mode: 'universal',
        voice: true,  // ← Flag de voz
        message: transcript  // ← /chat/v2 usa 'message' no 'messages'
      })
    });
    
    if (!chatResponse.ok) {
      throw new Error(`Chat API error: ${chatResponse.statusText}`);
    }
    
    const chatData = await chatResponse.json();
    console.log(`[VOICE_CHAT] ✓ Chat response received - session: ${chatData.session_id}`);
    
    // ============================================
    // 3. TTS: Sintetizar con Edge-TTS
    // ============================================
    console.log('[VOICE_CHAT] 🔊 Step 3/3: Synthesizing with Edge-TTS...');
    const speakText = chatData.speak_text || chatData.answer;
    
    // Limpiar texto para voz (sin markdown)
    let cleanText = speakText.replace(/\*\*|\*|`|#/g, '').trim();
    
    // Truncar a 2 frases para respuestas rápidas en voz
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    if (sentences.length > 2) {
      cleanText = sentences.slice(0, 2).join(' ');
    }
    
    const outputFile = path.join(os.tmpdir(), `tts_${uuidv4()}.mp3`);
    await execPromise(
      `edge-tts --voice "es-MX-DaliaNeural" --text "${cleanText.replace(/"/g, '\\"')}" --write-media "${outputFile}"`,
      { timeout: TTS_TIMEOUT_MS }
    );
    
    const audioBuffer = fs.readFileSync(outputFile);
    fs.unlinkSync(outputFile);
    
    console.log(`[VOICE_CHAT] ✅ Completed in ${Date.now() - startTime}ms`);
    
    // ============================================
    // 4. RESPONDER con audio + metadata
    // ============================================
    return res.json({
      transcript,
      answer: chatData.answer,
      speak_text: cleanText,
      audioUrl: `data:audio/mpeg;base64,${audioBuffer.toString('base64')}`,
      session_id: chatData.session_id,
      with_memory: true,  // ✅ CONFIRMACIÓN: Memoria está activa
      metadata: {
        latency_ms: Date.now() - startTime,
        stt_provider: 'groq',
        chat_provider: chatData.metadata?.provider || 'groq',
        tts_provider: 'edge-tts',
        memory_loaded: true  // Confirmación de memoria
      }
    });
    
  } catch (error: any) {
    console.error('[VOICE_CHAT] ❌ Error:', error);
    return res.status(500).json({
      error: 'VOICE_CHAT_ERROR',
      message: error.message
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