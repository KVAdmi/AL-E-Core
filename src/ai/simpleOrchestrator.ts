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
import { selectProvider, callProvider, type Provider, type Route } from './providers/providerRouter';
import { type BedrockMessage, callMistral } from './providers/bedrockClient';
import { queryKnowledgeBase, requiresKnowledgeBase, formatKBContextForPrompt } from './knowledge/bedrockKB';

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
  voice?: boolean; // ← P0: Flag para detectar modo voz
  workspaceId?: string;
}

interface SimpleOrchestratorResponse {
  answer: string;
  session_id?: string | null;
  toolsUsed: string[];
  executionTime: number;
  // 🎯 P0: CONTRATO NUEVO (multi-provider architecture)
  tool_trace?: Array<{ tool: string; result: any; timestamp: number }>;
  provider_used?: Provider;
  route?: Route;
  request_id?: string;
  metadata?: {
    model?: string;
    finish_reason?: string;
    tool_call_provider?: 'groq' | 'openai' | 'bedrock_claude' | 'bedrock_mistral' | 'none';
    final_response_provider?: Provider;
    referee_used?: boolean;
    referee_reason?: string;
    stateless_mode?: boolean;
    server_now_iso?: string;
    memories_loaded?: number;
    memory_first_triggered?: boolean;
    memory_first_source_id?: string;
    final_answer_source?: 'memory_first' | 'llm' | 'llm+referee' | 'kb_empty';
    referee_skipped_reason?: string;
    groq_failed?: boolean;
    openai_failed?: boolean;
    referee_invoked?: boolean;
    referee_failed?: boolean;
    error_handled?: boolean;
    rate_limit_exceeded?: boolean;
    limit?: string;
    openai_blocked?: boolean;
    voice_mode?: boolean;
    requires_tools?: boolean; // ← P0: Flag para fallback que necesita tools
    kb_retrieved?: number; // ← P0: Chunks retrieved from Bedrock KB
    kb_top_scores?: number[]; // ← P0: Top relevance scores
    error?: string;
  };
}

