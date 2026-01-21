import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { createClient } from '@supabase/supabase-js';

const execAsync = promisify(exec);

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface MeetingSegment {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

interface DiarizeResult {
  segments: MeetingSegment[];
  duration: number;
  speakers_count: number;
  error?: string;
}

interface MeetingTranscription {
  id: string;
  user_id: string;
  title: string;
  duration: number;
  speakers_count: number;
  segments: MeetingSegment[];
  audio_path?: string;
  created_at: string;
}

/**
 * Procesa audio de reunión: diarización + transcripción
 */
export async function processMeetingAudio(
  audioBuffer: Buffer,
  userId: string,
  originalFilename: string
): Promise<MeetingTranscription> {
  
  // Crear archivo temporal
  const tmpDir = '/tmp';
  const timestamp = Date.now();
  const audioPath = path.join(tmpDir, `meeting_${timestamp}_${originalFilename}`);
  
  try {
    // Guardar audio en /tmp
    await fs.writeFile(audioPath, audioBuffer);
    console.log(`[MeetingTranscription] Audio saved: ${audioPath}`);
    
    // Ejecutar script Python
    const pythonScript = path.join(process.cwd(), 'services/meetings/diarize_transcribe.py');
    const venvPython = '/opt/meetings-venv/bin/python3';
    
    console.log(`[MeetingTranscription] Executing: ${venvPython} ${pythonScript} ${audioPath}`);
    
    const { stdout, stderr } = await execAsync(
      `${venvPython} ${pythonScript} ${audioPath}`,
      {
        timeout: 1800000, // 30 minutos máximo
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      }
    );
    
    // Logs del proceso (stderr tiene los status updates)
    if (stderr) {
      const logs = stderr.split('\n').filter(line => line.trim());
      logs.forEach(log => {
        try {
          const parsed = JSON.parse(log);
          console.log('[MeetingTranscription]', parsed);
        } catch {
          console.log('[MeetingTranscription]', log);
        }
      });
    }
    
    // Parsear resultado (stdout tiene el JSON final)
    const result: DiarizeResult = JSON.parse(stdout);
    
    if (result.error) {
      throw new Error(result.error);
    }
    
    console.log(`[MeetingTranscription] Processed: ${result.segments.length} segments, ${result.speakers_count} speakers`);
    
    // Generar título automático
    const now = new Date();
    const title = `Reunión del ${now.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })}`;
    
    // Guardar en Supabase
    const { data, error } = await supabase
      .from('meeting_transcriptions')
      .insert({
        user_id: userId,
        title,
        duration: result.duration,
        speakers_count: result.speakers_count,
        segments: result.segments,
        audio_path: audioPath
      })
      .select()
      .single();
    
    if (error) {
      throw new Error(`Database error: ${error.message}`);
    }
    
    console.log(`[MeetingTranscription] Saved to DB: ${data.id}`);
    
    return data as MeetingTranscription;
    
  } catch (error: any) {
    console.error('[MeetingTranscription] Error:', error);
    
    // Limpiar archivo temporal
    try {
      await fs.unlink(audioPath);
    } catch {}
    
    throw new Error(`Failed to process meeting: ${error.message}`);
    
  } finally {
    // Opcional: limpiar archivo después de procesar
    // En producción podrías querer mantenerlo o subirlo a S3
    // await fs.unlink(audioPath).catch(() => {});
  }
}

/**
 * Obtiene transcripción de reunión por ID
 */
export async function getMeetingTranscription(
  meetingId: string,
  userId: string
): Promise<MeetingTranscription | null> {
  
  const { data, error } = await supabase
    .from('meeting_transcriptions')
    .select('*')
    .eq('id', meetingId)
    .eq('user_id', userId)
    .single();
  
  if (error) {
    console.error('[MeetingTranscription] Get error:', error);
    return null;
  }
  
  return data as MeetingTranscription;
}

/**
 * Lista reuniones del usuario
 */
export async function listMeetingTranscriptions(
  userId: string,
  limit: number = 50
): Promise<MeetingTranscription[]> {
  
  const { data, error } = await supabase
    .from('meeting_transcriptions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('[MeetingTranscription] List error:', error);
    return [];
  }
  
  return data as MeetingTranscription[];
}

/**
 * Elimina reunión
 */
export async function deleteMeetingTranscription(
  meetingId: string,
  userId: string
): Promise<boolean> {
  
  // Obtener audio_path antes de eliminar
  const meeting = await getMeetingTranscription(meetingId, userId);
  
  const { error } = await supabase
    .from('meeting_transcriptions')
    .delete()
    .eq('id', meetingId)
    .eq('user_id', userId);
  
  if (error) {
    console.error('[MeetingTranscription] Delete error:', error);
    return false;
  }
  
  // Limpiar archivo de audio si existe
  if (meeting?.audio_path) {
    try {
      await fs.unlink(meeting.audio_path);
    } catch (err) {
      console.error('[MeetingTranscription] Failed to delete audio file:', err);
    }
  }
  
  return true;
}
