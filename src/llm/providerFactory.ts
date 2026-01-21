/**
 * =====================================================
 * LLM PROVIDER FACTORY (LEGACY)
 * =====================================================
 * 
 * ⚠️  DEPRECADO: AL-E usa Amazon Nova Pro (Bedrock) como cerebro ejecutivo
 * 
 * Este factory mantiene proveedores auxiliares:
 * - Groq (disponible como fallback)
 * - Mistral AI (disponible como fallback)
 * - OpenRouter (disponible como fallback)
 * 
 * NO se usan para tool calling ni orquestación principal.
 * =====================================================
 */

import { MistralProvider } from './providers/mistral';
import { OpenRouterProvider } from './providers/openrouter';
import { Message, CompletionOptions, CompletionResponse } from './providers/mistral';

// ═══════════════════════════════════════════════════════════════
// LLM PROVIDER INTERFACE
// ═══════════════════════════════════════════════════════════════

export interface LLMProvider {
  createCompletion(messages: Message[], options?: CompletionOptions): Promise<CompletionResponse>;
}

// Groq Provider Wrapper
class GroqProviderWrapper implements LLMProvider {
  private groqProvider: any;

  constructor(apiKey: string) {
    // Import dinámico de groqProvider existente
    import('../ai/providers/groqProvider').then(module => {
      this.groqProvider = module;
    });
  }

  async createCompletion(messages: Message[], options?: CompletionOptions): Promise<CompletionResponse> {
    if (!this.groqProvider) {
      const module = await import('../ai/providers/groqProvider');
      this.groqProvider = module;
    }

    // Adaptar a formato Groq
    const response = await this.groqProvider.callGroqChat(messages, options?.tools);
    
    return {
      content: response.content,
      usage: response.usage,
      tool_calls: response.tool_calls
    } as CompletionResponse;
  }
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER FACTORY
// ═══════════════════════════════════════════════════════════════

class LLMProviderFactory {
  private groqProvider: LLMProvider | null = null;
  private mistralProvider: LLMProvider | null = null;
  private openrouterProvider: LLMProvider | null = null;
  private currentProvider: 'groq' | 'mistral' | 'openrouter' = 'groq';

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const groqKey = process.env.GROQ_API_KEY;
    const mistralKey = process.env.MISTRAL_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const provider = process.env.LLM_PROVIDER || 'groq';

    // ⚠️ NOTA: Este factory es LEGACY - AL-E usa Amazon Nova Pro (Bedrock) como cerebro ejecutivo
    // Groq/Mistral disponibles solo como fallback auxiliar si Nova falla
    
    // Configurar providers disponibles
    if (groqKey) {
      this.groqProvider = new GroqProviderWrapper(groqKey);
      console.log('[LLM FACTORY] ✅ Groq disponible (fallback auxiliar - NO primario)');
    }

    if (mistralKey) {
      this.mistralProvider = new MistralProvider(mistralKey);
      console.log('[LLM FACTORY] ✅ Mistral AI disponible (fallback auxiliar)');
    }

    if (openrouterKey) {
      this.openrouterProvider = new OpenRouterProvider(openrouterKey);
      console.log('[LLM FACTORY] ✅ OpenRouter configurado (terciario)');
    }

    // Validar que al menos uno esté disponible
    if (!this.groqProvider && !this.mistralProvider && !this.openrouterProvider) {
      console.error('[LLM FACTORY] ❌ CRÍTICO: No hay providers LLM configurados. Tool calling NO funcionará.');
      console.error('[LLM FACTORY] Configurar al menos uno: GROQ_API_KEY (recomendado), MISTRAL_API_KEY, o OPENROUTER_API_KEY');
    } else {
      const available = [
        this.groqProvider ? 'Groq' : null,
        this.mistralProvider ? 'Mistral' : null,
        this.openrouterProvider ? 'OpenRouter' : null
      ].filter(Boolean).join(', ');
      console.log(`[LLM FACTORY] 🎯 Providers disponibles: ${available}`);
    }

    // Determinar provider activo
    if (provider === 'groq' && this.groqProvider) {
      this.currentProvider = 'groq';
    } else if (provider === 'mistral' && this.mistralProvider) {
      this.currentProvider = 'mistral';
    } else if (provider === 'openrouter' && this.openrouterProvider) {
      this.currentProvider = 'openrouter';
    } else {
      // Auto-select: Groq > Mistral > OpenRouter
      if (this.groqProvider) this.currentProvider = 'groq';
      else if (this.mistralProvider) this.currentProvider = 'mistral';
      else if (this.openrouterProvider) this.currentProvider = 'openrouter';
    }

    console.log(`[LLM FACTORY] ⚠️  Legacy provider: ${this.currentProvider.toUpperCase()} (NO usado - Nova Pro es cerebro ejecutivo)`);
  }

  /**
   * Obtener provider activo con fallback automático
   */
  async createCompletion(
    messages: Message[],
    options: CompletionOptions = {}
  ): Promise<CompletionResponse> {
    
    // Validar que hay providers disponibles
    if (!this.groqProvider && !this.mistralProvider && !this.openrouterProvider) {
      throw new Error('No hay providers LLM configurados. Configura GROQ_API_KEY, MISTRAL_API_KEY o OPENROUTER_API_KEY');
    }
    
    // Cascade: Groq > Mistral > OpenRouter
    const providers = [
      { name: 'Groq', instance: this.groqProvider },
      { name: 'Mistral', instance: this.mistralProvider },
      { name: 'OpenRouter', instance: this.openrouterProvider }
    ].filter(p => p.instance !== null);

    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        console.log(`[LLM FACTORY] 🔄 Intentando con ${provider.name}`);
        const result = await provider.instance!.createCompletion(messages, options);
        console.log(`[LLM FACTORY] ✅ ${provider.name} respondió exitosamente`);
        return result;
      } catch (error: any) {
        console.error(`[LLM FACTORY] ❌ ${provider.name} falló: ${error.message}`);
        lastError = error;
      }
    }

    throw lastError || new Error('Todos los providers LLM fallaron');
  }

  /**
   * Obtener provider específico
   */
  getProvider(name: 'groq' | 'mistral' | 'openrouter'): LLMProvider | null {
    if (name === 'groq') return this.groqProvider;
    if (name === 'mistral') return this.mistralProvider;
    if (name === 'openrouter') return this.openrouterProvider;
    return null;
  }

  /**
   * Cambiar provider actual (para testing)
   */
  switchProvider(provider: 'groq' | 'mistral' | 'openrouter'): void {
    this.currentProvider = provider;
    console.log(`[LLM FACTORY] Provider cambiado a: ${provider}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const llmFactory = new LLMProviderFactory();
export { Message, CompletionOptions, CompletionResponse };
