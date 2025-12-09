import { AssistantRequest, AssistantResponse } from '../ai/IAssistantProvider';
import { getAssistantProvider } from '../ai/AssistantRouter';
import { getRelevantMemories } from '../memory/memoryService';

/**
 * Servicio principal para procesar solicitudes del asistente
 * Actúa como capa de abstracción entre los endpoints y los proveedores de IA
 */
export class AssistantService {
  
  /**
   * Procesa una solicitud del asistente
   */
  async processRequest(payload: AssistantRequest): Promise<AssistantResponse> {
    try {
      // Validaciones básicas
      this.validateRequest(payload);
      
      // Logs para debugging (sin mostrar contenido completo en producción)
      this.logRequest(payload);
      
      // PASO 1: Obtener memorias relevantes
      const memories = await getRelevantMemories(
        payload.workspaceId || 'default',
        payload.userId || 'anonymous', 
        payload.mode || 'universal',
        20
      );

      // PASO 2: Inyectar memorias en los mensajes si hay memorias disponibles
      const messagesWithMemory = [...payload.messages];
      if (memories && memories.length > 0) {
        const memoryContext = `[MEMORIAS RELEVANTES DEL USUARIO]\n${memories.join('\n')}\n`;
        // Insertar memoria como mensaje del sistema antes del último mensaje del usuario
        const lastUserIndex = messagesWithMemory.map(m => m.role).lastIndexOf('user');
        if (lastUserIndex >= 0) {
          messagesWithMemory.splice(lastUserIndex, 0, {
            role: 'system',
            content: memoryContext
          });
        }
      }

      // PASO 3: Llamar al proveedor con memoria inyectada
      const requestWithMemory = { ...payload, messages: messagesWithMemory };
      const provider = getAssistantProvider();
      const response = await provider.chat(requestWithMemory);
      
      // PASO 4: Crear respuesta final (sin procesamiento de memorias de OpenAI)
      const finalResponse: AssistantResponse = {
        content: response.content,
        raw: {
          ...response.raw,
          memoryContextUsed: memories.length > 0
        }
      };
      
      // Log de respuesta exitosa
      this.logResponse(finalResponse, payload);
      
      return finalResponse;
    } catch (error) {
      console.error('Error en AssistantService:', error);
      
      // Log estructurado del error
      this.logError(error, payload);
      
      throw error;
    }
  }

  /**
   * Validación de la solicitud
   */
  private validateRequest(payload: AssistantRequest): void {
    if (!payload.messages || payload.messages.length === 0) {
      throw new Error('La solicitud debe incluir al menos un mensaje');
    }

    // Verificar que hay al menos un mensaje del usuario
    const hasUserMessage = payload.messages.some(msg => msg.role === 'user');
    if (!hasUserMessage) {
      throw new Error('La solicitud debe incluir al menos un mensaje del usuario');
    }

    // Validar estructura de mensajes
    payload.messages.forEach((msg, index) => {
      if (!msg.role || !['system', 'user', 'assistant'].includes(msg.role)) {
        throw new Error(`Mensaje ${index}: rol inválido. Debe ser 'system', 'user' o 'assistant'`);
      }
      
      if (!msg.content || typeof msg.content !== 'string') {
        throw new Error(`Mensaje ${index}: contenido inválido o vacío`);
      }
    });

    // Validar modo si se especifica
    if (payload.mode) {
      const validModes = ['universal', 'legal', 'medico', 'seguros', 'contabilidad'];
      if (!validModes.includes(payload.mode)) {
        throw new Error(`Modo inválido: ${payload.mode}. Modos válidos: ${validModes.join(', ')}`);
      }
    }
  }

  /**
   * Log estructurado de la solicitud
   */
  private logRequest(payload: AssistantRequest): void {
    const isProduction = process.env.NODE_ENV === 'production';
    
    const logData = {
      timestamp: new Date().toISOString(),
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      mode: payload.mode || 'universal',
      messageCount: payload.messages.length,
      // En producción no loguear contenido completo
      messages: isProduction 
        ? payload.messages.map(m => ({ role: m.role, contentLength: m.content.length }))
        : payload.messages
    };

    console.log('🤖 Procesando solicitud de asistente:', logData);
  }

  /**
   * Log de respuesta exitosa
   */
  private logResponse(response: AssistantResponse, originalPayload: AssistantRequest): void {
    const isProduction = process.env.NODE_ENV === 'production';
    
    const logData = {
      timestamp: new Date().toISOString(),
      workspaceId: originalPayload.workspaceId,
      userId: originalPayload.userId,
      mode: originalPayload.mode,
      responseLength: response.content.length,
      // Metadata del proveedor sin contenido sensible
      provider: response.raw?.provider,
      model: response.raw?.model,
      // En desarrollo, mostrar fragmento de respuesta
      responsePreview: isProduction ? undefined : response.content.substring(0, 100)
    };

    console.log('✅ Respuesta generada exitosamente:', logData);
  }

  /**
   * Log de memorias guardadas
   */
  private logMemoriesSaved(count: number, originalPayload: AssistantRequest): void {
    const logData = {
      timestamp: new Date().toISOString(),
      workspaceId: originalPayload.workspaceId,
      userId: originalPayload.userId,
      mode: originalPayload.mode,
      memoriesCount: count
    };

    console.log('🧠 Memorias guardadas:', logData);
  }

  /**
   * Log estructurado de errores
   */
  private logError(error: any, payload: AssistantRequest): void {
    const logData = {
      timestamp: new Date().toISOString(),
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      mode: payload.mode,
      error: {
        message: error.message || 'Error desconocido',
        name: error.name || 'UnknownError',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    };

    console.error('❌ Error en procesamiento de asistente:', logData);
  }
}

/**
 * Instancia singleton del servicio
 */
const assistantService = new AssistantService();

/**
 * Función de conveniencia para procesar solicitudes
 */
export async function processAssistantRequest(payload: AssistantRequest): Promise<AssistantResponse> {
  return assistantService.processRequest(payload);
}