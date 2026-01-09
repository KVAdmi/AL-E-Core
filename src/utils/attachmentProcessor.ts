/**
 * ATTACHMENT PROCESSOR
 * 
 * CAPACIDADES REALES:
 * ✅ Extrae texto de imágenes con Google Vision OCR
 * ✅ Parsea PDFs y extrae contenido
 * ✅ Procesa documentos DOCX, TXT, MD
 * ✅ Descarga attachments desde Supabase Storage
 * 
 * AL-EON debe funcionar IGUAL que GitHub Copilot.
 */

import { analyzeImage } from '../services/visionService';
import { parseDocument } from '../services/documentParser';
import { downloadAttachment } from '../services/attachmentDownload';
import fs from 'fs';
import path from 'path';
import os from 'os';

export interface AttachmentMetadata {
  name?: string;
  type?: string;
  size?: number;
  url?: string;
  bucket?: string;
  path?: string;
  buffer?: Buffer; // Si ya viene en memoria
}

export interface ProcessedAttachment {
  filename: string;
  type: string;
  extractedText: string;
  metadata: {
    processingMethod: 'vision-ocr' | 'pdf-parse' | 'document-parse' | 'raw-text';
    originalSize?: number;
    textLength: number;
    error?: string;
  };
}

/**
 * Procesa un attachment y extrae su contenido
 */
