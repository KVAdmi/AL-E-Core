/**
 * Supabase Storage Service para Meetings
 * Maneja storage de audio/video chunks y archivos completos
 * 🔥 REEMPLAZA S3 - USA SUPABASE STORAGE
 */

import { supabase } from '../db/supabase';

const BUCKET = 'meetings-audio';

export interface UploadChunkParams {
  userId: string;
  meetingId: string;
  chunkIndex: number;
  buffer: Buffer;
  mimeType: string;
}

export interface UploadFileParams {
  userId: string;
  meetingId: string;
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Upload audio chunk para modo LIVE usando Supabase Storage
 */
export async function uploadMeetingChunk(params: UploadChunkParams) {
  const { userId, meetingId, chunkIndex, buffer, mimeType } = params;

  // Path: meetings/{userId}/{meetingId}/chunks/chunk-{index}.webm
  const path = `meetings/${userId}/${meetingId}/chunks/chunk-${String(chunkIndex).padStart(5, '0')}.webm`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: true, // Sobrescribir si existe
    });

  if (error) {
    console.error('[SupabaseMeetings] ❌ Error uploading chunk:', error);
    throw new Error(`Failed to upload chunk: ${error.message}`);
  }

  // Obtener URL pública
  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path);

  return {
    s3Key: path, // Mantenemos el nombre por compatibilidad con DB
    s3Bucket: BUCKET,
    s3Url: urlData.publicUrl,
    sizeBytes: buffer.length,
  };
}

/**
 * Upload archivo completo para modo UPLOAD usando Supabase Storage
 */
export async function uploadMeetingFile(params: UploadFileParams) {
  const { userId, meetingId, buffer, filename, mimeType } = params;

  // Path: meetings/{userId}/{meetingId}/original/{filename}
  const path = `meetings/${userId}/${meetingId}/original/${filename}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, buffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (error) {
    console.error('[SupabaseMeetings] ❌ Error uploading file:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }

  // Obtener URL pública
  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(path);

  return {
    s3Key: path,
    s3Bucket: BUCKET,
    s3Url: urlData.publicUrl,
    sizeBytes: buffer.length,
  };
}

/**
 * Generar URL firmada para descarga (válida 1 hora)
 */
export async function getSignedDownloadUrl(path: string, expiresIn: number = 3600) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error) {
    console.error('[SupabaseMeetings] ❌ Error creating signed URL:', error);
    throw new Error(`Failed to create signed URL: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Verificar si un archivo existe en Supabase Storage
 */
export async function checkFileExists(path: string): Promise<boolean> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(path.split('/').slice(0, -1).join('/'), {
      search: path.split('/').pop(),
    });

  if (error) {
    console.error('[SupabaseMeetings] ❌ Error checking file:', error);
    return false;
  }

  return data && data.length > 0;
}

/**
 * Obtener metadata de archivo desde Supabase Storage
 */
export async function getFileMetadata(path: string) {
  // Supabase Storage no tiene endpoint directo para metadata,
  // pero podemos obtener info básica desde list()
  const parts = path.split('/');
  const filename = parts.pop();
  const folder = parts.join('/');

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, {
      search: filename,
    });

  if (error || !data || data.length === 0) {
    throw new Error(`File not found: ${path}`);
  }

  const file = data[0];

  return {
    contentLength: file.metadata?.size || 0,
    contentType: file.metadata?.mimetype || 'application/octet-stream',
    lastModified: new Date(file.created_at),
    metadata: file.metadata,
  };
}

export default {
  uploadMeetingChunk,
  uploadMeetingFile,
  getSignedDownloadUrl,
  checkFileExists,
  getFileMetadata,
};
