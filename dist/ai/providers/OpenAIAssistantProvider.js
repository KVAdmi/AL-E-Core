"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAssistantProvider = void 0;
const openaiProvider_1 = require("./openaiProvider");
const aleon_1 = require("../prompts/aleon");
const lucy_1 = require("../prompts/lucy");
const userProfile_1 = require("../../services/userProfile");
/**
 * OpenAI Assistant Provider
 * Enruta entre AL-EON (generalista) y L.U.C.I (verticales)
 *
 * CRÍTICO: SIEMPRE inyecta contexto de marca Infinity Kode
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
            const mode = request.mode || 'universal';
            let systemPrompt = this.getSystemPrompt(mode);
            // CRÍTICO: SIEMPRE inyectar contexto de marca (HARDCODEADO)
            const brandContext = (0, userProfile_1.buildBrandContext)();
            systemPrompt = systemPrompt + brandContext;
            console.log('[IDENTITY] ✓ Brand context injected: Infinity Kode');
            // Inyección de identidad del usuario
            if (request.userIdentity) {
                const identityBlock = (0, userProfile_1.buildIdentityBlock)(request.userIdentity);
                systemPrompt = systemPrompt + identityBlock;
                console.log(`[PROVIDER] ✓ Identity injected: ${request.userIdentity.name || 'Usuario'}`);
            }
            else if (request.userId) {
                const identityBlock = (0, userProfile_1.buildIdentityBlock)(null);
                systemPrompt = systemPrompt + identityBlock;
                console.log(`[PROVIDER] ✓ Identity injected (fallback): userId=${request.userId}`);
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
