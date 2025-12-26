/**
 * Tavily Web Search Service
 * 
 * Herramienta de búsqueda web para AL-E
 * Permite buscar información actual, verificar datos, y obtener fuentes confiables
 */

import axios from 'axios';

const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const TAVILY_API_URL = 'https://api.tavily.com/search';

export interface TavilySearchOptions {
  query: string;
  searchDepth?: 'basic' | 'advanced';
  maxResults?: number;
  includeDomains?: string[];
  excludeDomains?: string[];
}

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  query: string;
  results: TavilySearchResult[];
  responseTime: number;
  success: boolean;
}

/**
 * Realizar búsqueda web con Tavily
 */
export async function webSearch(options: TavilySearchOptions): Promise<TavilySearchResponse> {
  const startTime = Date.now();
  
  try {
    const {
      query,
      searchDepth = 'basic',
      maxResults = 5,
      includeDomains,
      excludeDomains
    } = options;

    if (!TAVILY_API_KEY) {
      throw new Error('TAVILY_API_KEY not configured');
    }

    console.log(`[TAVILY] Searching: "${query}"`);
    console.log(`[TAVILY] Depth: ${searchDepth}, Max results: ${maxResults}`);

    const response = await axios.post(
      TAVILY_API_URL,
      {
        api_key: TAVILY_API_KEY,
        query: query,
        search_depth: searchDepth,
        max_results: maxResults,
        include_domains: includeDomains,
        exclude_domains: excludeDomains,
        include_answer: true,
        include_raw_content: false
      },
      {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000 // 15 segundos timeout
      }
    );

    const results: TavilySearchResult[] = response.data.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score || 0,
      publishedDate: r.published_date
    }));

    const responseTime = Date.now() - startTime;
    
    console.log(`[TAVILY] ✓ Found ${results.length} results in ${responseTime}ms`);
    results.forEach((r, idx) => {
      console.log(`[TAVILY]   ${idx + 1}. ${r.title} (score: ${r.score.toFixed(2)})`);
    });

    return {
      query,
      results,
      responseTime,
      success: true
    };
  } catch (error: any) {
    const responseTime = Date.now() - startTime;
    console.error('[TAVILY] Error:', error.message);
    
    return {
      query: options.query,
      results: [],
      responseTime,
      success: false
    };
  }
}

/**
 * Formatear resultados de Tavily para inyección en contexto
 */
export function formatTavilyResults(searchResponse: TavilySearchResponse): string {
  if (!searchResponse.success || searchResponse.results.length === 0) {
    return `\n[WEB SEARCH] No se encontraron resultados para: "${searchResponse.query}"\n`;
  }

  let formatted = `\n═══════════════════════════════════════════════════════════════\n`;
  formatted += `RESULTADOS DE BÚSQUEDA WEB (Tavily)\n`;
  formatted += `═══════════════════════════════════════════════════════════════\n\n`;
  formatted += `Query: "${searchResponse.query}"\n`;
  formatted += `Resultados encontrados: ${searchResponse.results.length}\n`;
  formatted += `Tiempo de respuesta: ${searchResponse.responseTime}ms\n\n`;

  searchResponse.results.forEach((result, idx) => {
    formatted += `--- Resultado ${idx + 1} ---\n`;
    formatted += `Título: ${result.title}\n`;
    formatted += `URL: ${result.url}\n`;
    formatted += `Relevancia: ${(result.score * 100).toFixed(0)}%\n`;
    if (result.publishedDate) {
      formatted += `Fecha: ${result.publishedDate}\n`;
    }
    formatted += `\nContenido:\n${result.content}\n\n`;
  });

  formatted += `═══════════════════════════════════════════════════════════════\n`;
  formatted += `INSTRUCCIÓN: Usa esta información web para fundamentar tu respuesta.\n`;
  formatted += `Cita las fuentes cuando sea relevante (URL + título).\n`;
  formatted += `═══════════════════════════════════════════════════════════════\n`;

  return formatted;
}

/**
 * Detectar si una query requiere búsqueda web
 * REGLA: Detectar agresivamente para evitar alucinaciones
 */
