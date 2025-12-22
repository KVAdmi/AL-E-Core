/**
 * Utilidades para detección y manejo de idiomas
 */

export interface LanguageDetection {
  primaryLanguage: string;
  confidence: number;
  isMultilingual: boolean;
  languages: Array<{ code: string; confidence: number }>;
}

/**
 * Detecta el idioma principal de un texto
 * Implementación simple basada en patrones comunes
 */
export function detectLanguage(text: string): LanguageDetection {
  if (!text || text.trim().length === 0) {
    return {
      primaryLanguage: 'en',
      confidence: 0.5,
      isMultilingual: false,
      languages: [{ code: 'en', confidence: 0.5 }]
    };
  }

  const cleanText = text.toLowerCase().trim();
  const languages: Array<{ code: string; confidence: number }> = [];
  
  // Patrones para español
  const spanishPatterns = [
    /\b(hola|gracias|por favor|sí|no|qué|cómo|dónde|cuándo|quién)\b/g,
    /\b(español|mexicano|argentina|españa|méxico)\b/g,
    /ñ/g,
    /[áéíóúü]/g
  ];
  
  // Patrones para inglés
  const englishPatterns = [
    /\b(hello|thanks|please|yes|no|what|how|where|when|who|the|and|or|but)\b/g,
    /\b(english|american|british|united states|usa)\b/g
  ];
  
  // Patrones para francés
  const frenchPatterns = [
    /\b(bonjour|merci|s'il vous plaît|oui|non|quoi|comment|où|quand|qui)\b/g,
    /\b(français|france|canadien)\b/g,
    /[àâäéèêëïîôöùûüÿç]/g
  ];

  // Contar coincidencias
  let spanishScore = 0;
  let englishScore = 0;
  let frenchScore = 0;

  spanishPatterns.forEach(pattern => {
    const matches = cleanText.match(pattern);
    spanishScore += matches ? matches.length : 0;
  });

  englishPatterns.forEach(pattern => {
    const matches = cleanText.match(pattern);
    englishScore += matches ? matches.length : 0;
  });

  frenchPatterns.forEach(pattern => {
    const matches = cleanText.match(pattern);
    frenchScore += matches ? matches.length : 0;
  });

  // Normalizar scores por longitud del texto
  const textLength = cleanText.split(' ').length;
  const normalizedSpanish = spanishScore / textLength;
  const normalizedEnglish = englishScore / textLength;
  const normalizedFrench = frenchScore / textLength;

  // Determinar idioma principal
  let primaryLanguage = 'en'; // default
  let maxScore = normalizedEnglish;
  
  if (normalizedSpanish > maxScore) {
    primaryLanguage = 'es';
    maxScore = normalizedSpanish;
  }
  
  if (normalizedFrench > maxScore) {
    primaryLanguage = 'fr';
    maxScore = normalizedFrench;
  }

  // Construir array de idiomas detectados
  if (normalizedSpanish > 0) {
    languages.push({ code: 'es', confidence: Math.min(normalizedSpanish, 1) });
  }
  if (normalizedEnglish > 0) {
    languages.push({ code: 'en', confidence: Math.min(normalizedEnglish, 1) });
  }
  if (normalizedFrench > 0) {
    languages.push({ code: 'fr', confidence: Math.min(normalizedFrench, 1) });
  }

  // Ordenar por confianza
  languages.sort((a, b) => b.confidence - a.confidence);

  // Si no se detectó nada específico, asumir inglés
  if (languages.length === 0) {
    languages.push({ code: 'en', confidence: 0.5 });
  }

  return {
    primaryLanguage,
    confidence: Math.max(maxScore, 0.3), // Mínimo 30% de confianza
    isMultilingual: languages.length > 1,
    languages
  };
}

/**
 * Determina el idioma de respuesta basado en el input del usuario y metadatos
 */
export function determineResponseLanguage(
  userMessage: string, 
  responseLanguageOverride?: string
): string {
  // Si hay override explícito, usarlo
  if (responseLanguageOverride && responseLanguageOverride !== 'auto') {
    return responseLanguageOverride;
  }

  // Detectar idioma del mensaje del usuario
  const detection = detectLanguage(userMessage);
  
  // Retornar el idioma principal detectado
  return detection.primaryLanguage;
}

/**
 * Genera instrucciones de idioma para el sistema prompt
 */
export function generateLanguageInstructions(targetLanguage: string): string {
  const instructions: Record<string, string> = {
    'es': 'Responde SIEMPRE en español, usando un tono natural y conversacional.',
    'en': 'Always respond in English, using a natural and conversational tone.',
    'fr': 'Réponds TOUJOURS en français, en utilisant un ton naturel et conversationnel.',
    'de': 'Antworte IMMER auf Deutsch, mit einem natürlichen und gesprächigen Ton.',
    'it': 'Rispondi SEMPRE in italiano, usando un tono naturale e colloquiale.',
    'pt': 'Responde SEMPRE em português, usando um tom natural e conversacional.'
  };

  return instructions[targetLanguage] || instructions['en'];
}