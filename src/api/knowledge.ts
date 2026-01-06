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
    
    // Generar embedding del query
    const { generateVectorString } = await import('../services/embeddingService');
    const queryEmbedding = await generateVectorString(query);
    
    // Buscar usando similitud coseno en pgvector
    const { supabase } = await import('../db/supabase');
    
    const { data, error } = await supabase.rpc('search_knowledge', {
      query_embedding: queryEmbedding,
      match_threshold: threshold,
      match_count: limit
    });
    
    if (error) {
      console.error('[KNOWLEDGE] ❌ Error en búsqueda:', error);
      throw error;
    }
    
    // Si no hay resultados arriba del threshold
    if (!data || data.length === 0) {
      return res.json({
        success: true,
        query,
        results: [],
        count: 0,
        has_results: false,
        message: 'No tengo evidencia suficiente en la base. Necesito que ingieras el documento relevante.'
      });
    }
    
    console.log('[KNOWLEDGE] ✅ Encontrados:', data.length, 'resultados');
    
    return res.json({
      success: true,
      query,
      results: data,
      count: data.length,
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
  const { data, error } = await supabase
    .from('kb_sources')
    .insert({
      type: type || 'upload',
      repo: repo || null,
      path: filename,
      content: content.substring(0, 10000) // Max 10k chars en source
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
    metadata
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

export default router;
