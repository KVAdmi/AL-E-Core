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
 */
export function shouldUseWebSearch(userMessage: string): boolean {
  const lowerMsg = userMessage.toLowerCase();
  
  // Keywords que indican búsqueda web necesaria
  const webSearchKeywords = [
    'busca', 'buscar', 'búsqueda', 'search',
    'información sobre', 'info sobre', 'datos sobre',
    'qué es', 'quién es', 'dónde está',
    'cómo se hace', 'cuándo ocurrió',
    'precio de', 'costo de',
    'última noticia', 'noticias sobre',
    'actualización sobre',
    'web', 'internet', 'online',
    'investiga', 'averigua', 'encuentra'
  ];
  
  // Keywords de empresas/marcas que probablemente requieran búsqueda
  const brandKeywords = [
    'empresa', 'compañía', 'startup',
    'producto', 'servicio',
    'mercado', 'industria'
  ];
  
  // Verificar keywords de búsqueda directa
  const hasWebKeyword = webSearchKeywords.some(keyword => lowerMsg.includes(keyword));
  
  // Verificar keywords de marca (menos prioritario)
  const hasBrandKeyword = brandKeywords.some(keyword => lowerMsg.includes(keyword));
  
  // Detectar preguntas sobre información actual (fechas, eventos recientes)
  const hasTemporalKeyword = lowerMsg.includes('2024') || lowerMsg.includes('2025') || 
                             lowerMsg.includes('hoy') || lowerMsg.includes('ahora') ||
                             lowerMsg.includes('actual') || lowerMsg.includes('reciente');
  
  return hasWebKeyword || (hasBrandKeyword && hasTemporalKeyword);
}
