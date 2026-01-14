/**
 * =====================================================
 * TOOL REGISTRY - Catálogo único de herramientas
 * =====================================================
 * 
 * PRINCIPIO RECTOR:
 * Si la respuesta necesita datos actuales o verificables,
 * AL-E DEBE llamar una herramienta (API) y citar/adjuntar fuente.
 * 
 * El LLM no es la fuente. El LLM solo hace:
 * intención → plan → tool calls → síntesis
 * =====================================================
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
// TIPOS Y SCHEMAS
// ═══════════════════════════════════════════════════════════════

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'web' | 'search' | 'code' | 'data' | 'compute' | 'image' | 'internal';
  schema: z.ZodSchema;
  handler: (args: any) => Promise<ToolResult>;
  timeout?: number; // ms
  rateLimit?: {
    maxCalls: number;
    windowMs: number;
  };
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  source?: string; // URL o fuente de los datos
  timestamp: string;
  provider: string;
  cached?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// SCHEMAS DE ARGUMENTOS (ZOD)
// ═══════════════════════════════════════════════════════════════

// Web & Search
export const WebSearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().optional().default(10)
});

export const FetchUrlSchema = z.object({
  url: z.string().url(),
  waitForSelector: z.string().optional()
});

// GitHub
export const GitHubGetFileSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string(),
  ref: z.string().optional().default('main')
});

export const GitHubSearchCodeSchema = z.object({
  query: z.string(),
  repo: z.string().optional(),
  language: z.string().optional(),
  limit: z.number().optional().default(10)
});

// Datos cotidianos
export const ExchangeRateSchema = z.object({
  from: z.string().length(3), // USD
  to: z.string().length(3),    // MXN
  amount: z.number().optional().default(1)
});

export const SearchMealsSchema = z.object({
  ingredient: z.string().optional(),
  name: z.string().optional(),
  category: z.string().optional()
}).refine(data => data.ingredient || data.name || data.category, {
  message: "Al menos un criterio de búsqueda es requerido"
});

export const WolframQuerySchema = z.object({
  query: z.string().min(1).max(1000),
  format: z.enum(['plaintext', 'image', 'json']).optional().default('plaintext')
});

// Generación de imágenes
export const GenerateImageSchema = z.object({
  prompt: z.string().min(1).max(2000),
  model: z.string().optional().default('stability-ai/sdxl'),
  width: z.number().optional().default(1024),
  height: z.number().optional().default(1024)
});

// RAG interno
export const KnowledgeSearchSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().optional().default(5),
  workspaceId: z.string().optional()
});

// Telegram
export const TelegramSendMessageSchema = z.object({
  userId: z.string().uuid(),
  message: z.string().min(1).max(4096), // Límite de Telegram
  chatId: z.number().optional()
});

export const TelegramSendConfirmationSchema = z.object({
  userId: z.string().uuid(),
  message: z.string().min(1).max(4096),
  eventId: z.string().uuid(),
  chatId: z.number().optional()
});

// Calendar
export const CalendarCreateEventSchema = z.object({
  userId: z.string().uuid(),
  title: z.string().min(1).max(500),
  startAt: z.string(), // ISO 8601
  endAt: z.string(), // ISO 8601
  location: z.string().optional(),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  notificationMinutes: z.number().optional().default(60)
});

export const CalendarUpdateEventSchema = z.object({
  userId: z.string().uuid(),
  eventId: z.string().uuid(),
  title: z.string().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  location: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['draft', 'confirmed', 'cancelled']).optional(),
  attendees: z.array(z.string()).optional()
});

export const CalendarListEventsSchema = z.object({
  userId: z.string().uuid(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.enum(['draft', 'confirmed', 'cancelled']).optional(),
  limit: z.number().optional().default(50)
});

// Email Tools (Universal IMAP/SMTP)
export const EmailListSchema = z.object({
  userId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  folder: z.string().optional().default('INBOX'),
  limit: z.number().optional().default(20),
  unreadOnly: z.boolean().optional().default(false)
});

export const EmailReadSchema = z.object({
  userId: z.string().uuid(),
  messageId: z.string().uuid(),
  markAsRead: z.boolean().optional().default(true)
});

export const EmailSendSchema = z.object({
  userId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  to: z.union([z.string(), z.array(z.string())]),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  inReplyTo: z.string().optional()
});

export const EmailReplySchema = z.object({
  userId: z.string().uuid(),
  messageId: z.string().uuid(),
  body: z.string().min(1),
  replyAll: z.boolean().optional().default(false)
});

// DEPRECATED - Legacy schemas (mantener por compatibilidad)
export const EmailReadInboxSchema = z.object({
  userId: z.string().uuid(),
  accountId: z.string().uuid().optional(),
  filter: z.enum(['all', 'unread', 'urgent', 'important']).optional().default('unread'),
  limit: z.number().optional().default(20)
});

export const EmailAnalyzeMessageSchema = z.object({
  userId: z.string().uuid(),
  messageId: z.string().uuid()
});

export const EmailClassifySchema = z.object({
  userId: z.string().uuid(),
  messageId: z.string().uuid(),
  classification: z.enum(['urgent', 'important', 'normal', 'low_priority', 'spam']),
  category: z.string().optional()
});

export const EmailDraftReplySchema = z.object({
  userId: z.string().uuid(),
  messageId: z.string().uuid(),
  replyType: z.enum(['formal', 'friendly', 'brief']).optional().default('formal'),
  instructions: z.string().optional()
});

export const EmailSendLegacySchema = z.object({
  userId: z.string().uuid(),
  accountId: z.string().uuid(),
  to: z.union([z.string(), z.array(z.string())]),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  html: z.string().optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  draftId: z.string().uuid().optional(),
  inReplyTo: z.string().optional()
});

export const EmailSearchContactSchema = z.object({
  userId: z.string().uuid(),
  query: z.string().min(1).max(200)
});

export const EmailCreateContactSchema = z.object({
  userId: z.string().uuid(),
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().optional(),
  company: z.string().optional(),
  notes: z.string().optional()
});

// ═══════════════════════════════════════════════════════════════
// REGISTRO DE HERRAMIENTAS
// ═══════════════════════════════════════════════════════════════

export const TOOL_REGISTRY: Record<string, Omit<ToolDefinition, 'handler'>> = {
  // ─────────────────────────────────────────────────────────────
  // WEB & SEARCH
  // ─────────────────────────────────────────────────────────────
  web_search: {
    name: 'web_search',
    description: 'Busca información actual en Internet usando Google Search. Retorna títulos, URLs y snippets.',
    category: 'search',
    schema: WebSearchSchema,
    timeout: 15000,
    rateLimit: { maxCalls: 20, windowMs: 60000 }
  },
  
  fetch_url_content: {
    name: 'fetch_url_content',
    description: 'Extrae el contenido limpio de una URL específica (texto, artículos, páginas). Usa Firecrawl o Jina.',
    category: 'web',
    schema: FetchUrlSchema,
    timeout: 60000,
    rateLimit: { maxCalls: 10, windowMs: 60000 }
  },

  get_news: {
    name: 'get_news',
    description: 'Busca noticias recientes sobre un tema usando GNews API.',
    category: 'search',
    schema: WebSearchSchema,
    timeout: 15000
  },

  // ─────────────────────────────────────────────────────────────
  // GITHUB / CÓDIGO
  // ─────────────────────────────────────────────────────────────
  github_get_file: {
    name: 'github_get_file',
    description: 'Lee el contenido de un archivo en un repositorio de GitHub.',
    category: 'code',
    schema: GitHubGetFileSchema,
    timeout: 10000
  },

  github_search_code: {
    name: 'github_search_code',
    description: 'Busca código en GitHub por query, lenguaje o repositorio.',
    category: 'code',
    schema: GitHubSearchCodeSchema,
    timeout: 15000
  },

  // ─────────────────────────────────────────────────────────────
  // DATOS COTIDIANOS
  // ─────────────────────────────────────────────────────────────
  get_exchange_rate: {
    name: 'get_exchange_rate',
    description: 'Obtiene el tipo de cambio actual entre dos monedas (ej. USD a MXN).',
    category: 'data',
    schema: ExchangeRateSchema,
    timeout: 10000
  },

  search_recipes: {
    name: 'search_recipes',
    description: 'Busca recetas de cocina por ingrediente, nombre o categoría usando TheMealDB.',
    category: 'data',
    schema: SearchMealsSchema,
    timeout: 10000
  },

  wolfram_compute: {
    name: 'wolfram_compute',
    description: 'Resuelve cálculos matemáticos, conversiones, datos científicos usando Wolfram Alpha.',
    category: 'compute',
    schema: WolframQuerySchema,
    timeout: 20000
  },

  // ─────────────────────────────────────────────────────────────
  // GENERACIÓN DE IMÁGENES (OPCIONAL)
  // ─────────────────────────────────────────────────────────────
  generate_image: {
    name: 'generate_image',
    description: 'Genera una imagen a partir de un prompt usando Replicate (Stable Diffusion XL).',
    category: 'image',
    schema: GenerateImageSchema,
    timeout: 120000
  },

  // ─────────────────────────────────────────────────────────────
  // RAG INTERNO (KNOWLEDGE BASE)
  // ─────────────────────────────────────────────────────────────
  knowledge_search: {
    name: 'knowledge_search',
    description: 'Busca en la base de conocimiento interna (documentación, memoria del sistema) usando búsqueda semántica.',
    category: 'internal',
    schema: KnowledgeSearchSchema,
    timeout: 10000
  },

  // ─────────────────────────────────────────────────────────────
  // TELEGRAM
  // ─────────────────────────────────────────────────────────────
  telegram_send_message: {
    name: 'telegram_send_message',
    description: 'Envía un mensaje de texto por Telegram al usuario. Requiere bot conectado y chat activo.',
    category: 'internal',
    schema: TelegramSendMessageSchema,
    timeout: 10000,
    rateLimit: { maxCalls: 20, windowMs: 60000 }
  },

  telegram_send_confirmation: {
    name: 'telegram_send_confirmation',
    description: 'Envía un mensaje con botones interactivos (Confirmar/Reagendar/Cancelar) para confirmación de eventos.',
    category: 'internal',
    schema: TelegramSendConfirmationSchema,
    timeout: 10000,
    rateLimit: { maxCalls: 10, windowMs: 60000 }
  },

  // ─────────────────────────────────────────────────────────────
  // CALENDAR
  // ─────────────────────────────────────────────────────────────
  calendar_create_event: {
    name: 'calendar_create_event',
    description: 'Crea un nuevo evento en el calendario del usuario. Genera notification_job automáticamente.',
    category: 'internal',
    schema: CalendarCreateEventSchema,
    timeout: 10000
  },

  calendar_update_event: {
    name: 'calendar_update_event',
    description: 'Actualiza un evento existente (título, fechas, status, etc). Valida ownership del usuario.',
    category: 'internal',
    schema: CalendarUpdateEventSchema,
    timeout: 10000
  },

  calendar_list_events: {
    name: 'calendar_list_events',
    description: 'Lista eventos del calendario con filtros opcionales (fechas, status).',
    category: 'internal',
    schema: CalendarListEventsSchema,
    timeout: 10000
  },

  // ─────────────────────────────────────────────────────────────
  // EMAIL (Universal IMAP/SMTP)
  // ─────────────────────────────────────────────────────────────
  email_list: {
    name: 'email_list',
    description: 'Lista correos del inbox (o folder específico). Muestra from, subject, preview, attachments. Soporta filtro unreadOnly.',
    category: 'internal',
    schema: EmailListSchema,
    timeout: 15000
  },

  email_read: {
    name: 'email_read',
    description: 'Lee contenido completo de un correo (body, attachments, metadata). Marca como leído opcionalmente.',
    category: 'internal',
    schema: EmailReadSchema,
    timeout: 10000
  },

  email_send: {
    name: 'email_send',
    description: 'Envía correo nuevo vía SMTP. Soporta to/cc/bcc, HTML/text body, threading (inReplyTo).',
    category: 'internal',
    schema: EmailSendSchema,
    timeout: 20000
  },

  email_reply: {
    name: 'email_reply',
    description: 'Responde a un correo existente. Mantiene threading automáticamente. Soporta Reply All.',
    category: 'internal',
    schema: EmailReplySchema,
    timeout: 20000
  },

  // DEPRECATED - Legacy email tools (mantener por compatibilidad)
  email_read_inbox: {
    name: 'email_read_inbox',
    description: '[DEPRECATED] Usa email_list en su lugar.',
    category: 'internal',
    schema: EmailReadInboxSchema,
    timeout: 15000
  },

  email_analyze_message: {
    name: 'email_analyze_message',
    description: 'Analiza y clasifica un correo con LLM (urgente/importante, categoría, requiere acción, resumen).',
    category: 'internal',
    schema: EmailAnalyzeMessageSchema,
    timeout: 20000
  },

  email_classify: {
    name: 'email_classify',
    description: 'Actualiza la clasificación de un mensaje en la DB (urgent, important, normal, low_priority, spam).',
    category: 'internal',
    schema: EmailClassifySchema,
    timeout: 5000
  },

  email_draft_reply: {
    name: 'email_draft_reply',
    description: 'Genera borrador de respuesta a un correo usando LLM con tono formal/friendly/brief.',
    category: 'internal',
    schema: EmailDraftReplySchema,
    timeout: 20000
  },

  email_search_contact: {
    name: 'email_search_contact',
    description: 'Busca contactos por nombre o email en email_contacts del usuario.',
    category: 'internal',
    schema: EmailSearchContactSchema,
    timeout: 5000
  },

  email_create_contact: {
    name: 'email_create_contact',
    description: 'Crea un nuevo contacto en email_contacts con nombre, email, phone, company, notes.',
    category: 'internal',
    schema: EmailCreateContactSchema,
    timeout: 5000
  }
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/**
 * Obtiene la definición de una herramienta
 */
