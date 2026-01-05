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

const router = express.Router();

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
    
    const results = await searchKnowledge(query, limit);
    
    console.log('[KNOWLEDGE] ✅ Encontrados:', results.length, 'resultados');
    
    // Filtrar por threshold
    const filtered = results.filter((r: any) => r.score >= threshold);
    
    return res.json({
      success: true,
      query,
      results: filtered,
      count: filtered.length,
      has_results: filtered.length > 0
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
