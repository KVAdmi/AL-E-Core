/**
 * =====================================================
 * ENDPOINT ENTERPRISE - Regenerar Embeddings
 * =====================================================
 * 
 * POST /api/knowledge/embeddings/regenerate
 * 
 * Busca chunks sin embeddings y genera con HuggingFace
 * =====================================================
 */

import { Router, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const HF_API_KEY = process.env.HF_API_KEY;
const HF_MODEL = process.env.HF_EMBEDDING_MODEL || 'BAAI/bge-m3';

let supabaseClient: any = null;

function getSupabaseClient() {
  if (!supabaseClient && SUPABASE_URL && SUPABASE_KEY) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabaseClient;
}

// ═══════════════════════════════════════════════════════════════
// REGENERAR EMBEDDINGS
// ═══════════════════════════════════════════════════════════════

router.post('/regenerate', async (req: Request, res: Response) => {
  try {
    console.log('[EMBEDDINGS] Iniciando regeneración...');

    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Supabase no configurado'
      });
    }

    if (!HF_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'HF_API_KEY no configurado'
      });
    }

    // 1. Buscar chunks sin embeddings
    const { data: chunks, error: fetchError } = await supabase
      .from('knowledge_chunks')
      .select('id, content')
      .is('embedding', null)
      .limit(100); // Procesar en batches de 100

    if (fetchError) {
      throw new Error(`Error fetching chunks: ${fetchError.message}`);
    }

    if (!chunks || chunks.length === 0) {
      return res.json({
        success: true,
        message: 'No hay chunks sin embeddings',
        processed: 0
      });
    }

    console.log(`[EMBEDDINGS] Encontrados ${chunks.length} chunks sin embeddings`);

    // 2. Generar embeddings en batch
    let processed = 0;
    let failed = 0;

    for (const chunk of chunks) {
      try {
        const embedding = await generateEmbedding(chunk.content);

        // Actualizar en DB
        const { error: updateError } = await supabase
          .from('knowledge_chunks')
          .update({ embedding })
          .eq('id', chunk.id);

        if (updateError) {
          console.error(`[EMBEDDINGS] Error actualizando chunk ${chunk.id}:`, updateError);
          failed++;
        } else {
          processed++;
        }

        // Rate limiting: esperar 500ms entre requests
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (embError: any) {
        console.error(`[EMBEDDINGS] Error generando embedding para chunk ${chunk.id}:`, embError.message);
        failed++;
      }
    }

    console.log(`[EMBEDDINGS] Regeneración completa: ${processed} exitosos, ${failed} fallidos`);

    return res.json({
      success: true,
      processed,
      failed,
      total: chunks.length
    });

  } catch (error: any) {
    console.error('[EMBEDDINGS] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// HELPER: Generar Embedding con HuggingFace
// ═══════════════════════════════════════════════════════════════

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await axios.post(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      { inputs: text },
      {
        headers: {
          'Authorization': `Bearer ${HF_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    // HuggingFace retorna array de embeddings
    return response.data[0] || response.data;
  } catch (error: any) {
    throw new Error(`HuggingFace API error: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// STATS ENDPOINT
// ═══════════════════════════════════════════════════════════════

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) {
      return res.status(500).json({
        success: false,
        error: 'Supabase no configurado'
      });
    }

    // Total chunks
    const { count: totalChunks } = await supabase
      .from('knowledge_chunks')
      .select('*', { count: 'exact', head: true });

    // Chunks sin embeddings
    const { count: missingEmbeddings } = await supabase
      .from('knowledge_chunks')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null);

    return res.json({
      success: true,
      stats: {
        totalChunks: totalChunks || 0,
        withEmbeddings: (totalChunks || 0) - (missingEmbeddings || 0),
        missingEmbeddings: missingEmbeddings || 0,
        coverage: totalChunks ? ((totalChunks - (missingEmbeddings || 0)) / totalChunks * 100).toFixed(2) + '%' : '0%'
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
