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
 * CRÍTICO: Formato AGRESIVO para que el modelo NO pueda ignorar los resultados
 */
export function formatTavilyResults(searchResponse: TavilySearchResponse): string {
  if (!searchResponse.success || searchResponse.results.length === 0) {
    return `

⚠️⚠️⚠️ ATENCIÓN CRÍTICA ⚠️⚠️⚠️
La búsqueda web se ejecutó pero NO encontró resultados para: "${searchResponse.query}"

INSTRUCCIÓN OBLIGATORIA:
Debes informar al usuario que:
1. La búsqueda web se ejecutó correctamente
2. No se encontraron resultados públicos para "${searchResponse.query}"
3. NO inventes información ni uses memoria interna como sustituto
4. Sugiere que el usuario verifique la ortografía o proporcione más detalles

PROHIBIDO: Inventar que "no tienes acceso" o "no puedes buscar"
LA BÚSQUEDA YA SE EJECUTÓ. Solo no encontró resultados.
`;
  }

  let formatted = `

╔════════════════════════════════════════════════════════════════╗
║  🌐 RESULTADOS DE BÚSQUEDA WEB (Tavily)                        ║
║  ESTOS SON DATOS REALES DE INTERNET - ÚSALOS OBLIGATORIAMENTE ║
╚════════════════════════════════════════════════════════════════╝

🔍 Query ejecutada: "${searchResponse.query}"
✅ Resultados encontrados: ${searchResponse.results.length}
⏱️ Tiempo de respuesta: ${searchResponse.responseTime}ms

`;

  searchResponse.results.forEach((result, idx) => {
    formatted += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 RESULTADO ${idx + 1} de ${searchResponse.results.length}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 Título: ${result.title}
🔗 URL: ${result.url}
⭐ Relevancia: ${(result.score * 100).toFixed(0)}%${result.publishedDate ? `\n📅 Fecha: ${result.publishedDate}` : ''}

📝 Contenido verificado:
${result.content}

`;
  });

  formatted += `
╔════════════════════════════════════════════════════════════════╗
║  ⚠️ INSTRUCCIONES OBLIGATORIAS (NO NEGOCIABLES)                ║
╚════════════════════════════════════════════════════════════════╝

✅ DEBES usar ESTOS resultados para responder al usuario
✅ DEBES citar las fuentes con formato: [Título](URL)
✅ DEBES priorizar el Resultado #1 (mayor relevancia)
❌ PROHIBIDO inventar información que no esté en estos resultados
❌ PROHIBIDO decir "buscando..." o "*buscando*" (la búsqueda YA se ejecutó)
❌ PROHIBIDO mezclar memoria interna con estos facts externos
❌ PROHIBIDO sugerir "alternativas" si los resultados son claros

EJEMPLO DE RESPUESTA CORRECTA:
"Encontré información sobre [tema]:

Según [Título del Resultado 1]([URL]), [contenido del resultado].

Fuente: ${searchResponse.results[0]?.url || '[URL del resultado 1]'}"

AHORA RESPONDE USANDO ESTOS DATOS REALES.
`;

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
    'verifica', 'checa', 'confirma', 'valida', 'validar',
    've a', 'accede a', 'mira en',
    'consulta', 'revisa en',
    // Conjugaciones futuras y progresivas (CRÍTICO para "voy a buscar")
    'voy a buscar', 'voy a validar', 'voy a verificar', 'voy a consultar',
    'vamos a buscar', 'vamos a validar', 'vamos a verificar',
    'déjame buscar', 'déjame verificar', 'déjame validar',
    'puedes buscar', 'puedes verificar', 'puedes validar'
  ];
  
  // TIER 2: Keywords de verificación externa (ALTA PRIORIDAD)
  const verificationKeywords = [
    'existe', 'existencia', 'tiene página', 'tiene web', 'tiene sitio',
    'url', 'dominio', 'website', 'sitio web', 'página web',
    'oficial', 'público', 'publicado',
    'información sobre', 'info sobre', 'datos sobre',
    'qué es', 'quién es', 'dónde está',
    'cuándo', 'fecha', 'año',
    // Financiero/Verificación de datos
    'tipo de cambio', 'tasa', 'cotización', 'valor actual'
  ];
  
  // TIER 3: Keywords de entidades externas (EMPRESAS, PRODUCTOS, FINANCIERO)
  const entityKeywords = [
    'empresa', 'compañía', 'startup', 'corporación', 'organización',
    'producto', 'servicio', 'plataforma', 'software', 'app',
    'marca', 'brand', 'negocio', 'comercio',
    // Financiero
    'moneda', 'divisa', 'dólar', 'peso', 'euro', 'bitcoin', 'cripto',
    'bolsa', 'acción', 'mercado', 'índice'
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
  const hasTemporal = temporalKeywords.some(kw => lowerMsg.includes(kw));
  
  if (hasVerification && hasEntity) {
    console.log('[TAVILY] ✓ Tier 2: Verificación de entidad externa detectada');
    return true;
  }
  
  // TIER 2.5 CRÍTICO: Verificación + Temporal (DATOS FINANCIEROS/ACTUALIDAD)
  // Ejemplo: "tipo de cambio actual" → tiene verificación (tipo de cambio) + temporal (actual)
  if (hasVerification && hasTemporal) {
    console.log('[TAVILY] ✓ Tier 2.5: Verificación de datos actuales (financiero/temporal)');
    return true;
  }
  
  // VERIFICACIÓN TIER 3: Patterns de pregunta (REGEX)
  if (questionPatterns.some(pattern => pattern.test(lowerMsg))) {
    console.log('[TAVILY] ✓ Tier 3: Patrón de pregunta sobre facts externos');
    return true;
  }
  
  // VERIFICACIÓN TIER 4: Temporal + Entidad (INFORMACIÓN ACTUAL)
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