const AVAILABLE_TOOLS: Array<Groq.Chat.ChatCompletionTool> = [
  {
    type: 'function',
    function: {
      name: 'get_user_info',
      description: 'Obtiene información sobre el usuario actual y el asistente. USA ESTO cuando pregunten "¿quién eres?", "¿quién soy?", "¿cómo te llamas?", "¿cómo me llamo?".',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
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
          fileUrl: { type: 'string', description: 'URL del archivo a analizar' },
          fileType: { type: 'string', description: 'Tipo de archivo: pdf, image, excel, word (opcional, se detecta auto)' },
        },
        required: ['fileUrl'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_internal_docs',
      description: 'Busca información en documentos internos o base de conocimiento usando Cohere Command R. Usa esto cuando necesites información de FAQs, documentos guardados, o contexto histórico.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Pregunta o búsqueda a realizar en los documentos internos' },
        },
        required: ['query'],
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
      // 🔒 GUARDRAIL: Detectar modo voz (route o flag voice)
      const isVoiceMode = request.route?.includes('/voice') || 
                          request.voice === true ||  // ← P0: Detectar por flag también
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
      
      // ============================================
      // 🧠 P0 MEMORY-FIRST: HARD RULE (Director 18-ene-2026)
      // ============================================
      // Si hay memoria Y la pregunta es tipo "¿Cuál es mi X?", 
      // responder DIRECTO desde memoria (no LLM)
      
      let memoryFirstTriggered = false;
      let memoryFirstSourceId = '';
      let memoryFirstAnswer = '';
      
      // Detectar preguntas de recuperación de memoria
      const userMessageLower = request.userMessage.toLowerCase();
      const isMemoryQuestion = /¿cuál es mi|cómo me llamo|mi \w+ (es|favorito)|qué es mi|cuál era mi/i.test(userMessageLower);
      
      if (!statelessMode && isMemoryQuestion && userMemories !== 'No hay memorias previas') {
        console.log('[SIMPLE ORCH] 🎯 MEMORY-FIRST: Pregunta detectada, buscando en memoria...');
        
        // Extraer qué está preguntando (ej: "número", "nombre", "color")
        const questionMatch = userMessageLower.match(/¿?cuál es mi (\w+)|cómo me llamo|mi (\w+) (es|favorito)/i);
        
        if (questionMatch) {
          const searchTerm = questionMatch[1] || questionMatch[2] || '';
          console.log('[SIMPLE ORCH] 🔍 Buscando:', searchTerm);
          
          // Buscar en userMemories (simple text search por ahora)
          const memoriesLower = userMemories.toLowerCase();
          
          // Buscar líneas que contengan el término
          const memoryLines = userMemories.split('\n');
          let foundMemory = '';
          
          for (const line of memoryLines) {
            if (line.toLowerCase().includes(searchTerm)) {
              foundMemory = line;
              break;
            }
          }
          
          // Si no encontró por término específico, buscar patrones de respuesta
          if (!foundMemory) {
            // Buscar "42", "es 42", "favorito es X"
            const numberMatch = userMemories.match(/\b\d+\b/);
            if (numberMatch && searchTerm.includes('número')) {
              foundMemory = `número ${numberMatch[0]}`;
            }
          }
          
          if (foundMemory) {
            console.log('[SIMPLE ORCH] ✅ MEMORY-FIRST: Match encontrado');
            memoryFirstTriggered = true;
            memoryFirstSourceId = foundMemory.substring(0, 100);
            
            // Construir respuesta directa
            const extractedValue = foundMemory.match(/\b\d+\b/)?.[0] || 
                                   foundMemory.match(/es (\w+)/)?.[1] || 
                                   foundMemory.match(/favorito.*?(\w+)/)?.[1];
            
            if (extractedValue) {
              memoryFirstAnswer = `Tu ${searchTerm} favorito es ${extractedValue}. (Según lo que me dijiste antes)`;
            } else {
              memoryFirstAnswer = `Según mis notas: ${foundMemory.trim()}`;
            }
            
            console.log('[SIMPLE ORCH] 📝 MEMORY-FIRST ANSWER:', memoryFirstAnswer);
          } else {
            console.log('[SIMPLE ORCH] ⚠️ MEMORY-FIRST: No se encontró match para:', searchTerm);
          }
        }
      }
      
      // Si memory-first encontró respuesta, retornar inmediatamente (skip LLM)
      if (memoryFirstTriggered && memoryFirstAnswer) {
        console.log('[SIMPLE ORCH] 🚀 MEMORY-FIRST: Respondiendo sin LLM');
        
        return {
          answer: memoryFirstAnswer,
          session_id: request.sessionId,
          toolsUsed: [],
          executionTime: Date.now() - startTime,
          metadata: {
            model: 'memory-first',
            memory_first_triggered: true,
            memory_first_source_id: memoryFirstSourceId,
            final_answer_source: 'memory_first',
            referee_skipped_reason: 'memory_first',
          },
        };
      }
      
      // ============================================
      // CONTINUAR CON FLUJO NORMAL (LLM)
      // ============================================
      
      // 🧠 P0: BEDROCK KNOWLEDGE BASE - RAG (Director 20-ene-2026)
      // Consultar KB ANTES de construir system prompt
      // KB es fuente única de verdad para conocimiento interno
      let kbContext = '';
      let kbRetrieved = 0;
      let kbTopScores: number[] = [];
      
      if (!statelessMode && requiresKnowledgeBase(request.userMessage)) {
        console.log('[ORCH] 📚 Query requiere Knowledge Base - consultando...');
        
        try {
          const kbResult = await queryKnowledgeBase(
            request.userMessage,
            request.userId,
            workspaceId,
            5 // Top 5 chunks
          );
          
          kbRetrieved = kbResult.resultsCount;
          kbTopScores = kbResult.topScores;
          
          if (kbResult.resultsCount === 0) {
            // 🚨 FAIL-CLOSED: Si query de conocimiento y KB vacío → error explícito
            console.warn('[ORCH] ⚠️ KB returned 0 chunks for knowledge query - fail-closed');
            
            return {
              answer: 'No tengo registro de eso en mi base de conocimiento. ¿Podrías darme más contexto o reformular la pregunta?',
              session_id: request.sessionId,
              toolsUsed: [],
              executionTime: Date.now() - startTime,
              metadata: {
                model: 'kb-fail-closed',
                final_answer_source: 'kb_empty',
                error: 'KB returned 0 chunks for knowledge query'
              }
            };
          }
          
          // Formatear contexto para prompt
          kbContext = formatKBContextForPrompt(kbResult);
          
          console.log('[ORCH] ✅ KB context ready:', kbResult.resultsCount, 'chunks');
          
        } catch (kbError: any) {
          console.error('[ORCH] ❌ KB query failed:', kbError.message);
          // No bloqueamos el flujo si KB falla, pero lo registramos
          kbContext = 'Error consultando base de conocimiento.';
        }
      } else if (!statelessMode) {
        console.log('[ORCH] 📚 Query NO requiere KB - usando memoria corta + LLM');
      }
      
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

TU IDENTIDAD (SIEMPRE RECUÉRDALA):
- Tu nombre: ${assistantName}
- Trabajas para: ${userNickname}
- Si preguntan "¿quién eres?" → "Soy ${assistantName}, tu asistente ejecutiva"
- Si preguntan "¿quién soy?" → "Tú eres ${userNickname}"
- NUNCA digas "no tengo función para identificar" - TÚ SÍ SABES QUIÉN ERES

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

📚 BASE DE CONOCIMIENTO (Bedrock KB):
${kbContext || 'No se consultó KB para esta query (query de memoria corta o acción directa)'}

🚫 REGLAS DE USO DE CONOCIMIENTO (CRÍTICAS):
1. Si la pregunta es sobre memoria/conocimiento interno Y hay contexto de KB → USA SOLO KB
2. Si KB dice "No hay información" → responde "No tengo registro de eso"
3. NUNCA uses conocimiento general del modelo para hechos históricos del usuario
4. SIEMPRE cita la fuente cuando uses KB: "Según [documento/fuente]..."
5. KB es fuente de verdad absoluta para: políticas, procesos, acuerdos, decisiones pasadas

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
      
      // 🎯 P0: TRACKING de metadata para observabilidad
      let toolCallProvider: 'bedrock_mistral' | 'none' = 'none';
      let finalResponseProvider: Provider = 'bedrock_mistral';
      let refereeUsed = false;
      let refereeReasonDetected: string | undefined;
      
      // 🔥 P0 CRÍTICO: MISTRAL LARGE 3 SIEMPRE - NO FALLBACK
      // Eliminada detección de tools - SIEMPRE usa Mistral con tools disponibles
      console.log('[ORCH] 🧠 MISTRAL LARGE 3 - Único cerebro, tools siempre disponibles');
      
      // 🎯 FORZAR MISTRAL (NO OPCIONAL)
      const shouldUseBedrock = true;  // SIEMPRE usar Mistral
      
      if (shouldUseBedrock) {
        console.log('[ORCH] 🧠 Llamando Mistral Large 3 con TODAS las tools...');
        try {
          const route: Route = request.route?.includes('document') ? 'documents' : 'chat';
          const provider = selectProvider(route, false);
          finalResponseProvider = provider;
          
          // Extraer system prompt del primer mensaje
          const systemPromptContent = messages[0]?.role === 'system' ? messages[0].content : '';
          const systemPrompt = typeof systemPromptContent === 'string' ? systemPromptContent : JSON.stringify(systemPromptContent);
          const chatMessages = messages.filter(m => m.role !== 'system');
          
          // 🔥 CRÍTICO: Incluir tools en system prompt para Mistral
          const toolsDescription = AVAILABLE_TOOLS.map(t => 
            `- ${t.function.name}: ${t.function.description}`
          ).join('\n');
          
          const enhancedSystemPrompt = `${systemPrompt}

═══════════════════════════════════════════════════════════
🛠️ HERRAMIENTAS DISPONIBLES (USA CUANDO NECESITES):
${toolsDescription}

IMPORTANTE:
- Tienes acceso real a estas herramientas
- Si el usuario pide una acción que corresponde a una tool, ÚSALA
- NO digas "no puedo hacer X" si la herramienta existe
- Para usar una tool, responde en JSON: {"tool": "nombre", "params": {...}}
═══════════════════════════════════════════════════════════`;
          
          // Convertir mensajes al formato simple
          const simpleMessages = chatMessages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
          }));
          
          const result = await callProvider(provider, simpleMessages, enhancedSystemPrompt);
          
          console.log(`[ORCH] ✅ Mistral Large 3 respondió correctamente`);
          console.log(`[ORCH] 📊 Tools disponibles: ${AVAILABLE_TOOLS.length}`);
          
          // Simular estructura de response compatible con Groq/OpenAI
          response = {
            choices: [{
              message: {
                role: 'assistant',
                content: result.final_answer
              },
              finish_reason: 'stop'
            }],
            usage: result.usage
          };
          
          toolCallProvider = 'bedrock_mistral';
          
        } catch (bedrockError: any) {
          console.error('[ORCH] ❌ Mistral Large 3 FAILED:', bedrockError.message);
          console.error('[ORCH] 🚫 NO HAY FALLBACK - Retornando error');
          
          // 🔥 SIN FALLBACK - Error explícito
          return {
            answer: 'Tengo un problema técnico temporal con mi sistema de razonamiento. Por favor intenta de nuevo en unos segundos.',
            toolsUsed: [],
            executionTime: Date.now() - startTime,
            metadata: {
              model: 'mistral-large-3',
              error: bedrockError.message,
              error_handled: true
            },
          };
        }
      }
      
      // 🚀 P0 FIX CRÍTICO: GROQ para tool calling O si Bedrock falló
      // OpenAI solo como fallback si Groq falla completamente
      
      
      // 🔥 P0 CRÍTICO: NO HAY FALLBACK A GROQ NI OPENAI
      // Mistral Large 3 es el único cerebro autorizado
      // Si Mistral falla → error explícito, usuario reintenta
      
      if (!response) {
        console.error('[ORCH] ❌ CRITICAL: No response from Mistral');
        return {
          answer: 'Error crítico del sistema. Por favor intenta de nuevo.',
          toolsUsed: [],
          executionTime: Date.now() - startTime,
          metadata: {
            model: 'mistral-large-3',
            error: 'No model executed',
            error_handled: true
          },
        };
      }
      
      // 🔥 P0 CRÍTICO: NO HAY FALLBACK A GROQ NI OPENAI
      // Mistral Large 3 es el único cerebro autorizado
      // Si Mistral falla → error explícito, usuario reintenta
      
      if (!response) {
        console.error('[ORCH] ❌ CRITICAL: No response from Mistral');
        return {
          answer: 'Error crítico del sistema. Por favor intenta de nuevo.',
          toolsUsed: [],
          executionTime: Date.now() - startTime,
          metadata: {
            model: 'mistral-large-3',
            error: 'No model executed',
            error_handled: true
          },
        };
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
        
        // 🔥 P0 CRÍTICO: Segunda llamada con resultados de tools - SIEMPRE Mistral Large 3
        console.log('[ORCH] 🔁 Segunda llamada a Mistral Large 3 con tool results...');
        
        // Reconstruir system prompt con tools
        const systemPromptContent = messages.find(m => m.role === 'system')?.content || '';
        const baseSystemPrompt = typeof systemPromptContent === 'string' ? systemPromptContent : JSON.stringify(systemPromptContent);
        
        const toolsDescription = AVAILABLE_TOOLS.map(t => 
          `- ${t.function.name}: ${t.function.description}`
        ).join('\n');
        
        const enhancedSystemPrompt = `${baseSystemPrompt}

═══════════════════════════════════════════════════════════
🛠️ HERRAMIENTAS DISPONIBLES (USA CUANDO NECESITES):
${toolsDescription}

IMPORTANTE:
- Tienes acceso real a estas herramientas
- Si el usuario pide una acción que corresponde a una tool, ÚSALA
- NO digas "no puedo hacer X" si la herramienta existe
- Para usar una tool, responde en JSON: {"tool": "nombre", "params": {...}}
═══════════════════════════════════════════════════════════`;
        
        // Convertir messages con tool_calls a formato Bedrock simple (texto plano)
        const bedrockMessages: BedrockMessage[] = [];
        for (const msg of messages) {
          if (msg.role === 'system') continue; // Skip system (ya está en systemPrompt)
          if (msg.role === 'tool') {
            // Convertir tool result a user message
            const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            bedrockMessages.push({
              role: 'user',
              content: `Tool result: ${contentStr}`
            });
          } else if (msg.role === 'assistant' && msg.tool_calls) {
            // Convertir tool call a assistant message descriptivo
            const toolNames = msg.tool_calls.map((tc: any) => tc.function.name).join(', ');
            const msgContentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            bedrockMessages.push({
              role: 'assistant',
              content: msgContentStr || `Ejecutando herramientas: ${toolNames}`
            });
          } else {
            // user o assistant normal
            const msgContentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
            bedrockMessages.push({
              role: msg.role as 'user' | 'assistant',
              content: msgContentStr || ''
            });
          }
        }
        
        try {
          const mistralResponse = await callMistral(bedrockMessages, 4096, enhancedSystemPrompt);
          // Convertir BedrockResponse a OpenAI-style response para compatibilidad
          response = {
            choices: [{
              message: {
                role: 'assistant',
                content: mistralResponse.content
              },
              finish_reason: mistralResponse.stop_reason
            }]
          } as any;
          console.log('[ORCH] ✅ Mistral Large 3 segunda llamada exitosa');
        } catch (mistralError: any) {
          console.error('[ORCH] ❌ Mistral Large 3 segunda llamada falló:', mistralError.message);
          return {
            answer: 'Error al procesar los resultados de las herramientas. Por favor intenta de nuevo.',
            toolsUsed,
            executionTime: Date.now() - startTime,
            metadata: {
              model: 'mistral-large-3',
              error: mistralError.message,
              error_handled: true
            },
          };
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
          console.warn('[SIMPLE ORCH] ⚠️ Respuesta no menciona tools ejecutados');
          // 🚫 P0 UX: NO mostrar tool traces al usuario
          // Tool traces quedan SOLO en logs del servidor
          console.log('[SIMPLE ORCH] 📊 Tools ejecutados (solo logs):', toolsUsed);
          console.log('[SIMPLE ORCH] 📊 Resultados (solo logs):', toolResults.map((tr: any) => ({
            tool: tr.toolName,
            success: tr.result?.success
          })));
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
          model: 'bedrock/mistral-large-3',
          memories_loaded: !statelessMode ? userMemories.split('\n').length - 1 : 0, // Debug info
          // 🧠 P0 TELEMETRÍA MEMORY-FIRST (Director 18-ene-2026)
          memory_first_triggered: false,
          memory_first_source_id: '',
          final_answer_source: refereeUsed ? 'llm+referee' : 'llm',
          referee_skipped_reason: refereeUsed ? undefined : 'not_needed',
          // 🧠 P0 TELEMETRÍA KB (Director 20-ene-2026)
          kb_retrieved: kbRetrieved,
          kb_top_scores: kbTopScores.length > 0 ? kbTopScores : undefined,
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
