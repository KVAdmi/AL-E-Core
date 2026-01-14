/**
 * =====================================================
 * TOOL ROUTER - Ejecutor Central de Herramientas
 * =====================================================
 * 
 * Router que:
 * - Recibe tool_calls del LLM
 * - Valida argumentos con schemas Zod
 * - Ejecuta handlers apropiados
 * - Aplica rate limiting y timeouts
 * - Normaliza respuestas
 * =====================================================
 */

import { z } from 'zod';
import { 
  TOOL_REGISTRY, 
  getToolDefinition, 
  ToolResult 
} from './registry';

// Importar todos los handlers
import { 
  webSearchHandler, 
  fetchUrlHandler, 
  getNewsHandler 
} from './handlers/webSearch';

import { 
  getExchangeRateHandler, 
  searchRecipesHandler, 
  wolframComputeHandler 
} from './handlers/dataTools';

import { 
  githubGetFileHandler, 
  githubSearchCodeHandler 
} from './handlers/githubTools';

import { 
  knowledgeSearchHandler 
} from './handlers/knowledgeTools';

import { 
  generateImageHandler 
} from './handlers/imageTools';

import {
  telegramSendMessageHandler,
  telegramSendConfirmationHandler
} from './handlers/telegramTools';

import {
  calendarCreateEventHandler,
  calendarUpdateEventHandler,
  calendarListEventsHandler
} from './handlers/calendarTools';

import {
  emailListHandler,
  emailReadHandler,
  emailSendHandler,
  emailReplyHandler
} from './handlers/emailTools';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface ToolCall {
  name: string;
  args: Record<string, any>;
}

// ═══════════════════════════════════════════════════════════════
// RATE LIMITING (Simple In-Memory)
// ═══════════════════════════════════════════════════════════════

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimits = new Map<string, RateLimitEntry>();

function checkRateLimit(toolName: string, config: { maxCalls: number; windowMs: number }): boolean {
  const now = Date.now();
  const key = toolName;
  const entry = rateLimits.get(key);

  // Resetear si pasó la ventana
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, {
      count: 1,
      resetAt: now + config.windowMs
    });
    return true;
  }

  // Validar límite
  if (entry.count >= config.maxCalls) {
    return false;
  }

  // Incrementar contador
  entry.count++;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// TOOL ROUTER PRINCIPAL
// ═══════════════════════════════════════════════════════════════

export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const { name, args } = toolCall;

  try {
    console.log(`[TOOL ROUTER] Ejecutando: ${name}`);
    console.log(`[TOOL ROUTER] Args:`, JSON.stringify(args, null, 2));

    // 1. Validar que la herramienta existe
    const toolDef = getToolDefinition(name);
    if (!toolDef) {
      return {
        success: false,
        error: `Herramienta desconocida: ${name}`,
        timestamp: new Date().toISOString(),
        provider: 'router'
      };
    }

    // 2. Rate limiting
    const rateLimit = toolDef.rateLimit || { maxCalls: 30, windowMs: 60000 }; // Default: 30/min
    if (!checkRateLimit(name, rateLimit)) {
      return {
        success: false,
        error: `Rate limit excedido para ${name}. Límite: ${rateLimit.maxCalls} llamadas/${rateLimit.windowMs}ms`,
        timestamp: new Date().toISOString(),
        provider: 'router'
      };
    }

    // 3. Validar argumentos con schema Zod
    const validationResult = toolDef.schema.safeParse(args);
    if (!validationResult.success) {
      return {
        success: false,
        error: `Argumentos inválidos: ${validationResult.error.message}`,
        timestamp: new Date().toISOString(),
        provider: 'router'
      };
    }

    const validArgs = validationResult.data;

    // 4. Ejecutar handler con timeout
    const timeout = toolDef.timeout || 15000; // Default: 15 segundos
    const result = await Promise.race([
      executeHandler(name, validArgs),
      timeoutPromise(timeout)
    ]);

    console.log(`[TOOL ROUTER] Resultado exitoso: ${name}`);
    return result;

  } catch (error: any) {
    console.error(`[TOOL ROUTER] Error en ${name}:`, error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'router'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Ejecutar Handler Apropiado
// ═══════════════════════════════════════════════════════════════

async function executeHandler(name: string, args: any): Promise<ToolResult> {
  switch (name) {
    // Web & Search
    case 'web_search':
      return webSearchHandler(args);
    case 'fetch_url_content':
      return fetchUrlHandler(args);
    case 'get_news':
      return getNewsHandler(args);

    // GitHub
    case 'github_get_file':
      return githubGetFileHandler(args);
    case 'github_search_code':
      return githubSearchCodeHandler(args);

    // Data
    case 'get_exchange_rate':
      return getExchangeRateHandler(args);
    case 'search_recipes':
      return searchRecipesHandler(args);
    case 'wolfram_compute':
      return wolframComputeHandler(args);

    // Knowledge
    case 'knowledge_search':
      return knowledgeSearchHandler(args);

    // Image
    case 'generate_image':
      return generateImageHandler(args);

    // Telegram
    case 'telegram_send_message':
      return telegramSendMessageHandler(args);
    case 'telegram_send_confirmation':
      return telegramSendConfirmationHandler(args);

    // Calendar
    case 'calendar_create_event':
      return calendarCreateEventHandler(args);
    case 'calendar_update_event':
      return calendarUpdateEventHandler(args);
    case 'calendar_list_events':
      return calendarListEventsHandler(args);

    // Email (Universal IMAP/SMTP)
    case 'email_list':
    case 'list_emails': // Alias para compatibilidad con toolDefinitions.ts
      return emailListHandler(args);
    case 'email_read':
    case 'read_email': // Alias para compatibilidad con toolDefinitions.ts
      return emailReadHandler(args);
    case 'email_send':
    case 'send_email': // Alias para compatibilidad con toolDefinitions.ts
      return emailSendHandler(args);
    case 'email_reply':
      return emailReplyHandler(args);

    // Legacy email tools (deprecated)
    case 'email_read_inbox':
    case 'email_analyze_message':
    case 'email_classify':
    case 'email_draft_reply':
    case 'email_search_contact':
    case 'email_create_contact':
      throw new Error(`Email tool ${name} DEPRECATED. Usa: email_list, email_read, email_send, email_reply`);

    default:
      throw new Error(`Handler no implementado para: ${name}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPER: Timeout Promise
// ═══════════════════════════════════════════════════════════════

function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout: herramienta excedió ${ms}ms`)), ms);
  });
}

// ═══════════════════════════════════════════════════════════════
// BATCH EXECUTION (Ejecutar múltiples tools en paralelo)
// ═══════════════════════════════════════════════════════════════

export async function executeToolCallsBatch(toolCalls: ToolCall[]): Promise<ToolResult[]> {
  console.log(`[TOOL ROUTER] Ejecutando batch de ${toolCalls.length} herramientas`);
  
  const results = await Promise.all(
    toolCalls.map(call => executeToolCall(call))
  );

  return results;
}
