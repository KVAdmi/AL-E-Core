/**
 * =====================================================
 * GOOGLE VISION API - P0 EXPRESS
 * =====================================================
 * OCR + análisis de imágenes para RAG.
 * Extrae texto de screenshots, PDFs escaneados, etc.
 */

import vision from '@google-cloud/vision';
import crypto from 'crypto';

// Cliente de Vision API
const visionClient = new vision.ImageAnnotatorClient({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './al-eon-0e41ae57cf6f.json'
});

export interface VisionResult {
  fullText: string;
  entities: Array<{
    description: string;
    score: number;
  }>;
  structured: {
    emails: string[];
    dates: string[];
    urls: string[];
    numbers: string[];
  };
  requestId: string;
  imageHash: string;
}

/**
 * Analiza imagen y extrae texto + entidades
 */
export async function analyzeImage(imageInput: string | Buffer): Promise<VisionResult> {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  console.log(`[VISION] Iniciando análisis: ${requestId}`);
  
  try {
    // Preparar input
    let imageBuffer: Buffer;
    
    if (typeof imageInput === 'string') {
      // Si es base64
      if (imageInput.startsWith('data:image')) {
        const base64Data = imageInput.split(',')[1];
        imageBuffer = Buffer.from(base64Data, 'base64');
      } else if (imageInput.startsWith('http')) {
        // Si es URL (por ahora no implementado, agregar fetch si se necesita)
        throw new Error('URL images not implemented yet');
      } else {
        // Asumir base64 sin header
        imageBuffer = Buffer.from(imageInput, 'base64');
      }
    } else {
      imageBuffer = imageInput;
    }
    
    // Hash de la imagen (para deduplicación)
    const imageHash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    // Llamar Vision API con todas las features necesarias
    const [result] = await visionClient.annotateImage({
      image: { content: imageBuffer },
      features: [
        { type: 'TEXT_DETECTION' },
        { type: 'DOCUMENT_TEXT_DETECTION' },
        { type: 'LABEL_DETECTION' },
      ],
    });
    
    // Extraer texto completo
    const fullText = result.fullTextAnnotation?.text || '';
    
    // Extraer entidades (labels)
    const entities = (result.labelAnnotations || []).map(label => ({
      description: label.description || '',
      score: label.score || 0
    }));
    
    // Extraer datos estructurados con regex
    const structured = extractStructuredData(fullText);
    
    const duration = Date.now() - startTime;
    console.log(`[VISION] ✅ Completado en ${duration}ms: ${fullText.length} chars`);
    
    return {
      fullText,
      entities,
      structured,
      requestId,
      imageHash
    };
    
  } catch (error: any) {
    console.error(`[VISION] ❌ Error:`, error);
    throw new Error(`Vision API error: ${error.message}`);
  }
}

/**
 * Extrae datos estructurados del texto OCR
 */
function extractStructuredData(text: string): VisionResult['structured'] {
  // Emails
  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
  const emails = text.match(emailRegex) || [];
  
  // URLs
  const urlRegex = /https?:\/\/[^\s]+/g;
  const urls = text.match(urlRegex) || [];
  
  // Fechas (varios formatos)
  const dateRegex = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/g;
  const dates = text.match(dateRegex) || [];
  
  // Números relevantes (IDs, montos, etc.)
  const numberRegex = /\b\d{3,}\b/g;
  const numbers = text.match(numberRegex) || [];
  
  return {
    emails: [...new Set(emails)], // Deduplicar
    dates: [...new Set(dates)],
    urls: [...new Set(urls)],
    numbers: [...new Set(numbers)].slice(0, 10) // Max 10 números
  };
}

/**
 * Sanitiza PII (Personally Identifiable Information)
 * Por ahora solo básico, expandir si se necesita GDPR compliance
 */
export function sanitizePII(text: string): string {
  // Reemplazar emails
  let sanitized = text.replace(/[\w.-]+@[\w.-]+\.\w+/g, '[EMAIL_REDACTED]');
  
  // Reemplazar números de teléfono (formatos comunes)
  sanitized = sanitized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE_REDACTED]');
  
  // Reemplazar números de tarjetas (16 dígitos)
  sanitized = sanitized.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD_REDACTED]');
  
  return sanitized;
}

/**
 * Analiza imagen y retorna solo texto (helper rápido)
 */
export async function extractTextFromImage(imageInput: string | Buffer): Promise<string> {
  const result = await analyzeImage(imageInput);
  return result.fullText;
}
