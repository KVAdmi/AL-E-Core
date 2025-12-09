"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.callOpenAIChat = callOpenAIChat;
const openai_1 = __importDefault(require("openai"));
async function callOpenAIChat({ messages, model = 'gpt-4-turbo', systemPrompt, temperature = 0.7 }) {
    const openai = new openai_1.default({
        apiKey: process.env.OPENAI_API_KEY,
    });
    // Preparar mensajes incluyendo system prompt si se proporciona
    const finalMessages = [...messages];
    if (systemPrompt) {
        finalMessages.unshift({
            role: 'system',
            content: systemPrompt
        });
    }
    try {
        const completion = await openai.chat.completions.create({
            model,
            messages: finalMessages,
            temperature,
            max_tokens: 4000,
            response_format: { type: "json_object" }
        });
        const content = completion.choices[0]?.message?.content || '';
        return {
            content,
            raw: completion
        };
    }
    catch (error) {
        console.error('Error en OpenAI API:', error);
        throw new Error(`Error en llamada a OpenAI: ${error instanceof Error ? error.message : 'Error desconocido'}`);
    }
}
