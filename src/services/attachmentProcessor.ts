/**
 * ATTACHMENT PROCESSOR
 * Procesa attachments: PDFs, imágenes, DOCX
 */

import vision from '@google-cloud/vision';
import mammoth from 'mammoth';
import axios from 'axios';

const visionClient = new vision.ImageAnnotatorClient();

export interface AttachmentProcessResult {
  success: boolean;
  type: 'pdf' | 'image' | 'docx' | 'unsupported';
  text?: string;
  error?: string;
}

/**
 * Procesa un attachment y extrae su contenido
 */
export async function processAttachment(
  url: string,
  mimeType: string
): Promise<AttachmentProcessResult> {
  try {
    console.log(`[ATTACHMENT] Processing: ${mimeType}`);
    
    // Descargar archivo
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);
    
    // PDF
    if (mimeType === 'application/pdf') {
      const pdfParse = await import('pdf-parse');
      const data = await pdfParse(buffer);
      return {
        success: true,
        type: 'pdf',
        text: data.text
      };
    }
    
    // Imágenes (PNG, JPG, JPEG, WEBP)
    if (mimeType.startsWith('image/')) {
      const [result] = await visionClient.textDetection(buffer);
      const text = result.fullTextAnnotation?.text || '';
      
      return {
        success: true,
        type: 'image',
        text: text || '[Imagen sin texto detectado]'
      };
    }
    
    // DOCX
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      return {
        success: true,
        type: 'docx',
        text: result.value
      };
    }
    
    return {
      success: false,
      type: 'unsupported',
      error: `Tipo de archivo no soportado: ${mimeType}`
    };
    
  } catch (error: any) {
    console.error('[ATTACHMENT] Error:', error);
    return {
      success: false,
      type: 'unsupported',
      error: error.message
    };
  }
}
