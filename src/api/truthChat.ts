/**
 * TRUTH CHAT API - ENDPOINT CON TRUTH LAYER
 * 
 * Endpoint de testing para el nuevo pipeline Truth Layer + Authority Matrix.
 * Una vez validado, puede reemplazar /api/ai/chat
 */

import express from 'express';
import { optionalAuth, getUserId } from '../middleware/auth';
import { getTruthOrchestrator } from '../ai/truthOrchestrator';

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
    
    console.log('[TRUTH CHAT] User ID resolved:', userId);
    
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
    
    console.log('[TRUTH CHAT] User ID:', userId);
    console.log('[TRUTH CHAT] Message:', userMessage.substring(0, 100));
    console.log('[TRUTH CHAT] User confirmed:', userConfirmed || false);
    
    // Obtener Truth Orchestrator
    const truthOrchestrator = await getTruthOrchestrator();
    
    // Ejecutar pipeline
    const result = await truthOrchestrator.orchestrate({
      userMessage,
      userId,
      conversationHistory: messages.slice(0, -1), // Excluir último mensaje
      userConfirmed,
    });
    
    const elapsedTime = Date.now() - startTime;
    
    console.log('[TRUTH CHAT] Result:');
    console.log('[TRUTH CHAT]  - Was blocked:', result.wasBlocked);
    console.log('[TRUTH CHAT]  - Block reason:', result.blockReason || 'N/A');
    console.log('[TRUTH CHAT]  - Authority level:', result.authorityLevel);
    console.log('[TRUTH CHAT]  - Execution time:', result.executionTime, 'ms');
    console.log('[TRUTH CHAT]  - Total time:', elapsedTime, 'ms');
    console.log('[TRUTH CHAT] ===============================================');
    
    // Respuesta
    return res.json({
      answer: result.content,
      wasBlocked: result.wasBlocked,
      blockReason: result.blockReason,
      evidence: result.evidence,
      metadata: {
        intent: result.plan.intent,
        authorityLevel: result.authorityLevel,
        authorityRequired: result.plan.authorityRequired,
        requiresConfirmation: result.plan.requiresConfirmation,
        executedTools: result.plan.requiredTools,
        governorStatus: result.governorDecision.status,
        executionTime: result.executionTime,
        totalTime: elapsedTime,
      },
    });
    
  } catch (error: any) {
    console.error('[TRUTH CHAT] Error:', error);
    
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      wasBlocked: true,
    });
  }
};

// Montar en TODOS los endpoints que el frontend puede usar
router.post('/truth-chat', optionalAuth, handleTruthChat);
router.post('/chat', optionalAuth, handleTruthChat); // NUEVO - reemplaza /chat con Truth Layer
router.post('/chat/v2', optionalAuth, handleTruthChat); // También /chat/v2 (frontend usa esta)

export default router;
