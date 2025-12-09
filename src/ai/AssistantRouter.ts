import { IAssistantProvider } from './IAssistantProvider';
import { OpenAIAssistantProvider } from './providers/OpenAIAssistantProvider';

type ProviderType = 'openai' | 'ale-local' | 'anthropic' | 'gemini';

interface ProviderConfig {
  type: ProviderType;
  enabled: boolean;
  priority: number;
}

/**
 * Router central para proveedores de IA
 * Permite cambiar entre diferentes motores sin afectar el resto del sistema
 */
export class AssistantRouter {
  private static instance: AssistantRouter;
  private providers: Map<ProviderType, () => IAssistantProvider> = new Map();
  
  private constructor() {
    this.initializeProviders();
  }

  public static getInstance(): AssistantRouter {
    if (!AssistantRouter.instance) {
      AssistantRouter.instance = new AssistantRouter();
    }
    return AssistantRouter.instance;
  }

  private initializeProviders(): void {
    // Registrar OpenAI como proveedor principal
    this.providers.set('openai', () => new OpenAIAssistantProvider());
    
    // Aquí se pueden agregar más proveedores en el futuro:
    // this.providers.set('ale-local', () => new ALELocalProvider());
    // this.providers.set('anthropic', () => new AnthropicProvider());
    // this.providers.set('gemini', () => new GeminiProvider());
  }

  /**
   * Obtiene el proveedor configurado
   * Por ahora siempre devuelve OpenAI, pero está preparado para lógica más compleja
   */
  public getProvider(providerType?: ProviderType): IAssistantProvider {
    const targetProvider = providerType || this.getDefaultProvider();
    
    const providerFactory = this.providers.get(targetProvider);
    if (!providerFactory) {
      console.warn(`Proveedor ${targetProvider} no disponible, usando OpenAI como fallback`);
      return new OpenAIAssistantProvider();
    }

    return providerFactory();
  }

  /**
   * Determina el proveedor por defecto basado en configuración/disponibilidad
   */
  private getDefaultProvider(): ProviderType {
    // Por ahora siempre OpenAI, pero aquí se puede agregar lógica para:
    // - Verificar variables de entorno
    // - Comprobar disponibilidad de servicios
    // - Balanceo de carga
    // - A/B testing entre proveedores
    
    const configuredProvider = process.env.ALE_DEFAULT_PROVIDER as ProviderType;
    
    if (configuredProvider && this.providers.has(configuredProvider)) {
      return configuredProvider;
    }
    
    return 'openai';
  }

  /**
   * Lista los proveedores disponibles
   */
  public getAvailableProviders(): ProviderType[] {
    return Array.from(this.providers.keys());
  }
}

/**
 * Función de conveniencia para obtener el proveedor actual
 */
export function getAssistantProvider(providerType?: ProviderType): IAssistantProvider {
  const router = AssistantRouter.getInstance();
  return router.getProvider(providerType);
}