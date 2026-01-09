/**
 * Utilidades para AL-E CORE
 */

/**
 * Valida si un string es un UUID válido
 */
export function isUuid(str: string): boolean {
  if (!str) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Genera un título a partir de un texto (primeras 6-8 palabras)
 */
export function makeTitleFromText(text: string, maxWords: number = 8): string {
  if (!text || text.trim() === '') {
    return 'Nueva conversación';
  }
  
  const words = text.trim().split(/\s+/);
  const title = words.slice(0, maxWords).join(' ');
  
  if (words.length > maxWords) {
    return title + '...';
  }
  
  return title;
}

/**
 * Convierte un objeto a JSON de forma segura, sin fallar
 */
export function safeJson(obj: any): string {
  try {
    // Usar replacer para manejar referencias circulares
    const seen = new WeakSet();
    return JSON.stringify(obj, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]';
        }
        seen.add(value);
      }
      return value;
    });
  } catch (error) {
    console.error('[SAFE-JSON] Error serializando objeto:', error);
    return '{}';
  }
}

/**
 * Parsea JSON de forma segura, devuelve objeto vacío si falla
 */
export function safeJsonParse(str: string): any {
  try {
    return JSON.parse(str);
  } catch (error) {
    return {};
  }
}

/**
 * Calcula tokens aproximados (estimación simple)
 * 1 token ≈ 4 caracteres en inglés
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Calcula costo aproximado en USD
 * GPT-4: $0.03/1K tokens input, $0.06/1K tokens output
 */
export function estimateCost(inputTokens: number, outputTokens: number, model: string = 'gpt-4'): number {
  if (model.includes('gpt-4')) {
    const inputCost = (inputTokens / 1000) * 0.03;
    const outputCost = (outputTokens / 1000) * 0.06;
    return inputCost + outputCost;
  }
  // Default: GPT-3.5 pricing
  const inputCost = (inputTokens / 1000) * 0.0015;
  const outputCost = (outputTokens / 1000) * 0.002;
  return inputCost + outputCost;
}
