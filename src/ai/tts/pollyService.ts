/**
 * POLLY TTS SERVICE
 * 
 * Amazon Polly para Text-to-Speech
 * Voces: Mia (mujer) y Andrés (hombre) - Español México
 * 
 * IMPORTANTE: Polly NO piensa, NO decide, SOLO habla.
 */

import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { logger } from '../../utils/logger';

const polly = new PollyClient({ region: 'us-east-1' });

export type PollyVoice = 'Mia' | 'Andres'; // Sin acento en Andres
export type PollyGender = 'female' | 'male';

interface PollyTTSRequest {
  text: string;
  voice?: PollyVoice;
  gender?: PollyGender; // Alternativa: especificar por género
  engine?: 'neural' | 'generative' | 'standard';
}

interface PollyTTSResponse {
  audioStream: Uint8Array;
  contentType: string;
  voice: PollyVoice;
  engine: string;
}

/**
 * Convierte texto a audio usando Amazon Polly
 */
export async function textToSpeech(request: PollyTTSRequest): Promise<PollyTTSResponse> {
  const startTime = Date.now();
  
  // Determinar voz (Mia por defecto)
  let voice: PollyVoice = request.voice || 'Mia';
  
  // Si se especificó género, usar esa voz
  if (request.gender === 'male') {
    voice = 'Andres'; // Sin acento
  } else if (request.gender === 'female') {
    voice = 'Mia';
  }
  
  const engine = request.engine || 'neural';
  
  console.log(`[POLLY] 🎙️ Sintetizando voz: ${voice} (${engine})`);
  console.log(`[POLLY] 📝 Texto: ${request.text.substring(0, 100)}...`);
  
  try {
    const command = new SynthesizeSpeechCommand({
      Text: request.text,
      OutputFormat: 'mp3',
      VoiceId: voice,
      Engine: engine as 'neural' | 'standard' | 'generative',
      LanguageCode: 'es-MX',
    });
    
    const response = await polly.send(command);
    
    if (!response.AudioStream) {
      throw new Error('No se recibió audio de Polly');
    }
    
    // Convertir stream a Uint8Array
    const audioStream = await streamToUint8Array(response.AudioStream);
    
    const executionTime = Date.now() - startTime;
    console.log(`[POLLY] ✅ Audio generado en ${executionTime}ms`);
    console.log(`[POLLY] 📊 Tamaño: ${audioStream.length} bytes`);
    
    return {
      audioStream,
      contentType: response.ContentType || 'audio/mpeg',
      voice,
      engine,
    };
    
  } catch (error: any) {
    console.error('[POLLY] ❌ Error:', error.message);
    throw new Error(`Polly TTS failed: ${error.message}`);
  }
}

/**
 * Convierte stream a Uint8Array
 */
async function streamToUint8Array(stream: any): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

/**
 * Metadata de voces disponibles
 */
export const POLLY_VOICES = {
  Mia: {
    gender: 'female',
    language: 'es-MX',
    engines: ['neural', 'generative', 'standard'],
    description: 'Voz femenina mexicana'
  },
  Andrés: {
    gender: 'male',
    language: 'es-MX',
    engines: ['neural', 'generative'],
    description: 'Voz masculina mexicana'
  }
} as const;
