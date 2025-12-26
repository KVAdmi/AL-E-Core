/**
 * LLM Router Multi-Provider (OpenAI-Compatible)
 * 
 * Router de proveedores sin dependencia de OpenAI
 * - Default: Groq (rápido, económico)
 * - Fallback 1: Fireworks (alta estabilidad)
 * - Fallback 2: Together (backup opcional)
 * 
 * CRITICAL: OpenAI está BLOQUEADO completamente
 */

import axios, { AxiosError } from 'axios';

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type LlmProvider = 'groq' | 'fireworks' | 'together';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmGenerateOptions {
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  model?: string; // Opcional: override del modelo default del provider
}

export interface LlmResponse {
  text: string;
  model_used: string;
  provider_used: LlmProvider;
  tokens_in?: number;
  tokens_out?: number;
  finish_reason?: string;
  raw?: any;
}

export interface FallbackChain {
  attempted: LlmProvider[];
  final_provider: LlmProvider;
  fallback_used: boolean;
  errors: Record<LlmProvider, string>;
}

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE PROVEEDORES
// ═══════════════════════════════════════════════════════════════

interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  defaultModel: string;
  timeout: number;
}

const PROVIDER_CONFIGS: Record<LlmProvider, () => ProviderConfig | null> = {
  groq: () => {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return null;
    
    return {
      baseURL: 'https://api.groq.com/openai/v1',
      apiKey,
      defaultModel: 'llama-3.3-70b-versatile',
      timeout: 12000 // 12s
    };
  },
  
  fireworks: () => {
    const apiKey = process.env.FIREWORKS_API_KEY;
    if (!apiKey) return null;
    
    return {
      baseURL: 'https://api.fireworks.ai/inference/v1',
      apiKey,
      defaultModel: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
      timeout: 15000 // 15s
    };
  },
  
  together: () => {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) return null;
    
    return {
      baseURL: 'https://api.together.xyz/v1',
      apiKey,
      defaultModel: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      timeout: 15000 // 15s
    };
  }
};

// ═══════════════════════════════════════════════════════════════
// LLAMADA OPENAI-COMPATIBLE
// ═══════════════════════════════════════════════════════════════

/**
 * Llamar a endpoint OpenAI-compatible (/chat/completions)
 */
