/**
 * Groq Assistant Provider
 * 
 * Provider principal de AL-E usando Groq (más rápido y económico)
 * Fallback a OpenAI si Groq falla
 */

import { IAssistantProvider, AssistantRequest, AssistantResponse } from '../IAssistantProvider';
import { callGroqChat, selectGroqModel } from './groqProvider';
import { callOpenAIChat } from './openaiProvider';
import { ALEON_SYSTEM_PROMPT } from '../prompts/aleon';
import { buildIdentityBlock, buildBrandContext } from '../../services/userProfile';

export class GroqAssistantProvider implements IAssistantProvider {
  
  async chat(request: AssistantRequest): Promise<AssistantResponse> {
    try {
      const mode = request.mode || 'universal';
      let systemPrompt = ALEON_SYSTEM_PROMPT;
      
      // SIEMPRE inyectar contexto de marca
      const brandContext = buildBrandContext();
      systemPrompt = systemPrompt + brandContext;
      console.log('[GROQ PROVIDER] ✓ Brand context injected');
      
      // Inyección de identidad del usuario
      if (request.userIdentity) {
        const identityBlock = buildIdentityBlock(request.userIdentity);
        systemPrompt = systemPrompt + identityBlock;
        console.log(`[GROQ PROVIDER] ✓ Identity injected: ${request.userIdentity.name || 'Usuario'}`);
      } else if (request.userId) {
        const identityBlock = buildIdentityBlock(null);
        systemPrompt = systemPrompt + identityBlock;
        console.log(`[GROQ PROVIDER] ✓ Identity injected (fallback): userId=${request.userId}`);
      }
      
      // Seleccionar modelo Groq según complejidad
      const lastMessage = request.messages[request.messages.length - 1]?.content || '';
      const messageText = typeof lastMessage === 'string' ? lastMessage : JSON.stringify(lastMessage);
      const isCodeHeavy = /code|código|programming|debug|refactor/i.test(messageText);
      const isLongReasoning = /explicar|analiza|reasoning|estrategia|paso a paso/i.test(messageText);
      
      const taskType = isCodeHeavy || isLongReasoning ? 'complex' : 'standard';
      const groqModel = selectGroqModel(taskType);
      
      console.log(`[GROQ PROVIDER] Task type: ${taskType}, Model: ${groqModel}`);
      
      try {
        // Intentar con Groq primero
        const response = await callGroqChat({
          messages: request.messages.filter(m => m.role !== 'system') as any,
          systemPrompt,
          model: groqModel,
          temperature: 0.7,
          topP: 0.95,
          maxTokens: 600 // COST CONTROL
        });

        return {
          content: response.content,
          raw: {
            provider: 'groq',
            model: response.raw.model,
            mode: mode,
            workspaceId: request.workspaceId,
            userId: request.userId,
            metadata: {
              usage: response.raw.usage,
              finish_reason: response.raw.finish_reason
            }
          }
        };
      } catch (groqError: any) {
        console.error('[GROQ PROVIDER] Groq failed:', groqError.message);
        console.log('[GROQ PROVIDER] Falling back to OpenAI...');
        
        // Fallback a OpenAI
        const fallbackResponse = await callOpenAIChat({
          messages: request.messages.filter(m => m.role !== 'system') as any,
          systemPrompt,
          temperature: 0.7,
          topP: 0.95,
          model: 'gpt-4-turbo'
        });

        return {
          content: fallbackResponse.content,
          raw: {
            provider: 'openai',
            model: 'gpt-4-turbo',
            mode: mode,
            workspaceId: request.workspaceId,
            userId: request.userId,
            metadata: {
              ...fallbackResponse.raw,
              fallback_reason: groqError.message
            }
          }
        };
      }
    } catch (error) {
      console.error('[GROQ PROVIDER] Fatal error:', error);
      throw new Error(`Error procesando solicitud: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  }
}
