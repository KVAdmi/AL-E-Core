/**
 * =====================================================
 * LLM PROVIDER - OpenRouter
 * =====================================================
 * 
 * Cliente para OpenRouter (fallback multi-modelo)
 * =====================================================
 */

import axios from 'axios';
import { Message, CompletionOptions, CompletionResponse, ToolCall } from './mistral';

// ═══════════════════════════════════════════════════════════════
// OPENROUTER CLIENT
// ═══════════════════════════════════════════════════════════════

export class OpenRouterProvider {
  private apiKey: string;
  private baseURL = 'https://openrouter.ai/api/v1';
  private defaultModel = 'anthropic/claude-3.5-sonnet'; // Fallback model

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY es requerido');
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
      console.log('[OPENROUTER] Generando completion (fallback)...');

      const payload: any = {
        model,
        messages,
        temperature,
        max_tokens: maxTokens
      };

      // OpenRouter soporta tools en modelos compatibles
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
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://al-e.com', // Requerido por OpenRouter
            'X-Title': 'AL-E Core'
          },
          timeout: 60000
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
          promptTokens: response.data.usage?.prompt_tokens || 0,
          completionTokens: response.data.usage?.completion_tokens || 0,
          totalTokens: response.data.usage?.total_tokens || 0
        }
      };
    } catch (error: any) {
      console.error('[OPENROUTER] Error:', error.response?.data || error.message);
      throw new Error(`OpenRouter API error: ${error.response?.data?.message || error.message}`);
    }
  }
}
