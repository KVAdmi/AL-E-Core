/**
 * S3 Service para Meetings
 * Maneja storage de audio/video chunks y archivos completos
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

const BUCKET = process.env.AWS_S3_BUCKET_MEETINGS || 'al-eon-meetings';

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
 * Upload audio chunk para modo LIVE
 */
export async function uploadMeetingChunk(params: UploadChunkParams) {
  const { userId, meetingId, chunkIndex, buffer, mimeType } = params;

  // Path: meetings/{userId}/{meetingId}/chunks/chunk-{index}.webm
  const key = `meetings/${userId}/${meetingId}/chunks/chunk-${String(chunkIndex).padStart(5, '0')}.webm`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    Metadata: {
      userId,
      meetingId,
      chunkIndex: String(chunkIndex),
      uploadedAt: new Date().toISOString(),
    },
  });

  await s3Client.send(command);

  return {
    s3Key: key,
    s3Bucket: BUCKET,
    s3Url: `https://${BUCKET}.s3.amazonaws.com/${key}`,
    sizeBytes: buffer.length,
  };
}

/**
 * Upload archivo completo para modo UPLOAD
 */
export async function uploadMeetingFile(params: UploadFileParams) {
  const { userId, meetingId, buffer, filename, mimeType } = params;

  // Path: meetings/{userId}/{meetingId}/original/{filename}
  const key = `meetings/${userId}/${meetingId}/original/${filename}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
    Metadata: {
      userId,
      meetingId,
      originalFilename: filename,
      uploadedAt: new Date().toISOString(),
    },
  });

  await s3Client.send(command);

  return {
    s3Key: key,
    s3Bucket: BUCKET,
    s3Url: `https://${BUCKET}.s3.amazonaws.com/${key}`,
    sizeBytes: buffer.length,
  };
}

/**
 * Generar URL pre-firmada para descarga (válida 1 hora)
 */
export async function getSignedDownloadUrl(s3Key: string, expiresIn: number = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Verificar si un archivo existe en S3
 */
export async function checkFileExists(s3Key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
    });
    await s3Client.send(command);
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
}

/**
 * Obtener metadata de archivo
 */
export async function getFileMetadata(s3Key: string) {
  const command = new HeadObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  const response = await s3Client.send(command);

  return {
    contentLength: response.ContentLength,
    contentType: response.ContentType,
    lastModified: response.LastModified,
    metadata: response.Metadata,
  };
}

export default {
  uploadMeetingChunk,
  uploadMeetingFile,
  getSignedDownloadUrl,
  checkFileExists,
  getFileMetadata,
};
