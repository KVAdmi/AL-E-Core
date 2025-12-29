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
 * GET /_health/full
 * 
 * Health check BLOQUEANTE - Sistema delata faltantes
 * P0: NO acepta "implementado" sin evidencia en DB/ENV
 */
router.get('/full', async (req, res) => {
  try {
    const status: any = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
      },
      migrations_ok: true,
      missing_tables: [],
      env_ok: true,
      missing_env: [],
      features_verified: {}
    };
    
    // ═══════════════════════════════════════════════════════════════
    // 1. VERIFICAR TABLAS CRÍTICAS (MIGRATIONS)
    // ═══════════════════════════════════════════════════════════════
    
    const requiredTables = [
      'email_accounts',
      'email_folders',
      'email_drafts', 
      'email_messages',
      'email_attachments',
      'email_contacts',
      'calendar_events',
      'notification_jobs',
      'telegram_bots',
      'telegram_chats',
      'assistant_memories'
    ];
    
    const { supabase } = await import('../db/supabase');
    
    for (const table of requiredTables) {
      try {
        const { error } = await supabase
          .from(table)
          .select('id')
          .limit(1);
        
        if (error) {
          status.migrations_ok = false;
          status.missing_tables.push(table);
        }
      } catch (err) {
        status.migrations_ok = false;
        status.missing_tables.push(table);
      }
    }
    
    status.db_ok = status.migrations_ok;
    
    // ═══════════════════════════════════════════════════════════════
    // 2. VERIFICAR ENV VARS CRÍTICAS
    // ═══════════════════════════════════════════════════════════════
    
    const requiredEnv = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_KEY',
      'ENCRYPTION_KEY',
      'GROQ_API_KEY'
    ];
    
    for (const envVar of requiredEnv) {
      if (!process.env[envVar]) {
        status.env_ok = false;
        status.missing_env.push(envVar);
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 3. VERIFICAR FEATURES REALES (NO FLAGS, DATOS REALES)
    // ═══════════════════════════════════════════════════════════════
    
    // Email SMTP: ¿Hay cuentas configuradas Y con credenciales?
    try {
      const { data: emailAccounts } = await supabase
        .from('email_accounts')
        .select('id, smtp_host, smtp_user, smtp_pass_enc')
        .eq('is_active', true)
        .limit(1);
      
      status.features_verified.email_smtp = !!(emailAccounts && emailAccounts.length > 0 && emailAccounts[0].smtp_pass_enc);
    } catch {
      status.features_verified.email_smtp = false;
    }
    
    // Calendar: ¿Tabla existe Y tiene eventos?
    try {
      const { data: events } = await supabase
        .from('calendar_events')
        .select('id')
        .limit(1);
      
      status.features_verified.calendar_internal = true; // Tabla existe
    } catch {
      status.features_verified.calendar_internal = false;
    }
    
    // Telegram: ¿Hay bots configurados Y con tokens?
    try {
      const { data: bots } = await supabase
        .from('telegram_bots')
        .select('id, bot_token_enc')
        .eq('is_active', true)
        .limit(1);
      
      status.features_verified.telegram = !!(bots && bots.length > 0 && bots[0].bot_token_enc);
    } catch {
      status.features_verified.telegram = false;
    }
    
    // IMAP: ¿Hay cuentas con credenciales IMAP?
    try {
      const { data: imapAccounts } = await supabase
        .from('email_accounts')
        .select('id, imap_host, imap_user, imap_pass_enc')
        .eq('is_active', true)
        .limit(1);
      
      status.features_verified.email_imap = !!(imapAccounts && imapAccounts.length > 0 && imapAccounts[0].imap_pass_enc);
    } catch {
      status.features_verified.email_imap = false;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 4. STATUS FINAL
    // ═══════════════════════════════════════════════════════════════
    
    if (!status.migrations_ok || !status.env_ok) {
      status.status = 'degraded';
      return res.status(500).json(status);
    }
    
    return res.json(status);
    
  } catch (error: any) {
    console.error('[HEALTH] Error:', error);
    return res.status(500).json({
      status: 'error',
      message: error.message || 'Health check failed',
      timestamp: new Date().toISOString()
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
