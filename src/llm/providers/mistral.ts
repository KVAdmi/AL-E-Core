/**
 * =====================================================
 * LLM PROVIDER - Mistral AI
 * =====================================================
 * 
 * Cliente para Mistral AI con soporte tool calling
 * =====================================================
 */

import axios from 'axios';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
  toolChoice?: 'auto' | 'none';
}

export interface CompletionResponse {
  content: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, any>;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// MISTRAL CLIENT
// ═══════════════════════════════════════════════════════════════

export class MistralProvider {
  private apiKey: string;
  private baseURL = 'https://api.mistral.ai/v1';
  private defaultModel = 'mistral-large-latest';

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY es requerido');
    }
    this.apiKey = apiKey;
  }

  async createCompletion(
    messages: Message[],
    options: CompletionOptions = {}
  ): Promise<CompletionResponse> {
    const {
      model = this.defaultModel,
      temperature = 0.7,
      maxTokens = 4096,
      tools,
      toolChoice = 'auto'
    } = options;

    try {
      console.log('[MISTRAL] Generando completion...');

      const payload: any = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens
      };

      if (tools && tools.length > 0) {
        payload.tools = tools;
        payload.tool_choice = toolChoice;
      }

      const response = await axios.post(
        `${this.baseURL}/chat/completions`,
        payload,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000 // 60 segundos
        }
      );

      const choice = response.data.choices[0];
      const message = choice.message;

      // Parsear tool_calls si existen
      let toolCalls: CompletionResponse['toolCalls'] = undefined;
      if (message.tool_calls && message.tool_calls.length > 0) {
        toolCalls = message.tool_calls.map((tc: ToolCall) => ({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments)
        }));
      }

      return {
        content: message.content || '',
        toolCalls,
        usage: {
          promptTokens: response.data.usage.prompt_tokens,
          completionTokens: response.data.usage.completion_tokens,
          totalTokens: response.data.usage.total_tokens
        }
      };
    } catch (error: any) {
      console.error('[MISTRAL] Error:', error.response?.data || error.message);
      throw new Error(`Mistral API error: ${error.response?.data?.message || error.message}`);
    }
  }

  async streamCompletion(
    messages: Message[],
    options: CompletionOptions = {}
  ): Promise<AsyncIterable<string>> {
    // TODO: Implementar streaming si se necesita
    throw new Error('Streaming no implementado aún');
  }
}
