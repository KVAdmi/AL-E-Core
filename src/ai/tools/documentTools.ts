/**
 * =====================================================
 * DOCUMENT ANALYSIS TOOLS - AL-E CORE
 * =====================================================
 * 
 * Herramientas para que AL-E pueda:
 * - Leer y analizar PDFs
 * - Extraer datos de Excel/CSV
 * - Analizar documentos Word
 * - Extraer texto de imágenes (OCR)
 * - Identificar números clave, riesgos, compromisos
 * 
 * =====================================================
 */

import { supabase } from '../../db/supabase';
import axios from 'axios';
import * as pdfjsLib from 'pdfjs-dist';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

export interface DocumentAnalysisResult {
  success: boolean;
  documentType: 'pdf' | 'excel' | 'word' | 'image' | 'unknown';
  extractedText?: string;
  tables?: any[][];
  numbers?: Array<{ value: number; context: string }>;
  dates?: Array<{ date: string; context: string }>;
  keyFindings?: string[];
  risks?: string[];
  commitments?: string[];
  summary?: string;
  error?: string;
}

/**
 * Analiza un PDF y extrae texto, tablas y datos clave
 */
export async function analyzePDF(
  fileUrl: string
): Promise<DocumentAnalysisResult> {
  try {
    console.log('[DOCUMENT TOOLS] 📄 Analizando PDF:', fileUrl);
    
    // Descargar PDF
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    const pdfData = new Uint8Array(response.data);
    
    // Cargar PDF con pdf.js
    const loadingTask = pdfjsLib.getDocument({ data: pdfData });
    const pdf = await loadingTask.promise;
    
    let fullText = '';
    const numbers: Array<{ value: number; context: string }> = [];
    
    // Extraer texto de cada página
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      fullText += pageText + '\n\n';
    }
    
    // Analizar contenido
    const analysis = analyzeTextContent(fullText);
    
    return {
      success: true,
      documentType: 'pdf',
      extractedText: fullText,
      ...analysis
    };
    
  } catch (error: any) {
    console.error('[DOCUMENT TOOLS] ❌ Error analizando PDF:', error);
    return {
      success: false,
      documentType: 'pdf',
      error: error.message
    };
  }
}

/**
 * Analiza un archivo Excel y extrae datos, tablas y números
 */
export async function analyzeExcel(
  fileUrl: string
): Promise<DocumentAnalysisResult> {
  try {
    console.log('[DOCUMENT TOOLS] 📊 Analizando Excel:', fileUrl);
    
    // Descargar archivo
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    
    // Parsear Excel
    const workbook = XLSX.read(response.data, { type: 'array' });
    
    const tables: any[][] = [];
    let fullText = '';
    const numbers: Array<{ value: number; context: string }> = [];
    
    // Procesar cada hoja
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      
      // Convertir a JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      tables.push(jsonData as any[][]);
      
      // Extraer texto
      const sheetText = XLSX.utils.sheet_to_txt(worksheet);
      fullText += `\n=== ${sheetName} ===\n${sheetText}\n`;
      
      // Extraer números
      (jsonData as any[][]).forEach((row, rowIndex) => {
        row.forEach((cell, colIndex) => {
          if (typeof cell === 'number') {
            const context = `Hoja: ${sheetName}, Fila: ${rowIndex + 1}, Col: ${colIndex + 1}`;
            numbers.push({ value: cell, context });
          }
        });
      });
    });
    
    // Analizar contenido
    const analysis = analyzeTextContent(fullText);
    
    return {
      success: true,
      documentType: 'excel',
      extractedText: fullText,
      tables,
      numbers,
      ...analysis
    };
    
  } catch (error: any) {
    console.error('[DOCUMENT TOOLS] ❌ Error analizando Excel:', error);
    return {
      success: false,
      documentType: 'excel',
      error: error.message
    };
  }
}

/**
 * Analiza un documento Word y extrae texto
 */
