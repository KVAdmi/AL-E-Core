/**
 * =====================================================
 * KNOWLEDGE INGEST SERVICE
 * =====================================================
 * 
 * Pipeline de ingesta de conocimiento para RAG:
 * 1. Lee archivos .md del repo
 * 2. Chunking simple (por archivo o cada 500 tokens)
 * 3. Genera embeddings con bge-m3
 * 4. Guarda en Supabase (kb_sources, kb_chunks, kb_embeddings)
 * 
 * Stack: bge-m3 + pgvector + Supabase
 * =====================================================
 */

import { supabase } from '../db/supabase';
import fs from 'fs';
import path from 'path';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const CHUNK_SIZE = 500; // tokens aproximados por chunk
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || '';
const EMBEDDING_MODEL = 'BAAI/bge-m3'; // 1024 dimensions

// ═══════════════════════════════════════════════════════════════
// UTILIDADES DE CHUNKING
// ═══════════════════════════════════════════════════════════════

/**
 * Divide texto en chunks de ~500 tokens
 */
function chunkText(text: string, maxTokens: number = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  
  // Aproximación simple: 1 token ≈ 4 caracteres
  const maxChars = maxTokens * 4;
  
  // Dividir por párrafos primero
  const paragraphs = text.split(/\n\n+/);
  
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    if ((currentChunk + paragraph).length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      
      // Si el párrafo es muy largo, dividir por oraciones
      if (paragraph.length > maxChars) {
        const sentences = paragraph.split(/\. +/);
        for (const sentence of sentences) {
          if ((currentChunk + sentence).length > maxChars) {
            if (currentChunk) {
              chunks.push(currentChunk.trim());
            }
            currentChunk = sentence + '. ';
          } else {
            currentChunk += sentence + '. ';
          }
        }
      } else {
        currentChunk = paragraph + '\n\n';
      }
    } else {
      currentChunk += paragraph + '\n\n';
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// ═══════════════════════════════════════════════════════════════
// EMBEDDINGS CON BGE-M3
// ═══════════════════════════════════════════════════════════════

/**
 * Genera embedding usando Hugging Face Inference API
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(
      `https://api-inference.huggingface.co/pipeline/feature-extraction/${EMBEDDING_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: text,
          options: {
            wait_for_model: true
          }
        })
      }
    );
    
    if (!response.ok) {
      throw new Error(`Hugging Face API error: ${response.statusText}`);
    }
    
    const embedding = await response.json();
    
    // bge-m3 devuelve un array de arrays (por token), tomamos el promedio
    if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
      // Promedio de embeddings de tokens
      const dimension = embedding[0].length;
      const averaged = new Array(dimension).fill(0);
      
      for (const tokenEmb of embedding) {
        for (let i = 0; i < dimension; i++) {
          averaged[i] += tokenEmb[i];
        }
      }
      
      return averaged.map(val => val / embedding.length);
    }
    
    return embedding;
  } catch (error: any) {
    console.error('[KNOWLEDGE] Error generando embedding:', error);
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// INGESTA DE ARCHIVOS .MD
// ═══════════════════════════════════════════════════════════════

/**
 * Lee archivos .md recursivamente desde un directorio
 */
function readMarkdownFiles(dir: string): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  
  function traverse(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        // Skip node_modules, .git, dist
        if (!['node_modules', '.git', 'dist', 'build'].includes(entry.name)) {
          traverse(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          files.push({
            path: fullPath,
            content
          });
        } catch (error) {
          console.error(`[KNOWLEDGE] Error leyendo ${fullPath}:`, error);
        }
      }
    }
  }
  
  traverse(dir);
  return files;
}

/**
 * Ingesta UN archivo markdown
 */
export async function ingestMarkdownFile(filePath: string, content: string): Promise<void> {
  try {
    console.log(`[KNOWLEDGE] 📄 Ingiriendo: ${filePath}`);
    
    // 1. Crear source
    const { data: source, error: sourceError } = await supabase
      .from('kb_sources')
      .insert({
        type: 'doc',
        repo: 'AL-E-Core',
        path: filePath,
        content: content,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (sourceError) {
      console.error('[KNOWLEDGE] Error creando source:', sourceError);
      return;
    }
    
    // 2. Chunking
    const chunks = chunkText(content);
    console.log(`[KNOWLEDGE] ✂️  Generados ${chunks.length} chunks`);
    
    // 3. Generar embeddings y guardar
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // Crear chunk en DB
      const { data: chunkData, error: chunkError } = await supabase
        .from('kb_chunks')
        .insert({
          source_id: source.id,
          content: chunk,
          metadata: {
            chunk_index: i,
            file_path: filePath,
            chunk_size: chunk.length
          }
        })
        .select()
        .single();
      
      if (chunkError) {
        console.error('[KNOWLEDGE] Error creando chunk:', chunkError);
        continue;
      }
      
      // Generar embedding
      try {
        const embedding = await generateEmbedding(chunk);
        
        // Guardar embedding
        const { error: embError } = await supabase
          .from('kb_embeddings')
          .insert({
            chunk_id: chunkData.id,
            embedding: JSON.stringify(embedding) // pgvector acepta array o string
          });
        
        if (embError) {
          console.error('[KNOWLEDGE] Error guardando embedding:', embError);
        }
        
        console.log(`[KNOWLEDGE] ✅ Chunk ${i + 1}/${chunks.length} procesado`);
      } catch (error) {
        console.error(`[KNOWLEDGE] Error en embedding chunk ${i}:`, error);
      }
      
      // Rate limiting: esperar 100ms entre requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`[KNOWLEDGE] ✅ Archivo completado: ${filePath}`);
  } catch (error: any) {
    console.error('[KNOWLEDGE] Error en ingestMarkdownFile:', error);
  }
}

/**
 * Ingesta TODOS los archivos .md del repositorio
 */
export async function ingestAllMarkdownFiles(repoPath: string): Promise<void> {
  console.log('[KNOWLEDGE] 🚀 Iniciando ingesta de conocimiento...');
  console.log('[KNOWLEDGE] Repo path:', repoPath);
  
  const files = readMarkdownFiles(repoPath);
  console.log(`[KNOWLEDGE] 📚 Encontrados ${files.length} archivos .md`);
  
  for (const file of files) {
    await ingestMarkdownFile(file.path, file.content);
  }
  
  console.log('[KNOWLEDGE] 🎉 Ingesta completada!');
}

// ═══════════════════════════════════════════════════════════════
// BÚSQUEDA (para testing)
// ═══════════════════════════════════════════════════════════════

/**
 * Busca chunks relevantes por embedding
 */
export async function searchKnowledge(query: string, limit: number = 5): Promise<any[]> {
  try {
    // 1. Generar embedding del query
    const queryEmbedding = await generateEmbedding(query);
    
    // 2. Búsqueda por similitud coseno en pgvector
    const { data, error } = await supabase.rpc('search_knowledge', {
      query_embedding: JSON.stringify(queryEmbedding),
      match_threshold: 0.7,
      match_count: limit
    });
    
    if (error) {
      console.error('[KNOWLEDGE] Error en búsqueda:', error);
      return [];
    }
    
    return data || [];
  } catch (error: any) {
    console.error('[KNOWLEDGE] Error en searchKnowledge:', error);
    return [];
  }
}
