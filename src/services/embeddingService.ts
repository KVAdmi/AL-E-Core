/**
 * =====================================================
 * EMBEDDING SERVICE - BGE-M3
 * =====================================================
 * Genera embeddings usando bge-m3 via Hugging Face Inference API
 * Dimensión: 1024
 */

import { HfInference } from '@huggingface/inference';

const hf = new HfInference(process.env.HUGGINGFACE_API_KEY);

const BGE_MODEL = 'BAAI/bge-m3';

/**
 * Genera embedding para un texto usando bge-m3
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    console.log(`[EMBEDDINGS] Generando para: ${text.substring(0, 100)}...`);
    
    const result = await hf.featureExtraction({
      model: BGE_MODEL,
      inputs: text
    });
    
    // El resultado puede ser un array o un array de arrays
    const embedding = Array.isArray(result[0]) ? result[0] : result;
    
    console.log(`[EMBEDDINGS] ✅ Generado: ${embedding.length} dimensiones`);
    
    return embedding as number[];
    
  } catch (error: any) {
    console.error('[EMBEDDINGS] ❌ Error:', error);
    throw new Error(`Failed to generate embedding: ${error.message}`);
  }
}

/**
 * Genera embeddings para múltiples textos (batch)
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  console.log(`[EMBEDDINGS] Generando batch de ${texts.length} embeddings...`);
  
  const embeddings: number[][] = [];
  
  // Procesar en secuencia para evitar rate limits
  for (const text of texts) {
    const embedding = await generateEmbedding(text);
    embeddings.push(embedding);
    
    // Pequeño delay para no saturar API
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`[EMBEDDINGS] ✅ Batch completado: ${embeddings.length} embeddings`);
  
  return embeddings;
}

/**
 * Convierte array de números a formato pgvector STRING
 * ⚠️ SOLO para inserción en DB, NUNCA para búsqueda RPC
 */
export function arrayToVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * @deprecated NO USAR PARA BÚSQUEDA. Solo para legacy/inserción.
 * Para búsqueda usa: generateEmbedding() → devuelve number[] directamente
 */
export async function generateVectorString(text: string): Promise<string> {
  const embedding = await generateEmbedding(text);
  return arrayToVector(embedding);
}
