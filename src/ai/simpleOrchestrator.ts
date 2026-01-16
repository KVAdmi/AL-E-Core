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
import {
  detectGroqEvasion,
  detectEvidenceMismatch,
  invokeOpenAIReferee,
  type RefereeReason
} from '../llm/openaiReferee';

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
      const { data: userProfile, error: profileError } = await supabase
        .from('user_profiles')
        .select('preferred_name, assistant_name, tone_pref')
        .eq('user_id', request.userId)
        .single();
      
      if (profileError && profileError.code !== 'PGRST116') {
        console.error('[SIMPLE ORCH] ⚠️ Error cargando perfil:', profileError);
      }
      
      const assistantName = userProfile?.assistant_name || 'AL-E';
      const userNickname = userProfile?.preferred_name || 'Usuario';
      const tonePref = userProfile?.tone_pref || 'barrio';
      
      console.log('[SIMPLE ORCH] 👤 Nombre asistente:', assistantName);
      console.log('[SIMPLE ORCH] 👤 Nickname usuario:', userNickname);
      console.log('[SIMPLE ORCH] 👤 Tono preferido:', tonePref);
      
      const messages: Array<Groq.Chat.ChatCompletionMessageParam> = [];
      
      // 🎭 3. SYSTEM PROMPT ANTI-MENTIRAS (P0 ABSOLUTO)
      const systemPrompt = `Eres ${assistantName}, asistente AI ejecutiva de ${userNickname}.

🚫 PROHIBICIONES ABSOLUTAS (NUNCA HAGAS ESTO):
❌ NUNCA inventes resultados de tools
❌ NUNCA digas "revisé" si no ejecutaste list_emails
❌ NUNCA digas "según encontré" si no ejecutaste web_search
❌ NUNCA inventes nombres de empresas, personas o correos
❌ NUNCA simules acciones completadas
❌ Si un tool falla, di "El tool falló: [razón]"
❌ Si no tienes información, di "No tengo esa información"

✅ REGLAS DE EJECUCIÓN OBLIGATORIAS:
1. "revisar correo" → EJECUTA list_emails INMEDIATAMENTE
2. "qué dice X correo" → EJECUTA read_email con el emailId
3. "busca/investiga" → EJECUTA web_search (Tavily)
4. "mi agenda" → EJECUTA list_events
5. Después de ejecutar tool → USA LOS DATOS REALES en tu respuesta

� FORMATO DE RESPUESTA OBLIGATORIO:
Cuando ejecutes un tool, SIEMPRE estructura así:

**Acción ejecutada:** [nombre del tool]
**Resultado:** [datos reales del tool]
**Fuente:** [email_messages / web_search / calendar_events]

Ejemplo correcto:
"Revisé tu correo.
**Cuenta:** usuario@gmail.com
**Correos encontrados:** 3
**Fuente:** email_messages

1. De: Juan Pérez - Asunto: Propuesta comercial
2. De: María López - Asunto: Reunión pendiente
3. De: Sistema - Asunto: Confirmación de pago

¿Deseas leer alguno?"

Ejemplo PROHIBIDO:
"Revisé tu correo y tienes varios mensajes importantes..."
(❌ NO dice cuántos, NO dice de quién, NO dice la fuente)

🧠 MEMORIA DEL USUARIO:
${userMemories}

📧 TOOLS DISPONIBLES:
- list_emails: Lista correos reales del usuario
- read_email: Lee UN correo específico
- send_email: Envía correo (requiere to, subject, body)
- web_search: Busca en web con Tavily
- list_events: Lista eventos del calendario
- create_event: Crea evento (requiere title, startTime)
- analyze_document: Analiza PDF/imagen con OCR

CONTEXTO:
- Usuario: ${userNickname} (${request.userId})
- Email: ${request.userEmail || 'N/A'}
- Workspace: ${workspaceId}

SI NO EJECUTASTE UN TOOL, NO DIGAS QUE LO HICISTE.
LA VERDAD ES MÁS IMPORTANTE QUE SER ÚTIL.`;

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
        model: 'llama-3.3-70b-versatile', // Actualizado: 3.3 soporta tool calling
        max_tokens: 4096,
        messages,
        tools: AVAILABLE_TOOLS,
        tool_choice: 'auto',
      });
      
      console.log('[SIMPLE ORCH] Finish reason:', response.choices[0]?.finish_reason);
      
      // Array para guardar resultados de tools (para referee)
      const toolResults: any[] = [];
      
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
            
            // Guardar resultado para referee
            toolResults.push({ tool: toolName, result });
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          } catch (error: any) {
            console.error(`[SIMPLE ORCH] ❌ ${toolName}:`, error.message);
            
            // Guardar error para referee
            toolResults.push({ tool: toolName, error: error.message });
            
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
      
      const executionTime = Date.now() - startTime;
      
      console.log('[SIMPLE ORCH] 🎯 Tools:', toolsUsed);
      console.log('[SIMPLE ORCH] ⏱️', executionTime, 'ms');
      
      // ====================================================================
      // VALIDACIÓN POST-RESPUESTA: Verificar que menciona tools ejecutados
      // ====================================================================
      
      let finalAnswer = response.choices[0]?.message?.content || '';
      
      console.log('[SIMPLE ORCH] 🔍 Validando respuesta...');
      
      if (toolsUsed.length > 0) {
        const responseText = finalAnswer.toLowerCase();
        
        let mentionedTools = false;
        for (const tool of toolsUsed) {
          if (responseText.includes(tool.replace('_', ' ')) || 
              responseText.includes('encontré') || 
              responseText.includes('revisé') ||
              responseText.includes('fuente:') ||
              responseText.includes('resultado:')) {
            mentionedTools = true;
            break;
          }
        }
        
        if (!mentionedTools) {
          console.warn('[SIMPLE ORCH] ⚠️ Respuesta no menciona tools ejecutados - forzando estructura');
          
          const toolsSummary = toolResults.map((tr: any, idx: number) => 
            `${idx + 1}. Tool: ${tr.toolName}\n   Resultado: ${JSON.stringify(tr.result).substring(0, 200)}`
          ).join('\n');
          
          finalAnswer = `⚠️ Ejecuté las siguientes acciones:\n\n${toolsSummary}\n\n---\n\n${finalAnswer}`;
        }
      }
      
      // ====================================================================
      // OPENAI REFEREE - Detección de evasiones
      // ====================================================================
      
      let correctedAnswer = finalAnswer;
      
      if (process.env.OPENAI_ROLE === 'referee') {
        try {
          // Detectar si Groq evadió
          const evasionCheck = detectGroqEvasion(
            finalAnswer,
            AVAILABLE_TOOLS.length > 0,
            toolsUsed.length > 0
          );
          
          // Detectar contradicción con evidencia
          const evidenceMismatch = toolResults.length > 0
            ? detectEvidenceMismatch(finalAnswer, { toolResults })
            : false;
          
          const needsReferee = evasionCheck.needsReferee || evidenceMismatch;
          
          if (needsReferee) {
            console.log(`[SIMPLE ORCH] ⚖️ OPENAI REFEREE INVOKED - reason=${evasionCheck.reason || 'evidence_mismatch'}`);
            
            const refereeResult = await invokeOpenAIReferee({
              userPrompt: request.userMessage,
              groqResponse: finalAnswer,
              toolResults: toolResults.length > 0 ? { tools: toolResults } : undefined,
              systemState: {
                tools_available: AVAILABLE_TOOLS.length,
                tools_executed: toolsUsed.length,
                execution_time_ms: executionTime
              },
              detectedIssue: evasionCheck.reason || 'evidence_mismatch'
            });
            
            correctedAnswer = refereeResult.text;
            console.log(`[SIMPLE ORCH] ✅ REFEREE CORRECTED - primary_model=groq fallback_model=openai`);
          }
        } catch (refereeError: any) {
          console.error(`[SIMPLE ORCH] ❌ REFEREE FAILED: ${refereeError.message}`);
          // Continuar con respuesta de Groq
        }
      }
      
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
      
      return { answer: correctedAnswer, toolsUsed, executionTime };
      
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
