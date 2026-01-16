/**
 * TRUTH CHAT API - ENDPOINT CON TRUTH LAYER
 * 
 * Endpoint de testing para el nuevo pipeline Truth Layer + Authority Matrix.
 * Una vez validado, puede reemplazar /api/ai/chat
 */

import express from 'express';
import { optionalAuth, getUserId, getUserEmail } from '../middleware/auth';
import { getSimpleOrchestrator } from '../ai/simpleOrchestrator';

const router = express.Router();

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
    const { messages, userConfirmed } = req.body;
    
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
    
    const elapsedTime = Date.now() - startTime;
    
    console.log('[CHAT] Result:');
    console.log('[CHAT]  - Tools used:', result.toolsUsed);
    console.log('[CHAT]  - Execution time:', result.executionTime, 'ms');
    console.log('[CHAT]  - Total time:', elapsedTime, 'ms');
    console.log('[CHAT] ===============================================');
    
    // Respuesta con metadata y debug info
    return res.json({
      answer: result.answer,
      toolsUsed: result.toolsUsed,
      executionTime: result.executionTime,
      metadata: {
        request_id: `req-${Date.now()}`,
        timestamp: new Date().toISOString(),
        model: 'groq/llama-3.3-70b-versatile',
        tools_executed: result.toolsUsed.length,
        source: 'SimpleOrchestrator',
      },
      debug: {
        tools_detail: result.toolsUsed.map((tool: string) => ({
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

// Montar en TODOS los endpoints que el frontend puede usar
router.post('/truth-chat', optionalAuth, handleTruthChat);
router.post('/chat', optionalAuth, handleTruthChat);
router.post('/chat/v2', optionalAuth, handleTruthChat);

export default router;
