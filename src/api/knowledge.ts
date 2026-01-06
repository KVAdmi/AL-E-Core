/**
 * =====================================================
 * KNOWLEDGE API - BÚSQUEDA RAG
 * =====================================================
 * 
 * Endpoint para buscar en el Knowledge Core
 * Stack: bge-m3 + pgvector + Supabase
 * =====================================================
 */

import express from 'express';
import { searchKnowledge } from '../services/knowledgeIngest';
import { processDocument } from '../services/documentParser';
import { analyzeImage } from '../services/visionService';
import { generateEmbeddingsBatch, arrayToVector } from '../services/embeddingService';
import { processEmbeddingQueue, getEmbeddingStats } from '../workers/embeddingWorker';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = express.Router();
const upload = multer({ dest: '/tmp/uploads/' });

// ═══════════════════════════════════════════════════════════════
// POST /api/knowledge/search - Búsqueda semántica
// ═══════════════════════════════════════════════════════════════

router.post('/search', async (req, res) => {
  try {
    const { query, limit = 5, threshold = 0.7 } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_QUERY',
        message: 'Campo "query" es requerido'
      });
    }
    
    console.log('[KNOWLEDGE] 🔍 Búsqueda:', query);
    
    // Preprocesar query (keyword extraction para queries largas)
    const { preprocessQuery, mergeSearchResults } = await import('../services/queryPreprocessor');
    const preprocessed = preprocessQuery(query);
    
    const { generateEmbedding } = await import('../services/embeddingService');
    const { supabase } = await import('../db/supabase');
    
    let allResults: any[] = [];
    
    // Búsqueda 1: Query original
    const queryEmbedding = await generateEmbedding(preprocessed.original);
    
    // GUARDRAILS: Validar que el embedding sea correcto
    if (!Array.isArray(queryEmbedding)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMBEDDING',
        message: 'query_embedding must be number[]'
      });
    }
    
    if (queryEmbedding.length !== 1024) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_EMBEDDING_DIM',
        message: `query_embedding must have 1024 dimensions, got ${queryEmbedding.length}`
      });
    }
    
    const { data: results1, error: error1 } = await supabase.rpc('search_knowledge', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit
    });
    
    if (error1) {
      console.error('[KNOWLEDGE] ❌ Error en búsqueda:', error1);
      throw error1;
    }
    
    allResults = results1 || [];
    
    // Búsqueda 2: Keywords (si aplica)
    if (preprocessed.shouldMerge && preprocessed.keywords) {
      console.log('[KNOWLEDGE] 🔍 Keywords extraction:', preprocessed.keywords);
      
      const keywordsEmbedding = await generateEmbedding(preprocessed.keywords);
      
      const { data: results2 } = await supabase.rpc('search_knowledge', {
        query_embedding: keywordsEmbedding,
        match_threshold: threshold * 0.8, // Threshold más bajo para keywords
        match_count: limit
      });
      
      if (results2 && results2.length > 0) {
        allResults = mergeSearchResults(allResults, results2);
        console.log('[KNOWLEDGE] 🔗 Merged results:', allResults.length);
      }
    }
    
    // Limitar a los top K
    const finalResults = allResults.slice(0, limit);
    
    // Log mínimo para producción (no spam)
    console.log(`[KNOWLEDGE] ✅ Search: embedding_len=${queryEmbedding.length}, threshold=${threshold}, results=${finalResults.length}`);
    
    // Si no hay resultados arriba del threshold
    if (!finalResults || finalResults.length === 0) {
      return res.json({
        success: true,
        query,
        results: [],
        count: 0,
        has_results: false,
        message: 'No tengo evidencia suficiente en la base. Necesito que ingieras el documento relevante.'
      });
    }
    
    return res.json({
      success: true,
      query,
      results: finalResults,
      count: finalResults.length,
      has_results: true
    });
    
  } catch (error: any) {
    console.error('[KNOWLEDGE] ❌ Error en búsqueda:', error);
    return res.status(500).json({
      success: false,
      error: 'SEARCH_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/knowledge/ingest - Ingestar documento/imagen
// ═══════════════════════════════════════════════════════════════

router.post('/ingest', upload.single('file'), async (req, res) => {
  try {
    const { sourceType, repo, branch, workspaceId } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_FILE',
        message: 'Debes subir un archivo'
      });
    }
    
    console.log('[KNOWLEDGE] 📥 Ingesting:', file.originalname);
    
    const ext = path.extname(file.originalname).toLowerCase();
    let text = '';
    let metadata: any = {
      filename: file.originalname,
      size: file.size,
      type: sourceType || 'upload'
    };
    
    // Si es imagen → Vision OCR
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp'].includes(ext)) {
      console.log('[KNOWLEDGE] 📸 Procesando imagen con Vision...');
      const imageBuffer = fs.readFileSync(file.path);
      const visionResult = await analyzeImage(imageBuffer);
      text = visionResult.fullText;
      metadata.vision = {
        requestId: visionResult.requestId,
        imageHash: visionResult.imageHash,
        entities: visionResult.entities,
        structured: visionResult.structured
      };
    }
    // Si es documento → Parser
    else if (['.pdf', '.docx', '.txt', '.md'].includes(ext)) {
      console.log('[KNOWLEDGE] 📄 Procesando documento...');
      // Pasar extensión explícitamente porque multer usa nombres temporales
      const { parsed, chunks } = await processDocument(file.path, ext);
      text = parsed.text;
      metadata = { ...metadata, ...parsed.metadata };
      
      // Guardar chunks directamente
      const { supabase } = await import('../db/supabase');
      const sourceId = await saveSource(supabase, file.originalname, sourceType, repo, branch, text);
      const savedChunks = await saveChunks(supabase, sourceId, chunks, metadata);
      
      // Generar embeddings para los chunks
      console.log('[KNOWLEDGE] 🧠 Generando embeddings...');
      await generateEmbeddingsForChunks(supabase, savedChunks, chunks);
      
      // Limpiar archivo temporal
      fs.unlinkSync(file.path);
      
      return res.json({
        success: true,
        sourceId,
        chunksCount: savedChunks.length,
        filename: file.originalname,
        textLength: text.length
      });
    }
    else {
      fs.unlinkSync(file.path);
      return res.status(400).json({
        success: false,
        error: 'UNSUPPORTED_TYPE',
        message: `Tipo de archivo no soportado: ${ext}`
      });
    }
    
    // Para imágenes: guardar como chunk único
    const { supabase } = await import('../db/supabase');
    const sourceId = await saveSource(supabase, file.originalname, sourceType, repo, branch, text);
    const chunks = [text]; // Imagen = 1 chunk
    const savedChunks = await saveChunks(supabase, sourceId, chunks, metadata);
    
    // Generar embeddings
    console.log('[KNOWLEDGE] 🧠 Generando embeddings para imagen...');
    await generateEmbeddingsForChunks(supabase, savedChunks, chunks);
    
    // Limpiar archivo temporal
    fs.unlinkSync(file.path);
    
    console.log('[KNOWLEDGE] ✅ Ingesta completada');
    
    return res.json({
      success: true,
      sourceId,
      chunksCount: savedChunks.length,
      filename: file.originalname,
      textLength: text.length,
      vision: metadata.vision
    });
    
  } catch (error: any) {
    console.error('[KNOWLEDGE] ❌ Error:', error);
    
    // Limpiar archivo temporal si existe
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {}
    }
    
    return res.status(500).json({
      success: false,
      error: 'INGEST_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function saveSource(supabase: any, filename: string, type: string, repo: string | undefined, branch: string | undefined, content: string) {
  
  // Calcular source_hash (SHA-256 del contenido)
  const sourceHash = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
  
  // Verificar si ya existe
  const { data: existing, error: searchError } = await supabase
    .from('kb_sources')
    .select('id')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  
  if (searchError) {
    console.error('[KNOWLEDGE] ⚠️ Error verificando source_hash:', searchError);
    // Continuar sin idempotencia (no bloqueante)
  }
  
  if (existing) {
    console.log('[KNOWLEDGE] ℹ️ Source ya existe (source_hash match), reutilizando ID:', existing.id);
    return existing.id;
  }
  
  // Crear nuevo source
  const { data, error } = await supabase
    .from('kb_sources')
    .insert({
      type: type || 'upload',
      repo: repo || null,
      path: filename,
      content: content.substring(0, 10000), // Max 10k chars en source
      source_hash: sourceHash
    })
    .select('id')
    .single();
  
  if (error) throw error;
  return data.id;
}

async function saveChunks(supabase: any, sourceId: string, chunks: string[], metadata: any) {
  const chunksToInsert = chunks.map(content => ({
    source_id: sourceId,
    content,
    metadata,
    embedding_status: 'pending' // ← Estado explícito
  }));
  
  const { data, error } = await supabase
    .from('kb_chunks')
    .insert(chunksToInsert)
    .select('id');
  
  if (error) throw error;
  return data || [];
}

async function generateEmbeddingsForChunks(supabase: any, savedChunks: any[], chunkTexts: string[]) {
  try {
    // Generar embeddings en batch
    const embeddings = await generateEmbeddingsBatch(chunkTexts);
    
    // Guardar embeddings en kb_embeddings
    const embeddingsToInsert = savedChunks.map((chunk, index) => ({
      chunk_id: chunk.id,
      embedding: arrayToVector(embeddings[index])
    }));
    
    const { error } = await supabase
      .from('kb_embeddings')
      .insert(embeddingsToInsert);
    
    if (error) throw error;
    
    console.log(`[KNOWLEDGE] ✅ ${embeddings.length} embeddings guardados`);
  } catch (error: any) {
    console.error('[KNOWLEDGE] ⚠️ Error generando embeddings:', error);
    // No fallar la ingesta si los embeddings fallan
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/knowledge/stats - Estadísticas del Knowledge Core
// ═══════════════════════════════════════════════════════════════

router.get('/stats', async (req, res) => {
  try {
    const { supabase } = await import('../db/supabase');
    
    const { count: sourcesCount } = await supabase
      .from('kb_sources')
      .select('*', { count: 'exact', head: true });
    
    const { count: chunksCount } = await supabase
      .from('kb_chunks')
      .select('*', { count: 'exact', head: true });
    
    const { count: embeddingsCount } = await supabase
      .from('kb_embeddings')
      .select('*', { count: 'exact', head: true });
    
    return res.json({
      success: true,
      stats: {
        sources: sourcesCount || 0,
        chunks: chunksCount || 0,
        embeddings: embeddingsCount || 0
      }
    });
    
  } catch (error: any) {
    console.error('[KNOWLEDGE] ❌ Error obteniendo stats:', error);
    return res.status(500).json({
      success: false,
      error: 'STATS_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/knowledge/embeddings/process - Worker de Embeddings
// ═══════════════════════════════════════════════════════════════

router.post('/embeddings/process', async (req, res) => {
  try {
    const { batchSize = 50, retryErrors = false } = req.body;
    
    console.log(`[KNOWLEDGE] 🤖 Worker iniciado (batch=${batchSize}, retry=${retryErrors})`);
    
    // Obtener Supabase client (usando el global)
    const supabase = (req as any).supabase;
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'NO_SUPABASE_CLIENT'
      });
    }
    
    // Procesar queue
    const result = await processEmbeddingQueue(supabase, batchSize, retryErrors);
    
    console.log(`[KNOWLEDGE] ✅ Worker completado: ${result.ready} ready, ${result.errors} errors`);
    
    return res.json({
      success: result.success,
      processed: result.processed,
      ready: result.ready,
      errors: result.errors,
      errorDetails: result.errorDetails
    });
    
  } catch (error: any) {
    console.error('[KNOWLEDGE] ❌ Error en worker:', error);
    return res.status(500).json({
      success: false,
      error: 'WORKER_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/knowledge/health - Health Monitoring
// ═══════════════════════════════════════════════════════════════

router.get('/health', async (req, res) => {
  try {
    const supabase = (req as any).supabase;
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'NO_SUPABASE_CLIENT'
      });
    }
    
    // Stats de embeddings
    const stats = await getEmbeddingStats(supabase);
    
    // Coverage
    const coverage = stats.total_chunks > 0 
      ? Math.round((stats.ready / stats.total_chunks) * 100 * 10) / 10 
      : 100;
    
    // Status
    let status = 'healthy';
    if (stats.pending > 0 || stats.error > 0) {
      status = 'degraded';
    }
    if (stats.processing > 0) {
      status = 'processing';
    }
    
    return res.json({
      status,
      coverage,
      healthy: stats.healthy,
      total_chunks: stats.total_chunks,
      ready: stats.ready,
      pending: stats.pending,
      processing: stats.processing,
      errors: stats.error
    });
    
  } catch (error: any) {
    console.error('[KNOWLEDGE] ❌ Error en health check:', error);
    return res.status(500).json({
      success: false,
      error: 'HEALTH_CHECK_ERROR',
      message: error.message
    });
  }
});

export default router;
