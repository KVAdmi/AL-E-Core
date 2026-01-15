/**
 * SIMPLE ORCHESTRATOR - Como GitHub Copilot
 * 
 * NO bloquea, NO pide permisos, NO valida evidencia antes.
 * Razona → Ejecuta → Responde.
 * 
 * Filosofía: Mejor pedir perdón que pedir permiso.
 * 
 * 🚀 POWERED BY GROQ - Llama 3.3 70B
 */

import Groq from 'groq-sdk';
import { executeTool } from './tools/toolRouter';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabase';

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

const AVAILABLE_TOOLS: Array<Groq.Chat.ChatCompletionTool> = [
  {
    type: 'function',
    function: {
      name: 'list_emails',
      description: 'Lista los correos del usuario. Usa esto cuando pidan "revisar correo", "ver emails", "qué correos tengo".',
      parameters: {
        type: 'object',
        properties: {
          unreadOnly: { type: 'boolean', description: 'Si true, solo muestra correos no leídos' },
          limit: { type: 'number', description: 'Número máximo de correos a retornar (default: 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_email',
      description: 'Lee el contenido completo de un correo específico. Usa esto cuando digan "qué dice", "léelo", "abre el correo".',
      parameters: {
        type: 'object',
        properties: {
          emailId: { type: 'string', description: 'ID del correo a leer' },
        },
        required: ['emailId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Envía un correo electrónico.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Email del destinatario' },
          subject: { type: 'string', description: 'Asunto del correo' },
          body: { type: 'string', description: 'Cuerpo del correo' },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Busca información en internet con Tavily. Usa esto cuando necesites datos actuales.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Consulta de búsqueda' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_events',
      description: 'Lista los eventos del calendario del usuario.',
      parameters: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Fecha de inicio (ISO format)' },
          endDate: { type: 'string', description: 'Fecha de fin (ISO format)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Crea un nuevo evento en el calendario.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Título del evento' },
          startTime: { type: 'string', description: 'Hora de inicio (ISO format)' },
          endTime: { type: 'string', description: 'Hora de fin (ISO format)' },
          description: { type: 'string', description: 'Descripción del evento' },
        },
        required: ['title', 'startTime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_document',
      description: 'Analiza un documento (PDF, imagen, etc) usando OCR y extracción de información.',
      parameters: {
        type: 'object',
        properties: {
          documentUrl: { type: 'string', description: 'URL o path del documento' },
        },
        required: ['documentUrl'],
      },
    },
  },
];

export class SimpleOrchestrator {
  async orchestrate(request: SimpleOrchestratorRequest): Promise<SimpleOrchestratorResponse> {
    const startTime = Date.now();
    const requestId = request.requestId || uuidv4();
    const workspaceId = request.workspaceId || 'default';
    
    logger.aiRequestReceived({
      request_id: requestId,
      user_id: request.userId,
      workspace_id: workspaceId,
      route: request.route || '/api/ai/chat',
      message_length: request.userMessage.length,
      channel: 'api',
    });
    
    console.log('[SIMPLE ORCH] ══════════════════════════════════════');
    console.log('[SIMPLE ORCH] 🚀 GROQ (Llama 3.3 70B)');
    console.log('[SIMPLE ORCH] Request:', request.userMessage.substring(0, 100));
    console.log('[SIMPLE ORCH] User:', request.userId);
    
    try {
      // 🧠 1. CARGAR MEMORIA DEL USUARIO desde Supabase
      console.log('[SIMPLE ORCH] 🧠 Cargando memoria del usuario...');
      const { data: memories, error: memError } = await supabase
        .from('assistant_memories')
        .select('memory, importance, created_at')
        .eq('user_id', request.userId)
        .eq('workspace_id', workspaceId)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (memError) {
        console.error('[SIMPLE ORCH] ⚠️ Error cargando memorias:', memError);
      }
      
      const userMemories = memories && memories.length > 0 
        ? memories.map(m => m.memory).join('\n- ')
        : 'No hay memorias previas';
      
      console.log('[SIMPLE ORCH] 🧠 Memorias cargadas:', memories?.length || 0);
      
      // 👤 2. CARGAR CONFIGURACIÓN DEL USUARIO
      console.log('[SIMPLE ORCH] 👤 Cargando configuración del usuario...');
      const { data: userConfig, error: configError } = await supabase
        .from('user_settings')
        .select('assistant_name, user_nickname, preferences')
        .eq('user_id', request.userId)
        .single();
      
      if (configError && configError.code !== 'PGRST116') {
        console.error('[SIMPLE ORCH] ⚠️ Error cargando config:', configError);
      }
      
      const assistantName = userConfig?.assistant_name || 'AL-E';
      const userNickname = userConfig?.user_nickname || 'Usuario';
      const preferences = userConfig?.preferences || {};
      
      console.log('[SIMPLE ORCH] 👤 Nombre asistente:', assistantName);
      console.log('[SIMPLE ORCH] 👤 Nickname usuario:', userNickname);
      
      const messages: Array<Groq.Chat.ChatCompletionMessageParam> = [];
      
      // 🎭 3. SYSTEM PROMPT PERSONALIZADO CON MEMORIA
      const systemPrompt = `Eres ${assistantName}, asistente AI ejecutiva ultra competente de ${userNickname}.

TU PERSONALIDAD:
- Clara, eficiente, sin rodeos (como directora de operaciones de Silicon Valley)
- Ejecutas acciones SIN pedir permiso (como GitHub Copilot)
- Si algo falla, lo dices honestamente y propones alternativas
- Hablas directo, sin ser formal en exceso
- Usas "flaca" o términos casuales si el usuario lo hace

🧠 LO QUE RECUERDAS DE ${userNickname}:
${userMemories}

📧 CAPACIDADES (úsalas automáticamente):
✅ Email: list_emails, read_email, send_email
✅ Web: web_search (Tavily - búsquedas en tiempo real)
✅ Documentos: analyze_document (OCR con Google Vision)
✅ Calendario: list_events, create_event
✅ Transcripts: get_meeting_transcript

REGLAS DE ORO:
1. "revisar correo" → usa list_emails INMEDIATAMENTE
2. "qué dice" o "léelo" → usa read_email con el emailId
3. "PDF/documento/contrato/imagen" → usa analyze_document (tienes OCR!)
4. "busca/investiga/qué es" → usa web_search (Tavily)
5. NUNCA digas "no tengo información" si puedes ejecutar un tool
6. NUNCA digas "acción completada" sin ejecutar nada
7. Cuando ejecutes tools, usa los resultados REALES en tu respuesta

CONTEXTO ACTUAL:
- Usuario: ${userNickname} (${request.userId})
- Email: ${request.userEmail || 'N/A'}
- Workspace: ${workspaceId}

IMPORTANTE: Después de ejecutar un tool, SIEMPRE menciona lo que encontraste con los datos reales. No inventes.`;

      messages.push({ role: 'system', content: systemPrompt });
      
      if (request.conversationHistory && request.conversationHistory.length > 0) {
        request.conversationHistory.forEach(msg => {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
          }
        });
      }
      
      messages.push({ role: 'user', content: request.userMessage });
      
      let response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 4096,
        messages,
        tools: AVAILABLE_TOOLS,
        tool_choice: 'auto',
      });
      
      console.log('[SIMPLE ORCH] Finish reason:', response.choices[0]?.finish_reason);
      
      const toolsUsed: string[] = [];
      let iterations = 0;
      const maxIterations = 5;
      
      while (response.choices[0]?.finish_reason === 'tool_calls' && iterations < maxIterations) {
        iterations++;
        console.log(`[SIMPLE ORCH] 🔧 Iteration ${iterations}`);
        
        const assistantMessage = response.choices[0].message;
        const toolCalls = assistantMessage.tool_calls || [];
        
        messages.push({
          role: 'assistant',
          content: assistantMessage.content || '',
          tool_calls: toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        });
        
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const toolInput = JSON.parse(toolCall.function.arguments);
          
          console.log(`[SIMPLE ORCH] ⚙️  ${toolName}`);
          toolsUsed.push(toolName);
          
          try {
            const result = await executeTool(request.userId, { name: toolName, parameters: toolInput });
            console.log(`[SIMPLE ORCH] ✅ ${toolName} success`);
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          } catch (error: any) {
            console.error(`[SIMPLE ORCH] ❌ ${toolName}:`, error.message);
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: false, error: error.message }),
            });
          }
        }
        
        response = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 4096,
          messages,
          tools: AVAILABLE_TOOLS,
          tool_choice: 'auto',
        });
        
        console.log('[SIMPLE ORCH] Finish reason:', response.choices[0]?.finish_reason);
      }
      
      const finalAnswer = response.choices[0]?.message?.content || '';
      const executionTime = Date.now() - startTime;
      
      console.log('[SIMPLE ORCH] 🎯 Tools:', toolsUsed);
      console.log('[SIMPLE ORCH] ⏱️', executionTime, 'ms');
      
      // 💾 GUARDAR MEMORIA si la conversación fue importante
      if (toolsUsed.length > 0 || request.userMessage.length > 50) {
        console.log('[SIMPLE ORCH] 💾 Guardando memoria...');
        
        const memoryText = `${userNickname} preguntó: "${request.userMessage.substring(0, 200)}". ${assistantName} usó: ${toolsUsed.join(', ') || 'respuesta directa'}.`;
        const importance = toolsUsed.length > 0 ? 5 : 3; // Más importante si usó tools
        
        await supabase
          .from('assistant_memories')
          .insert({
            workspace_id: workspaceId,
            user_id: request.userId,
            mode: 'universal',
            memory: memoryText,
            importance,
          })
          .then(({ error }) => {
            if (error) console.error('[SIMPLE ORCH] ⚠️ Error guardando memoria:', error);
            else console.log('[SIMPLE ORCH] 💾 Memoria guardada');
          });
      }
      
      console.log('[SIMPLE ORCH] ══════════════════════════════════════');
      
      logger.aiResponseSent({
        request_id: requestId,
        status: 'approved',
        response_type: 'facts',
        evidence_ids_summary: { toolsUsed },
        latency_ms_total: executionTime,
      });
      
      return { answer: finalAnswer, toolsUsed, executionTime };
      
    } catch (error: any) {
      console.error('[SIMPLE ORCH] 💥 Error:', error);
      const executionTime = Date.now() - startTime;
      return {
        answer: `Disculpa, error: ${error.message}`,
        toolsUsed: [],
        executionTime,
      };
    }
  }
}

let orchestratorInstance: SimpleOrchestrator | null = null;

export async function getSimpleOrchestrator(): Promise<SimpleOrchestrator> {
  if (!orchestratorInstance) {
    orchestratorInstance = new SimpleOrchestrator();
  }
  return orchestratorInstance;
}
