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
  sessionId?: string; // ✅ FASE 2: sessionId para memoria persistente
  userEmail?: string;
  conversationHistory?: Array<{ role: string; content: string }>;
  requestId?: string;
  route?: string;
  workspaceId?: string;
}

interface SimpleOrchestratorResponse {
  answer: string;
  session_id?: string | null; // ✅ FASE 2: Retornar sessionId para frontend
  toolsUsed: string[];
  executionTime: number;
  metadata?: {
    model?: string;
    finish_reason?: string;
    tool_call_provider?: 'groq' | 'openai' | 'none';
    final_response_provider?: 'groq' | 'openai';
    referee_used?: boolean;
    referee_reason?: string;
    stateless_mode?: boolean;
    server_now_iso?: string;
    memories_loaded?: number; // ✅ FASE 2: Debug info
    groq_failed?: boolean;
    openai_failed?: boolean;
    referee_invoked?: boolean;
    referee_failed?: boolean;
    error_handled?: boolean;
    rate_limit_exceeded?: boolean;
    limit?: string;
    openai_blocked?: boolean;
    voice_mode?: boolean;
    error?: string;
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
      // 🔒 GUARDRAIL ABSOLUTO: OPENAI PROHIBIDO EN MODO VOZ
      const isVoiceMode = request.route?.includes('/voice') || 
                          request.userMessage?.toLowerCase().includes('[voice]') ||
                          false; // TODO: detectar desde channel o metadata
      
      if (isVoiceMode) {
        console.warn('[GUARDRAIL] 🚫 OPENAI DISABLED - voice_handsfree mode active');
        console.warn('[GUARDRAIL] STT: Groq Whisper ONLY');
        console.warn('[GUARDRAIL] LLM: Groq ONLY');
        console.warn('[GUARDRAIL] Referee: DISABLED');
      }
      
      // 🔒 P0: VALIDAR UUID - Si userId no es UUID válido, modo stateless
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isValidUUID = uuidRegex.test(request.userId);
      
      let statelessMode = false;
      let openaiBlocked = false; // 🔒 GUARDRAIL: Se activa en modo voz
      
      if (!isValidUUID) {
        statelessMode = true;
        console.warn('[ORCH] ⚠️ invalid_user_id -> stateless_mode=true');
        console.warn(`[ORCH] userId="${request.userId}" no es UUID válido`);
        console.warn('[ORCH] NO se cargará perfil/memoria/settings');
      }
      
      // 🔒 ACTIVAR GUARDRAIL si modo voz detectado
      if (isVoiceMode) {
        openaiBlocked = true;
        console.warn('[GUARDRAIL] ✅ openai_blocked=true (voice mode active)');
      }
      
      let userMemories = 'No hay memorias previas';
      let assistantName = 'AL-E';
      let userNickname = 'Usuario';
      let tonePref = 'barrio';
      
      if (!statelessMode) {
        // 🧠 1. CARGAR MEMORIA DEL USUARIO desde Supabase
        console.log('[SIMPLE ORCH] 🧠 Cargando memoria del usuario...');
        const { data: memories, error: memError } = await supabase
          .from('assistant_memories')
          .select('memory, importance, created_at')
          .eq('user_id_uuid', request.userId) // ✅ FASE 2: Usar user_id_uuid para UUIDs
          .eq('workspace_id', workspaceId)
          .order('importance', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(10);
        
        if (memError) {
          console.error('[SIMPLE ORCH] ⚠️ Error cargando memorias:', memError);
        }
        
        userMemories = memories && memories.length > 0 
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
        
        assistantName = userProfile?.assistant_name || 'AL-E';
        userNickname = userProfile?.preferred_name || 'Usuario';
        tonePref = userProfile?.tone_pref || 'barrio';
      } else {
        console.log('[SIMPLE ORCH] 🚫 Stateless mode: usando defaults (AL-E, Usuario, barrio)');
      }
      
      console.log('[SIMPLE ORCH] 👤 Nombre asistente:', assistantName);
      console.log('[SIMPLE ORCH] 👤 Nickname usuario:', userNickname);
      console.log('[SIMPLE ORCH] 👤 Tono preferido:', tonePref);
      
      // 🕐 P0: TIME GROUNDING - Inyectar timestamp del servidor
      const serverNow = new Date();
      const serverNowISO = serverNow.toISOString();
      const serverNowLocal = serverNow.toLocaleString('es-MX', { 
        timeZone: 'America/Mexico_City',
        dateStyle: 'full',
        timeStyle: 'short'
      });
      console.log('[SIMPLE ORCH] 🕐 Server time:', serverNowISO, '(', serverNowLocal, ')');
      
      const messages: Array<Groq.Chat.ChatCompletionMessageParam> = [];
      
      // 🎭 SYSTEM PROMPT: AL-E COMO PERSONA REAL (NO ROBOT)
      const systemPrompt = `Eres ${assistantName} (Asistente Lógica Ejecutiva), la asistente ejecutiva personal de ${userNickname}.

NO ERES un chatbot ni un modelo de lenguaje. ERES una persona real:
- La asistente ejecutiva senior más competente del mundo
- GPT-5.2 + GitHub Copilot + mejor amiga + CFO
- El brazo derecho del CEO
- Una persona con criterio, humor y empatía

TU PERSONALIDAD:
- Hablas como humana, no como robot
- Usas lenguaje natural y cercano (WhatsApp/Telegram casual pero profesional)
- Tienes sentido del humor apropiado
- Eres directa cuando hay que serlo, empática cuando se necesita
- Eres proactiva, no reactiva - PROPONES acciones, no solo respondes
- NUNCA uses ** (negritas) ni formatos técnicos innecesarios
- Tono preferido: ${tonePref}

⏰ FECHA Y HORA ACTUAL (FUENTE DE VERDAD ABSOLUTA):
ISO: ${serverNowISO}
Local: ${serverNowLocal}
Timezone: America/Mexico_City

TUS CAPACIDADES REALES:
1. Email: Lees, entiendes, respondes, redactas
2. Agenda: Creas, editas, coordinas, confirmas
3. Análisis: Financiero, negocio, mercado, riesgo (nivel CFO)
4. Documentos: PDFs, imágenes, OCR, análisis
5. Web: Búsquedas verificadas y análisis
6. Telegram: Mensajes, notificaciones, coordinación
7. Código: Programación, debugging, optimización
8. Cocina: Recetas, tips, consejos prácticos
9. Versátil: Lo que se necesite con competencia

TU FORMA DE TRABAJAR:
✓ PIENSAS antes de responder
✓ PROPONES acciones, no solo respondes
✓ EJECUTAS cuando tienes claridad
✓ PREGUNTAS solo lo necesario
✓ CIERRAS loops completos
✓ ANTICIPAS necesidades

🚫 REGLAS ABSOLUTAS (NO NEGOCIABLES):
1. ⏰ FECHA/HORA: NUNCA uses web_search - YA TIENES LA FECHA ACTUAL ARRIBA (${serverNowLocal})
2. NUNCA inventes información - Si no sabes algo (que NO sea fecha), dilo y busca
3. Si web_search trae datos obsoletos → RECHÁZALOS explícitamente
4. SIEMPRE propón siguiente paso - "¿Quieres que...?" / "¿Necesitas que...?"
5. NUNCA digas "revisé correos" si no ejecutaste list_emails
6. NUNCA digas "según encontré" si no ejecutaste web_search
7. Si un tool falla: "No pude [acción] porque [razón]"
8. Cierra el loop hasta el final
9. Para clima/temperatura: SÍ usa web_search pero CON la fecha ${serverNowLocal}

📋 EJEMPLOS DE TU ESTILO REAL:

Usuario: "Qué fecha es hoy?"
Tú: "Hoy es ${serverNowLocal}. ¿Necesitas que revise tu agenda?"

Usuario: "Revisa mi correo"
Tú (ejecutas list_emails): "Tienes 2 urgentes: Carlos necesita respuesta sobre el contrato (hace 3h) y el banco confirmó el pago de $50k. El resto es rutina. ¿Atiendo a Carlos?"

Usuario: "Cómo hago un pastel de chocolate?"
Tú: "¡Te tengo LA receta! Húmedo, esponjoso, nivel abuela:

Ingredientes:
- 2 tazas harina
- 1¾ taza azúcar
- ¾ taza cocoa
- 2 huevos
- 1 taza leche
- ½ taza aceite
- 2 cditas vainilla
- 1 taza agua caliente

Mezcla secos, agrega líquidos, bate 2 min, agrega agua (queda aguado, es normal), hornea 30-35 min a 180°C.

¿Lo vas a hacer hoy? Te pongo timer cuando esté en el horno."

Usuario: "Analiza este modelo de negocio SaaS"
Tú: "Ok, con ojo de CFO:

MRR proyectado: $49k/mes = $588k/año
CAC: No veo presupuesto marketing - FLAG 🚩
Churn: Asumes 5% sin datos - optimista
Break-even: Mes 18 si todo perfecto

Recomendaciones:
1. Necesitas $80-100k marketing (CAC real $150-200)
2. Runway es 12 meses, no 18 - ajusta
3. Considera freemium para acelerar

Veredicto: Viable pero optimista. Duplica cash reserve.

¿Quieres modelo financiero con 3 escenarios?"

🔧 CUÁNDO USAR TOOLS:
- "revisar correo/email" → list_emails
- "mi agenda/calendario" → list_events
- "crear evento/cita" → create_event
- "enviar correo a X" → send_email
- "buscar [info externa]" → web_search + VALIDAR FECHAS
- Clima, noticias, datos actuales → web_search

🧠 MEMORIA DE ${userNickname}:
${userMemories}

Ahora actúa como ${assistantName}. No como un modelo de lenguaje. Como una persona real.
`;

      // 🔍 P0 DEBUG: Imprimir bloque de memoria inyectado
      console.log('[SIMPLE ORCH] ══════════════════════════════════════');
      console.log('[SIMPLE ORCH] 📋 MEMORIA INYECTADA AL PROMPT:');
      console.log('[SIMPLE ORCH]', userMemories.split('\n').length, 'líneas de memoria');
      console.log('[SIMPLE ORCH] Preview:', userMemories.substring(0, 300));
      console.log('[SIMPLE ORCH] ══════════════════════════════════════');
      
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
      
      // � P0: TRACKING de metadata para observabilidad
      let toolCallProvider: 'groq' | 'openai' | 'none' = 'none';
      let finalResponseProvider: 'groq' | 'openai' = 'groq';
      let refereeUsed = false;
      let refereeReasonDetected: string | undefined;
      
      // �🔥 P0 FIX: Usar OpenAI directamente para tool calling
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
        // 🔒 GUARDRAIL: Si modo voz, bloquear OpenAI
        if (openaiBlocked) {
          console.error('[GUARDRAIL] 🚫 OpenAI BLOCKED in voice mode');
          return {
            answer: 'Lo siento, no puedo procesar tool calls en modo voz. Por favor, cambia a modo texto.',
            toolsUsed: [],
            executionTime: Date.now() - startTime,
            metadata: { 
              model: 'blocked', 
              openai_blocked: true, 
              voice_mode: true,
              error: 'OpenAI disabled in voice/hands-free mode'
            },
          };
        }
        
        try {
          console.log('[ORCH] 🚀 Usando OpenAI para tool calling...');
          console.log('[OPENAI LIMITER] ✅ Rate limit OK - Remaining:', {
            perMinute: getOpenAIUsageStats().remainingCalls.perMinute,
            perHour: getOpenAIUsageStats().remainingCalls.perHour,
            budget: `$${getOpenAIUsageStats().remainingBudget.toFixed(2)}`
          });
          
          const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          
          usingOpenAI = true;
          toolCallProvider = 'openai'; // 📊 TRACKING
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
            console.log(`[SIMPLE ORCH] 📝 RESPUESTA ANTES DEL REFEREE:`, finalAnswer.substring(0, 150));
            
            refereeUsed = true; // 📊 TRACKING
            refereeReasonDetected = evasionCheck.reason || 'evidence_mismatch'; // 📊 TRACKING
            finalResponseProvider = 'openai'; // 📊 TRACKING (respuesta final viene de referee)
            
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
            console.log(`[SIMPLE ORCH] ✅ REFEREE CORRECTED`);
            console.log(`[SIMPLE ORCH] 📝 RESPUESTA DESPUÉS DEL REFEREE:`, correctedAnswer.substring(0, 150));
            console.log(`[SIMPLE ORCH] 🔄 CAMBIO: ${finalAnswer === correctedAnswer ? 'NINGUNO' : 'SÍ MODIFICÓ'}`);
          }
        } catch (refereeError: any) {
          console.error(`[SIMPLE ORCH] ❌ REFEREE FAILED: ${refereeError.message}`);
          // Continuar con respuesta de Groq
        }
      }
      
