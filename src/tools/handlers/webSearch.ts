/**
 * =====================================================
 * TOOL HANDLERS - Web & Search
 * =====================================================
 * 
 * Implementaciones de herramientas para:
 * - Búsqueda web (Serper, SerpAPI, Brave)
 * - Scraping (Firecrawl, Jina)
 * - Noticias (GNews)
 * =====================================================
 */

import axios from 'axios';
import { ToolResult } from '../registry';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || 'serper';
const SCRAPE_PROVIDER = process.env.SCRAPE_PROVIDER || 'firecrawl';

const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const JINA_API_KEY = process.env.JINA_API_KEY;
const GNEWS_API_KEY = process.env.GNEWS_API_KEY;

// ═══════════════════════════════════════════════════════════════
// WEB SEARCH
// ═══════════════════════════════════════════════════════════════

/**
 * Búsqueda web usando Serper (Google Search API)
 */
async function searchWithSerper(query: string, limit: number): Promise<any> {
  if (!SERPER_API_KEY) {
    throw new Error('SERPER_API_KEY no configurada');
  }

  const response = await axios.post(
    'https://google.serper.dev/search',
    {
      q: query,
      num: limit
    },
    {
      headers: {
        'X-API-KEY': SERPER_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  return {
    query,
    results: response.data.organic?.map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      position: item.position
    })) || []
  };
}

/**
 * Búsqueda web usando SerpAPI (fallback)
 */
async function searchWithSerpAPI(query: string, limit: number): Promise<any> {
  if (!SERPAPI_API_KEY) {
    throw new Error('SERPAPI_API_KEY no configurada');
  }

  const response = await axios.get('https://serpapi.com/search', {
    params: {
      q: query,
      api_key: SERPAPI_API_KEY,
      num: limit,
      engine: 'google'
    },
    timeout: 15000
  });

  return {
    query,
    results: response.data.organic_results?.map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
      position: item.position
    })) || []
  };
}

/**
 * Handler principal de web_search
 */
export async function webSearchHandler(args: { query: string; limit?: number }): Promise<ToolResult> {
  const { query, limit = 10 } = args;
  
  try {
    console.log(`[TOOL] web_search: "${query}" (provider: ${SEARCH_PROVIDER})`);
    
    let data;
    let provider;

    // Primero intentar con provider configurado
    try {
      if (SEARCH_PROVIDER === 'serper' && SERPER_API_KEY) {
        data = await searchWithSerper(query, limit);
        provider = 'serper';
      } else if (SEARCH_PROVIDER === 'serpapi' && SERPAPI_API_KEY) {
        data = await searchWithSerpAPI(query, limit);
        provider = 'serpapi';
      } else {
        throw new Error('Provider configurado no disponible');
      }
    } catch (primaryError) {
      console.warn(`[TOOL] Primario falló, intentando fallback...`);
      
      // Fallback
      if (SERPER_API_KEY) {
        data = await searchWithSerper(query, limit);
        provider = 'serper (fallback)';
      } else if (SERPAPI_API_KEY) {
        data = await searchWithSerpAPI(query, limit);
        provider = 'serpapi (fallback)';
      } else {
        throw new Error('Ningún proveedor de búsqueda disponible');
      }
    }

    return {
      success: true,
      data,
      source: `Google Search via ${provider}`,
      timestamp: new Date().toISOString(),
      provider
    };
  } catch (error: any) {
    console.error('[TOOL] web_search error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: SEARCH_PROVIDER
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// WEB SCRAPING
// ═══════════════════════════════════════════════════════════════

/**
 * Scraping con Firecrawl
 */
async function scrapeWithFirecrawl(url: string): Promise<any> {
  if (!FIRECRAWL_API_KEY) {
    throw new Error('FIRECRAWL_API_KEY no configurada');
  }

  const response = await axios.post(
    'https://api.firecrawl.dev/v2/scrape',
    { url },
    {
      headers: {
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );

  return {
    url,
    title: response.data.title || '',
    content: response.data.markdown || response.data.text || '',
    metadata: response.data.metadata || {}
  };
}

/**
 * Scraping con Jina AI Reader
 */
async function scrapeWithJina(url: string): Promise<any> {
  const response = await axios.get(`https://r.jina.ai/${url}`, {
    headers: {
      'Authorization': `Bearer ${JINA_API_KEY}`,
      'X-Return-Format': 'markdown'
    },
    timeout: 30000
  });

  return {
    url,
    title: response.data.title || '',
    content: response.data.content || response.data,
    metadata: {}
  };
}

/**
 * Handler principal de fetch_url_content
 */
export async function fetchUrlHandler(args: { url: string; waitForSelector?: string }): Promise<ToolResult> {
  const { url } = args;
  
  try {
    console.log(`[TOOL] fetch_url_content: ${url} (provider: ${SCRAPE_PROVIDER})`);
    
    let data;
    let provider;

    // Primero intentar con provider configurado
    try {
      if (SCRAPE_PROVIDER === 'firecrawl' && FIRECRAWL_API_KEY) {
        data = await scrapeWithFirecrawl(url);
        provider = 'firecrawl';
      } else if (SCRAPE_PROVIDER === 'jina' && JINA_API_KEY) {
        data = await scrapeWithJina(url);
        provider = 'jina';
      } else {
        throw new Error('Provider configurado no disponible');
      }
    } catch (primaryError) {
      console.warn(`[TOOL] Primario falló, intentando fallback...`);
      
      // Fallback
      if (JINA_API_KEY) {
        data = await scrapeWithJina(url);
        provider = 'jina (fallback)';
      } else if (FIRECRAWL_API_KEY) {
        data = await scrapeWithFirecrawl(url);
        provider = 'firecrawl (fallback)';
      } else {
        throw new Error('Ningún proveedor de scraping disponible');
      }
    }

    return {
      success: true,
      data,
      source: url,
      timestamp: new Date().toISOString(),
      provider
    };
  } catch (error: any) {
    console.error('[TOOL] fetch_url_content error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: SCRAPE_PROVIDER
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// NOTICIAS
// ═══════════════════════════════════════════════════════════════

/**
 * Handler de get_news
 */
export async function getNewsHandler(args: { query: string; limit?: number }): Promise<ToolResult> {
  const { query, limit = 10 } = args;
  
  try {
    if (!GNEWS_API_KEY) {
      throw new Error('GNEWS_API_KEY no configurada');
    }

    console.log(`[TOOL] get_news: "${query}"`);

    const response = await axios.get('https://gnews.io/api/v4/search', {
      params: {
        q: query,
        token: GNEWS_API_KEY,
        max: limit,
        lang: 'es'
      },
      timeout: 15000
    });

    const data = {
      query,
      articles: response.data.articles?.map((article: any) => ({
        title: article.title,
        description: article.description,
        url: article.url,
        publishedAt: article.publishedAt,
        source: article.source.name
      })) || []
    };

    return {
      success: true,
      data,
      source: 'GNews API',
      timestamp: new Date().toISOString(),
      provider: 'gnews'
    };
  } catch (error: any) {
    console.error('[TOOL] get_news error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'gnews'
    };
  }
}