export async function analyzeWord(
  fileUrl: string
): Promise<DocumentAnalysisResult> {
  try {
    console.log('[DOCUMENT TOOLS] 📝 Analizando Word:', fileUrl);
    
    // Descargar archivo
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    
    // Extraer texto con mammoth
    const result = await mammoth.extractRawText({ buffer: response.data });
    const fullText = result.value;
    
    // Analizar contenido
    const analysis = analyzeTextContent(fullText);
    
    return {
      success: true,
      documentType: 'word',
      extractedText: fullText,
      ...analysis
    };
    
  } catch (error: any) {
    console.error('[DOCUMENT TOOLS] ❌ Error analizando Word:', error);
    return {
      success: false,
      documentType: 'word',
      error: error.message
    };
  }
}

/**
 * Extrae texto de una imagen usando OCR
 */
export async function extractTextFromImage(
  imageUrl: string
): Promise<DocumentAnalysisResult> {
  try {
    console.log('[DOCUMENT TOOLS] 🔍 Extrayendo texto de imagen:', imageUrl);
    
    // P0: Descargar imagen con axios (más robusto que fetch en Node.js)
    console.log('[DOCUMENT TOOLS] 📥 Descargando imagen con axios...');
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 segundos
      headers: {
        'User-Agent': 'AL-E-Core/1.0'
      }
    });
    
    const imageBuffer = Buffer.from(imageResponse.data);
    console.log('[DOCUMENT TOOLS] ✅ Imagen descargada:', imageBuffer.byteLength, 'bytes');
    
    // OCR con buffer
    const result = await Tesseract.recognize(imageBuffer, 'spa', {
      logger: (m) => console.log('[OCR]', m)
    });
    
    const fullText = result.data.text;
    
    // Analizar contenido
    const analysis = analyzeTextContent(fullText);
    
    return {
      success: true,
      documentType: 'image',
      extractedText: fullText,
      ...analysis
    };
    
  } catch (error: any) {
    console.error('[DOCUMENT TOOLS] ❌ Error descargando imagen:', error.message);
    console.error('[DOCUMENT TOOLS] ❌ Error en OCR:', error);
    
    // 🔴 P0: Detectar error de permisos (bucket privado o signed URL expirada)
    if (error.response?.status === 400 || error.response?.status === 404 || error.response?.status === 403 || error.response?.status === 401) {
      console.error('[DOCUMENT TOOLS] 🔒 Error de acceso: HTTP', error.response.status);
      return {
        success: false,
        documentType: 'image',
        error: 'No pude acceder al archivo (URL expirada o sin permisos). Reintenta subiendo la imagen nuevamente.'
      };
    }
    
    return {
      success: false,
      documentType: 'image',
      error: `No se pudo descargar la imagen: ${error.message}`
    };
  }
}

/**
 * Analiza texto y extrae insights clave
 */
function analyzeTextContent(text: string): {
  numbers: Array<{ value: number; context: string }>;
  dates: Array<{ date: string; context: string }>;
  keyFindings: string[];
  risks: string[];
  commitments: string[];
  summary: string;
} {
  const lower = text.toLowerCase();
  
  // Extraer números con contexto
  const numberMatches = text.match(/\$?\d{1,3}(,?\d{3})*(\.\d{2})?/g) || [];
  const numbers = numberMatches.slice(0, 20).map(match => ({
    value: parseFloat(match.replace(/[$,]/g, '')),
    context: extractContext(text, match)
  }));
  
  // Extraer fechas
  const datePatterns = [
    /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/g,
    /\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/gi
  ];
  
  const dates: Array<{ date: string; context: string }> = [];
  datePatterns.forEach(pattern => {
    const matches = text.match(pattern) || [];
    matches.forEach(match => {
      dates.push({
        date: match,
        context: extractContext(text, match)
      });
    });
  });
  
  // Identificar hallazgos clave
  const keyFindings: string[] = [];
  const riskKeywords = ['riesgo', 'problema', 'crítico', 'urgente', 'falla', 'error'];
  const commitmentKeywords = ['compromiso', 'entrega', 'plazo', 'deadline', 'vencimiento'];
  
  const sentences = text.split(/[.!?]\n/).filter(s => s.trim().length > 20);
  
  sentences.forEach(sentence => {
    const lowerSent = sentence.toLowerCase();
    
    // Hallazgos importantes (contienen números grandes o palabras clave)
    if (/\d{4,}/.test(sentence) || /importante|clave|principal|destacar/.test(lowerSent)) {
      if (keyFindings.length < 5) {
        keyFindings.push(sentence.trim());
      }
    }
  });
  
  // Identificar riesgos
  const risks = sentences
    .filter(s => riskKeywords.some(kw => s.toLowerCase().includes(kw)))
    .slice(0, 5);
  
  // Identificar compromisos
  const commitments = sentences
    .filter(s => commitmentKeywords.some(kw => s.toLowerCase().includes(kw)))
    .slice(0, 5);
  
  // Generar resumen ejecutivo
  const summary = generateSummary(text, keyFindings, numbers);
  
  return {
    numbers,
    dates,
    keyFindings,
    risks,
    commitments,
    summary
  };
}

