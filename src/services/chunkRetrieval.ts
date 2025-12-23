/**
 * Servicio de Recuperación de Chunks
 * 
 * Responsabilidad: Buscar y recuperar conocimiento entrenable de forma inteligente
 * Prioridad: user → project → workspace
 */

import { db as pool } from '../db/client';

export type ChunkSearchParams = {
  workspaceId: string;
  userId?: string;
  projectId?: string;
  query?: string;        // Para búsqueda futura con embeddings
  limit?: number;
  minImportance?: number;
};

export type RetrievedChunk = {
  id: string;
  fileId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  importance: number;
  createdAt: Date;
  relevanceScore?: number;
};

/**
 * Recupera chunks relevantes para una consulta
 * 
 * Estrategia actual: Basada en prioridad (user > project > workspace)
 * Estrategia futura: Basada en embeddings + similaridad semántica
 */
export async function retrieveRelevantChunks(params: ChunkSearchParams): Promise<RetrievedChunk[]> {
  const { workspaceId, userId, projectId, limit = 10, minImportance = 0.5 } = params;

  console.log('[ChunkRetrieval] Buscando chunks relevantes:', {
    workspaceId,
    userId: userId || 'N/A',
    projectId: projectId || 'N/A',
    limit,
  });

  // Por ahora: recuperación basada en prioridad y recencia
  // TODO: Implementar búsqueda semántica con embeddings
  
  const chunks: RetrievedChunk[] = [];

  // 1. Primero buscar chunks del usuario específico (máxima prioridad)
  if (userId) {
    const userChunks = await fetchChunksByContext({
      workspaceId,
      userId,
      limit: Math.floor(limit * 0.5), // 50% del límite
      minImportance,
    });
    chunks.push(...userChunks);
  }

  // 2. Luego buscar chunks del proyecto (prioridad media)
  if (projectId && chunks.length < limit) {
    const projectChunks = await fetchChunksByContext({
      workspaceId,
      projectId,
      limit: Math.floor(limit * 0.3), // 30% del límite
      minImportance,
    });
    chunks.push(...projectChunks);
  }

  // 3. Finalmente buscar chunks generales del workspace (prioridad baja)
  if (chunks.length < limit) {
    const workspaceChunks = await fetchChunksByContext({
      workspaceId,
      limit: limit - chunks.length,
      minImportance,
    });
    chunks.push(...workspaceChunks);
  }

  console.log(`[ChunkRetrieval] Recuperados ${chunks.length} chunks`);
  return chunks.slice(0, limit);
}

/**
 * Recupera chunks por contexto específico
 */
async function fetchChunksByContext(params: {
  workspaceId: string;
  userId?: string;
  projectId?: string;
  limit: number;
  minImportance: number;
}): Promise<RetrievedChunk[]> {
  const { workspaceId, userId, projectId, limit, minImportance } = params;

  let query = `
    SELECT 
      c.id,
      c.file_id,
      f.filename,
      c.chunk_index,
      c.content,
      c.importance,
      c.created_at
    FROM ae_chunks c
    INNER JOIN ae_files f ON f.id = c.file_id
    WHERE c.workspace_id = $1
      AND c.importance >= $2
  `;

  const queryParams: any[] = [workspaceId, minImportance];
  let paramIndex = 3;

  if (userId) {
    query += ` AND c.user_id_uuid = $${paramIndex}`;
    queryParams.push(userId);
    paramIndex++;
  }

  if (projectId) {
    query += ` AND c.project_id = $${paramIndex}`;
    queryParams.push(projectId);
    paramIndex++;
  }

  // Ordenar por importancia y recencia
  query += `
    ORDER BY c.importance DESC, c.created_at DESC
    LIMIT $${paramIndex};
  `;
  queryParams.push(limit);

  const { rows } = await pool.query(query, queryParams);

  return rows.map(row => ({
    id: row.id,
    fileId: row.file_id,
    filename: row.filename,
    chunkIndex: row.chunk_index,
    content: row.content,
    importance: parseFloat(row.importance),
    createdAt: new Date(row.created_at),
  }));
}