export function shouldUseWebSearch(userMessage: string): boolean {
  const lowerMsg = userMessage.toLowerCase();
  
  // TIER 1: Comandos EXPLÍCITOS de búsqueda (FORZAR SIEMPRE)
  const explicitSearchCommands = [
    'busca', 'buscar', 'búsqueda', 'search',
    'investiga', 'averigua', 'encuentra',
    'verifica', 'checa', 'confirma',
    've a', 'accede a', 'mira en',
    'consulta', 'revisa en'
  ];
  
  // TIER 2: Keywords de verificación externa (ALTA PRIORIDAD)
  const verificationKeywords = [
    'existe', 'existencia', 'tiene página', 'tiene web', 'tiene sitio',
    'url', 'dominio', 'website', 'sitio web', 'página web',
    'oficial', 'público', 'publicado',
    'información sobre', 'info sobre', 'datos sobre',
    'qué es', 'quién es', 'dónde está',
    'cuándo', 'fecha', 'año'
  ];
  
  // TIER 3: Keywords de entidades externas (EMPRESAS, PRODUCTOS)
  const entityKeywords = [
    'empresa', 'compañía', 'startup', 'corporación', 'organización',
    'producto', 'servicio', 'plataforma', 'software', 'app',
    'marca', 'brand', 'negocio', 'comercio'
  ];
  
  // TIER 4: Keywords de información actual (TEMPORAL)
  const temporalKeywords = [
    '2024', '2025', 'hoy', 'ahora', 'actual', 'actualidad',
    'reciente', 'recientemente', 'últimamente',
    'precio', 'costo', 'valor', 'cotización',
    'noticia', 'noticias', 'nota', 'artículo', 'reporte'
  ];
  
  // TIER 5: Patrones de pregunta sobre facts externos
  const questionPatterns = [
    /puedes\s+(buscar|verificar|confirmar|checar)/,
    /(tiene|hay|existe)\s+(página|web|sitio|url)/,
    /información\s+(actual|reciente|sobre)/,
    /qué\s+(es|son|significa)/,
    /dónde\s+(está|están|se encuentra)/
  ];
  
  // VERIFICACIÓN TIER 1: Comandos explícitos (RETURN INMEDIATO)
  if (explicitSearchCommands.some(cmd => lowerMsg.includes(cmd))) {
    console.log('[TAVILY] ✓ Tier 1: Comando explícito de búsqueda detectado');
    return true;
  }
  
  // VERIFICACIÓN TIER 2: Verificación + Entidad (ALTA CONFIANZA)
  const hasVerification = verificationKeywords.some(kw => lowerMsg.includes(kw));
  const hasEntity = entityKeywords.some(kw => lowerMsg.includes(kw));
  if (hasVerification && hasEntity) {
    console.log('[TAVILY] ✓ Tier 2: Verificación de entidad externa detectada');
    return true;
  }
  
  // VERIFICACIÓN TIER 3: Patterns de pregunta (REGEX)
  if (questionPatterns.some(pattern => pattern.test(lowerMsg))) {
    console.log('[TAVILY] ✓ Tier 3: Patrón de pregunta sobre facts externos');
    return true;
  }
  
  // VERIFICACIÓN TIER 4: Temporal + Entidad (INFORMACIÓN ACTUAL)
  const hasTemporal = temporalKeywords.some(kw => lowerMsg.includes(kw));
  if (hasTemporal && hasEntity) {
    console.log('[TAVILY] ✓ Tier 4: Información actual sobre entidad');
    return true;
  }
  
  // VERIFICACIÓN TIER 5: Solo verificación fuerte (sin entidad)
  const strongVerification = ['existe', 'url', 'página web', 'sitio web', 'dominio', 'oficial'];
  if (strongVerification.some(kw => lowerMsg.includes(kw))) {
    console.log('[TAVILY] ✓ Tier 5: Verificación fuerte de existencia/URL');
    return true;
  }
  
  console.log('[TAVILY] ✗ No se detectó necesidad de búsqueda web');
  return false;
}
