/**
 * Chunking inteligente para entrenamiento estructural de AL-E
 * 
 * Principio: Dividir documentos en fragmentos recuperables sin perder contexto
 */

export type TextChunk = {
  index: number;
  content: string;
  charStart: number;
  charEnd: number;
};

export type ChunkingConfig = {
  chunkSize: number;      // Caracteres por chunk (800-1500 recomendado)
  overlap: number;        // Caracteres de overlap (100-200 recomendado)
  minChunkSize: number;   // Mínimo para considerar un chunk válido
};

const DEFAULT_CONFIG: ChunkingConfig = {
  chunkSize: 1200,
  overlap: 150,
  minChunkSize: 100,
};

/**
 * Divide texto en chunks con overlap para mantener contexto
 * 
 * @param text - Texto completo a dividir
 * @param config - Configuración de chunking (opcional)
 * @returns Array de chunks con índice y posición
 */
export function chunkText(text: string, config: Partial<ChunkingConfig> = {}): TextChunk[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const chunks: TextChunk[] = [];
  
  if (!text || text.trim().length === 0) {
    return chunks;
  }

  const cleanText = text.trim();
  let start = 0;
  let index = 0;

  while (start < cleanText.length) {
    const end = Math.min(start + cfg.chunkSize, cleanText.length);
    let chunkContent = cleanText.slice(start, end);

    // Si no es el último chunk y no termina en límite natural, buscar punto de corte
    if (end < cleanText.length) {
      const lastPeriod = chunkContent.lastIndexOf('. ');
      const lastNewline = chunkContent.lastIndexOf('\n');
      const lastBreak = Math.max(lastPeriod, lastNewline);

      // Si encontramos un punto de corte natural y no está muy cerca del inicio
      if (lastBreak > cfg.chunkSize * 0.5) {
        chunkContent = chunkContent.slice(0, lastBreak + 1).trim();
      }
    }

    // Solo agregar si cumple mínimo
    if (chunkContent.length >= cfg.minChunkSize) {
      chunks.push({
        index,
        content: chunkContent,
        charStart: start,
        charEnd: start + chunkContent.length,
      });
      index++;
    }

    // Mover start con overlap
    start += chunkContent.length - cfg.overlap;
    
    // Prevenir loops infinitos
    if (start <= chunks[chunks.length - 1]?.charStart) {
      start = chunks[chunks.length - 1].charEnd;
    }
  }

  return chunks;
}

/**
 * Estima la cantidad de chunks que generará un texto
 */
export function estimateChunks(textLength: number, config: Partial<ChunkingConfig> = {}): number {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const effectiveChunkSize = cfg.chunkSize - cfg.overlap;
  return Math.ceil(textLength / effectiveChunkSize);
}

/**
 * Valida si un texto es apropiado para chunking
 */
export function validateTextForChunking(text: string): { valid: boolean; reason?: string } {
  if (!text || typeof text !== 'string') {
    return { valid: false, reason: 'Texto vacío o inválido' };
  }

  const trimmed = text.trim();
  
  if (trimmed.length < DEFAULT_CONFIG.minChunkSize) {
    return { 
      valid: false, 
      reason: `Texto demasiado corto (${trimmed.length} chars, mínimo ${DEFAULT_CONFIG.minChunkSize})` 
    };
  }

  return { valid: true };
}
