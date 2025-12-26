/**
 * Health Check Endpoints
 * 
 * Endpoints protegidos para verificar estado del sistema
 */

import express from 'express';
import { getConfiguredProviders, verifyOpenAIBlocked } from '../llm/router';
import { env } from '../config/env';
import fs from 'fs';
import path from 'path';

const router = express.Router();

/**
 * GET /_health/ai
 * 
 * Verifica configuración de proveedores LLM y tools
 */
router.get('/ai', async (req, res) => {
  try {
    const configuredProviders = getConfiguredProviders();
    const openaiStatus = verifyOpenAIBlocked();
    
    // Leer build hash (últimos 8 chars del commit si existe .git)
    let buildHash = 'unknown';
    try {
      const gitHeadPath = path.join(__dirname, '../../.git/HEAD');
      if (fs.existsSync(gitHeadPath)) {
        const headContent = fs.readFileSync(gitHeadPath, 'utf-8').trim();
        if (headContent.startsWith('ref:')) {
          const refPath = headContent.split(' ')[1];
          const commitPath = path.join(__dirname, '../../.git', refPath);
          if (fs.existsSync(commitPath)) {
            const commitHash = fs.readFileSync(commitPath, 'utf-8').trim();
            buildHash = commitHash.substring(0, 8);
          }
        }
      }
    } catch (gitError) {
      console.warn('[HEALTH] Could not read git hash:', gitError);
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      
      // LLM Config
      default_provider: process.env.LLM_DEFAULT_PROVIDER || 'groq',
      fallback_provider: process.env.LLM_FALLBACK_PROVIDER || 'fireworks',
      fallback2_provider: process.env.LLM_FALLBACK2_PROVIDER || 'together',
      configured_providers: configuredProviders,
      
      // OpenAI Status
      openai_disabled: openaiStatus.blocked,
      openai_message: openaiStatus.message,
      
      // Tools
      tavily_enabled: !!process.env.TAVILY_API_KEY,
      
      // Build info
      build_hash: buildHash,
      node_env: process.env.NODE_ENV || 'development'
    });
  } catch (error: any) {
    console.error('[HEALTH] Error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Health check failed'
    });
  }
});

/**
 * GET /_health/ping
 * 
 * Simple ping para verificar que el servidor está vivo
 */
router.get('/ping', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

export default router;
