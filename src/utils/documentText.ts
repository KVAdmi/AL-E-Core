import * as pdfParseModule from "pdf-parse";
import mammoth from "mammoth";
import vision from '@google-cloud/vision';

// pdf-parse usa default export
const pdfParse = (pdfParseModule as any).default || pdfParseModule;
const visionClient = new vision.ImageAnnotatorClient();

export type UploadedFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
};

export type ExtractedDocument = {
  name: string;
  type: string;
  text: string;
};

/**
 * Extrae texto de archivos subidos (PDF, DOCX, TXT, CSV, JSON, MD, IMÁGENES con OCR)
 */
export async function extractTextFromFiles(files: UploadedFile[]): Promise<ExtractedDocument[]> {
  const docs: ExtractedDocument[] = [];

  for (const f of files || []) {
    const name = f.originalname || "documento";
    const type = f.mimetype || "application/octet-stream";

    try {
      // TXT / CSV / JSON / MD
      if (type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(name)) {
        const text = f.buffer.toString("utf8");
        console.log(`[ATTACHMENTS][TEXT] ${name}: ${text.length} caracteres`);
        docs.push({ name, type, text });
        continue;
      }

      // IMÁGENES - OCR con Google Vision
      if (type.startsWith("image/")) {
        console.log(`[ATTACHMENTS][OCR] Procesando imagen: ${name} (${type})`);
        
        try {
          const [result] = await visionClient.textDetection(f.buffer);
          const detectedText = result.fullTextAnnotation?.text || '';
          
          if (detectedText.trim()) {
            console.log(`[ATTACHMENTS][OCR] ✓ ${name}: ${detectedText.length} caracteres extraídos`);
            docs.push({ 
              name, 
              type, 
              text: `[IMAGEN CON TEXTO DETECTADO VÍA OCR]\n\n${detectedText}` 
            });
          } else {
            console.log(`[ATTACHMENTS][OCR] ⚠️ ${name}: No se detectó texto en la imagen`);
            docs.push({ 
              name, 
              type, 
              text: '[IMAGEN: No se detectó texto visible. Puede ser una imagen sin texto, logo, gráfico, etc.]' 
            });
          }
        } catch (ocrError: any) {
          console.error(`[ATTACHMENTS][OCR] ❌ Error en OCR de ${name}:`, ocrError.message);
          docs.push({ 
            name, 
            type, 
            text: `[ERROR EN OCR: ${ocrError.message}. Google Vision API no pudo procesar la imagen.]` 
          });
        }
        continue;
      }

      // PDF
      if (type === "application/pdf" || /\.pdf$/i.test(name)) {
        const parsed = await pdfParse(f.buffer);
        const text = (parsed.text || "").trim();
        console.log(`[ATTACHMENTS][PDF] ${name}: ${text.length} caracteres extraídos`);
        docs.push({ name, type, text });
        continue;
      }

      // DOCX
      if (
        type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        /\.docx$/i.test(name)
      ) {
        const res = await mammoth.extractRawText({ buffer: f.buffer });
        const text = (res.value || "").trim();
        console.log(`[ATTACHMENTS][DOCX] ${name}: ${text.length} caracteres extraídos`);
        docs.push({ name, type, text });
        continue;
      }

      // fallback para archivos no soportados
      console.warn(`[ATTACHMENTS] Tipo no soportado: ${name} (${type})`);
      docs.push({
        name,
        type,
        text: `[No se pudo extraer texto automáticamente de este archivo: ${name} (${type}). Formatos soportados: PDF, DOCX, TXT, CSV, JSON, MD, IMÁGENES (PNG/JPG/JPEG/WEBP con OCR).]`,
      });
    } catch (err) {
      console.error(`[ATTACHMENTS] ❌ Error procesando archivo ${name}:`, err);
      docs.push({
        name,
        type,
        text: `[Error al procesar archivo: ${name}. ${err instanceof Error ? err.message : String(err)}]`,
      });
    }
  }

  console.log(`[ATTACHMENTS] ✓ Total procesado: ${docs.length} archivo(s)`);
  return docs;
}

/**
 * Convierte documentos extraídos a un bloque de contexto para el prompt
 */
export function documentsToContext(docs: ExtractedDocument[]): string {
  if (!docs.length) return "";

  return docs
    .map((d, i) => {
      // Limitar a 30,000 caracteres por documento para no reventar tokens
      const safe = (d.text || "").slice(0, 30000);
      return `\n[DOCUMENTO ${i + 1}] ${d.name} (${d.type})\n${safe}\n`;
    })
    .join("\n");
}
