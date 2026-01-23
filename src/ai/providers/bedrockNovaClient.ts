/**
 * AMAZON NOVA PRO CLIENT
 * 
 * Cerebro ejecutivo único de AL-E vía Bedrock Converse API.
 * 
 * 🧠 Modelo: amazon.nova-pro (us-east-1)
 * 🔧 API: Bedrock Converse (native tool calling)
 * 🚫 Prohibido: InvokeModel, JSON wrappers, fallbacks
 * 
 * DIRECTOR: 21-ene-2026
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type Message,
  type Tool,
  type ToolInputSchema,
  type ToolResultBlock,
  type ToolUseBlock,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseCommandOutput
} from '@aws-sdk/client-bedrock-runtime';
import { logger } from '../../utils/logger';

// ✅ IAM Role auto-discovery (EC2 instance profile)
// NO especificar credentials explícitas - AWS SDK las toma del role
const bedrock = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const MODEL_ID = 'amazon.nova-pro-v1:0';

/**
 * Tool definitions para Bedrock Converse API.
 * Tools: create_event, delete_event, send_email, list_emails, read_email, list_events, web_search.
 */
const NOVA_TOOLS: Tool[] = [
  {
    toolSpec: {
      name: 'create_event',
      description: 'Crea un nuevo evento en el calendario del usuario. Usa esto cuando pidan agendar, crear cita, o programar reunión.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Título del evento'
            },
            startTime: {
              type: 'string',
              description: 'Hora de inicio en formato ISO 8601 (ej: 2026-01-22T15:00:00-06:00)'
            },
            endTime: {
              type: 'string',
              description: 'Hora de fin en formato ISO 8601 (opcional)'
            },
            description: {
              type: 'string',
              description: 'Descripción del evento (opcional)'
            }
          },
          required: ['title', 'startTime']
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'send_email',
      description: 'Envía un correo electrónico. RESPONDER correo: usa "inReplyTo" con Message-ID del correo original (campo "id" de list_emails/read_email). NUEVO correo: omite "inReplyTo".',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Email del destinatario. Para responder, usa el "from_address" del correo original.'
            },
            subject: {
              type: 'string',
              description: 'Asunto del correo. Para responder, usa "Re: " + subject original.'
            },
            body: {
              type: 'string',
              description: 'Cuerpo del correo en texto plano o HTML'
            },
            inReplyTo: {
              type: 'string',
              description: 'OPCIONAL: Message-ID del correo al que respondes (campo "id" de list_emails/read_email). Para RESPONDER correos usa esto. Para correos nuevos NO lo uses.'
            }
          },
          required: ['to', 'subject', 'body']
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'list_emails',
      description: '⚠️ EMAILS ONLY: Lista correos electrónicos del inbox. EJECUTA SIEMPRE cuando el usuario diga: "revisa correos", "revisa mi correo", "checa emails", "mis mensajes", "inbox", "segunda cuenta", "ambas cuentas". NO inventes respuestas sin ejecutar este tool. NO digas "tengo problemas" sin intentar. EJEMPLO: Usuario dice "revisa correos" → TÚ EJECUTAS list_emails{} → RECIBES lista real → RESPONDES con datos reales. NO uses para agenda/calendario/eventos.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Número máximo de correos a listar (default: 20, máximo: 50)'
            },
            unreadOnly: {
              type: 'boolean',
              description: 'true para mostrar solo correos no leídos'
            },
            folderType: {
              type: 'string',
              description: 'Carpeta a leer: "inbox" (default), "sent", "drafts", "trash", "archive"'
            }
          },
          required: []
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'read_email',
      description: 'Lee el contenido COMPLETO de un correo específico. Usa DESPUÉS de list_emails para leer correos completos. Si el usuario NO especifica cuál correo, usa "latest" como emailId para leer el más reciente.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            emailId: {
              type: 'string',
              description: 'ID del correo a leer. Usa "latest" si el usuario no especifica un correo particular.'
            }
          },
          required: ['emailId']
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'list_events',
      description: 'CALENDARIO ONLY: Lista eventos/citas/reuniones del calendario. Usa cuando mencionen: "agenda", "calendario", "eventos", "citas", "reuniones", "qué tengo programado", "confirmame agenda", "qué tengo hoy/mañana/esta semana". NO uses para correos/emails.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            startDate: {
              type: 'string',
              description: 'Fecha de inicio en formato ISO 8601 (ej: 2026-01-22T00:00:00Z). Si dicen "hoy", usa fecha actual. Si dicen "esta semana", usa inicio de semana.'
            },
            endDate: {
              type: 'string',
              description: 'Fecha de fin en formato ISO 8601. Si no especifican, usa 7 días desde startDate.'
            }
          },
          required: []
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'delete_event',
      description: 'Elimina un evento del calendario. Usa cuando pidan borrar, cancelar o eliminar evento/cita/reunión. Si dicen "borra TODA mi agenda" o "cancela TODOS mis eventos", primero lista eventos con list_events, luego borra cada uno con su eventId.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            eventId: {
              type: 'string',
              description: 'ID del evento a eliminar (viene del campo "id" de list_events). REQUERIDO.'
            }
          },
          required: ['eventId']
        }
      }
    }
  },
  {
    toolSpec: {
      name: 'web_search',
      description: 'BUSCA INFORMACIÓN EN INTERNET usando Tavily. USA SIEMPRE que el usuario diga: "busca", "investiga", "encuentra info de", "qué es", "cuánto cuesta", "dónde está", "información sobre". EJEMPLOS de cuándo usar: (1) "Busca información sobre X" → LLAMA web_search con query="X información completa". (2) "Qué es Vitacard 365" → LLAMA web_search con query="Vitacard 365 qué es membresía beneficios precio". (3) "Cuánto cuesta X" → LLAMA web_search con query="X precio costo México 2026". CRÍTICO: SIEMPRE reescribe query agregando contexto y keywords (precio, beneficios, disponibilidad, funcionamiento). NUNCA digas "no encontré" sin llamar esta tool primero.',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Query de búsqueda REESCRITO con intención clara, contexto geográfico si aplica, y keywords específicos (ej: "precio", "beneficios", "cómo funciona", "disponibilidad México")'
            },
            maxResults: {
              type: 'number',
              description: 'Número máximo de resultados (default: 5)'
            }
          },
          required: ['query']
        }
      }
    }
  }
];

