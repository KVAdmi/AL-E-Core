/**
 * =====================================================
 * TOOL HANDLERS - Knowledge & RAG
 * =====================================================
 * 
 * Implementaciones de herramientas para:
 * - Buscar en knowledge base interna
 * - Consultar embeddings vectoriales
 * - Recuperar chunks relevantes
 * =====================================================
 */

import { ToolResult } from '../registry';
import { createClient } from '@supabase/supabase-js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

let supabaseClient: any = null;

function getSupabaseClient() {
  if (!supabaseClient && SUPABASE_URL && SUPABASE_KEY) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabaseClient;
}

// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE SEARCH (RAG Interno)
// ═══════════════════════════════════════════════════════════════

export async function knowledgeSearchHandler(args: {
  query: string;
  limit?: number;
  threshold?: number;
}): Promise<ToolResult> {
  const { query, limit = 5, threshold = 0.7 } = args;
  
  try {
    console.log(`[TOOL] knowledge_search: "${query}"`);

    const supabase = getSupabaseClient();
    if (!supabase) {
      throw new Error('Supabase no configurado. Se requiere SUPABASE_URL y SUPABASE_SERVICE_KEY');
    }

    // 1. Generar embedding del query (usando HuggingFace)
    const embedding = await generateEmbedding(query);

    // 2. Búsqueda vectorial en Supabase
    const { data: chunks, error } = await supabase.rpc('match_knowledge_chunks', {
      query_embedding: embedding,
      match_threshold: threshold,
      match_count: limit
    });

    if (error) {
      throw new Error(`Supabase error: ${error.message}`);
    }

    // 3. Formatear resultados
    const results = chunks?.map((chunk: any) => ({
      content: chunk.content,
      metadata: chunk.metadata,
      similarity: chunk.similarity,
      source: chunk.source_url || 'knowledge_base'
    })) || [];

    const data = {
      query,
      resultsCount: results.length,
      results
    };

    return {
      success: true,
      data,
      source: 'AL-E Knowledge Base',
      timestamp: new Date().toISOString(),
      provider: 'internal'
    };
  } catch (error: any) {
    console.error('[TOOL] knowledge_search error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'internal'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Generar Embedding
// ═══════════════════════════════════════════════════════════════

async function generateEmbedding(text: string): Promise<number[]> {
  const HF_API_KEY = process.env.HF_API_KEY;
  const HF_MODEL = process.env.HF_EMBEDDING_MODEL || 'BAAI/bge-m3';

  if (!HF_API_KEY) {
    throw new Error('HF_API_KEY no configurado');
  }

  const axios = require('axios');
  
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

  // HuggingFace retorna un array de embeddings
  return response.data[0] || response.data;
}
