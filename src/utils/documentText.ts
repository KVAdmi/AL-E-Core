import * as pdfParseModule from "pdf-parse";
import mammoth from "mammoth";

// pdf-parse usa default export
const pdfParse = (pdfParseModule as any).default || pdfParseModule;

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
 * Extrae texto de archivos subidos (PDF, DOCX, TXT, CSV, JSON, MD)
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
        docs.push({ name, type, text });
        continue;
      }

      // PDF
      if (type === "application/pdf" || /\.pdf$/i.test(name)) {
        const parsed = await pdfParse(f.buffer);
        const text = (parsed.text || "").trim();
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
        docs.push({ name, type, text });
        continue;
      }

      // fallback para archivos no soportados
      docs.push({
        name,
        type,
        text: `[No se pudo extraer texto automáticamente de este archivo: ${name} (${type}). Formatos soportados: PDF, DOCX, TXT, CSV, JSON, MD.]`,
      });
    } catch (err) {
      console.error(`[DocumentText] Error procesando archivo ${name}:`, err);
      docs.push({
        name,
        type,
        text: `[Error al procesar archivo: ${name}. ${err instanceof Error ? err.message : String(err)}]`,
      });
    }
  }

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
