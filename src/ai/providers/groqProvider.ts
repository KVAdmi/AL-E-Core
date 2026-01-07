/**
 * Groq Provider
 * 
 * LLM provider usando Groq Cloud (llama3-70b, mixtral-8x7b)
 * Más rápido y económico que OpenAI para la mayoría de casos
 */

import Groq from 'groq-sdk';
import { env } from '../../config/env';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

export interface GroqChatOptions {
  messages: GroqMessage[];
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: any[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface GroqChatResponse {
  content: string;
  raw: {
    model: string;
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
    finish_reason: string;
    tool_calls?: any[];
  };
}

/**
 * Llamar a Groq Chat Completion
 */
export async function callGroqChat(options: GroqChatOptions): Promise<GroqChatResponse> {
  try {
    const {
      messages,
      systemPrompt,
      model = 'llama-3.3-70b-versatile', // Modelo por default (más rápido y capaz)
      temperature = 0.7,
      maxTokens = 600, // COST CONTROL: Limitado a 600 tokens por defecto
      topP = 0.95
    } = options;

    console.log('[GROQ] Enviando request...');
    console.log(`[GROQ] Model: ${model}, Temperature: ${temperature}`);

    // Construir mensajes con system prompt si existe
    let finalMessages = [...messages];
    if (systemPrompt) {
      finalMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.filter(m => m.role !== 'system')
      ];
    }

    const completion = await groq.chat.completions.create({
      messages: finalMessages as any,
      model: model,
      temperature: temperature,
      max_tokens: maxTokens,
      top_p: topP,
      stream: false,
      // Tool calling support
      ...(options.tools && options.tools.length > 0 && {
        tools: options.tools,
        tool_choice: options.toolChoice || 'auto'
      })
    });

    const content = completion.choices[0]?.message?.content || '';
    const toolCalls = completion.choices[0]?.message?.tool_calls;
    const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    // Log tool calls si existen
    if (toolCalls && toolCalls.length > 0) {
      console.log(`[GROQ] 🔧 LLM requested ${toolCalls.length} tool call(s)`);
      toolCalls.forEach((tc: any) => {
        console.log(`[GROQ]    - ${tc.function.name}(${tc.function.arguments})`);
      });
    }

    console.log(`[GROQ] ✓ Respuesta recibida (${usage.completion_tokens} tokens)`);
    console.log(`[GROQ] Usage: ${usage.prompt_tokens} in + ${usage.completion_tokens} out = ${usage.total_tokens} total`);

    return {
      content,
      raw: {
        model: completion.model,
        usage: {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens
        },
        finish_reason: completion.choices[0]?.finish_reason || 'stop',
        tool_calls: toolCalls || []
      }
    };
  } catch (error: any) {
    console.error('[GROQ] Error:', error);
    
    // Si Groq falla, lanzar error para fallback a OpenAI
    if (error.status === 429) {
      throw new Error('GROQ_RATE_LIMIT: Rate limit exceeded');
    } else if (error.status === 503) {
      throw new Error('GROQ_UNAVAILABLE: Service unavailable');
    } else {
      throw new Error(`GROQ_ERROR: ${error.message || 'Unknown error'}`);
    }
  }
}

/**
 * Modelos disponibles en Groq
 */
export const GROQ_MODELS = {
  // Llama 3 (más rápido y capaz)
  LLAMA3_70B: 'llama-3.3-70b-versatile',      // Recomendado: Rápido + capaz
  LLAMA3_8B: 'llama-3.1-8b-instant',          // Ultra rápido para tareas simples
  
  // Mixtral (alternativa)
  MIXTRAL_8X7B: 'mixtral-8x7b-32768',         // Gran contexto (32k tokens)
  
  // Gemma (Google, más pequeño)
  GEMMA_7B: 'gemma-7b-it'                     // Pequeño pero eficiente
};

/**
 * Selección inteligente de modelo Groq según tarea
 */
export function selectGroqModel(taskType: 'simple' | 'standard' | 'complex' | 'large-context'): string {
  switch (taskType) {
    case 'simple':
      return GROQ_MODELS.LLAMA3_8B;           // Ultra rápido
    case 'standard':
      return GROQ_MODELS.LLAMA3_70B;          // Balance perfecto
    case 'complex':
      return GROQ_MODELS.LLAMA3_70B;          // Reasoning avanzado
    case 'large-context':
      return GROQ_MODELS.MIXTRAL_8X7B;        // 32k context window
    default:
      return GROQ_MODELS.LLAMA3_70B;
  }
}
