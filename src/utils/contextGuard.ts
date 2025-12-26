/**
 * Context Window Guard - Previene OpenAI 400 por exceso de tokens
 * PRIORIDAD: identidad > historial > chunks
 * 
 * DISEÑO DETERMINISTA:
 * - No usa estimación de tokens (poco confiable)
 * - Usa límites por longitud de caracteres
 * - Límites configurables por env
 */

import { AssistantMessage } from '../ai/IAssistantProvider';

// 🔒 LÍMITES CONFIGURABLES (deterministas, no estimados)
const OPENAI_CONTEXT_LIMIT = parseInt(process.env.OPENAI_CONTEXT_LIMIT || '16000', 10);
const OPENAI_MAX_OUTPUT_TOKENS = parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || '500', 10);

// Límites por longitud de caracteres (determinista)
const MAX_MESSAGES_HISTORY = 12; // Máximo 12 mensajes históricos
const MAX_CHARS_PER_MESSAGE = 2000; // Máximo 2000 chars por mensaje
const MAX_CHUNKS = 3; // Máximo 3 chunks
const MAX_CHARS_PER_CHUNK = 2000; // Máximo 2000 chars por chunk

interface ContextGuardResult {
  messages: AssistantMessage[];
  systemPrompt: string;
  chunks: string;
  identityPreserved: boolean;
  wasTruncated: boolean;
}

export function guardContextWindow(
  messages: AssistantMessage[],
  systemPrompt: string,
  chunks: string = '',
  identityInjected: boolean = false
): ContextGuardResult {
  
  console.log(`[CONTEXT GUARD] Aplicando recorte determinista (max ${MAX_MESSAGES_HISTORY} msgs, ${MAX_CHUNKS} chunks)`);
  
  let truncated = false;
  
  // 1️⃣ SYSTEM PROMPT / IDENTIDAD (NUNCA TRUNCAR)
  const finalSystemPrompt = systemPrompt;
  console.log(`[CONTEXT GUARD] System prompt preservado (${systemPrompt.length} chars, identity=${identityInjected})`);
  
  // 2️⃣ CHUNKS (TRUNCAR PRIMERO - PRIORIDAD BAJA)
  let finalChunks = '';
  if (chunks && chunks.length > 0) {
    // Truncar por caracteres (no tokens)
    const maxChunkLength = MAX_CHUNKS * MAX_CHARS_PER_CHUNK;
    
    if (chunks.length <= maxChunkLength) {
      finalChunks = chunks;
    } else {
      finalChunks = chunks.substring(0, maxChunkLength) + '... [truncado]';
      truncated = true;
      console.log(`[CONTEXT GUARD] Chunks truncados: ${chunks.length} → ${maxChunkLength} chars`);
    }
  }
  
  // 3️⃣ HISTORIAL (RECORTAR DESDE EL MÁS VIEJO)
  let finalMessages = [...messages];
  
  // Límite estricto: máximo 12 mensajes
  if (finalMessages.length > MAX_MESSAGES_HISTORY) {
    const removed = finalMessages.length - MAX_MESSAGES_HISTORY;
    finalMessages = finalMessages.slice(-MAX_MESSAGES_HISTORY); // Últimos 12
    truncated = true;
    console.log(`[CONTEXT GUARD] Historial reducido: removidos ${removed} mensajes más antiguos`);
  }
  
  // Truncar cada mensaje por longitud de caracteres
  finalMessages = finalMessages.map((msg, idx) => {
    const msgContent = typeof msg.content === 'string' 
      ? msg.content 
      : JSON.stringify(msg.content);
    
    if (msgContent.length > MAX_CHARS_PER_MESSAGE) {
      truncated = true;
      console.log(`[CONTEXT GUARD] Mensaje ${idx} truncado: ${msgContent.length} → ${MAX_CHARS_PER_MESSAGE} chars`);
      
      return {
        ...msg,
        content: msgContent.substring(0, MAX_CHARS_PER_MESSAGE) + '... [truncado]'
      };
    }
    
    return msg;
  });
  
  console.log(`[CONTEXT GUARD] Resultado: ${finalMessages.length} msgs, ${finalChunks.length} chars de chunks (truncado: ${truncated})`);
  
  return {
    messages: finalMessages,
    systemPrompt: finalSystemPrompt,
    chunks: finalChunks,
    identityPreserved: identityInjected,
    wasTruncated: truncated
  };
}

export function getMaxOutputTokens(): number {
  return OPENAI_MAX_OUTPUT_TOKENS;
}
