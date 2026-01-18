/**
 * TRUTH CHAT API - ENDPOINT CON TRUTH LAYER
 * 
 * Endpoint de testing para el nuevo pipeline Truth Layer + Authority Matrix.
 * Una vez validado, puede reemplazar /api/ai/chat
 */

import express from 'express';
import { optionalAuth, getUserId, getUserEmail } from '../middleware/auth';
import { getSimpleOrchestrator } from '../ai/simpleOrchestrator';
import { supabase } from '../db/supabase';
import { executeTool } from '../ai/tools/toolRouter';

const router = express.Router();

const looksLikeTimeOrDateQuestion = (text: string): boolean => {
  const t = (text || '').toLowerCase();
  // Español informal + variantes comunes
  return (
    /\b(que\s*)?hora\b/.test(t) ||
    /\bhoras\b/.test(t) ||
    /\bfecha\b/.test(t) ||
    /\bd[ií]a\s+es\s+hoy\b/.test(t) ||
    /\b(que\s*)?d[ií]a\b/.test(t) ||
    /\bhoy\b/.test(t)
  );
};

const formatNowMx = (): { iso: string; pretty: string } => {
  // Usamos el server time, pero lo expresamos en timezone de MX.
  // Nota: MX tiene múltiples zonas; por default usamos America/Mexico_City.
  const now = new Date();
  const timeZone = 'America/Mexico_City';
  const pretty = new Intl.DateTimeFormat('es-MX', {
    timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(now);
  return { iso: now.toISOString(), pretty };
};

/**
 * POST /api/ai/truth-chat
 * POST /api/ai/chat (NUEVO - reemplaza el viejo con Truth Layer)
 * 
 * Endpoint con Truth Orchestrator + Authority Matrix + Logs estructurados
 * 
 * Body:
 * - messages: Array<{role, content}>
 * - userId: string
 * - userConfirmed: boolean (opcional)
 */
const handleTruthChat = async (req: express.Request, res: express.Response) => {
  const startTime = Date.now();
  
  try {
    console.log('[TRUTH CHAT] ===============================================');
    console.log('[TRUTH CHAT] Nueva solicitud con Truth Layer');
    console.log('[TRUTH CHAT] Body keys:', Object.keys(req.body).join(', '));
    console.log('[TRUTH CHAT] Body:', JSON.stringify(req.body, null, 2).substring(0, 500));
    
    // Obtener userId
    const authenticatedUserId = getUserId(req);
    const bodyUserId = req.body.userId || req.body.user_id;
    const userId = authenticatedUserId || bodyUserId;
    
    // Obtener userEmail
    const userEmail = getUserEmail(req);
    
    console.log('[TRUTH CHAT] User ID resolved:', userId);
    console.log('[TRUTH CHAT] User Email resolved:', userEmail || 'N/A');
    
    if (!userId) {
      console.log('[TRUTH CHAT] ERROR: No userId found');
      return res.status(400).json({
        error: 'userId is required',
        wasBlocked: true,
      });
    }
    
  // Validar messages
  const { messages, userConfirmed, attachments } = req.body;
    
    console.log('[TRUTH CHAT] Messages type:', typeof messages);
    console.log('[TRUTH CHAT] Messages is array:', Array.isArray(messages));
    console.log('[TRUTH CHAT] Messages length:', messages?.length);
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.log('[TRUTH CHAT] ERROR: Invalid messages array');
      return res.status(400).json({
        error: 'messages must be a non-empty array',
        wasBlocked: true,
      });
    }
    
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
      return res.status(400).json({
        error: 'Last message must be from user',
        wasBlocked: true,
      });
    }
    
    const userMessage = lastMessage.content;

    // ============================================
    // P0 GUARDRail: Hora/fecha SIEMPRE desde server-time
    // (sin LLM, sin tools, sin web_search)
    // ============================================
    if (looksLikeTimeOrDateQuestion(userMessage)) {
      const { iso, pretty } = formatNowMx();
      const elapsedTime = Date.now() - startTime;

      console.log('[TRUTH CHAT] P0: Responding with server time (MX) - no tools');

      return res.json({
        answer: `Son las ${pretty}. (Server time: ${iso})`,
        toolsUsed: [],
        executionTime: elapsedTime,
        metadata: {
          request_id: `req-${Date.now()}`,
          timestamp: new Date().toISOString(),
          model: 'server-time',
          tools_executed: 0,
          source: 'TruthChatGuardrail'
        },
        debug: {
          tools_detail: [],
          guardrail: 'server_time_for_datetime'
        }
      });
    }

    // ============================================
    // P0 GUARDRail: Si hay attachments, forzar analyze_document
    // (evita respuestas tipo "no veo tu documento")
    // ============================================
    const safeAttachments = Array.isArray(attachments) ? attachments : [];
    if (safeAttachments.length > 0) {
      console.log('[TRUTH CHAT] P0: Attachments received, forcing analyze_document');

      // Tomamos el primer attachment como P0 (evitar costos altos); más adelante podemos iterar.
      const att = safeAttachments[0] || {};
      let fileUrl: string | null = null;
      const fileType: string | undefined = att.type || att.mimeType || undefined;
      const fileName: string | undefined = att.name || undefined;

      // 1) Si viene URL directa (attachments unificados)
      if (typeof att.url === 'string' && att.url.trim()) {
        fileUrl = att.url.trim();
      }
      if (!fileUrl && typeof att.signedUrl === 'string' && att.signedUrl.trim()) {
        fileUrl = att.signedUrl.trim();
      }

      // 2) Si es Supabase Storage: bucket + path → signed URL
      if (!fileUrl && typeof att.bucket === 'string' && typeof att.path === 'string') {
        const bucket = String(att.bucket);
        const path = String(att.path);
        console.log(`[TRUTH CHAT] Attachment looks like Supabase Storage: ${bucket}/${path}`);

        const { data: signed, error: signedErr } = await supabase.storage
          .from(bucket)
          .createSignedUrl(path, 60 * 10); // 10 min

        if (signedErr) {
          console.error('[TRUTH CHAT] Error creating signed URL:', signedErr);
        } else {
          fileUrl = signed?.signedUrl || null;
        }
      }

      if (!fileUrl) {
        return res.status(428).json({
          error: 'ATTACHMENT_ANALYSIS_REQUIRED',
          safe_message:
            'Recibí el attachment, pero no viene una URL/ruta usable para analizarlo. Reintenta adjuntándolo de nuevo.',
          details: {
            attachments_received: safeAttachments.length,
            first_attachment_keys: Object.keys(att || {})
          },
          wasBlocked: true
        });
      }

      // Ejecutar tool sin depender del LLM
      const toolResult = await executeTool(userId, {
        name: 'analyze_document',
        parameters: {
          fileUrl,
          fileType
        }
      });

      if (!toolResult.success) {
        return res.status(428).json({
          error: 'ATTACHMENT_ANALYSIS_FAILED',
          safe_message:
            'Pude ver el archivo, pero falló el análisis automático. Intenta con otro formato o vuelve a subirlo.',
          details: {
            fileName,
            fileType,
            error: toolResult.error
          },
          wasBlocked: true
        });
      }

      const elapsedTime = Date.now() - startTime;
      return res.json({
        answer:
          `Listo, analicé el documento${fileName ? ` "${fileName}"` : ''}.
\n\nResumen: ${toolResult.data?.summary || 'Sin resumen disponible.'}
\n\nHallazgos clave: ${Array.isArray(toolResult.data?.keyFindings) ? toolResult.data.keyFindings.join('; ') : 'N/A'}
\n\nRiesgos: ${Array.isArray(toolResult.data?.risks) ? toolResult.data.risks.join('; ') : 'N/A'}`,
        toolsUsed: ['analyze_document'],
        executionTime: elapsedTime,
        metadata: {
          request_id: `req-${Date.now()}`,
          timestamp: new Date().toISOString(),
          model: 'tool-only',
          tools_executed: 1,
          source: 'TruthChatGuardrail'
        },
        debug: {
          tools_detail: [
            {
              name: 'analyze_document',
              status: 'executed',
              timestamp: new Date().toISOString(),
              input: {
                fileUrl: fileUrl.substring(0, 120) + (fileUrl.length > 120 ? '…' : ''),
                fileType,
                fileName
              }
            }
          ]
        }
      });
    }
    
    console.log('[CHAT] User ID:', userId);
    console.log('[CHAT] User Email:', userEmail || 'N/A');
    console.log('[CHAT] Message:', userMessage.substring(0, 100));
    
    // 🔥 SIMPLE ORCHESTRATOR - Como GitHub Copilot
    const orchestrator = await getSimpleOrchestrator();
    
    // Ejecutar
    const result = await orchestrator.orchestrate({
      userMessage,
      userId,
      userEmail,
      conversationHistory: messages.slice(0, -1), // Excluir último mensaje
      requestId: `req-${Date.now()}`,
      route: '/api/ai/chat',
    });

    const safeToolsUsed = Array.isArray(result.toolsUsed) ? result.toolsUsed : [];
    
    const elapsedTime = Date.now() - startTime;
    
    console.log('[CHAT] Result:');
  console.log('[CHAT]  - Tools used:', safeToolsUsed);
    console.log('[CHAT]  - Execution time:', result.executionTime, 'ms');
    console.log('[CHAT]  - Total time:', elapsedTime, 'ms');
    console.log('[CHAT] ===============================================');
    
    // Respuesta con metadata y debug info
    return res.json({
      answer: result.answer,
      toolsUsed: safeToolsUsed,
      executionTime: result.executionTime,
      metadata: {
        request_id: `req-${Date.now()}`,
        timestamp: new Date().toISOString(),
        model: 'groq/llama-3.3-70b-versatile',
        tools_executed: safeToolsUsed.length,
        source: 'SimpleOrchestrator',
      },
      debug: {
        tools_detail: safeToolsUsed.map((tool: string) => ({
          name: tool,
          status: 'executed',
          timestamp: new Date().toISOString(),
        })),
      },
    });
    
  } catch (error: any) {
    console.error('[CHAT] Error:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  }
};

// Montar rutas legacy/truth + V2 para frontend
router.post('/truth-chat', optionalAuth, handleTruthChat);
router.post('/chat', optionalAuth, handleTruthChat);
router.post('/chat/v2', optionalAuth, handleTruthChat); // ← FIX: Frontend llama /v2

export default router;
