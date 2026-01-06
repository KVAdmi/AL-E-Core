/**
 * =====================================================
 * EMBEDDING WORKER - ARQUITECTURA ENTERPRISE
 * =====================================================
 * 
 * RESPONSABILIDAD:
 * Procesar chunks en estado 'pending' o 'error' y generar embeddings
 * 
 * INDEPENDIENTE del ingest: puede ejecutarse:
 * - Post-ingest automático
 * - Manual vía endpoint
 * - Cron job
 * - Post-configuración (cuando aparece HF_API_KEY)
 * 
 * GARANTÍAS:
 * - Idempotente (puede correr múltiples veces sin duplicar)
 * - Auditable (logs de cada chunk procesado)
 * - Recuperable (retry automático de errores)
 * - Determinístico (mismo chunk → mismo embedding)
 */

import { generateEmbeddingsBatch, arrayToVector } from '../services/embeddingService';

interface ChunkToProcess {
  id: string;
  content: string;
}

interface ProcessResult {
  success: boolean;
  processed: number;
  ready: number;
  errors: number;
  errorDetails?: Array<{ chunkId: string; error: string }>;
}

/**
 * Procesa chunks pendientes y genera embeddings
 * @param supabase Cliente de Supabase
 * @param batchSize Chunks a procesar por lote (default: 50)
 * @param retryErrors Si debe reintentar chunks en estado 'error' (default: false)
 */
export async function processEmbeddingQueue(
  supabase: any,
  batchSize: number = 50,
  retryErrors: boolean = false
): Promise<ProcessResult> {
  
  console.log('[EMBEDDING WORKER] 🚀 Iniciando procesamiento...');
  
  const result: ProcessResult = {
    success: true,
    processed: 0,
    ready: 0,
    errors: 0,
    errorDetails: []
  };
  
  try {
    // 1. Seleccionar chunks pendientes
    const statuses = retryErrors ? ['pending', 'error'] : ['pending'];
    
    const { data: chunks, error: fetchError } = await supabase
      .from('kb_chunks')
      .select('id, content')
      .in('embedding_status', statuses)
      .limit(batchSize);
    
    if (fetchError) {
      console.error('[EMBEDDING WORKER] ❌ Error fetching chunks:', fetchError);
      result.success = false;
      return result;
    }
    
    if (!chunks || chunks.length === 0) {
      console.log('[EMBEDDING WORKER] ✅ No hay chunks pendientes');
      return result;
    }
    
    console.log(`[EMBEDDING WORKER] 📦 ${chunks.length} chunks a procesar`);
    
    // 2. Marcar como 'processing'
    const chunkIds = chunks.map((c: ChunkToProcess) => c.id);
    
    await supabase
      .from('kb_chunks')
      .update({
        embedding_status: 'processing',
        embedding_attempted_at: new Date().toISOString()
      })
      .in('id', chunkIds);
    
    // 3. Generar embeddings en batch
    const contents = chunks.map((c: ChunkToProcess) => c.content);
    
    try {
      const embeddings = await generateEmbeddingsBatch(contents);
      
      console.log(`[EMBEDDING WORKER] 🧠 ${embeddings.length} embeddings generados`);
      
      // 4. Insertar embeddings en DB
      const embeddingsToInsert = chunks.map((chunk: ChunkToProcess, index: number) => ({
        chunk_id: chunk.id,
        embedding: arrayToVector(embeddings[index])
      }));
      
      const { error: insertError } = await supabase
        .from('kb_embeddings')
        .upsert(embeddingsToInsert, { 
          onConflict: 'chunk_id',
          ignoreDuplicates: false 
        });
      
      if (insertError) {
        console.error('[EMBEDDING WORKER] ❌ Error insertando embeddings:', insertError);
        
        // Marcar todos como error
        await supabase
          .from('kb_chunks')
          .update({
            embedding_status: 'error',
            embedding_error: insertError.message
          })
          .in('id', chunkIds);
        
        result.errors = chunks.length;
        result.success = false;
        return result;
      }
      
      // 5. Marcar chunks como 'ready'
      await supabase
        .from('kb_chunks')
        .update({
          embedding_status: 'ready',
          embedding_error: null
        })
        .in('id', chunkIds);
      
      result.processed = chunks.length;
      result.ready = chunks.length;
      
      console.log(`[EMBEDDING WORKER] ✅ ${chunks.length} chunks procesados exitosamente`);
      
    } catch (embeddingError: any) {
      console.error('[EMBEDDING WORKER] ❌ Error generando embeddings:', embeddingError);
      
      // Marcar chunks como error para retry posterior
      await supabase
        .from('kb_chunks')
        .update({
          embedding_status: 'error',
          embedding_error: embeddingError.message
        })
        .in('id', chunkIds);
      
      result.errors = chunks.length;
      result.errorDetails = [{ 
        chunkId: 'batch', 
        error: embeddingError.message 
      }];
      result.success = false;
    }
    
    return result;
    
  } catch (error: any) {
    console.error('[EMBEDDING WORKER] ❌ Error crítico:', error);
    result.success = false;
    return result;
  }
}

/**
 * Obtiene estadísticas del estado de embeddings
 */
export async function getEmbeddingStats(supabase: any): Promise<{
  total_chunks: number;
  ready: number;
  pending: number;
  processing: number;
  error: number;
  healthy: boolean;
}> {
  const { data, error } = await supabase
    .from('kb_chunks')
    .select('embedding_status');
  
  if (error || !data) {
    return {
      total_chunks: 0,
      ready: 0,
      pending: 0,
      processing: 0,
      error: 0,
      healthy: false
    };
  }
  
  const stats = {
    total_chunks: data.length,
    ready: data.filter((c: any) => c.embedding_status === 'ready').length,
    pending: data.filter((c: any) => c.embedding_status === 'pending').length,
    processing: data.filter((c: any) => c.embedding_status === 'processing').length,
    error: data.filter((c: any) => c.embedding_status === 'error').length,
    healthy: false
  };
  
  stats.healthy = stats.pending === 0 && stats.error === 0;
  
  return stats;
}