export async function processAttachment(
  attachment: AttachmentMetadata
): Promise<ProcessedAttachment> {
  const filename = attachment.name || 'unknown';
  const type = attachment.type || 'application/octet-stream';
  
  console.log(`[ATTACHMENT] Procesando: ${filename} (${type})`);
  
  try {
    let buffer: Buffer;
    
    // 1. Obtener el buffer del archivo
    if (attachment.buffer) {
      buffer = attachment.buffer;
    } else if (attachment.bucket && attachment.path) {
      // Descargar desde Supabase
      const downloaded = await downloadAttachment({
        bucket: attachment.bucket,
        path: attachment.path,
        name: filename,
        type: type,
        url: attachment.url
      });
      
      if (!downloaded) {
        throw new Error('No se pudo descargar el attachment');
      }
      
      buffer = downloaded.buffer;
    } else if (attachment.url) {
      // Descargar desde URL externa
      const response = await fetch(attachment.url);
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } else {
      throw new Error('No se proporcionó buffer, bucket/path, ni URL');
    }
    
    // 2. Detectar tipo y procesar según corresponda
    const ext = path.extname(filename).toLowerCase();
    let extractedText = '';
    let processingMethod: ProcessedAttachment['metadata']['processingMethod'] = 'raw-text';
    
    // IMÁGENES → Google Vision OCR
    if (type.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
      console.log(`[ATTACHMENT] Usando Google Vision OCR para: ${filename}`);
      
      try {
        const visionResult = await analyzeImage(buffer);
        extractedText = visionResult.fullText;
        processingMethod = 'vision-ocr';
        
        // Verificar si realmente se extrajo texto
        if (!extractedText || extractedText.trim().length === 0) {
          throw new Error('OCR completado pero no se detectó texto legible en la imagen');
        }
        
        // Agregar entidades detectadas
        if (visionResult.entities.length > 0) {
          extractedText += '\n\n[Entidades detectadas]: ' + 
            visionResult.entities.map(e => e.description).join(', ');
        }
      } catch (visionError: any) {
        // Capturar error específico de Vision API
        throw new Error(`Fallo en OCR de imagen: ${visionError.message}`);
      }
    }
    
    // PDFs / DOCX / TXT → Document Parser
    else if (['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
      console.log(`[ATTACHMENT] Parseando documento: ${filename}`);
      
      // Guardar temporalmente en disco para los parsers
      const tmpPath = path.join(os.tmpdir(), `ale-${Date.now()}-${filename}`);
      fs.writeFileSync(tmpPath, buffer);
      
      try {
        const parsed = await parseDocument(tmpPath);
        extractedText = parsed.text;
        processingMethod = ext === '.pdf' ? 'pdf-parse' : 'document-parse';
        
        // Verificar si realmente se extrajo texto
        if (!extractedText || extractedText.trim().length === 0) {
          throw new Error(`Documento procesado pero está vacío o no contiene texto extraíble. ${ext === '.pdf' ? 'Puede ser un PDF escaneado sin OCR.' : ''}`);
        }
      } catch (parseError: any) {
        // Limpiar y propagar error
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
        throw new Error(`Fallo al procesar documento ${ext}: ${parseError.message}`);
      } finally {
        // Limpiar archivo temporal
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      }
    }
    
    // Texto plano directo
    else if (type.startsWith('text/')) {
      extractedText = buffer.toString('utf-8');
      processingMethod = 'raw-text';
    }
    
    // Tipo no soportado
    else {
      console.warn(`[ATTACHMENT] Tipo no soportado: ${type} (${ext})`);
      throw new Error(`Tipo de archivo no soportado: ${type}. Formatos soportados: imágenes (JPG, PNG, GIF), PDF, DOCX, TXT, MD.`);
    }
    
    console.log(`[ATTACHMENT] ✅ Procesado: ${filename} → ${extractedText.length} caracteres`);
    
    return {
      filename,
      type,
      extractedText,
      metadata: {
        processingMethod,
        originalSize: buffer.length,
        textLength: extractedText.length
      }
    };
    
  } catch (error: any) {
    console.error(`[ATTACHMENT] ❌ Error procesando ${filename}:`, error.message);
    
    return {
      filename,
      type,
      extractedText: `[Error procesando archivo: ${error.message}]`,
      metadata: {
        processingMethod: 'raw-text',
        textLength: 0,
        error: error.message
      }
    };
  }
}

/**
 * Procesa múltiples attachments en paralelo
 */
export async function processAttachments(
  attachments: AttachmentMetadata[]
): Promise<ProcessedAttachment[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  
  console.log(`[ATTACHMENT] Procesando ${attachments.length} archivo(s)...`);
  
  const results = await Promise.all(
    attachments.map(att => processAttachment(att))
  );
  
  const successCount = results.filter(r => !r.metadata.error).length;
  console.log(`[ATTACHMENT] ✅ ${successCount}/${attachments.length} archivos procesados exitosamente`);
  
  return results;
}

/**
 * Genera el mensaje de contexto para inyectar en el prompt
 */
export function generateAttachmentContext(
  processedAttachments: ProcessedAttachment[]
): string {
  if (processedAttachments.length === 0) {
    return '';
  }
  
  let context = '\n\n╔════════════════════════════════════════════════════════════════╗\n';
  context += '║  📎 ARCHIVOS ADJUNTOS PROCESADOS                               ║\n';
  context += '╚════════════════════════════════════════════════════════════════╝\n\n';
  
  for (const attachment of processedAttachments) {
    context += `📄 Archivo: ${attachment.filename}\n`;
    context += `   Tipo: ${attachment.type}\n`;
    context += `   Método: ${attachment.metadata.processingMethod}\n`;
    context += `   Tamaño: ${attachment.metadata.textLength} caracteres extraídos\n\n`;
    
    if (attachment.metadata.error) {
      // DECLARACIÓN EXPLÍCITA DE ERROR
      context += `   ⚠️ IMPORTANTE: No fue posible procesar este archivo.\n`;
      context += `   Motivo: ${attachment.metadata.error}\n\n`;
      context += `   INSTRUCCIÓN PARA TI:\n`;
      context += `   - Declara explícitamente que no pudiste procesar este archivo\n`;
      context += `   - Indica el motivo técnico\n`;
      context += `   - Pide al usuario que describa el contenido O\n`;
      context += `   - Sugiere revisión humana O\n`;
      context += `   - Consulta otra fuente si está disponible\n`;
      context += `   - NUNCA inventes o inferas su contenido\n\n`;
    } else {
      context += `   ✅ Contenido extraído exitosamente:\n`;
      context += `   ${'-'.repeat(60)}\n`;
      context += `   ${attachment.extractedText.substring(0, 5000)}\n`;
      if (attachment.extractedText.length > 5000) {
        context += `   [...contenido truncado, ${attachment.extractedText.length - 5000} caracteres restantes]\n`;
      }
      context += `   ${'-'.repeat(60)}\n\n`;
    }
  }
  
  context += '═'.repeat(66) + '\n';
  context += 'INSTRUCCIONES GENERALES:\n';
  context += '- Usa el contenido extraído para responder\n';
  context += '- Si algún archivo tuvo error, decláalo explícitamente\n';
  context += '- NUNCA inventes contenido de archivos que no pudiste procesar\n';
  context += '- Si necesitas más información, pregunta al usuario\n';
  context += '═'.repeat(66) + '\n';
  
  return context;
}
