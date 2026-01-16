/**
 * ═══════════════════════════════════════════════════════════════
 * OPENAI REFEREE - Árbitro de Verdad para AL-E Core
 * ═══════════════════════════════════════════════════════════════
 * 
 * OpenAI como árbitro de última instancia cuando Groq:
 * - Se niega a ejecutar tools
 * - Responde con "no tengo acceso"
 * - Inventa contenido sin evidencia
 * - Contradice tool results
 * 
 * LÍMITES CONTROLADOS:
 * - Max 200 llamadas/día
 * - Max $20 USD/mes
 * - Solo activación por triggers específicos
 * 
 * ═══════════════════════════════════════════════════════════════
 */

import axios from 'axios';
import { LlmMessage } from './router';

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type RefereeReason = 
  | 'tool_not_executed'
  | 'defensive_response'
  | 'hallucination_detected'
  | 'evidence_mismatch'
  | 'groq_refusal';

export interface RefereeContext {
  userPrompt: string;
  groqResponse: string;
  toolResults?: Record<string, any>;
  systemState?: Record<string, any>;
  detectedIssue: RefereeReason;
}

export interface RefereeResponse {
  text: string;
  reason: RefereeReason;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_estimated_usd: number;
  model_used: string;
}

// ═══════════════════════════════════════════════════════════════
// CONTROL DE COSTOS
// ═══════════════════════════════════════════════════════════════

const MAX_CALLS_PER_DAY = 200;
const MAX_COST_PER_MONTH_USD = 20;

// In-memory tracking (migrar a Redis si es necesario)
const dailyStats = {
  calls: 0,
  lastReset: new Date().toDateString()
};

const monthlyStats = {
  cost: 0,
  lastReset: new Date().toISOString().slice(0, 7) // YYYY-MM
};

/**
 * Verificar si podemos hacer una llamada a OpenAI
 */
function canMakeRefereeCall(): { allowed: boolean; reason?: string } {
  const today = new Date().toDateString();
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  // Reset diario
  if (dailyStats.lastReset !== today) {
    dailyStats.calls = 0;
    dailyStats.lastReset = today;
  }
  
  // Reset mensual
  if (monthlyStats.lastReset !== currentMonth) {
    monthlyStats.cost = 0;
    monthlyStats.lastReset = currentMonth;
  }
  
  // Verificar límites
  if (dailyStats.calls >= MAX_CALLS_PER_DAY) {
    return { allowed: false, reason: `Daily limit reached (${MAX_CALLS_PER_DAY} calls)` };
  }
  
  if (monthlyStats.cost >= MAX_COST_PER_MONTH_USD) {
    return { allowed: false, reason: `Monthly budget exceeded ($${MAX_COST_PER_MONTH_USD})` };
  }
  
  return { allowed: true };
}

/**
 * Registrar uso y costo
 */
function recordUsage(tokensIn: number, tokensOut: number): number {
  // Pricing gpt-4o-mini (Enero 2026):
  // Input: $0.150 / 1M tokens
  // Output: $0.600 / 1M tokens
  const costInput = (tokensIn / 1_000_000) * 0.15;
  const costOutput = (tokensOut / 1_000_000) * 0.60;
  const totalCost = costInput + costOutput;
  
  dailyStats.calls++;
  monthlyStats.cost += totalCost;
  
  return totalCost;
}

// ═══════════════════════════════════════════════════════════════
// DETECCIÓN DE PROBLEMAS
// ═══════════════════════════════════════════════════════════════

/**
 * Detectar si Groq evadió la ejecución
 */
export function detectGroqEvasion(
  groqResponse: string,
  toolsAvailable: boolean,
  toolsExecuted: boolean
): { needsReferee: boolean; reason?: RefereeReason } {
  
  const response = groqResponse.toLowerCase();
  
  // Patrón 1: Frases defensivas
  const defensivePhrases = [
    'no tengo acceso',
    'no puedo acceder',
    'no tengo la capacidad',
    'como modelo de lenguaje',
    'no puedo realizar',
    'no tengo información',
    'no dispongo de',
    'actualmente no puedo'
  ];
  
  const hasDefensivePhrase = defensivePhrases.some(phrase => response.includes(phrase));
  
  if (hasDefensivePhrase && toolsAvailable) {
    return { 
      needsReferee: true, 
      reason: 'defensive_response' 
    };
  }
  
  // Patrón 2: Tools disponibles pero no ejecutados
  if (toolsAvailable && !toolsExecuted && response.length < 50) {
    return { 
      needsReferee: true, 
      reason: 'tool_not_executed' 
    };
  }
  
  // Patrón 3: Placeholders o contenido inventado
  const placeholderPatterns = [
    /\[.*?\]/g,  // [nombre], [empresa]
    /\{.*?\}/g,  // {variable}
    /example@/,  // email de ejemplo
    /xxx/i
  ];
  
  const hasPlaceholders = placeholderPatterns.some(pattern => pattern.test(groqResponse));
  
  if (hasPlaceholders && toolsAvailable) {
    return { 
      needsReferee: true, 
      reason: 'hallucination_detected' 
    };
  }
  
  return { needsReferee: false };
}

