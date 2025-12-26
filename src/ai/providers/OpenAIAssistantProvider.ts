import { IAssistantProvider, AssistantRequest, AssistantResponse } from '../IAssistantProvider';
import { callOpenAIChat } from './openaiProvider';
import { ALEON_SYSTEM_PROMPT } from '../prompts/aleon';
import { 
  LUCY_LEGAL_PROMPT, 
  LUCY_MEDICAL_PROMPT, 
  LUCY_INSURANCE_PROMPT, 
  LUCY_ACCOUNTING_PROMPT 
} from '../prompts/lucy';
import { buildIdentityBlock } from '../../services/userProfileService';

/**
 * OpenAI Assistant Provider
 * Enruta entre AL-EON (generalista) y L.U.C.I (verticales)
 */
export class OpenAIAssistantProvider implements IAssistantProvider {
  
  private getSystemPrompt(mode?: string): string {
    switch (mode) {
      case 'universal':
      case 'aleon': // Alias legacy
        return ALEON_SYSTEM_PROMPT;
      
      case 'lucy_legal':
      case 'legal':
        return LUCY_LEGAL_PROMPT;
      
      case 'lucy_medical':
      case 'medico':
        return LUCY_MEDICAL_PROMPT;
      
      case 'lucy_insurance':
      case 'seguros':
        return LUCY_INSURANCE_PROMPT;
      
      case 'lucy_accounting':
      case 'contabilidad':
        return LUCY_ACCOUNTING_PROMPT;
      
      default:
        // Default: AL-EON generalista
        return ALEON_SYSTEM_PROMPT;
    }
  }

  async chat(request: AssistantRequest): Promise<AssistantResponse> {
    try {
      const mode = request.mode || 'universal';
      let systemPrompt = this.getSystemPrompt(mode);
      
      // 🔒 INYECCIÓN DE IDENTIDAD OBLIGATORIA
      // Si hay userIdentity, SIEMPRE agregar bloque de identidad al system prompt
      if (request.userIdentity) {
        const identityBlock = buildIdentityBlock(request.userIdentity);
        systemPrompt = systemPrompt + identityBlock;
        console.log(`[PROVIDER] ✓ Identity injected: name=${request.userIdentity.name || 'N/A'}, role=${request.userIdentity.role || 'N/A'}`);
      } else if (request.userId) {
        // Fallback: tenemos userId pero no se pasó identidad (usuario autenticado sin perfil)
        const identityBlock = buildIdentityBlock(null);
        systemPrompt = systemPrompt + identityBlock;
        console.log(`[PROVIDER] ✓ Identity injected (authenticated user without profile): userId=${request.userId}`);
      } else {
        console.log('[PROVIDER] ⚠️ No userId provided - guest mode');
      }
      
      const response = await callOpenAIChat({
        messages: request.messages,
        systemPrompt,
        temperature: 0.8,
        topP: 0.95,
        presencePenalty: 0.3,
        frequencyPenalty: 0.1,
        model: 'gpt-4-turbo'
      });

      return {
        content: response.content,
        raw: {
          provider: 'openai',
          model: 'gpt-4-turbo',
          mode: mode,
          workspaceId: request.workspaceId,
          userId: request.userId,
          metadata: response.raw
        }
      };
    } catch (error) {
      console.error('Error en OpenAIAssistantProvider:', error);
      throw new Error(`Error procesando solicitud: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
  }
}
