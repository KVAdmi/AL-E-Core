/**
 * SIMPLE ORCHESTRATOR - Como GitHub Copilot
 * 
 * NO bloquea, NO pide permisos, NO valida evidencia antes.
 * Razona → Ejecuta → Responde.
 * 
 * Filosofía: Mejor pedir perdón que pedir permiso.
 */

import Anthropic from '@anthropic-ai/sdk';
import { executeTool } from './tools/toolRouter';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

interface SimpleOrchestratorRequest {
  userMessage: string;
  userId: string;
  userEmail?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  requestId?: string;
  route?: string;
  workspaceId?: string;
}

interface SimpleOrchestratorResponse {
  answer: string;
  toolsUsed: string[];
  executionTime: number;
}

/**
 * TOOLS DISPONIBLES - Definición para Claude
 */
const AVAILABLE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_emails',
    description: 'Lista los correos del usuario. Usa esto cuando pidan "revisar correo", "ver emails", "qué correos tengo".',
    input_schema: {
      type: 'object',
      properties: {
        unreadOnly: {
          type: 'boolean',
          description: 'Si true, solo muestra correos no leídos',
        },
        limit: {
          type: 'number',
          description: 'Número máximo de correos a retornar (default: 20)',
        },
      },
    },
  },
  {
    name: 'read_email',
    description: 'Lee el contenido completo de un correo específico. Usa esto cuando digan "qué dice", "léelo", "abre el correo", "muéstramelo".',
    input_schema: {
      type: 'object',
      properties: {
        emailId: {
          type: 'string',
          description: 'ID del correo a leer',
        },
      },
      required: ['emailId'],
    },
  },
  {
    name: 'send_email',
    description: 'Envía un correo electrónico.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Email del destinatario',
        },
        subject: {
          type: 'string',
          description: 'Asunto del correo',
        },
        body: {
          type: 'string',
          description: 'Cuerpo del correo',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'web_search',
    description: 'Busca información en internet. Usa esto cuando necesites datos actuales o cuando el usuario pida "busca", "investiga", "encuentra información sobre".',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Consulta de búsqueda',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_events',
    description: 'Lista los eventos del calendario del usuario.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Fecha de inicio (ISO format)',
        },
        endDate: {
          type: 'string',
          description: 'Fecha de fin (ISO format)',
        },
      },
    },
  },
  {
    name: 'create_event',
    description: 'Crea un nuevo evento en el calendario.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Título del evento',
        },
        startTime: {
          type: 'string',
          description: 'Hora de inicio (ISO format)',
        },
        endTime: {
          type: 'string',
          description: 'Hora de fin (ISO format)',
        },
        description: {
          type: 'string',
          description: 'Descripción del evento',
        },
      },
      required: ['title', 'startTime'],
    },
  },
  {
    name: 'analyze_document',
    description: 'Analiza un documento (PDF, imagen, etc) usando OCR y extracción de información.',
    input_schema: {
      type: 'object',
      properties: {
        documentUrl: {
          type: 'string',
          description: 'URL o path del documento',
        },
      },
      required: ['documentUrl'],
    },
  },
];

/**
 * SIMPLE ORCHESTRATOR
 */