/**
 * Extrae contexto alrededor de un match
 */
function extractContext(text: string, match: string, contextLength = 50): string {
  const index = text.indexOf(match);
  if (index === -1) return match;
  
  const start = Math.max(0, index - contextLength);
  const end = Math.min(text.length, index + match.length + contextLength);
  
  return text.substring(start, end).trim();
}

/**
 * Genera resumen ejecutivo del documento
 */
function generateSummary(
  text: string,
  keyFindings: string[],
  numbers: Array<{ value: number; context: string }>
): string {
  const wordCount = text.split(/\s+/).length;
  const largeNumbers = numbers.filter(n => n.value >= 1000).slice(0, 3);
  
  let summary = `Documento de ${wordCount} palabras. `;
  
  if (keyFindings.length > 0) {
    summary += `Hallazgos principales: ${keyFindings[0]}. `;
  }
  
  if (largeNumbers.length > 0) {
    summary += `Números destacados: ${largeNumbers.map(n => `$${n.value.toLocaleString()}`).join(', ')}. `;
  }
  
  return summary;
}

/**
 * Endpoint unificado para analizar cualquier documento
 */
export async function analyzeDocument(
  fileUrl: string,
  fileType?: string
): Promise<DocumentAnalysisResult> {
  try {
    // Detectar tipo si no se especifica
    if (!fileType) {
      if (fileUrl.includes('.pdf')) fileType = 'pdf';
      else if (fileUrl.match(/\.(xlsx?|csv)/)) fileType = 'excel';
      else if (fileUrl.match(/\.(docx?)/)) fileType = 'word';
      else if (fileUrl.match(/\.(png|jpg|jpeg|gif|bmp)/)) fileType = 'image';
    }
    
    // Ejecutar análisis según tipo
    switch (fileType) {
      case 'pdf':
        return await analyzePDF(fileUrl);
      case 'excel':
      case 'xlsx':
      case 'csv':
        return await analyzeExcel(fileUrl);
      case 'word':
      case 'docx':
        return await analyzeWord(fileUrl);
      case 'image':
      case 'png':
      case 'jpg':
      case 'jpeg':
        return await extractTextFromImage(fileUrl);
      default:
        return {
          success: false,
          documentType: 'unknown',
          error: 'Tipo de documento no soportado'
        };
    }
    
  } catch (error: any) {
    return {
      success: false,
      documentType: 'unknown',
      error: error.message
    };
  }
}

/**
 * Definiciones de herramientas para el LLM
 */
export const DOCUMENT_TOOLS_DEFINITIONS = [
  {
    name: 'analyze_document',
    description: 'Analiza un documento (PDF, Excel, Word o imagen) y extrae texto, números clave, fechas, riesgos y hallazgos importantes.',
    parameters: {
      type: 'object',
      properties: {
        fileUrl: {
          type: 'string',
          description: 'URL del documento a analizar'
        },
        fileType: {
          type: 'string',
          enum: ['pdf', 'excel', 'word', 'image'],
          description: 'Tipo de documento (opcional, se detecta automáticamente)'
        }
      },
      required: ['fileUrl']
    }
  },
  {
    name: 'extract_text_from_image',
    description: 'Extrae texto de una imagen usando OCR. Útil para leer facturas escaneadas, screenshots, contratos en imagen.',
    parameters: {
      type: 'object',
      properties: {
        imageUrl: {
          type: 'string',
          description: 'URL de la imagen a procesar'
        }
      },
      required: ['imageUrl']
    }
  }
];