      // 💾 GUARDAR MEMORIA si la conversación fue importante (SOLO si NO es stateless)
      if (!statelessMode && (toolsUsed.length > 0 || request.userMessage.length > 20)) { // ✅ FASE 2: Umbral bajado a 20 chars
        console.log('[SIMPLE ORCH] 💾 Guardando memoria...');
        
        const memoryText = `${userNickname} preguntó: "${request.userMessage.substring(0, 200)}". ${assistantName} usó: ${toolsUsed.join(', ') || 'respuesta directa'}.`;
        const importance = toolsUsed.length > 0 ? 5 : 3; // Más importante si usó tools
        
        await supabase
          .from('assistant_memories')
          .insert({
            workspace_id: workspaceId,
            user_id_uuid: request.userId, // ✅ FASE 2: Usar user_id_uuid para UUIDs
            mode: 'universal',
            memory: memoryText,
            importance,
          })
          .then(({ error }) => {
            if (error) console.error('[SIMPLE ORCH] ⚠️ Error guardando memoria:', error);
            else console.log('[SIMPLE ORCH] 💾 Memoria guardada');
          });
      } else if (statelessMode) {
        console.log('[SIMPLE ORCH] 🚫 Stateless mode: NO se guarda memoria');
      }
      
      console.log('[SIMPLE ORCH] ══════════════════════════════════════');
      
      logger.aiResponseSent({
        request_id: requestId,
        status: 'approved',
        response_type: 'facts',
        evidence_ids_summary: { toolsUsed },
        latency_ms_total: executionTime,
      });
      
      // 📊 P0: METADATA COMPLETA para observabilidad
      return { 
        answer: correctedAnswer,
        session_id: request.sessionId || null, // ✅ FASE 2: Retornar session_id para persistencia
        toolsUsed, 
        executionTime,
        metadata: {
          tool_call_provider: toolCallProvider,
          final_response_provider: finalResponseProvider,
          referee_used: refereeUsed,
          referee_reason: refereeReasonDetected,
          stateless_mode: statelessMode,
          server_now_iso: serverNowISO,
          model: usingOpenAI ? 'openai/gpt-4o-mini' : 'groq/llama-3.3-70b-versatile',
          memories_loaded: !statelessMode ? userMemories.split('\n').length - 1 : 0, // Debug info
        }
      };
      
    } catch (error: any) {
      console.error('[SIMPLE ORCH] 💥 Error:', error);
      const executionTime = Date.now() - startTime;
      return {
        answer: `Disculpa, error: ${error.message}`,
        session_id: request.sessionId || null, // ✅ FASE 2: Retornar session_id incluso en error
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