export class SimpleOrchestrator {
  /**
   * ORCHESTRATE - Pipeline simple como GitHub Copilot
   */
  async orchestrate(request: SimpleOrchestratorRequest): Promise<SimpleOrchestratorResponse> {
    const startTime = Date.now();
    const requestId = request.requestId || uuidv4();
    
    // LOG: Request recibido
    logger.aiRequestReceived({
      request_id: requestId,
      user_id: request.userId,
      workspace_id: request.workspaceId || 'default',
      route: request.route || '/api/ai/chat',
      message_length: request.userMessage.length,
      channel: 'api',
    });
    
    console.log('[SIMPLE ORCH] ══════════════════════════════════════');
    console.log('[SIMPLE ORCH] Request:', request.userMessage.substring(0, 100));
    console.log('[SIMPLE ORCH] User:', request.userId);
    
    try {
      // Construir historial de mensajes
      const messages: Anthropic.MessageParam[] = [];
      
      // Agregar historial previo si existe
      if (request.conversationHistory && request.conversationHistory.length > 0) {
        request.conversationHistory.forEach(msg => {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({
              role: msg.role as 'user' | 'assistant',
              content: msg.content,
            });
          }
        });
      }
      
      // Agregar mensaje actual
      messages.push({
        role: 'user',
        content: request.userMessage,
      });
      
      // System prompt - Como GitHub Copilot
      const systemPrompt = `Eres AL-E, una asistente AI ejecutiva ultra competente y directa.

Tu personalidad:
- Hablas como una directora de operaciones: clara, eficiente, sin rodeos
- Eres amable pero no empalagosa
- Ejecutas acciones sin pedir permiso innecesario (como GitHub Copilot)
- Si algo falla, lo dices honestamente y propones alternativas

Reglas de oro:
1. Si te piden "revisar correo" → usa list_emails
2. Si te dicen "qué dice" o "léelo" después de mostrar correos → usa read_email con el emailId del primer correo
3. Si mencionan PDF/documento/contrato/adjunto → usa analyze_document
4. Si necesitas info actual/web → usa web_search
5. NUNCA digas "no tengo suficiente información" si puedes ejecutar un tool para obtenerla
6. NUNCA digas "acción completada" si no ejecutaste nada

Contexto:
- Usuario: ${request.userId}
- Email: ${request.userEmail || 'no disponible'}

Ejecuta lo necesario y responde naturalmente.`;
      
      // Llamar a Claude con tools
      let response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools: AVAILABLE_TOOLS,
      });
      
      console.log('[SIMPLE ORCH] Claude response stop_reason:', response.stop_reason);
      
      const toolsUsed: string[] = [];
      let finalAnswer = '';
      
      // Loop de tool calling (hasta 5 iteraciones máximo)
      let iterations = 0;
      const maxIterations = 5;
      
      while (response.stop_reason === 'tool_use' && iterations < maxIterations) {
        iterations++;
        console.log(`[SIMPLE ORCH] Tool use iteration ${iterations}`);
        
        // Extraer tool calls
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
        );
        
        // Ejecutar cada tool
        const toolResults: Anthropic.MessageParam[] = [];
        
        for (const toolUse of toolUseBlocks) {
          const toolName = toolUse.name;
          const toolInput = toolUse.input as Record<string, any>;
          
          console.log(`[SIMPLE ORCH] Executing tool: ${toolName}`);
          console.log(`[SIMPLE ORCH] Input:`, JSON.stringify(toolInput).substring(0, 200));
          
          toolsUsed.push(toolName);
          
          try {
            // 🔥 EJECUTAR TOOL SIN VALIDACIONES
            const result = await executeTool(request.userId, {
              name: toolName,
              parameters: toolInput,
            });
            
            console.log(`[SIMPLE ORCH] ✅ ${toolName} success`);
            
            // Agregar resultado
            toolResults.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify(result),
                },
              ],
            });
            
          } catch (error: any) {
            console.error(`[SIMPLE ORCH] ❌ ${toolName} failed:`, error.message);
            
            // Agregar error como resultado
            toolResults.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({
                    success: false,
                    error: error.message,
                  }),
                  is_error: true,
                },
              ],
            });
          }
        }
        
        // Construir nuevos mensajes para Claude
        const newMessages: Anthropic.MessageParam[] = [
          ...messages,
          {
            role: 'assistant',
            content: response.content,
          },
          ...toolResults,
        ];
        
        // Llamar a Claude de nuevo con los resultados
        response = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          system: systemPrompt,
          messages: newMessages,
          tools: AVAILABLE_TOOLS,
        });
        
        console.log('[SIMPLE ORCH] Claude response stop_reason:', response.stop_reason);
      }
      
      // Extraer respuesta final
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === 'text'
      );
      
      finalAnswer = textBlocks.map(block => block.text).join('\n');
      
      const executionTime = Date.now() - startTime;
      
      console.log('[SIMPLE ORCH] Tools used:', toolsUsed);
      console.log('[SIMPLE ORCH] Execution time:', executionTime, 'ms');
      console.log('[SIMPLE ORCH] ══════════════════════════════════════');
      
      // LOG: Response enviado
      logger.aiResponseSent({
        request_id: requestId,
        status: 'approved',
        response_type: 'facts',
        evidence_ids_summary: { toolsUsed },
        latency_ms_total: executionTime,
      });
      
      return {
        answer: finalAnswer,
        toolsUsed,
        executionTime,
      };
      
    } catch (error: any) {
      console.error('[SIMPLE ORCH] Error:', error);
      
      const executionTime = Date.now() - startTime;
      
      return {
        answer: `Disculpa, tuve un error al procesar tu solicitud: ${error.message}`,
        toolsUsed: [],
        executionTime,
      };
    }
  }
}

// Singleton instance
let orchestratorInstance: SimpleOrchestrator | null = null;

export async function getSimpleOrchestrator(): Promise<SimpleOrchestrator> {
  if (!orchestratorInstance) {
    orchestratorInstance = new SimpleOrchestrator();
  }
  return orchestratorInstance;
}