/**
 * Convierte chunks recuperados a contexto para el prompt
 */
export function chunksToContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return '';

  const header = `\n[CONOCIMIENTO ENTRENABLE]\nAL-E tiene acceso a ${chunks.length} fragmento(s) de conocimiento previamente ingerido:\n`;
  
  const content = chunks
    .map((chunk, i) => {
      const source = `${chunk.filename} (fragmento ${chunk.chunkIndex + 1})`;
      return `\n[FRAGMENTO ${i + 1}] Fuente: ${source}\n${chunk.content}\n`;
    })
    .join('\n---\n');

  const footer = `\n[FIN DEL CONOCIMIENTO ENTRENABLE]\n`;

  return header + content + footer;
}

/**
 * Busca chunks que contengan palabras clave (búsqueda simple por texto)
 * 
 * Útil mientras no tengamos embeddings
 */
export async function searchChunksByKeywords(params: {
  workspaceId: string;
  keywords: string[];
  userId?: string;
  projectId?: string;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const { workspaceId, keywords, userId, projectId, limit = 10 } = params;

  if (!keywords.length) {
    return retrieveRelevantChunks({ workspaceId, userId, projectId, limit });
  }

  // Construir condición de búsqueda con ILIKE (case-insensitive)
  const keywordConditions = keywords.map((_, i) => `c.content ILIKE $${i + 2}`).join(' OR ');

  let query = `
    SELECT 
      c.id,
      c.file_id,
      f.filename,
      c.chunk_index,
      c.content,
      c.importance,
      c.created_at
    FROM ae_chunks c
    INNER JOIN ae_files f ON f.id = c.file_id
    WHERE c.workspace_id = $1
      AND (${keywordConditions})
  `;

  const queryParams: any[] = [workspaceId, ...keywords.map(k => `%${k}%`)];
  let paramIndex = 2 + keywords.length;

  if (userId) {
    query += ` AND c.user_id_uuid = $${paramIndex}`;
    queryParams.push(userId);
    paramIndex++;
  }

  if (projectId) {
    query += ` AND c.project_id = $${paramIndex}`;
    queryParams.push(projectId);
    paramIndex++;
  }

  query += `
    ORDER BY c.importance DESC, c.created_at DESC
    LIMIT $${paramIndex};
  `;
  queryParams.push(limit);

  try {
    const { rows } = await pool.query(query, queryParams);

    return rows.map(row => ({
      id: row.id,
      fileId: row.file_id,
      filename: row.filename,
      chunkIndex: row.chunk_index,
      content: row.content,
      importance: parseFloat(row.importance),
      createdAt: new Date(row.created_at),
    }));
  } catch (err) {
    console.error('[ChunkRetrieval] Error en búsqueda por keywords:', err);
    return [];
  }
}

/**
 * Obtiene estadísticas de conocimiento ingerido
 */
export async function getKnowledgeStats(workspaceId: string, userId?: string): Promise<{
  totalFiles: number;
  totalChunks: number;
  avgChunksPerFile: number;
  totalCharacters: number;
}> {
  let query = `
    SELECT 
      COUNT(DISTINCT f.id) as total_files,
      COUNT(c.id) as total_chunks,
      SUM(LENGTH(c.content)) as total_characters
    FROM ae_files f
    LEFT JOIN ae_chunks c ON c.file_id = f.id
    WHERE f.workspace_id = $1
  `;

  const queryParams: any[] = [workspaceId];

  if (userId) {
    query += ` AND f.user_id_uuid = $2`;
    queryParams.push(userId);
  }

  const { rows } = await pool.query(query, queryParams);
  const row = rows[0];

  return {
    totalFiles: parseInt(row.total_files) || 0,
    totalChunks: parseInt(row.total_chunks) || 0,
    avgChunksPerFile: row.total_files > 0 ? parseInt(row.total_chunks) / parseInt(row.total_files) : 0,
    totalCharacters: parseInt(row.total_characters) || 0,
  };
}
