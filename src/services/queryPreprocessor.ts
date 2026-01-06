/**
 * =====================================================
 * QUERY PREPROCESSOR - MEJORA RECALL EN BÚSQUEDA RAG
 * =====================================================
 * 
 * Problema: Queries largas tienen baja similitud con chunks específicos
 * Solución: Extrae keywords técnicas y genera embedding complementario
 * 
 * Ejemplo:
 * Query: "cómo funciona el sistema de correos con IMAP y SMTP"
 * Keywords: ["IMAP", "SMTP", "correo", "sistema"]
 * → 2 búsquedas: original + keywords → merge top-K
 */

/**
 * Extrae keywords técnicas de una query
 * Prioriza: siglas, términos técnicos, nombres propios
 */
export function extractKeywords(query: string): string[] {
  const keywords: string[] = [];
  
  // 1. Extraer siglas (mayúsculas, 2+ chars)
  const acronyms = query.match(/\b[A-Z]{2,}\b/g) || [];
  keywords.push(...acronyms);
  
  // 2. Términos técnicos comunes (lowercase)
  const technicalTerms = [
    'oauth', 'api', 'smtp', 'imap', 'gmail', 'outlook', 'email', 
    'authentication', 'token', 'bearer', 'endpoint', 'webhook',
    'database', 'postgres', 'supabase', 'vector', 'embedding',
    'aws', 'ses', 'lambda', 'ec2', 's3', 'cognito',
    'jwt', 'session', 'cookie', 'header', 'body', 'request',
    'response', 'status', 'error', 'success', 'failure'
  ];
  
  const queryLower = query.toLowerCase();
  const foundTerms = technicalTerms.filter(term => queryLower.includes(term));
  keywords.push(...foundTerms);
  
  // 3. Palabras importantes (sustantivos técnicos, no stopwords)
  const words = query.toLowerCase().match(/\b\w{4,}\b/g) || [];
  const stopwords = ['cómo', 'funciona', 'sistema', 'puede', 'hacer', 'tiene', 'para', 'con', 'por', 'sobre'];
  const importantWords = words.filter(w => !stopwords.includes(w));
  keywords.push(...importantWords.slice(0, 5)); // Max 5 palabras
  
  // Deduplicar y retornar
  return [...new Set(keywords)];
}

/**
 * Detecta si una query es "larga" (necesita keyword extraction)
 */
export function isLongQuery(query: string): boolean {
  const wordCount = query.split(/\s+/).length;
  return wordCount > 6; // Más de 6 palabras = query larga
}

/**
 * Genera query optimizada para búsqueda
 * Si es larga → keywords, si es corta → original
 */
export function preprocessQuery(query: string): { 
  original: string; 
  keywords: string | null; 
  shouldMerge: boolean;
} {
  if (!isLongQuery(query)) {
    return {
      original: query,
      keywords: null,
      shouldMerge: false
    };
  }
  
  const extractedKeywords = extractKeywords(query);
  
  if (extractedKeywords.length === 0) {
    return {
      original: query,
      keywords: null,
      shouldMerge: false
    };
  }
  
  return {
    original: query,
    keywords: extractedKeywords.join(' '),
    shouldMerge: true
  };
}

/**
 * Merge y deduplica resultados de múltiples búsquedas
 * Prioriza por score, elimina duplicados por chunk_id
 */
export function mergeSearchResults(results1: any[], results2: any[]): any[] {
  const merged = [...results1, ...results2];
  
  // Deduplicar por chunk_id, mantener el de mayor score
  const deduped = new Map<string, any>();
  
  for (const result of merged) {
    const existing = deduped.get(result.chunk_id);
    if (!existing || result.score > existing.score) {
      deduped.set(result.chunk_id, result);
    }
  }
  
  // Ordenar por score descendente
  return Array.from(deduped.values())
    .sort((a, b) => b.score - a.score);
}
