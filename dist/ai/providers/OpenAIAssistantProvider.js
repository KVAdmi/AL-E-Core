"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIAssistantProvider = void 0;
const openaiProvider_1 = require("./openaiProvider");
const aleon_1 = require("../prompts/aleon");
const lucy_1 = require("../prompts/lucy");
/**
 * OpenAI Assistant Provider
 * Enruta entre AL-EON (generalista) y L.U.C.I (verticales)
 */
class OpenAIAssistantProvider {
    getSystemPrompt(mode) {
        switch (mode) {
            case 'aleon':
                return aleon_1.ALEON_SYSTEM_PROMPT;
            case 'lucy_legal':
                return lucy_1.LUCY_LEGAL_PROMPT;
            case 'lucy_medical':
                return lucy_1.LUCY_MEDICAL_PROMPT;
            case 'lucy_insurance':
                return lucy_1.LUCY_INSURANCE_PROMPT;
            case 'lucy_accounting':
                return lucy_1.LUCY_ACCOUNTING_PROMPT;
            default:
                // Default: AL-EON generalista
                return aleon_1.ALEON_SYSTEM_PROMPT;
        }
    }
    async chat(request) {
        try {
            const mode = request.mode || 'aleon';
            const systemPrompt = this.getSystemPrompt(mode);
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
