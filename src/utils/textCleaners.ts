/**
 * Funciones para limpiar texto para TTS (speak_text)
 */

/**
 * Convierte texto markdown a texto plano para TTS
 * - Elimina markdown syntax (**, ##, [], etc)
 * - Acorta URLs largas
 * - Elimina code blocks
 * - Mantiene solo texto hablable
 */
export function markdownToSpeakable(text: string): string {
  let clean = text;

  // 1. Eliminar code blocks
  clean = clean.replace(/```[\s\S]*?```/g, '');
  clean = clean.replace(/`[^`]+`/g, '');

  // 2. Eliminar headers (###)
  clean = clean.replace(/^#{1,6}\s+/gm, '');

  // 3. Eliminar bold/italic (**texto**, *texto*, __texto__)
  clean = clean.replace(/\*\*([^*]+)\*\*/g, '$1');
  clean = clean.replace(/\*([^*]+)\*/g, '$1');
  clean = clean.replace(/__([^_]+)__/g, '$1');
  clean = clean.replace(/_([^_]+)_/g, '$1');

  // 4. Convertir links [texto](url) -> texto
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 5. Acortar URLs largas (más de 30 chars)
  clean = clean.replace(/https?:\/\/[^\s]{30,}/g, 'enlace');

  // 6. Eliminar bullet points
  clean = clean.replace(/^[•\-*]\s+/gm, '');

  // 7. Eliminar líneas vacías múltiples
  clean = clean.replace(/\n{3,}/g, '\n\n');

  // 8. Truncar a máximo 300 caracteres para TTS
  if (clean.length > 300) {
    clean = clean.substring(0, 297) + '...';
  }

  return clean.trim();
}

/**
 * Determina si una respuesta debe hablar
 * - true: Respuestas cortas, confirmaciones, resultados
 * - false: Respuestas con código, listas largas, enlaces múltiples
 */
export function shouldSpeak(text: string): boolean {
  // NO hablar si tiene code blocks
  if (text.includes('```')) return false;

  // NO hablar si tiene más de 3 URLs
  const urlCount = (text.match(/https?:\/\//g) || []).length;
  if (urlCount > 3) return false;

  // NO hablar si es muy largo (>500 chars)
  if (text.length > 500) return false;

  // NO hablar si tiene múltiples bullet points (lista larga)
  const bulletCount = (text.match(/^[•\-*]\s+/gm) || []).length;
  if (bulletCount > 5) return false;

  // SÍ hablar en otros casos
  return true;
}