/**
 * Detectar contradicción entre tool results y respuesta
 */
export function detectEvidenceMismatch(
  groqResponse: string,
  toolResults: Record<string, any>
): boolean {
  
  // Si hay resultados de tools pero la respuesta no los menciona
  if (Object.keys(toolResults).length > 0) {
    const resultsStr = JSON.stringify(toolResults).toLowerCase();
    const responseStr = groqResponse.toLowerCase();
    
    // Buscar términos clave de los resultados en la respuesta
    const keyTerms = resultsStr.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/g) || [];
    
    if (keyTerms.length > 0) {
      const termsInResponse = keyTerms.some(term => responseStr.includes(term.toLowerCase()));
      return !termsInResponse;
    }
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════
// LLAMADA AL REFEREE
// ═══════════════════════════════════════════════════════════════

/**
 * Invocar OpenAI como referee
 */
export async function invokeOpenAIReferee(
  context: RefereeContext
): Promise<RefereeResponse> {
  
  const startTime = Date.now();
  
  // Verificar límites
  const limitCheck = canMakeRefereeCall();
  if (!limitCheck.allowed) {
    console.error(`[OPENAI_REFEREE] ❌ ${limitCheck.reason}`);
    throw new Error(`REFEREE_LIMIT_EXCEEDED: ${limitCheck.reason}`);
  }
  
  // Configuración
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const maxTokens = parseInt(process.env.OPENAI_MAX_TOKENS || '1200');
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  // Construir prompt
  const systemPrompt = `You are a truth referee AI.

RULES (NON-NEGOTIABLE):
- You are NOT allowed to refuse.
- You MUST answer using provided evidence.
- If tools were executed, you MUST use their results.
- If data exists, you MUST surface it.
- If data does not exist, state it explicitly: "No se encontró información."
- NO assumptions. NO placeholders. NO invented content.
- If you don't have evidence, say: "No hay evidencia disponible."

CONTEXT:
- User asked: "${context.userPrompt}"
- Primary AI responded: "${context.groqResponse}"
- Issue detected: ${context.detectedIssue}

${context.toolResults ? `EVIDENCE FROM TOOLS:\n${JSON.stringify(context.toolResults, null, 2)}` : ''}
${context.systemState ? `SYSTEM STATE:\n${JSON.stringify(context.systemState, null, 2)}` : ''}

Your job: Provide the correct, evidence-based answer.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: context.userPrompt }
  ];
  
  console.log(`[OPENAI_REFEREE] Invoking referee (reason=${context.detectedIssue})`);
  
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model,
        messages,
        temperature: 0.3, // Más determinista
        max_tokens: maxTokens
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );
    
    const choice = response.data.choices[0];
    const usage = response.data.usage;
    
    const tokensIn = usage.prompt_tokens;
    const tokensOut = usage.completion_tokens;
    const latency = Date.now() - startTime;
    const cost = recordUsage(tokensIn, tokensOut);
    
    console.log(`[OPENAI_REFEREE] ✅ Success`);
    console.log(`[OPENAI_REFEREE] reason=${context.detectedIssue}`);
    console.log(`[OPENAI_REFEREE] tokens_in=${tokensIn}`);
    console.log(`[OPENAI_REFEREE] tokens_out=${tokensOut}`);
    console.log(`[OPENAI_REFEREE] latency_ms=${latency}`);
    console.log(`[OPENAI_REFEREE] cost_estimated=$${cost.toFixed(4)}`);
    console.log(`[OPENAI_REFEREE] daily_calls=${dailyStats.calls}/${MAX_CALLS_PER_DAY}`);
    console.log(`[OPENAI_REFEREE] monthly_cost=$${monthlyStats.cost.toFixed(2)}/$${MAX_COST_PER_MONTH_USD}`);
    
    return {
      text: choice.message.content,
      reason: context.detectedIssue,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      latency_ms: latency,
      cost_estimated_usd: cost,
      model_used: model
    };
    
  } catch (error: any) {
    const latency = Date.now() - startTime;
    
    console.error(`[OPENAI_REFEREE] ❌ Error: ${error.message}`);
    console.error(`[OPENAI_REFEREE] latency_ms=${latency}`);
    
    throw new Error(`OPENAI_REFEREE_FAILED: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════

/**
 * Obtener estadísticas de uso
 */
export function getRefereeStats() {
  return {
    daily: {
      calls: dailyStats.calls,
      limit: MAX_CALLS_PER_DAY,
      remaining: MAX_CALLS_PER_DAY - dailyStats.calls,
      date: dailyStats.lastReset
    },
    monthly: {
      cost: monthlyStats.cost,
      limit: MAX_COST_PER_MONTH_USD,
      remaining: MAX_COST_PER_MONTH_USD - monthlyStats.cost,
      month: monthlyStats.lastReset
    }
  };
}
