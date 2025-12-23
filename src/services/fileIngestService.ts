/**
 * Servicio de Ingesta Estructural de Documentos
 * 
 * Responsabilidad: Convertir documentos en conocimiento entrenable y recuperable
 * NO es chat con adjuntos. Es entrenamiento persistente.
 */

import { db as pool } from '../db/client';
import { chunkText, validateTextForChunking, estimateChunks } from '../utils/chunking';
import { extractTextFromFiles, UploadedFile, ExtractedDocument } from '../utils/documentText';

export type FileIngestRequest = {
  workspaceId: string;
  userId?: string;
  projectId?: string;
  files: UploadedFile[];
};

export type FileIngestResult = {
  fileId: string;
  filename: string;
  status: 'success' | 'partial' | 'error';
  chunksCreated: number;
  estimatedChunks: number;
  textLength: number;
  error?: string;
};

export type IngestSummary = {
  totalFiles: number;
  successfulFiles: number;
  totalChunks: number;
  results: FileIngestResult[];
};

/**
 * Ingiere documentos completos: extrae texto, chunkea y persiste
 */
export async function ingestFiles(request: FileIngestRequest): Promise<IngestSummary> {
  const { workspaceId, userId, projectId, files } = request;
  
  console.log(`[FileIngest] Iniciando ingesta: ${files.length} archivo(s)`);
  console.log(`[FileIngest] Workspace: ${workspaceId}, User: ${userId || 'N/A'}, Project: ${projectId || 'N/A'}`);

  // Extraer texto de todos los archivos
  const extractedDocs = await extractTextFromFiles(files);
  const results: FileIngestResult[] = [];

  for (const doc of extractedDocs) {
    try {
      const result = await ingestSingleDocument({
        workspaceId,
        userId,
        projectId,
        document: doc,
        originalFile: files.find(f => f.originalname === doc.name),
      });
      results.push(result);
    } catch (err) {
      console.error(`[FileIngest] Error ingiriendo ${doc.name}:`, err);
      results.push({
        fileId: '',
        filename: doc.name,
        status: 'error',
        chunksCreated: 0,
        estimatedChunks: 0,
        textLength: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: IngestSummary = {
    totalFiles: results.length,
    successfulFiles: results.filter(r => r.status === 'success').length,
    totalChunks: results.reduce((sum, r) => sum + r.chunksCreated, 0),
    results,
  };

  console.log(`[FileIngest] Completado: ${summary.successfulFiles}/${summary.totalFiles} archivos, ${summary.totalChunks} chunks`);
  return summary;
}

/**
 * Ingiere un documento individual
 */
async function ingestSingleDocument(params: {
  workspaceId: string;
  userId?: string;
  projectId?: string;
  document: ExtractedDocument;
  originalFile?: UploadedFile;
}): Promise<FileIngestResult> {
  const { workspaceId, userId, projectId, document, originalFile } = params;

  console.log(`[FileIngest] Procesando: ${document.name}`);

  // Validar texto
  const validation = validateTextForChunking(document.text);
  if (!validation.valid) {
    return {
      fileId: '',
      filename: document.name,
      status: 'error',
      chunksCreated: 0,
      estimatedChunks: 0,
      textLength: 0,
      error: validation.reason,
    };
  }

  const textLength = document.text.length;
  const estimated = estimateChunks(textLength);

  // 1. Guardar metadata del archivo en ae_files
  const fileId = await saveFileMetadata({
    workspaceId,
    userId,
    projectId,
    filename: document.name,
    mimetype: document.type,
    size: originalFile?.buffer.length || textLength,
  });

  // 2. Chunkear texto
  const chunks = chunkText(document.text);
  console.log(`[FileIngest] ${document.name}: ${chunks.length} chunks generados de ${textLength} caracteres`);

  if (chunks.length === 0) {
    return {
      fileId,
      filename: document.name,
      status: 'error',
      chunksCreated: 0,
      estimatedChunks: estimated,
      textLength,
      error: 'No se generaron chunks válidos',
    };
  }

  // 3. Persistir chunks en ae_chunks
  let savedChunks = 0;
  for (const chunk of chunks) {
    try {
      await saveChunk({
        fileId,
        workspaceId,
        userId,
        projectId,
        chunkIndex: chunk.index,
        content: chunk.content,
        importance: calculateImportance(chunk, chunks.length),
      });
      savedChunks++;
    } catch (err) {
      console.error(`[FileIngest] Error guardando chunk ${chunk.index} de ${document.name}:`, err);
    }
  }

  const status = savedChunks === chunks.length ? 'success' : savedChunks > 0 ? 'partial' : 'error';

  return {
    fileId,
    filename: document.name,
    status,
    chunksCreated: savedChunks,
    estimatedChunks: estimated,
    textLength,
  };
}

/**
 * Guarda metadata del archivo en ae_files
 */
async function saveFileMetadata(params: {
  workspaceId: string;
  userId?: string;
  projectId?: string;
  filename: string;
  mimetype: string;
  size: number;
}): Promise<string> {
  const { workspaceId, userId, projectId, filename, mimetype, size } = params;

  const { rows } = await pool.query(
    `
    INSERT INTO ae_files (workspace_id, user_id_uuid, project_id, filename, mimetype, size)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id;
    `,
    [workspaceId, userId || null, projectId || null, filename, mimetype, size]
  );

  return rows[0].id;
}

/**
 * Guarda un chunk en ae_chunks
 */
async function saveChunk(params: {
  fileId: string;
  workspaceId: string;
  userId?: string;
  projectId?: string;
  chunkIndex: number;
  content: string;
  importance: number;
}): Promise<void> {
  const { fileId, workspaceId, userId, projectId, chunkIndex, content, importance } = params;

  await pool.query(
    `
    INSERT INTO ae_chunks (file_id, workspace_id, user_id_uuid, project_id, chunk_index, content, importance)
    VALUES ($1, $2, $3, $4, $5, $6, $7);
    `,
    [fileId, workspaceId, userId || null, projectId || null, chunkIndex, content, importance]
  );
}

/**
 * Calcula importancia de un chunk (heurística simple)
 * 
 * Chunks iniciales y finales suelen tener más contexto
 */
function calculateImportance(chunk: { index: number; content: string }, totalChunks: number): number {
  const positionWeight = chunk.index === 0 || chunk.index === totalChunks - 1 ? 1.2 : 1.0;
  const lengthWeight = chunk.content.length > 1000 ? 1.1 : 1.0;
  
  return Math.min(positionWeight * lengthWeight, 2.0);
}

/**
 * Lista archivos ingeridos de un workspace/usuario/proyecto
 */
export async function listIngestedFiles(params: {
  workspaceId: string;
  userId?: string;
  projectId?: string;
  limit?: number;
}): Promise<any[]> {
  const { workspaceId, userId, projectId, limit = 50 } = params;

  let query = `
    SELECT 
      f.id,
      f.filename,
      f.mimetype,
      f.size,
      f.created_at,
      COUNT(c.id) as chunk_count
    FROM ae_files f
    LEFT JOIN ae_chunks c ON c.file_id = f.id
    WHERE f.workspace_id = $1
  `;

  const queryParams: any[] = [workspaceId];
  let paramIndex = 2;

  if (userId) {
    query += ` AND f.user_id_uuid = $${paramIndex}`;
    queryParams.push(userId);
    paramIndex++;
  }

  if (projectId) {
    query += ` AND f.project_id = $${paramIndex}`;
    queryParams.push(projectId);
    paramIndex++;
  }

  query += `
    GROUP BY f.id, f.filename, f.mimetype, f.size, f.created_at
    ORDER BY f.created_at DESC
    LIMIT $${paramIndex};
  `;
  queryParams.push(limit);

  const { rows } = await pool.query(query, queryParams);
  return rows;
}
