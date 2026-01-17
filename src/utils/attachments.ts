import axios from 'axios';
import * as pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { analyzeImage } from '../services/visionService';

export interface Attachment {
  name: string;
  type: string;
  url: string;
}

export interface ProcessedAttachment {
  name: string;
  type: string;
  content: string | { type: 'image_url'; image_url: { url: string } };
  error?: string;
  ocrText?: string;
  labels?: string[];
}

/**
 * Descarga un archivo desde una URL
 */
async function downloadFile(url: string): Promise<Buffer> {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 segundos
      maxContentLength: 50 * 1024 * 1024 // 50MB max
    });
    return Buffer.from(response.data);
  } catch (error) {
    throw new Error(`Error descargando archivo: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

/**
 * Extrae texto de un PDF
 */
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    const data = await (pdfParse as any)(buffer);
    return data.text.trim();
  } catch (error) {
    throw new Error(`Error extrayendo texto de PDF: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

/**
 * Extrae texto de un DOCX
 */
async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (error) {
    throw new Error(`Error extrayendo texto de DOCX: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

/**
 * Extrae texto de un archivo de texto plano
 */
function extractTextFromPlainText(buffer: Buffer): string {
  return buffer.toString('utf-8').trim();
}

/**
 * Detecta si el tipo MIME es una imagen soportada
 */
function isImageType(type: string): boolean {
  return ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'].includes(type.toLowerCase());
}

/**
 * Detecta si el tipo MIME es un documento de texto
 */
function isDocumentType(type: string): boolean {
  const docTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'text/plain',
    'text/markdown',
    'text/csv'
  ];
  return docTypes.includes(type.toLowerCase());
}

/**
 * Procesa un attachment y extrae su contenido
 * Ahora incluye OCR automático para imágenes
 */
export async function processAttachment(attachment: Attachment): Promise<ProcessedAttachment> {
  console.log(`[ATTACHMENTS] Procesando: ${attachment.name} (${attachment.type})`);
  
  try {
    // Si es imagen, aplicar OCR con Vision API
    if (isImageType(attachment.type)) {
      console.log(`[ATTACHMENTS] Imagen detectada: ${attachment.name} - Aplicando OCR con Google Vision`);
      
      try {
        // Descargar imagen
        const buffer = await downloadFile(attachment.url);
        
        // Analizar con Vision API
        const visionResult = await analyzeImage(buffer);
        
        console.log(`[ATTACHMENTS] ✅ OCR completado: ${visionResult.fullText.length} caracteres extraídos`);
        console.log(`[ATTACHMENTS] Entidades: ${visionResult.entities.length}`);
        
        // Formatear resultado para el LLM
        let content = `[Imagen: ${attachment.name}]\n\n`;
        
        if (visionResult.fullText && visionResult.fullText.length > 0) {
          content += `📝 Texto detectado (OCR):\n${visionResult.fullText}\n\n`;
        }
        
        if (visionResult.entities.length > 0) {
          const topEntities = visionResult.entities.slice(0, 5).map(e => e.description).join(', ');
          content += `🏷️ Contenido visual: ${topEntities}\n`;
        }
        
        // Agregar datos estructurados si existen
        if (visionResult.structured.emails.length > 0) {
          content += `📧 Emails detectados: ${visionResult.structured.emails.join(', ')}\n`;
        }
        if (visionResult.structured.urls.length > 0) {
          content += `🔗 URLs detectadas: ${visionResult.structured.urls.join(', ')}\n`;
        }
        
        return {
          name: attachment.name,
          type: attachment.type,
          content: content.trim(),
          ocrText: visionResult.fullText,
          labels: visionResult.entities.map(e => e.description)
        };
      } catch (visionError) {
        console.error(`[ATTACHMENTS] Error en Vision API:`, visionError);
        // Fallback: devolver referencia de imagen para visión multimodal
        return {
          name: attachment.name,
          type: attachment.type,
          content: {
            type: 'image_url',
            image_url: { url: attachment.url }
          },
          error: `OCR failed: ${visionError instanceof Error ? visionError.message : 'Unknown'}`
        };
      }
    }

    // Si es documento, descargar y extraer texto
    if (isDocumentType(attachment.type)) {
      const buffer = await downloadFile(attachment.url);
      let text: string;

      if (attachment.type === 'application/pdf') {
        text = await extractTextFromPDF(buffer);
      } else if (
        attachment.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        attachment.type === 'application/msword'
      ) {
        text = await extractTextFromDOCX(buffer);
      } else {
        // Texto plano
        text = extractTextFromPlainText(buffer);
      }

      if (!text || text.length === 0) {
        throw new Error('No se pudo extraer texto del documento');
      }

      console.log(`[ATTACHMENTS] Texto extraído: ${text.length} caracteres`);
      
      return {
        name: attachment.name,
        type: attachment.type,
        content: text
      };
    }

    // Tipo no soportado
    throw new Error(`Tipo de archivo no soportado: ${attachment.type}`);
    
  } catch (error) {
    console.error(`[ATTACHMENTS] Error procesando ${attachment.name}:`, error);
    return {
      name: attachment.name,
      type: attachment.type,
      content: '',
      error: error instanceof Error ? error.message : 'Error desconocido'
    };
  }
}

/**
 * Procesa múltiples attachments
 */
export async function processAttachments(attachments: Attachment[]): Promise<ProcessedAttachment[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  console.log(`[ATTACHMENTS] Procesando ${attachments.length} attachment(s)`);
  
  const results = await Promise.all(
    attachments.map(att => processAttachment(att))
  );

  const successful = results.filter(r => !r.error).length;
  const failed = results.filter(r => r.error).length;
  
  console.log(`[ATTACHMENTS] Procesados: ${successful} exitosos, ${failed} fallidos`);
  
  return results;
}

/**
 * Convierte attachments procesados en contexto para el prompt
 */
export function attachmentsToContext(processed: ProcessedAttachment[]): string {
  const textAttachments = processed.filter(
    p => !p.error && typeof p.content === 'string'
  );

  if (textAttachments.length === 0) {
    return '';
  }

  const contextBlocks = textAttachments.map(att => {
    return `DOCUMENTO_ADJUNTO: ${att.name}\n${'-'.repeat(50)}\n${att.content}\n${'-'.repeat(50)}\n`;
  });

  return '\n\n' + contextBlocks.join('\n\n');
}

/**
 * Extrae imágenes para mensajes multimodales (GPT-4 Vision)
 */
export function extractImageUrls(processed: ProcessedAttachment[]): Array<{ type: 'image_url'; image_url: { url: string } }> {
  return processed
    .filter(p => !p.error && typeof p.content === 'object' && p.content.type === 'image_url')
    .map(p => p.content as { type: 'image_url'; image_url: { url: string } });
}
