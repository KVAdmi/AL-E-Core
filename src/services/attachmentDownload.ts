/**
 * Servicio de Descarga de Attachments desde Supabase Storage
 * 
 * Propósito: Descargar archivos desde Supabase cuando el frontend envía URLs/paths
 * en lugar de archivos raw (multipart)
 */

import { supabase } from '../db/supabase';
import axios from 'axios';

export type AttachmentMetadata = {
  bucket: string;
  path: string;
  url?: string;
  name: string;
  type: string;
  size?: number;
};

export type DownloadedAttachment = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

/**
 * Descarga un attachment desde Supabase Storage
 * 
 * Estrategia:
 * 1. Preferir descarga con SERVICE_ROLE (bucket + path)
 * 2. Fallback a URL pública si falla
 */
export async function downloadAttachment(attachment: AttachmentMetadata): Promise<DownloadedAttachment | null> {
  const { bucket, path, url, name, type } = attachment;

  console.log(`[AttachmentDownload] Descargando: ${name} (${type})`);
  console.log(`[AttachmentDownload] Bucket: ${bucket}, Path: ${path}`);

  try {
    // Estrategia 1: Descargar usando Supabase Storage API (preferido)
    if (bucket && path) {
      const { data, error } = await supabase.storage
        .from(bucket)
        .download(path);

      if (!error && data) {
        const buffer = Buffer.from(await data.arrayBuffer());
        
        console.log(`[AttachmentDownload] ✓ Descargado desde Storage: ${name} (${buffer.length} bytes)`);
        
        return {
          originalname: name,
          mimetype: type || 'application/octet-stream',
          buffer,
        };
      } else {
        console.warn(`[AttachmentDownload] Error en Storage API:`, error?.message);
      }
    }

    // Estrategia 2: Descargar desde URL pública (fallback)
    if (url) {
      console.log(`[AttachmentDownload] Intentando descarga desde URL: ${url}`);
      
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 30000, // 30 segundos
        headers: {
          'User-Agent': 'AL-E-Core/1.0'
        }
      });

      const buffer = Buffer.from(response.data);
      
      console.log(`[AttachmentDownload] ✓ Descargado desde URL: ${name} (${buffer.length} bytes)`);
      
      return {
        originalname: name,
        mimetype: type || response.headers['content-type'] || 'application/octet-stream',
        buffer,
      };
    }

    console.error(`[AttachmentDownload] No se pudo descargar ${name}: sin bucket/path ni URL válida`);
    return null;

  } catch (err) {
    console.error(`[AttachmentDownload] Error descargando ${name}:`, err);
    return null;
  }
}

/**
 * Descarga múltiples attachments en paralelo
 */
export async function downloadAttachments(attachments: AttachmentMetadata[]): Promise<DownloadedAttachment[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  console.log(`[AttachmentDownload] Iniciando descarga de ${attachments.length} attachment(s)`);

  const downloadPromises = attachments.map(att => downloadAttachment(att));
  const results = await Promise.all(downloadPromises);

  // Filtrar resultados nulos (descargas fallidas)
  const downloaded = results.filter((r): r is DownloadedAttachment => r !== null);

  console.log(`[AttachmentDownload] Descargados exitosamente: ${downloaded.length}/${attachments.length}`);

  return downloaded;
}

/**
 * Valida que un attachment tenga los campos requeridos
 */
export function validateAttachment(att: any): att is AttachmentMetadata {
  if (!att || typeof att !== 'object') return false;
  
  // Debe tener al menos (bucket + path) o url
  const hasBucketPath = typeof att.bucket === 'string' && typeof att.path === 'string';
  const hasUrl = typeof att.url === 'string';
  
  if (!hasBucketPath && !hasUrl) return false;
  
  // Debe tener name y type
  if (typeof att.name !== 'string' || typeof att.type !== 'string') return false;
  
  return true;
}
