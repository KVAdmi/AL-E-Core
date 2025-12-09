"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssistantRouter = void 0;
exports.getAssistantProvider = getAssistantProvider;
const OpenAIAssistantProvider_1 = require("./providers/OpenAIAssistantProvider");
/**
 * Router central para proveedores de IA
 * Permite cambiar entre diferentes motores sin afectar el resto del sistema
 */
class AssistantRouter {
    constructor() {
        this.providers = new Map();
        this.initializeProviders();
    }
    static getInstance() {
        if (!AssistantRouter.instance) {
            AssistantRouter.instance = new AssistantRouter();
        }
        return AssistantRouter.instance;
    }
    initializeProviders() {
        // Registrar OpenAI como proveedor principal
        this.providers.set('openai', () => new OpenAIAssistantProvider_1.OpenAIAssistantProvider());
        // Aquí se pueden agregar más proveedores en el futuro:
        // this.providers.set('ale-local', () => new ALELocalProvider());
        // this.providers.set('anthropic', () => new AnthropicProvider());
        // this.providers.set('gemini', () => new GeminiProvider());
    }
    /**
     * Obtiene el proveedor configurado
     * Por ahora siempre devuelve OpenAI, pero está preparado para lógica más compleja
     */
    getProvider(providerType) {
        const targetProvider = providerType || this.getDefaultProvider();
        const providerFactory = this.providers.get(targetProvider);
        if (!providerFactory) {
            console.warn(`Proveedor ${targetProvider} no disponible, usando OpenAI como fallback`);
            return new OpenAIAssistantProvider_1.OpenAIAssistantProvider();
        }
        return providerFactory();
    }
    /**
     * Determina el proveedor por defecto basado en configuración/disponibilidad
     */
    getDefaultProvider() {
        // Por ahora siempre OpenAI, pero aquí se puede agregar lógica para:
        // - Verificar variables de entorno
        // - Comprobar disponibilidad de servicios
        // - Balanceo de carga
        // - A/B testing entre proveedores
        const configuredProvider = process.env.ALE_DEFAULT_PROVIDER;
        if (configuredProvider && this.providers.has(configuredProvider)) {
            return configuredProvider;
        }
        return 'openai';
    }
    /**
     * Lista los proveedores disponibles
     */
    getAvailableProviders() {
        return Array.from(this.providers.keys());
    }
}
exports.AssistantRouter = AssistantRouter;
/**
 * Función de conveniencia para obtener el proveedor actual
 */
function getAssistantProvider(providerType) {
    const router = AssistantRouter.getInstance();
    return router.getProvider(providerType);
}