export function getToolDefinition(name: string): Omit<ToolDefinition, 'handler'> | undefined {
  return TOOL_REGISTRY[name];
}

/**
 * Lista todas las herramientas disponibles
 */
export function listTools(): string[] {
  return Object.keys(TOOL_REGISTRY);
}

/**
 * Lista todas las herramientas con sus definiciones completas
 */
export function listToolDefinitions(): Omit<ToolDefinition, 'handler'>[] {
  return Object.values(TOOL_REGISTRY);
}

/**
 * Lista herramientas por categoría
 */
export function listToolsByCategory(category: string): string[] {
  return Object.entries(TOOL_REGISTRY)
    .filter(([_, def]) => def.category === category)
    .map(([name]) => name);
}

/**
 * Genera descripción de herramientas para el LLM
 */
export function generateToolsPrompt(): string {
  const tools = Object.values(TOOL_REGISTRY);
  
  return `
HERRAMIENTAS DISPONIBLES:

${tools.map(tool => `
${tool.name}:
  Descripción: ${tool.description}
  Categoría: ${tool.category}
  Ejemplo de uso: Llama esta herramienta cuando necesites ${tool.description.toLowerCase()}
`).join('\n')}

REGLAS DE USO:
1. SIEMPRE usa herramientas para datos actuales o verificables
2. NO inventes datos que podrías obtener con una herramienta
3. Cita la fuente cuando uses web_search, fetch_url_content o get_news
4. Si una herramienta falla, intenta con alternativas de la misma categoría
5. Para preguntas del sistema, usa primero knowledge_search

FORMATO DE RESPUESTA:
Responde con JSON:
{
  "tool_calls": [
    {"name": "web_search", "args": {"query": "clima Guadalajara"}},
    {"name": "get_exchange_rate", "args": {"from": "USD", "to": "MXN"}}
  ]
}
`.trim();
}
