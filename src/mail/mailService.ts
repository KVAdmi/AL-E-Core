/**
 * MAIL SERVICE - COMPLETAMENTE DESHABILITADO
 * 
 * ❌ ESTADO: SES DESHABILITADO POR POLÍTICA DE SEGURIDAD
 * 
 * Este servicio era para procesar correos inbound de AWS SES.
 * Ahora está bloqueado. Los correos personales van por Gmail/Outlook APIs.
 */

import { SES_BLOCKER } from '../utils/sesBlocker';

/**
 * Descarga un archivo .eml desde S3 - BLOQUEADO
 */
export async function downloadEmailFromS3(bucket: string, key: string, region?: string): Promise<Buffer> {
  SES_BLOCKER.throw('downloadEmailFromS3');
  throw new Error('SES_DISABLED');
}

/**
 * Genera URL firmada para descargar desde S3 - BLOQUEADO
 */
export async function generatePresignedUrl(bucket: string, key: string, region?: string, expiresIn = 3600): Promise<string> {
  SES_BLOCKER.throw('generatePresignedUrl');
  throw new Error('SES_DISABLED');
}

/**
 * Resuelve user_id basado en el destinatario del correo - BLOQUEADO
 */
export async function resolveUserId(toEmail: string): Promise<{ userId: string | null; accountId: string | null }> {
  SES_BLOCKER.throw('resolveUserId');
  throw new Error('SES_DISABLED');
}