async function callOpenAICompatible(
  config: ProviderConfig,
  provider: LlmProvider,
  options: LlmGenerateOptions
): Promise<LlmResponse> {
  const model = options.model || config.defaultModel;
  
  try {
    console.log(`[LLM_ROUTER] Calling ${provider} with model ${model}`);
    
    const response = await axios.post(
      `${config.baseURL}/chat/completions`,
      {
        model,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 600,
        top_p: options.topP ?? 0.95
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: config.timeout
      }
    );

    const choice = response.data.choices?.[0];
    const usage = response.data.usage;
    
    if (!choice?.message?.content) {
      throw new Error(`${provider.toUpperCase()}_INVALID_RESPONSE: No content in response`);
    }

    console.log(`[LLM_ROUTER] ✓ ${provider} success: ${usage?.completion_tokens || '?'} tokens`);

    return {
      text: choice.message.content,
      model_used: response.data.model || model,
      provider_used: provider,
      tokens_in: usage?.prompt_tokens,
      tokens_out: usage?.completion_tokens,
      finish_reason: choice.finish_reason,
      raw: response.data
    };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      const status = axiosError.response?.status;
      const message = axiosError.message;
      
      // Clasificar errores para fallback
      if (status === 429) {
        throw new Error(`${provider.toUpperCase()}_RATE_LIMIT: ${message}`);
      } else if (status && status >= 500) {
        throw new Error(`${provider.toUpperCase()}_SERVER_ERROR: ${status}`);
      } else if (axiosError.code === 'ECONNABORTED') {
        throw new Error(`${provider.toUpperCase()}_TIMEOUT: ${message}`);
      } else {
        throw new Error(`${provider.toUpperCase()}_ERROR: ${message}`);
      }
    }
    
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════
// ROUTER PRINCIPAL
// ═══════════════════════════════════════════════════════════════

/**
 * Generar respuesta con fallback automático
 * 
 * Orden de fallback:
 * 1. Default provider (configurable, default=groq)
 * 2. Fallback 1 (configurable, default=fireworks)
 * 3. Fallback 2 (configurable, default=together)
 * 
 * CRITICAL: OpenAI está BLOQUEADO (no se usa bajo ninguna circunstancia)
 */
export async function generate(
  options: LlmGenerateOptions
): Promise<{ response: LlmResponse; fallbackChain: FallbackChain }> {
  
  // Bloqueo total OpenAI
  if (process.env.OPENAI_API_KEY) {
    console.warn('[LLM_ROUTER] ⚠️ OPENAI_API_KEY detected but OpenAI is DISABLED');
  }
  
  // Determinar cadena de proveedores
  const defaultProvider = (process.env.LLM_DEFAULT_PROVIDER as LlmProvider) || 'groq';
  const fallback1 = (process.env.LLM_FALLBACK_PROVIDER as LlmProvider) || 'fireworks';
  const fallback2 = (process.env.LLM_FALLBACK2_PROVIDER as LlmProvider) || 'together';
  
  const providerChain: LlmProvider[] = [
    defaultProvider,
    ...(fallback1 !== defaultProvider ? [fallback1] : []),
    ...(fallback2 !== defaultProvider && fallback2 !== fallback1 ? [fallback2] : [])
  ];
  
  console.log(`[LLM_ROUTER] Provider chain: ${providerChain.join(' → ')}`);
  
  const fallbackChain: FallbackChain = {
    attempted: [],
    final_provider: defaultProvider,
    fallback_used: false,
    errors: {} as Record<LlmProvider, string>
  };
  
  // Intentar proveedores en orden
  for (const provider of providerChain) {
    fallbackChain.attempted.push(provider);
    
    const config = PROVIDER_CONFIGS[provider]();
    
    if (!config) {
      const error = `${provider.toUpperCase()}_API_KEY not configured`;
      console.warn(`[LLM_ROUTER] ⚠️ ${error}`);
      fallbackChain.errors[provider] = error;
      continue;
    }
    
    try {
      const response = await callOpenAICompatible(config, provider, options);
      
      fallbackChain.final_provider = provider;
      fallbackChain.fallback_used = (fallbackChain.attempted.length > 1);
      
      if (fallbackChain.fallback_used) {
        console.log(`[LLM_ROUTER] ✓ Fallback successful: ${fallbackChain.attempted.join(' → ')}`);
      }
      
      return { response, fallbackChain };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';
      console.error(`[LLM_ROUTER] ✗ ${provider} failed: ${errorMessage}`);
      fallbackChain.errors[provider] = errorMessage;
      
      // Si es el último en la cadena, lanzar error final
      if (provider === providerChain[providerChain.length - 1]) {
        throw new Error(`LLM_ALL_PROVIDERS_FAILED: ${JSON.stringify(fallbackChain.errors)}`);
      }
      
      // Continuar con siguiente proveedor
      console.log(`[LLM_ROUTER] Trying fallback...`);
    }
  }
  
  // No debería llegar aquí, pero por seguridad
  throw new Error('LLM_NO_PROVIDERS_AVAILABLE: All providers are unconfigured');
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

/**
 * Verificar si OpenAI está bloqueado correctamente
 */
export function verifyOpenAIBlocked(): { blocked: boolean; message: string } {
  if (process.env.OPENAI_API_KEY) {
    return {
      blocked: true,
      message: 'OPENAI_API_KEY exists but OpenAI is DISABLED by design'
    };
  }
  
  return {
    blocked: true,
    message: 'OpenAI is not configured (as expected)'
  };
}

/**
 * Listar proveedores configurados
 */
export function getConfiguredProviders(): LlmProvider[] {
  const configured: LlmProvider[] = [];
  
  for (const [provider, getConfig] of Object.entries(PROVIDER_CONFIGS)) {
    if (getConfig()) {
      configured.push(provider as LlmProvider);
    }
  }
  
  return configured;
}
