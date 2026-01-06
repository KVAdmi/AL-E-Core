/**
 * =====================================================
 * LLM PROVIDER FACTORY
 * =====================================================
 * 
 * Factory con fallback automático:
 * - Mistral AI (primario)
 * - OpenRouter (fallback)
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

// ═══════════════════════════════════════════════════════════════
// PROVIDER FACTORY
// ═══════════════════════════════════════════════════════════════

class LLMProviderFactory {
  private primaryProvider: LLMProvider | null = null;
  private fallbackProvider: LLMProvider | null = null;
  private currentProvider: 'mistral' | 'openrouter' = 'mistral';

  constructor() {
    this.initialize();
  }

  private initialize(): void {
    const mistralKey = process.env.MISTRAL_API_KEY;
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    const provider = process.env.LLM_PROVIDER || 'mistral';

    // Configurar providers disponibles
    if (mistralKey) {
      this.primaryProvider = new MistralProvider(mistralKey);
      console.log('[LLM FACTORY] Mistral AI configurado (primario)');
    }

    if (openrouterKey) {
      this.fallbackProvider = new OpenRouterProvider(openrouterKey);
      console.log('[LLM FACTORY] OpenRouter configurado (fallback)');
    }

    // Validar que al menos uno esté disponible (solo warning si no hay)
    if (!this.primaryProvider && !this.fallbackProvider) {
      console.warn('[LLM FACTORY] ⚠️  No hay providers LLM configurados. Tool calling no estará disponible hasta configurar MISTRAL_API_KEY o OPENROUTER_API_KEY');
    }

    this.currentProvider = provider === 'openrouter' ? 'openrouter' : 'mistral';
  }

  /**
   * Obtener provider activo con fallback automático
   */
  async createCompletion(
    messages: Message[],
    options: CompletionOptions = {}
  ): Promise<CompletionResponse> {
    
    // Validar que hay providers disponibles
    if (!this.primaryProvider && !this.fallbackProvider) {
      throw new Error('No hay providers LLM configurados. Configura MISTRAL_API_KEY o OPENROUTER_API_KEY en el servidor');
    }
    
    // Intentar con provider primario
    if (this.primaryProvider) {
      try {
        console.log('[LLM FACTORY] Usando Mistral AI');
        return await this.primaryProvider.createCompletion(messages, options);
      } catch (error: any) {
        console.error('[LLM FACTORY] Mistral falló:', error.message);
        
        // Intentar fallback
        if (this.fallbackProvider) {
          console.log('[LLM FACTORY] Fallback a OpenRouter');
          try {
            return await this.fallbackProvider.createCompletion(messages, options);
          } catch (fallbackError: any) {
            console.error('[LLM FACTORY] OpenRouter también falló:', fallbackError.message);
            throw new Error('Todos los providers LLM fallaron');
          }
        }
        
        throw error;
      }
    }

    // Si no hay primario, usar fallback directamente
    if (this.fallbackProvider) {
      console.log('[LLM FACTORY] Usando OpenRouter (sin primario)');
      return await this.fallbackProvider.createCompletion(messages, options);
    }

    throw new Error('No hay providers LLM disponibles');
  }

  /**
   * Obtener provider específico
   */
  getProvider(name: 'mistral' | 'openrouter'): LLMProvider | null {
    if (name === 'mistral') return this.primaryProvider;
    if (name === 'openrouter') return this.fallbackProvider;
    return null;
  }

  /**
   * Cambiar provider actual (para testing)
   */
  switchProvider(provider: 'mistral' | 'openrouter'): void {
    this.currentProvider = provider;
    console.log(`[LLM FACTORY] Provider cambiado a: ${provider}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════

export const llmFactory = new LLMProviderFactory();
export { Message, CompletionOptions, CompletionResponse };
