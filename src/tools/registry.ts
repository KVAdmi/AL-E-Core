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
