/**
 * OpenAI Rate Limiter - P0 COST CONTROL
 * 
 * Límites estrictos para evitar costos no controlados
 */

interface OpenAIUsage {
  callsPerMinute: number[];
  callsPerHour: number[];
  callsPerDay: number[];
  monthlyUSD: number;
  tokensUsed: number;
  lastReset: {
    minute: number;
    hour: number;
    day: number;
    month: number;
  };
}

const OPENAI_LIMITS = {
  maxCallsPerMinute: 60,     // Aumentado para uso intensivo
  maxCallsPerHour: 500,      // Suficiente para día de trabajo completo
  maxCallsPerDay: 2000,      // Cubre múltiples usuarios
  maxMonthlyUSD: 100,        // Ajustable según presupuesto
  maxTokensPerCall: 600
};

// In-memory storage (en producción usar Redis)
const usage: OpenAIUsage = {
  callsPerMinute: [],
  callsPerHour: [],
  callsPerDay: [],
  monthlyUSD: 0,
  tokensUsed: 0,
  lastReset: {
    minute: Date.now(),
    hour: Date.now(),
    day: Date.now(),
    month: Date.now(),
  },
};

/**
 * Limpia contadores vencidos
 */
function cleanupCounters() {
  const now = Date.now();
  
  // Limpiar minuto (>60s)
  if (now - usage.lastReset.minute > 60000) {
    usage.callsPerMinute = [];
    usage.lastReset.minute = now;
  }
  
  // Limpiar hora (>60min)
  if (now - usage.lastReset.hour > 3600000) {
    usage.callsPerHour = [];
    usage.lastReset.hour = now;
  }
  
  // Limpiar día (>24h)
  if (now - usage.lastReset.day > 86400000) {
    usage.callsPerDay = [];
    usage.lastReset.day = now;
  }
  
  // Limpiar mes (>30 días)
  if (now - usage.lastReset.month > 2592000000) {
    usage.monthlyUSD = 0;
    usage.lastReset.month = now;
  }
}

/**
 * Verifica si se puede hacer una llamada a OpenAI
 */
export function canCallOpenAI(): { allowed: boolean; reason?: string; limit?: string } {
  cleanupCounters();
  
  const now = Date.now();
  
  // Verificar límite de llamadas por minuto
  const recentMinuteCalls = usage.callsPerMinute.filter(t => now - t < 60000).length;
  if (recentMinuteCalls >= OPENAI_LIMITS.maxCallsPerMinute) {
    return {
      allowed: false,
      reason: `Límite de ${OPENAI_LIMITS.maxCallsPerMinute} llamadas/minuto excedido`,
      limit: 'per_minute'
    };
  }
  
  // Verificar límite de llamadas por hora
  const recentHourCalls = usage.callsPerHour.filter(t => now - t < 3600000).length;
  if (recentHourCalls >= OPENAI_LIMITS.maxCallsPerHour) {
    return {
      allowed: false,
      reason: `Límite de ${OPENAI_LIMITS.maxCallsPerHour} llamadas/hora excedido`,
      limit: 'per_hour'
    };
  }
  
  // Verificar límite de llamadas por día
  const recentDayCalls = usage.callsPerDay.filter(t => now - t < 86400000).length;
  if (recentDayCalls >= OPENAI_LIMITS.maxCallsPerDay) {
    return {
      allowed: false,
      reason: `Límite de ${OPENAI_LIMITS.maxCallsPerDay} llamadas/día excedido`,
      limit: 'per_day'
    };
  }
  
  // Verificar límite de gasto mensual
  if (usage.monthlyUSD >= OPENAI_LIMITS.maxMonthlyUSD) {
    return {
      allowed: false,
      reason: `Límite de $${OPENAI_LIMITS.maxMonthlyUSD} USD/mes excedido (gastado: $${usage.monthlyUSD.toFixed(2)})`,
      limit: 'monthly_usd'
    };
  }
  
  return { allowed: true };
}

/**
 * Registra una llamada a OpenAI
 */
export function recordOpenAICall(tokens: number, estimatedCostUSD: number) {
  const now = Date.now();
  
  usage.callsPerMinute.push(now);
  usage.callsPerHour.push(now);
  usage.callsPerDay.push(now);
  usage.tokensUsed += tokens;
  usage.monthlyUSD += estimatedCostUSD;
  
  console.log('[OPENAI LIMITER] 📊 Call recorded:');
  console.log(`  - Tokens: ${tokens}`);
  console.log(`  - Cost: $${estimatedCostUSD.toFixed(4)}`);
  console.log(`  - Calls (min/hour/day): ${usage.callsPerMinute.length}/${usage.callsPerHour.length}/${usage.callsPerDay.length}`);
  console.log(`  - Monthly spent: $${usage.monthlyUSD.toFixed(2)} / $${OPENAI_LIMITS.maxMonthlyUSD}`);
}

/**
 * Obtiene estadísticas de uso actuales
 */
export function getOpenAIUsageStats() {
  cleanupCounters();
  const now = Date.now();
  
  return {
    callsPerMinute: usage.callsPerMinute.filter(t => now - t < 60000).length,
    callsPerHour: usage.callsPerHour.filter(t => now - t < 3600000).length,
    callsPerDay: usage.callsPerDay.filter(t => now - t < 86400000).length,
    monthlyUSD: usage.monthlyUSD,
    limits: OPENAI_LIMITS,
    remainingCalls: {
      perMinute: OPENAI_LIMITS.maxCallsPerMinute - usage.callsPerMinute.filter(t => now - t < 60000).length,
      perHour: OPENAI_LIMITS.maxCallsPerHour - usage.callsPerHour.filter(t => now - t < 3600000).length,
      perDay: OPENAI_LIMITS.maxCallsPerDay - usage.callsPerDay.filter(t => now - t < 86400000).length,
    },
    remainingBudget: OPENAI_LIMITS.maxMonthlyUSD - usage.monthlyUSD,
  };
}

/**
 * Estima el costo de una llamada basado en tokens
 * gpt-4o-mini: $0.150 / 1M input tokens, $0.600 / 1M output tokens
 */
export function estimateOpenAICost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * 0.150;
  const outputCost = (outputTokens / 1_000_000) * 0.600;
  return inputCost + outputCost;
}
