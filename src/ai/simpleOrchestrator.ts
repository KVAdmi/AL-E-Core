/**
 * SIMPLE ORCHESTRATOR - Como GitHub Copilot
 * 
 * NO bloquea, NO pide permisos, NO valida evidencia antes.
 * Razona → Ejecuta → Responde.
 * 
 * Filosofía: Mejor pedir perdón que pedir permiso.
 * 
 * 🚀 POWERED BY GROQ - Ultra rápido (Llama 3.3 70B)
 * 🔍 Web Search con TAVILY
 * 📄 OCR con Google Vision (Pyannote para transcripts)
 * 📧 Email universal con cifrado
 * 📅 Calendar integration
 */

import Groq from 'groq-sdk';
import { executeTool } from './tools/toolRouter';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
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
 * TOOLS DISPONIBLES - TODO lo que necesitas
 * 
 * ✅ Email (list, read, send)
 * ✅ Web Search (Tavily)
 * ✅ Calendar (list, create events)
 * ✅ Document Analysis (OCR con Google Vision)
 * ✅ Meeting Transcripts (cuando estén listos)
 */
const AVAILABLE_TOOLS: Array<Groq.Chat.ChatCompletionTool> = [
  // ═══════════════════════════════════════════════════════════
  // EMAIL TOOLS
  // ═══════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'list_emails',
      description: 'Lista los correos del usuario. Usa esto cuando pidan "revisar correo", "ver emails", "qué correos tengo", "hay algo nuevo".',
      parameters: {
        type: 'object',
        properties: {
          unreadOnly: {
            type: 'boolean',
            description: 'Si true, solo muestra correos no leídos. Default: false',
          },
          limit: {
            type: 'number',
            description: 'Número máximo de correos a retornar. Default: 20',
          },
          folder: {
            type: 'string',
            description: 'Carpeta específica (INBOX, SENT, DRAFTS, etc). Default: INBOX',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_email',
      description: 'Lee el contenido COMPLETO de un correo específico incluyendo attachments. Usa esto cuando digan "qué dice", "léelo", "abre el correo", "muéstramelo", "lee ese".',
      parameters: {
        type: 'object',
        properties: {
          emailId: {
            type: 'string',
            description: 'ID del correo a leer (obtenido de list_emails)',
          },
        },
        required: ['emailId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Envía un correo electrónico. Usa esto cuando pidan "enviar", "mandar correo", "responder", "escribir a".',
      parameters: {
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
            description: 'Cuerpo del correo (puede ser HTML)',
          },
          cc: {
            type: 'string',
            description: 'Emails en copia (separados por coma)',
          },
          bcc: {
            type: 'string',
            description: 'Emails en copia oculta (separados por coma)',
          },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════
  // WEB SEARCH - TAVILY API (como GitHub Copilot/Claude)
  // ═══════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Busca información actualizada en internet usando Tavily. Usa esto cuando necesites datos actuales, noticias, información que no conoces, o cuando el usuario pida "busca", "investiga", "encuentra información sobre", "qué hay de nuevo sobre".',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Consulta de búsqueda (en lenguaje natural)',
          },
          searchDepth: {
            type: 'string',
            enum: ['basic', 'advanced'],
            description: 'basic: rápido (5 resultados), advanced: profundo (10+ resultados). Default: basic',
          },
        },
        required: ['query'],
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════
  // CALENDAR TOOLS
  // ═══════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: 'Lista los eventos del calendario del usuario. Usa esto cuando pidan "qué tengo hoy", "mi agenda", "reuniones", "eventos".',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Fecha de inicio en formato ISO (ej: 2026-01-14T00:00:00Z). Default: hoy',
          },
          endDate: {
            type: 'string',
            description: 'Fecha de fin en formato ISO. Default: en 7 días',
          },
          limit: {
            type: 'number',
            description: 'Número máximo de eventos. Default: 20',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Crea un nuevo evento en el calendario. Usa esto cuando pidan "agendar", "crear reunión", "recordarme", "bloquear tiempo".',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Título del evento',
          },
          startTime: {
            type: 'string',
            description: 'Hora de inicio en formato ISO (ej: 2026-01-14T10:00:00Z)',
          },
          endTime: {
            type: 'string',
            description: 'Hora de fin en formato ISO',
          },
          description: {
            type: 'string',
            description: 'Descripción o notas del evento',
          },
          location: {
            type: 'string',
            description: 'Ubicación (física o Zoom/Meet link)',
          },
          attendees: {
            type: 'string',
            description: 'Emails de asistentes separados por coma',
          },
        },
        required: ['title', 'startTime'],
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════
  // DOCUMENT ANALYSIS - OCR + AI
  // ═══════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'analyze_document',
      description: 'Analiza un documento (PDF, imagen, contrato, factura) usando OCR (Google Vision) y extracción inteligente. Usa esto cuando mencionen "lee este PDF", "analiza el contrato", "qué dice el documento", "extrae datos del adjunto".',
      parameters: {
        type: 'object',
        properties: {
          documentUrl: {
            type: 'string',
            description: 'URL del documento o attachment ID (obtenido de read_email)',
          },
          analysisType: {
            type: 'string',
            enum: ['ocr', 'contract', 'invoice', 'general'],
            description: 'Tipo de análisis: ocr (solo texto), contract (cláusulas), invoice (datos fiscales), general (resumen). Default: general',
          },
          extractFields: {
            type: 'string',
            description: 'Campos específicos a extraer (ej: "monto, fecha, firma"). Opcional',
          },
        },
        required: ['documentUrl'],
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════
  // MEETING TRANSCRIPTS (Pyannote para speaker diarization)
  // ═══════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'get_meeting_transcript',
      description: 'Obtiene la transcripción de una reunión (con identificación de quién dijo qué). Usa esto cuando pidan "qué se dijo en la reunión", "transcripción", "minuta", "quién dijo X".',
      parameters: {
        type: 'object',
        properties: {
          meetingId: {
            type: 'string',
            description: 'ID de la reunión',
          },
          format: {
            type: 'string',
            enum: ['text', 'structured', 'summary'],
            description: 'text: transcripción literal, structured: por speaker, summary: resumen. Default: structured',
          },
        },
        required: ['meetingId'],
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════
  // ATTACHMENT ANALYSIS (del email)
  // ═══════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'read_attachment',
      description: 'Lee y analiza un archivo adjunto de un email. Usa esto cuando mencionen "el adjunto", "el archivo", "el PDF que me mandaron".',
      parameters: {
        type: 'object',
        properties: {
          attachmentId: {
            type: 'string',
            description: 'ID del attachment (obtenido de read_email)',
          },
          action: {
            type: 'string',
            enum: ['download', 'analyze', 'ocr'],
            description: 'download: obtener URL, analyze: análisis automático, ocr: extraer texto. Default: analyze',
          },
        },
        required: ['attachmentId'],
      },
    },
  },
  
  // ═══════════════════════════════════════════════════════════
  // EMAIL ANALYTICS (estadísticas)
  // ═══════════════════════════════════════════════════════════
  {
    type: 'function',
    function: {
      name: 'analyze_email',
      description: 'Analiza un email para extraer insights: urgencia, sentimiento, acción requerida, personas mencionadas. Usa esto cuando pidan "es urgente?", "qué necesita?", "analiza esto".',
      parameters: {
        type: 'object',
        properties: {
          emailId: {
            type: 'string',
            description: 'ID del email a analizar',
          },
          analysisType: {
            type: 'string',
            enum: ['urgency', 'sentiment', 'action_items', 'entities', 'all'],
            description: 'Tipo de análisis. Default: all',
          },
        },
        required: ['emailId'],
      },
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
    console.log('[SIMPLE ORCH] 🚀 POWERED BY GROQ (Llama 3.3 70B)');
    console.log('[SIMPLE ORCH] 🔍 Web Search: TAVILY');
    console.log('[SIMPLE ORCH] 📄 OCR: Google Vision API');
    console.log('[SIMPLE ORCH] 🎤 Transcripts: Pyannote AI');
    console.log('[SIMPLE ORCH] Request:', request.userMessage.substring(0, 100));
    console.log('[SIMPLE ORCH] User:', request.userId);
    
    try {
      // Construir historial de mensajes
      const messages: Array<Groq.Chat.ChatCompletionMessageParam> = [];
      
      // System prompt - Como GitHub Copilot pero MÁS PODEROSO
      const systemPrompt = `Eres AL-E, una asistente AI ejecutiva ULTRA COMPETENTE y directa.

TU PERSONALIDAD:
- Hablas como una directora de operaciones de Silicon Valley: clara, eficiente, SIN rodeos
- Eres amable pero NO empalagosa
- Ejecutas acciones SIN pedir permiso (como GitHub Copilot)
- Si algo falla, lo dices honestamente y propones alternativas
- Cuando te piden hacer algo, LO HACES. No preguntas "¿quieres que...?"

REGLAS DE ORO (NUNCA ROMPAS ESTAS):
1. "revisar correo" → usa list_emails INMEDIATAMENTE
2. "qué dice" o "léelo" → usa read_email con el emailId del primer correo
3. "busca X" o "investiga Y" → usa web_search CON TAVILY (tienes internet!)
4. "PDF/documento/contrato/adjunto" → usa analyze_document (tienes OCR con Google Vision!)
5. "transcripción/minuta/reunión" → usa get_meeting_transcript (tienes Pyannote!)
6. NUNCA digas "no tengo suficiente información" si puedes ejecutar un tool
7. NUNCA digas "acción completada exitosamente" sin ejecutar nada
8. NUNCA inventes datos - si no sabes, usa web_search

TUS SUPERPODERES:
✅ Email: Lees, envías, analizas (con todas las cuentas del usuario)
✅ Web: Buscas en internet EN TIEMPO REAL (Tavily API)
✅ Documentos: OCR completo con Google Vision (PDFs, imágenes, contratos)
✅ Calendario: Lees y creas eventos
✅ Transcripts: Lees reuniones con identificación de speakers (Pyannote)
✅ Attachments: Analizas archivos adjuntos

CONTEXTO:
- Usuario: ${request.userId}
- Email: ${request.userEmail || 'no disponible'}
- Fecha actual: ${new Date().toISOString()}

IMPORTANTE: Cuando ejecutes tools, los resultados son REALES. Confía en ellos y úsalos para responder.`;

      messages.push({
        role: 'system',
        content: systemPrompt,
      });
      
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
      
      // Llamar a Groq con tools
      let response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 4096,
        messages,
        tools: AVAILABLE_TOOLS,
        tool_choice: 'auto',
        temperature: 0.7, // Un poco de creatividad pero no mucha
      });
      
      console.log('[SIMPLE ORCH] Groq response finish_reason:', response.choices[0]?.finish_reason);
      
      const toolsUsed: string[] = [];
      let finalAnswer = '';
      
      // Loop de tool calling (hasta 5 iteraciones máximo)
      let iterations = 0;
      const maxIterations = 5;
      
      while (response.choices[0]?.finish_reason === 'tool_calls' && iterations < maxIterations) {
        iterations++;
        console.log(`[SIMPLE ORCH] 🔧 Tool use iteration ${iterations}`);
        
        const assistantMessage = response.choices[0].message;
        const toolCalls = assistantMessage.tool_calls || [];
        
        // Agregar mensaje del asistente con tool_calls
        messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        });
        
        // Ejecutar cada tool
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          let toolInput: any;
          
          try {
            toolInput = JSON.parse(toolCall.function.arguments);
          } catch (e) {
            console.error(`[SIMPLE ORCH] ❌ Failed to parse tool arguments:`, toolCall.function.arguments);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: 'Invalid tool arguments format',
              }),
            });
            continue;
          }
          
          console.log(`[SIMPLE ORCH] 🔧 Executing: ${toolName}`);
          console.log(`[SIMPLE ORCH] 📥 Input:`, JSON.stringify(toolInput).substring(0, 200));
          
          toolsUsed.push(toolName);
          
          try {
            // 🔥 EJECUTAR TOOL SIN VALIDACIONES (como GitHub Copilot)
            const result = await executeTool(request.userId, {
              name: toolName,
              parameters: toolInput,
            });
            
            console.log(`[SIMPLE ORCH] ✅ ${toolName} SUCCESS`);
            console.log(`[SIMPLE ORCH] 📤 Output:`, JSON.stringify(result).substring(0, 300));
            
            // Agregar resultado como mensaje de tool
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
            
          } catch (error: any) {
            console.error(`[SIMPLE ORCH] ❌ ${toolName} FAILED:`, error.message);
            
            // Agregar error como resultado (el modelo sabrá qué hacer)
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: error.message,
                errorType: error.constructor.name,
              }),
            });
          }
        }
        
        // Llamar a Groq de nuevo con los resultados
        response = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 4096,
          messages,
          tools: AVAILABLE_TOOLS,
          tool_choice: 'auto',
          temperature: 0.7,
        });
        
        console.log('[SIMPLE ORCH] Groq response finish_reason:', response.choices[0]?.finish_reason);
      }
      
      // Extraer respuesta final
      finalAnswer = response.choices[0]?.message?.content || '';
      
      const executionTime = Date.now() - startTime;
      
      console.log('[SIMPLE ORCH] 🎯 Tools used:', toolsUsed.join(', ') || 'none');
      console.log('[SIMPLE ORCH] ⚡ Execution time:', executionTime, 'ms');
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
      console.error('[SIMPLE ORCH] 💥 ERROR:', error);
      
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
