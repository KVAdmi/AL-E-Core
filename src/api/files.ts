/**
 * API de Ingesta de Archivos
 * 
 * Endpoint: POST /api/files/ingest
 * Propósito: Entrenamiento estructural de AL-E con documentos completos
 */

import express from 'express';
import multer from 'multer';
import { ingestFiles, listIngestedFiles } from '../services/fileIngestService';
import { getKnowledgeStats } from '../services/chunkRetrieval';
import { UploadedFile } from '../utils/documentText';

const router = express.Router();

// Configurar multer para subida de archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB por archivo (sin límite práctico)
    files: 10, // Hasta 10 archivos simultáneos
  },
  fileFilter: (req, file, cb) => {
    // Validar tipos de archivo permitidos
    const allowedMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
    ];

    const allowedExtensions = /\.(pdf|docx|txt|md|csv|json)$/i;

    if (allowedMimes.includes(file.mimetype) || allowedExtensions.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype} (${file.originalname})`));
    }
  },
});

/**
 * POST /api/files/ingest
 * 
 * Ingiere documentos completos para entrenamiento estructural
 */
router.post('/ingest', upload.array('files', 10), async (req, res) => {
  const startTime = Date.now();

  try {
    const files = (req.files as Express.Multer.File[]) || [];
    
    // Validar que haya archivos
    if (files.length === 0) {
      return res.status(400).json({
        error: 'NO_FILES',
        message: 'No se recibieron archivos para ingerir',
      });
    }

    // Extraer parámetros (pueden venir como string en multipart)
    const workspaceId = String(req.body.workspace_id || req.body.workspaceId || '').trim();
    const userId = req.body.user_id || req.body.userId || undefined;
    const projectId = req.body.project_id || req.body.projectId || undefined;

    // Validar workspace_id requerido
    if (!workspaceId) {
      return res.status(400).json({
        error: 'WORKSPACE_REQUIRED',
        message: 'workspace_id es requerido',
      });
    }

    console.log(`\n[FILES/INGEST] ==================== NUEVA INGESTA ====================`);
    console.log(`[FILES/INGEST] Archivos: ${files.length}`);
    console.log(`[FILES/INGEST] Workspace: ${workspaceId}`);
    console.log(`[FILES/INGEST] User: ${userId || 'N/A'}`);
    console.log(`[FILES/INGEST] Project: ${projectId || 'N/A'}`);

    // Convertir a formato UploadedFile
    const uploadedFiles: UploadedFile[] = files.map(f => ({
      originalname: f.originalname,
      mimetype: f.mimetype,
      buffer: f.buffer,
    }));

    // Ingerir archivos
    const summary = await ingestFiles({
      workspaceId,
      userId,
      projectId,
      files: uploadedFiles,
    });

    const duration = Date.now() - startTime;

    console.log(`[FILES/INGEST] Completado en ${duration}ms`);
    console.log(`[FILES/INGEST] Resultado: ${summary.successfulFiles}/${summary.totalFiles} archivos, ${summary.totalChunks} chunks`);

    // Respuesta exitosa
    return res.status(200).json({
      success: true,
      summary: {
        totalFiles: summary.totalFiles,
        successfulFiles: summary.successfulFiles,
        failedFiles: summary.totalFiles - summary.successfulFiles,
        totalChunks: summary.totalChunks,
      },
      results: summary.results,
      duration_ms: duration,
      message: `Ingesta completada: ${summary.successfulFiles} archivo(s), ${summary.totalChunks} fragmento(s) de conocimiento`,
    });

  } catch (err: any) {
    console.error('[FILES/INGEST] Error:', err);
    
    return res.status(500).json({
      success: false,
      error: 'INGEST_FAILED',
      message: 'Error al ingerir archivos',
      detail: err?.message || String(err),
    });
  }
});

/**
 * GET /api/files/list
 * 
 * Lista archivos ingeridos
 */
router.get('/list', async (req, res) => {
  try {
    const workspaceId = String(req.query.workspace_id || '').trim();
    const userId = req.query.user_id as string | undefined;
    const projectId = req.query.project_id as string | undefined;
    const limit = parseInt(String(req.query.limit || '50'));

    if (!workspaceId) {
      return res.status(400).json({
        error: 'WORKSPACE_REQUIRED',
        message: 'workspace_id es requerido',
      });
    }

    const files = await listIngestedFiles({
      workspaceId,
      userId,
      projectId,
      limit,
    });

    return res.status(200).json({
      success: true,
      count: files.length,
      files,
    });

  } catch (err: any) {
    console.error('[FILES/LIST] Error:', err);
    
    return res.status(500).json({
      success: false,
      error: 'LIST_FAILED',
      message: 'Error al listar archivos',
      detail: err?.message || String(err),
    });
  }
});

/**
 * GET /api/files/stats
 * 
 * Estadísticas de conocimiento ingerido
 */
router.get('/stats', async (req, res) => {
  try {
    const workspaceId = String(req.query.workspace_id || '').trim();
    const userId = req.query.user_id as string | undefined;

    if (!workspaceId) {
      return res.status(400).json({
        error: 'WORKSPACE_REQUIRED',
        message: 'workspace_id es requerido',
      });
    }

    const stats = await getKnowledgeStats(workspaceId, userId);

    return res.status(200).json({
      success: true,
      stats,
    });

  } catch (err: any) {
    console.error('[FILES/STATS] Error:', err);
    
    return res.status(500).json({
      success: false,
      error: 'STATS_FAILED',
      message: 'Error al obtener estadísticas',
      detail: err?.message || String(err),
    });
  }
});

export default router;
