"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAssistantProvider = void 0;
const openaiProvider_1 = require("./openaiProvider");
const aleon_1 = require("../prompts/aleon");
const lucy_1 = require("../prompts/lucy");
const userProfileService_1 = require("../../services/userProfileService");
/**
 * OpenAI Assistant Provider
 * Enruta entre AL-EON (generalista) y L.U.C.I (verticales)
 */
class OpenAIAssistantProvider {
    getSystemPrompt(mode) {
        switch (mode) {
            case 'universal':
            case 'aleon': // Alias legacy
                return aleon_1.ALEON_SYSTEM_PROMPT;
            case 'lucy_legal':
            case 'legal':
                return lucy_1.LUCY_LEGAL_PROMPT;
            case 'lucy_medical':
            case 'medico':
                return lucy_1.LUCY_MEDICAL_PROMPT;
            case 'lucy_insurance':
            case 'seguros':
                return lucy_1.LUCY_INSURANCE_PROMPT;
            case 'lucy_accounting':
            case 'contabilidad':
                return lucy_1.LUCY_ACCOUNTING_PROMPT;
            default:
                // Default: AL-EON generalista
                return aleon_1.ALEON_SYSTEM_PROMPT;
        }
    }
    async chat(request) {
        try {
            console.log('[PROVIDER] 🔍 OpenAIAssistantProvider.chat() CALLED');
            console.log(`[PROVIDER] Request details: userId=${request.userId}, mode=${request.mode}, hasIdentity=${!!request.userIdentity}`);
            const mode = request.mode || 'universal';
            let systemPrompt = this.getSystemPrompt(mode);
            // 🔒 INYECCIÓN DE IDENTIDAD OBLIGATORIA
            // Si hay userIdentity, SIEMPRE agregar bloque de identidad al system prompt
            if (request.userIdentity) {
                const identityBlock = (0, userProfileService_1.buildIdentityBlock)(request.userIdentity);
                systemPrompt = systemPrompt + identityBlock;
                console.log(`[PROVIDER] ✓ Identity injected: name=${request.userIdentity.name || 'N/A'}, role=${request.userIdentity.role || 'N/A'}`);
                console.log(`[DEBUG PROMPT] System prompt length: ${systemPrompt.length} chars, contains identity: ${systemPrompt.includes('CONTEXTO DE USUARIO')}`);
            }
            else if (request.userId) {
                // Fallback: tenemos userId pero no se pasó identidad (usuario autenticado sin perfil)
                const identityBlock = (0, userProfileService_1.buildIdentityBlock)(null);
                systemPrompt = systemPrompt + identityBlock;
                console.log(`[PROVIDER] ✓ Identity injected (authenticated user without profile): userId=${request.userId}`);
                console.log(`[DEBUG PROMPT] System prompt length: ${systemPrompt.length} chars, contains identity: ${systemPrompt.includes('CONTEXTO DE USUARIO')}`);
            }
            else {
                console.log('[PROVIDER] ⚠️ No userId provided - guest mode');
            }
            const response = await (0, openaiProvider_1.callOpenAIChat)({
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
        }
        catch (error) {
            console.error('Error en OpenAIAssistantProvider:', error);
            throw new Error(`Error procesando solicitud: ${error instanceof Error ? error.message : 'Error desconocido'}`);
        }
    }
}
exports.OpenAIAssistantProvider = OpenAIAssistantProvider;
