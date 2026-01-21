import { callMistral, BedrockMessage } from './bedrockClient';
import Groq from 'groq-sdk';
import OpenAI from 'openai';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type Provider = 'bedrock_mistral' | 'groq' | 'openai';
export type Route = 'chat' | 'voice' | 'meetings' | 'documents' | 'tool_calling';

interface CircuitBreakerState {
  isDown: boolean;
  downUntil: number; // timestamp
  failureCount: number;
}

// Circuit breakers por provider (anti-429)
const circuitBreakers: Record<Provider, CircuitBreakerState> = {
  bedrock_mistral: { isDown: false, downUntil: 0, failureCount: 0 },
  groq: { isDown: false, downUntil: 0, failureCount: 0 },
  openai: { isDown: false, downUntil: 0, failureCount: 0 }
};

const CIRCUIT_BREAKER_TIMEOUT = 5 * 60 * 1000; // 5 minutos
const MAX_FAILURES = 3;

/**
 * Marca un provider como down temporalmente
 */
function tripCircuitBreaker(provider: Provider) {
  const breaker = circuitBreakers[provider];
  breaker.failureCount++;
  
  if (breaker.failureCount >= MAX_FAILURES) {
    breaker.isDown = true;
    breaker.downUntil = Date.now() + CIRCUIT_BREAKER_TIMEOUT;
    console.log(`[ROUTER] 🔴 Circuit breaker OPEN para ${provider} por ${CIRCUIT_BREAKER_TIMEOUT/1000}s`);
  }
}

/**
 * Resetea circuit breaker si ya pasó el timeout
 */
function checkCircuitBreaker(provider: Provider): boolean {
  const breaker = circuitBreakers[provider];
  
  if (breaker.isDown && Date.now() > breaker.downUntil) {
    breaker.isDown = false;
    breaker.failureCount = 0;
    console.log(`[ROUTER] 🟢 Circuit breaker CLOSED para ${provider}`);
  }
  
  return !breaker.isDown;
}

/**
 * Decide qué provider usar según la ruta y disponibilidad
 */
export function selectProvider(route: Route, requiresTools: boolean): Provider {
  console.log(`[ROUTER] 🎯 Seleccionando provider para route=${route}, requiresTools=${requiresTools}`);
  
  // RULE 1: Tool-calling crítico -> Groq (o OpenAI fallback)
  if (requiresTools) {
    if (checkCircuitBreaker('groq')) {
      console.log('[ROUTER] ✅ Groq seleccionado para tool-calling');
      return 'groq';
    }
    // Fallback: OpenAI
    if (checkCircuitBreaker('openai')) {
      console.log('[ROUTER] ⚠️ Groq down, fallback a OpenAI para tools');
      return 'openai';
    }
    throw new Error('No hay provider disponible para tool-calling');
  }
  
  // RULE 2: Voz -> Groq obligatorio
  if (route === 'voice') {
    if (checkCircuitBreaker('groq')) {
      console.log('[ROUTER] ✅ Groq seleccionado para voz');
      return 'groq';
    }
    throw new Error('Groq no disponible para modo voz');
  }
  
  // RULE 3: Razonamiento/chat/documentos -> Mistral Large 3 (Bedrock)
  if (route === 'chat' || route === 'documents') {
    if (checkCircuitBreaker('bedrock_mistral')) {
      console.log('[ROUTER] ✅ Mistral Large 3 seleccionado para razonamiento');
      return 'bedrock_mistral';
    }
    // Fallback: Groq
    if (checkCircuitBreaker('groq')) {
      console.log('[ROUTER] ⚠️ Mistral down, fallback a Groq');
      return 'groq';
    }
    // Último fallback: OpenAI
    if (checkCircuitBreaker('openai')) {
      console.log('[ROUTER] ⚠️ Todo down, último fallback OpenAI');
      return 'openai';
    }
  }
  
  // Default: Mistral
  console.log('[ROUTER] ✅ Default: Mistral Large 3');
  return 'bedrock_mistral';
}

export interface ProviderResponse {
  final_answer: string;
  provider_used: Provider;
  usage?: any;
  stop_reason?: string;
}

/**
 * Llama al provider seleccionado con manejo de errores y circuit breaker
 */
export async function callProvider(
  provider: Provider,
  messages: any[],
  systemPrompt: string,
  tools?: any[]
): Promise<ProviderResponse> {
  try {
    console.log(`[ROUTER] 📡 Llamando a ${provider}...`);
    
    switch (provider) {
      case 'bedrock_mistral': {
        const bedrockMessages: BedrockMessage[] = messages.map(m => ({
          role: m.role === 'system' ? 'user' : m.role,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }));
        
        const response = await callMistral(bedrockMessages, 2048, systemPrompt);
        
        circuitBreakers.bedrock_mistral.failureCount = 0;
        
        return {
          final_answer: response.content,
          provider_used: 'bedrock_mistral',
          usage: response.usage,
          stop_reason: response.stop_reason
        };
      }
      
      case 'groq': {
        const response = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 2048,
          temperature: 0.7,
          tools: tools,
          tool_choice: tools ? 'auto' : undefined
        });
        
        circuitBreakers.groq.failureCount = 0;
        
        return {
          final_answer: response.choices[0].message.content || '',
          provider_used: 'groq',
          usage: response.usage
        };
      }
      
      case 'openai': {
        const response = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          max_tokens: 2048,
          tools: tools,
          tool_choice: tools ? 'auto' : undefined
        });
        
        circuitBreakers.openai.failureCount = 0;
        
        return {
          final_answer: response.choices[0].message.content || '',
          provider_used: 'openai',
          usage: response.usage
        };
      }
      
      default:
        throw new Error(`Provider desconocido: ${provider}`);
    }
  } catch (error: any) {
    console.error(`[ROUTER] ❌ Error en ${provider}:`, error.message);
    
    // Check si es rate limit (429) o error recuperable
    if (error.status === 429 || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      tripCircuitBreaker(provider);
    }
    
    throw error;
  }
}