export interface NovaMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface NovaCallResult {
  content: string;
  contentBlocks?: ContentBlock[];  // ✅ Agregar los blocks originales para multi-turn
  toolUses?: ToolUseBlock[];
  stopReason: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

/**
 * Llamada única a Amazon Nova Pro.
 * 
 * @param messages - Historial de conversación (user/assistant)
 * @param systemPrompt - System prompt (identidad, contexto, reglas)
 * @param maxTokens - Límite de tokens de salida (default: 4096)
 * @returns Respuesta de Nova con texto y/o tool_uses
 */
export async function callNovaPro(
  messages: NovaMessage[],
  systemPrompt: string,
  maxTokens: number = 4096
): Promise<NovaCallResult> {
  
  console.log('[NOVA] ════════════════════════════════════════════════');
  console.log('[NOVA] 🧠 Amazon Nova Pro v1:0');
  console.log('[NOVA] Region: us-east-1');
  console.log('[NOVA] Messages:', messages.length);
  console.log('[NOVA] System prompt length:', systemPrompt.length);
  console.log('[NOVA] Tools available:', NOVA_TOOLS.length);
  
  // Convertir mensajes al formato Bedrock Converse
  const converseMessages: Message[] = messages.map(msg => {
    // Si content es string, convertir a ContentBlock
    const content: ContentBlock[] = typeof msg.content === 'string'
      ? [{ text: msg.content }]
      : msg.content;
    
    return {
      role: msg.role,
      content
    };
  });
  
  const input: ConverseCommandInput = {
    modelId: MODEL_ID,
    messages: converseMessages,
    system: [{ text: systemPrompt }],
    inferenceConfig: {
      maxTokens,
      temperature: 0.7,
      topP: 0.9
    },
    toolConfig: {
      tools: NOVA_TOOLS
    }
  };
  
  try {
    const command = new ConverseCommand(input);
    const response: ConverseCommandOutput = await bedrock.send(command);
    
    console.log('[NOVA] ✅ Response received');
    console.log('[NOVA] Stop reason:', response.stopReason);
    console.log('[NOVA] Usage:', response.usage);
    
    // Extraer contenido
    let textContent = '';
    let toolUses: ToolUseBlock[] = [];
    const originalContentBlocks: ContentBlock[] = response.output?.message?.content || [];
    
    if (response.output?.message?.content) {
      for (const block of response.output.message.content) {
        if (block.text) {
          textContent += block.text;
        }
        if (block.toolUse) {
          toolUses.push(block.toolUse);
          console.log('[NOVA] 🔧 Tool use detected:', block.toolUse.name);
        }
      }
    }
    
    return {
      content: textContent,
      contentBlocks: originalContentBlocks,
      toolUses: toolUses.length > 0 ? toolUses : undefined,
      stopReason: response.stopReason || 'unknown',
      usage: response.usage ? {
        inputTokens: response.usage.inputTokens || 0,
        outputTokens: response.usage.outputTokens || 0,
        totalTokens: response.usage.totalTokens || 0
      } : undefined
    };
    
  } catch (error: any) {
    console.error('[NOVA] ❌ CALL FAILED');
    console.error('[NOVA] Error:', error.message);
    console.error('[NOVA] Code:', error.name);
    
    if (error.$metadata) {
      console.error('[NOVA] HTTP Status:', error.$metadata.httpStatusCode);
    }
    
    throw new Error(`Amazon Nova Pro failed: ${error.message}`);
  }
}

/**
 * Construye un ContentBlock de toolResult para Bedrock.
 * 
 * @param toolUseId - ID del toolUse recibido de Nova
 * @param content - Resultado de la ejecución (string o objeto)
 * @returns ContentBlock con toolResult
 */
export function buildToolResultBlock(
  toolUseId: string,
  content: any
): ContentBlock {
  const resultContent = typeof content === 'string' 
    ? content 
    : JSON.stringify(content);
  
  return {
    toolResult: {
      toolUseId,
      content: [{ text: resultContent }]
    }
  };
}
