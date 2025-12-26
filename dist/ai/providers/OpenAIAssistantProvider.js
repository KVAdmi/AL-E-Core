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
            // 🔒 INYECCIÓN DE IDENTIDAD OBLIGATORIA
            // Si hay userId, SIEMPRE agregar bloque de identidad al system prompt
            if (request.userId) {
                const identityBlock = `

---
INFORMACIÓN DEL USUARIO AUTENTICADO:
- User ID: ${request.userId}
${request.userEmail ? `- Email: ${request.userEmail}` : ''}
- Estado: Usuario registrado y autenticado

IMPORTANTE: Este usuario está autenticado. Reconoce su identidad en tus respuestas.
NO digas "no tengo capacidad de recordar" o "no sé quién eres".
Trata al usuario como alguien conocido del sistema.
---
`;
                systemPrompt = systemPrompt + identityBlock;
                console.log(`[PROVIDER] ✓ Identity injected: userId=${request.userId}, email=${request.userEmail || 'N/A'}`);
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
