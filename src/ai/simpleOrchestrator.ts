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
import OpenAI from 'openai';
import { executeTool } from './tools/toolRouter';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabase';
import { canCallOpenAI, recordOpenAICall, estimateOpenAICost, getOpenAIUsageStats } from '../utils/openaiRateLimiter';
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
  metadata?: {
    model?: string;
    finish_reason?: string;
    groq_failed?: boolean;
    openai_failed?: boolean;
    referee_invoked?: boolean;
    referee_reason?: string;
    referee_failed?: boolean;
    error_handled?: boolean;
    rate_limit_exceeded?: boolean;
    limit?: string;
  };
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
      const systemPrompt = `Eres ${assistantName}, asistente personal de ${userNickname}.

PERSONALIDAD:
- Conversacional y natural como amigo cercano
- Hablas directo sin formalismos
- Respondes como si estuvieras en WhatsApp
- NUNCA uses ** (negritas) ni formatos técnicos
- Di las cosas como yo se las diría

PROHIBICIONES ABSOLUTAS:
- NUNCA inventes resultados de tools
- NUNCA digas "revisé" si no ejecutaste list_emails
- NUNCA digas "según encontré" si no ejecutaste web_search
- NUNCA inventes nombres de empresas, personas o correos
- Si un tool falla, dilo directo: "No pude [acción] porque [razón]"
- Si no tienes info, di: "No tengo esa información"

CUÁNDO USAR TOOLS (MUY IMPORTANTE):
1. Usuario dice "revisar correo/email/mensajes" → USA list_emails
2. Usuario pregunta por info que NO sabes (tipo de cambio, noticias, empresas) → USA web_search
3. Usuario dice "mi agenda/calendario/reuniones" → USA list_events
4. Usuario pide enviar correo → USA send_email
5. Para TODO lo demás → Responde directo SIN tools

FORMATO DE RESPUESTA:
Habla natural, sin estructuras técnicas.

Ejemplo CORRECTO:
"Ok ${userNickname}, revisé tu correo de usuario@gmail.com. Tienes 3 correos:

1. Juan Pérez - Propuesta comercial
2. María López - Reunión pendiente  
3. Sistema - Confirmación de pago

¿Cuál quieres que te lea?"

Ejemplo PROHIBIDO:
"Revisé tu correo.
Acción ejecutada: list_emails
Resultado: 3 correos
Fuente: email_messages"
(Demasiado técnico, usa tu tono natural)

MEMORIA DEL USUARIO:
${userMemories}

TOOLS DISPONIBLES:
- list_emails: Lista correos reales del usuario
- read_email: Lee UN correo específico
- send_email: Envía correo (requiere to, subject, body)
- web_search: Busca en web con Tavily (usa esto para info que no sabes)
- list_events: Lista eventos del calendario
- create_event: Crea evento (requiere title, startTime)
- analyze_document: Analiza PDF/imagen con OCR

CONTEXTO:
- Usuario: ${userNickname} (${request.userId})
- Email: ${request.userEmail || 'N/A'}
- Workspace: ${workspaceId}

RECUERDA: Si no ejecutaste un tool, NO digas que lo hiciste. La verdad siempre.`;
      
      if (request.conversationHistory && request.conversationHistory.length > 0) {
        request.conversationHistory.forEach(msg => {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
          }
        });
      }
      
      messages.push({ role: 'user', content: request.userMessage });
      
      let response;
      let groqFailed = false;
      let usingOpenAI = false;
      
      // 🔥 P0 FIX: Usar OpenAI directamente para tool calling
      // Groq llama-3.3-70b tiene problemas generando tool calls válidos
      
      // 🔒 P0 COST CONTROL: Verificar límites ANTES de llamar
      const rateLimitCheck = canCallOpenAI();
      if (!rateLimitCheck.allowed) {
        console.error('[OPENAI LIMITER] ❌ Límite excedido:', rateLimitCheck.reason);
        console.error('[OPENAI LIMITER] � Stats:', JSON.stringify(getOpenAIUsageStats(), null, 2));
        
        // Fallback a Groq sin tools
        console.log('[FALLBACK] 🚨 OpenAI limit exceeded, using Groq without tools...');
        try {
          response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 2048,
            messages: [
              {
                role: 'system',
                content: `Eres ${assistantName}, asistente personal de ${userNickname}. Los tools no están disponibles temporalmente. Responde de manera natural sin inventar datos.`,
              },
              { role: 'user', content: request.userMessage },
            ],
          });
        } catch (groqFallbackError: any) {
          return {
            answer: 'Estoy teniendo problemas técnicos. ¿Puedes intentar de nuevo en unos segundos?',
            toolsUsed: [],
            executionTime: Date.now() - startTime,
            metadata: { model: 'fallback', rate_limit_exceeded: true, limit: rateLimitCheck.limit },
          };
        }
      } else {
        try {
          console.log('[ORCH] 🚀 Usando OpenAI para tool calling...');
          console.log('[OPENAI LIMITER] ✅ Rate limit OK - Remaining:', {
            perMinute: getOpenAIUsageStats().remainingCalls.perMinute,
            perHour: getOpenAIUsageStats().remainingCalls.perHour,
            budget: `$${getOpenAIUsageStats().remainingBudget.toFixed(2)}`
          });
          
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          
          usingOpenAI = true;
          response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 600, // P0 LIMIT: maxTokensPerCall
            messages: messages as any,
            tools: AVAILABLE_TOOLS as any,
            tool_choice: 'auto',
          });
          
          // Registrar uso y costo
          const inputTokens = response.usage?.prompt_tokens || 0;
          const outputTokens = response.usage?.completion_tokens || 0;
          const estimatedCost = estimateOpenAICost(inputTokens, outputTokens);
          recordOpenAICall(inputTokens + outputTokens, estimatedCost);
          
          console.log('[ORCH] ✅ OpenAI tool calling - Finish reason:', response.choices[0]?.finish_reason);
          console.log('[ORCH] tool_call_attempted =', response.choices[0]?.finish_reason === 'tool_calls');
        } catch (openaiError: any) {
          console.error('[ORCH] ❌ OpenAI tool calling failed:', openaiError.message);
          console.error('[ORCH] Error code:', openaiError.code);
          groqFailed = true;
          
          // Último recurso: Groq sin tools (solo texto)
          console.log('[FALLBACK] 🚨 OpenAI failed, trying Groq without tools...');
          
          try {
            response = await groq.chat.completions.create({
              model: 'llama-3.3-70b-versatile',
              max_tokens: 2048,
              messages: [
                {
                  role: 'system',
                  content: `Eres ${assistantName}, asistente personal de ${userNickname}. 
                  
Los tools no están disponibles temporalmente. Responde de manera natural.
Si necesitas información externa (clima, correo, etc), di: "Necesito consultar esa información pero tengo problemas técnicos ahora. ¿Intentamos en un momento?"

NUNCA inventes datos.`,
                },
                { role: 'user', content: request.userMessage },
              ],
            });
          } catch (groqFallbackError: any) {
            console.error('[FALLBACK] ❌ Groq fallback failed:', groqFallbackError.message);
            
            // Último último recurso
            return {
              answer: 'Estoy teniendo problemas técnicos. ¿Puedes intentar de nuevo en unos segundos?',
              toolsUsed: [],
              executionTime: Date.now() - startTime,
              metadata: {
                model: 'fallback',
                openai_failed: true,
                groq_failed: true,
                error_handled: true,
              },
            };
          }
        }
      }
      
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
          
          console.log(`[ORCH] ⚙️ Tool: ${toolName}`);
          console.log(`[ORCH] tool_call_attempted = true`);
          console.log(`[${toolName.toUpperCase()}] payload =`, JSON.stringify(toolInput));
          
          toolsUsed.push(toolName);
          
          try {
            const result = await executeTool(request.userId, { name: toolName, parameters: toolInput });
            console.log(`[${toolName.toUpperCase()}] ✅ Success`);
            console.log(`[${toolName.toUpperCase()}] response =`, JSON.stringify(result).substring(0, 200));
            
            // Guardar resultado para referee
            toolResults.push({ tool: toolName, result });
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          } catch (error: any) {
            console.error(`[${toolName.toUpperCase()}] ❌ Error:`, error.message);
            console.error(`[ORCH] tool_failed = true`);
            console.error(`[ORCH] tool_error =`, error.message);
            
            // Guardar error para referee
            toolResults.push({ tool: toolName, error: error.message });
            
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: false, error: error.message }),
            });
          }
        }
        
        // Segunda llamada con resultados de tools (usar el mismo provider)
        if (usingOpenAI) {
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            max_tokens: 4096,
            messages: messages as any,
            tools: AVAILABLE_TOOLS as any,
            tool_choice: 'auto',
          });
        } else {
          response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 4096,
            messages,
            tools: AVAILABLE_TOOLS,
            tool_choice: 'auto',
          });
        }
        
        console.log('[ORCH] Segunda llamada - Finish reason:', response.choices[0]?.finish_reason);
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
