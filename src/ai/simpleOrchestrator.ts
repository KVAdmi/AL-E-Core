/**
 * SIMPLE ORCHESTRATOR - Amazon Nova Pro Edition
 * 
 * Cerebro único: Amazon Nova Pro vía Bedrock Converse API.
 * NO fallbacks, NO Groq, NO Mistral ejecutor, NO Marketplace.
 * 
 * Razona → Ejecuta tools → Responde.
 * 
 * 🧠 POWERED BY AMAZON NOVA PRO (us-east-1)
 * � POWERED BY BEDROCK KNOWLEDGE BASE (RAG)
 * 
 * DIRECTOR: 21-ene-2026
 */

import { executeTool } from './tools/toolRouter';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../db/supabase';
import { queryKnowledgeBase, requiresKnowledgeBase, formatKBContextForPrompt } from './knowledge/bedrockKB';
import { callNovaPro, buildToolResultBlock, type NovaMessage } from './providers/bedrockNovaClient';
import type { ToolUseBlock, ContentBlock } from '@aws-sdk/client-bedrock-runtime';

// 🧠 Amazon Nova Pro es el único cerebro autorizado
// Configuración vía bedrockNovaClient.ts

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
  // 🎯 Amazon Nova Pro metadata
  tool_trace?: Array<{ tool: string; result: any; timestamp: number }>;
  request_id?: string;
  metadata?: {
    model?: string;
    finish_reason?: string;
    tool_call_provider?: 'bedrock_nova' | 'none';
    final_response_provider?: 'bedrock_nova';
    stateless_mode?: boolean;
    server_now_iso?: string;
    memories_loaded?: number;
    memory_first_triggered?: boolean;
    memory_first_source_id?: string;
    final_answer_source?: 'memory_first' | 'llm' | 'kb_empty';
    kb_retrieved?: number;
    kb_top_scores?: number[];
    nova_input_tokens?: number;
    nova_output_tokens?: number;
    nova_total_tokens?: number;
    error?: string;
    failed_tools?: Array<{ tool: string; error: string }>; // 🚨 CRÍTICO: Track de tools que fallaron
  };
}

// 🔧 TOOLS DISPONIBLES (SCOPE CERRADO)
// Solo create_event, send_email, read_email
// Definición completa está en bedrockNovaClient.ts con toolConfig nativo

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
    console.log('[SIMPLE ORCH] 🧠 AMAZON NOVA PRO (Bedrock Converse)');
    console.log('[SIMPLE ORCH] Request:', request.userMessage.substring(0, 100));
    console.log('[SIMPLE ORCH] User:', request.userId);
    
    try {
      // 🔒 P0: VALIDAR UUID - Si userId no es UUID válido, modo stateless
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const isValidUUID = uuidRegex.test(request.userId);
      
      let statelessMode = false;
      
      if (!isValidUUID) {
        statelessMode = true;
        console.warn('[ORCH] ⚠️ invalid_user_id -> stateless_mode=true');
        console.warn(`[ORCH] userId="${request.userId}" no es UUID válido`);
        console.warn('[ORCH] NO se cargará perfil/memoria/settings');
      }
      
      let userMemories = 'No hay memorias previas';
      let assistantName = 'AL-E';
      let userNickname = 'Usuario';
      let tonePref = 'barrio';
      
      if (!statelessMode) {
        // 🧠 1. CARGAR MEMORIA DEL USUARIO desde Supabase
        console.log('[ORCH] 🧠 Cargando memoria del usuario...');
        const { data: memories, error: memError } = await supabase
          .from('assistant_memories')
          .select('memory, importance, created_at')
          .eq('user_id_uuid', request.userId)
          .eq('workspace_id', workspaceId)
          .order('importance', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(10);
        
        if (memError) {
          console.error('[ORCH] ⚠️ Error cargando memorias:', memError);
        }
        
        userMemories = memories && memories.length > 0 
          ? memories.map(m => m.memory).join('\n- ')
          : 'No hay memorias previas';
        
        console.log('[ORCH] 🧠 Memorias cargadas:', memories?.length || 0);
        
        // �️ 1.5. CARGAR CONTEXTO DE SESIÓN (attachments persistidos)
        if (request.sessionId) {
          console.log('[ORCH] 🗂️ Cargando contexto de sesión...');
          const { data: sessionData, error: sessionError } = await supabase
            .from('ae_sessions')
            .select('metadata')
            .eq('id', request.sessionId)
            .eq('user_id_uuid', request.userId)
            .single();
          
          if (sessionError) {
            console.error('[ORCH] ⚠️ Error cargando sesión:', sessionError);
          } else if (sessionData?.metadata?.attachments_context) {
            const sessionContext = sessionData.metadata.attachments_context;
            const filesCount = sessionData.metadata.files?.length || 0;
            const filesNames = sessionData.metadata.files?.map((f: any) => f.name).join(', ') || 'unknown';
            
            console.log(`[ORCH] � KB CARGADO: ${filesCount} archivo(s)`);
            console.log(`[ORCH] 📄 Archivos: ${filesNames}`);
            console.log(`[ORCH] 📊 Tamaño KB: ${sessionContext.length} caracteres`);
            
            // Agregar contexto de sesión a las memorias
            userMemories = `${userMemories}\n\n=== KNOWLEDGE BASE (Archivos de esta sesión) ===\n${sessionContext}`;
          } else {
            console.log('[ORCH] ℹ️ No hay archivos en KB de esta sesión');
          }
        }
        
        // �👤 2. CARGAR CONFIGURACIÓN DEL USUARIO
        console.log('[ORCH] 👤 Cargando configuración del usuario...');
        const { data: userProfile, error: profileError } = await supabase
          .from('user_profiles')
          .select('preferred_name, assistant_name, tone_pref')
          .eq('user_id', request.userId)
          .single();
        
        if (profileError && profileError.code !== 'PGRST116') {
          console.error('[ORCH] ⚠️ Error cargando perfil:', profileError);
        }
        
        assistantName = userProfile?.assistant_name || 'AL-E';
        userNickname = userProfile?.preferred_name || 'Usuario';
        tonePref = userProfile?.tone_pref || 'barrio';
      } else {
        console.log('[ORCH] 🚫 Stateless mode: usando defaults (AL-E, Usuario, barrio)');
      }
      
      console.log('[ORCH] 👤 Asistente:', assistantName);
      console.log('[ORCH] 👤 Usuario:', userNickname);
      console.log('[ORCH] 👤 Tono:', tonePref);
      
      // ============================================
      // 🧠 MEMORY-FIRST: HARD RULE
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
      
      // Array para conversación (solo usado si hay conversationHistory)
      interface HistoryMessage {
        role: 'user' | 'assistant';
        content: string;
      }
      const conversationMessages: HistoryMessage[] = [];
      
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
10. 🔥 CRÍTICO: Si el usuario pide "revisa X", "busca Y", "agenda Z" → EJECUTA LA TOOL AHORA (NO uses info de memoria vieja)

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

🔧 CUÁNDO USAR TOOLS (REGLAS EXACTAS):
- Usuario menciona "correo/email/inbox/mensajes" → list_emails (NUNCA read_email primero)
- Usuario dice "agenda/calendario/eventos/citas/reuniones/qué tengo programado" → list_events (NUNCA read_email)
- Usuario pide "leer correo específico" o "el último correo" → read_email con emailId
- Usuario dice "crear/agendar/programar evento/cita/reunión" → create_event
- Usuario pide "enviar correo a X" → send_email
- Usuario dice "busca/investiga/encuentra info de X" → web_search (SOLO si piden explícitamente)

� REGLA CRÍTICA DE CORREOS (NO NEGOCIABLE):
Si el usuario menciona CUALQUIER palabra relacionada con correos: "correo", "email", "inbox", "segunda cuenta", "revisa", "mensajes" → SIEMPRE debes:
1. Ejecutar list_emails INMEDIATAMENTE
2. NUNCA digas "tengo problemas" sin intentar
3. NUNCA uses memoria vieja de correos
4. Si list_emails falla, ENTONCES sí di el error específico

�🚫 ERRORES COMUNES A EVITAR:
- NUNCA uses read_email cuando pidan ver agenda/calendario → USA list_events
- NUNCA digas "busqué" si NO ejecutaste web_search
- NUNCA digas "revisé correos" si NO ejecutaste list_emails
- NUNCA digas "tengo problemas con correos" sin ejecutar list_emails primero
- Si el usuario pide info AHORA → EJECUTA la tool SIEMPRE (ignora memoria vieja)

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
            conversationMessages.push({ role: msg.role as 'user' | 'assistant', content: msg.content });
          }
        });
      }
      
      // ═══════════════════════════════════════════════════════════
      // 🧠 AMAZON NOVA PRO - CEREBRO EJECUTIVO ÚNICO
      // ═══════════════════════════════════════════════════════════
      
      console.log('[ORCH] ═══════════════════════════════════════════════');
      console.log('[ORCH] 🚀 PROVIDER ACTIVO: AMAZON NOVA PRO');
      console.log('[ORCH] 📍 Model: amazon.nova-pro-v1:0');
      console.log('[ORCH] 🔧 Tools: create_event, send_email, list_emails, read_email, list_events, web_search');
      console.log('[ORCH] ═══════════════════════════════════════════════');
      
      // 🔥 BLOQUEADOR 1 FIX: CARGAR HISTORIAL COMPLETO DE LA SESIÓN
      const novaMessages: NovaMessage[] = [];
      let novaSystemPrompt = systemPrompt;
      
      // Cargar historial completo de Supabase si hay sessionId
      if (request.sessionId && !statelessMode) {
        console.log('[ORCH] 📚 Cargando historial completo de sesión...');
        const { data: sessionHistory, error: historyError } = await supabase
          .from('ae_messages')
          .select('role, content')
          .eq('session_id', request.sessionId)
          .order('created_at', { ascending: true })
          .limit(20); // Últimos 20 mensajes para contexto
        
        if (historyError) {
          console.error('[ORCH] ⚠️ Error cargando historial:', historyError);
        } else if (sessionHistory && sessionHistory.length > 0) {
          console.log(`[ORCH] ✅ ${sessionHistory.length} mensajes de historial cargados`);
          for (const msg of sessionHistory) {
            novaMessages.push({
              role: msg.role as 'user' | 'assistant',
              content: msg.content
            });
          }
        }
      }
      
      // Agregar conversationMessages si existen (fallback)
      if (conversationMessages.length > 0 && novaMessages.length === 0) {
        for (const msg of conversationMessages) {
          novaMessages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
      
      // Agregar mensaje actual del usuario
      novaMessages.push({
        role: 'user',
        content: request.userMessage
      });
      
      console.log(`[ORCH] 📝 Total mensajes enviados a Nova: ${novaMessages.length}`);
      
      // 🔥 HACK CRÍTICO: PRE-EJECUTAR TOOLS SI DETECTAMOS KEYWORDS
      // Nova está ignorando system prompt, así que ejecutamos tools ANTES de llamarla
      const userMsgLower = request.userMessage.toLowerCase();
      const forceListEmails = /revisa.*correo|checa.*email|mis.*mensaje|inbox|segunda.*cuenta|ambas.*cuenta/i.test(userMsgLower);
      
      if (forceListEmails && !statelessMode) {
        console.log('[ORCH] 🚨 FORCE EXECUTION: Detectado request de correos - ejecutando list_emails ANTES de Nova');
        
        try {
          const emailsResult = await executeTool(request.userId, { 
            name: 'list_emails', 
            parameters: {} 
          });
          
          console.log('[ORCH] ✅ list_emails pre-ejecutado exitosamente');
          console.log('[ORCH] 📧 Correos obtenidos:', JSON.stringify(emailsResult).substring(0, 200));
          
          // Agregar resultado como contexto en el mensaje del usuario
          const enrichedMessage = `${request.userMessage}

[DATOS REALES OBTENIDOS]:
${JSON.stringify(emailsResult, null, 2)}

Basándote ÚNICAMENTE en los datos arriba, presenta un resumen natural de los correos. NO inventes información.`;
          
          // Reemplazar último mensaje con versión enriquecida
          novaMessages[novaMessages.length - 1] = {
            role: 'user',
            content: enrichedMessage
          };
          
          console.log('[ORCH] 📝 Mensaje enriquecido con datos reales de correos');
          
        } catch (toolError: any) {
          console.error('[ORCH] ❌ Error pre-ejecutando list_emails:', toolError.message);
          
          // Si falla, retornar error inmediatamente (no llamar a Nova)
          return {
            answer: `No pude acceder a tus correos: ${toolError.message}. Por favor verifica tu configuración de email.`,
            session_id: request.sessionId,
            toolsUsed: ['list_emails'],
            executionTime: Date.now() - startTime,
            metadata: {
              model: 'force-execution-failed',
              error: toolError.message,
              tool_call_provider: 'none',
              final_response_provider: 'bedrock_nova'
            }
          };
        }
      }
      
      // Primera llamada a Nova Pro
      console.log('[ORCH] � Llamada inicial a Nova Pro...');
      let novaResponse;
      
      try {
        novaResponse = await callNovaPro(novaMessages, novaSystemPrompt, 4096);
        console.log('[ORCH] ✅ Nova Pro respondió');
        console.log('[ORCH] Stop reason:', novaResponse.stopReason);
        console.log('[ORCH] Tool uses:', novaResponse.toolUses?.length || 0);
      } catch (novaError: any) {
        console.error('[ORCH] ❌ AMAZON NOVA PRO FAILED:', novaError.message);
        console.error('[ORCH] 🚫 NO HAY FALLBACK - Retornando error');
        
        return {
          answer: 'Tengo un problema técnico temporal con mi sistema de razonamiento. Por favor intenta de nuevo en unos segundos.',
          toolsUsed: [],
          executionTime: Date.now() - startTime,
          metadata: {
            model: 'amazon.nova-pro-v1:0',
            error: novaError.message,
            tool_call_provider: 'none',
            final_response_provider: 'bedrock_nova'
          },
        };
      }
      // ═══════════════════════════════════════════════════════════
      // 🔧 TOOL EXECUTION LOOP (AMAZON NOVA PRO)
      // ═══════════════════════════════════════════════════════════
      
      const toolsUsed: string[] = [];
      const toolResults: any[] = [];
      let iterations = 0;
      const maxIterations = 5;
      
      // Loop mientras Nova indique tool_use
      while (novaResponse.stopReason === 'tool_use' && iterations < maxIterations) {
        iterations++;
        console.log(`[ORCH] 🔧 Tool execution iteration ${iterations}`);
        
        // ✅ CRÍTICO: Agregar respuesta de Nova como assistant ANTES de ejecutar tools
        // Esto mantiene la estructura: [user] → [assistant con toolUse] → [user con toolResult]
        novaMessages.push({
          role: 'assistant',
          content: novaResponse.contentBlocks || []
        });
        
        const toolUses = novaResponse.toolUses || [];
        console.log(`[ORCH] Tools to execute: ${toolUses.length}`);
        
        // Construir nuevo mensaje con resultados de tools (reinicia cada iteración)
        const toolResultBlocks: ContentBlock[] = [];
        
        for (const toolUse of toolUses) {
          const toolName = toolUse.name || 'unknown';
          const toolInput = toolUse.input || {};
          const toolUseId = toolUse.toolUseId || '';
          
          console.log(`[TOOLS] 🔧 Executing: ${toolName}`);
          console.log(`[TOOLS] 🆔 toolUseId: ${toolUseId}`);
          console.log(`[${toolName.toUpperCase()}] payload =`, JSON.stringify(toolInput));
          
          toolsUsed.push(toolName);
          
          try {
            const result = await executeTool(request.userId, { 
              name: toolName, 
              parameters: toolInput 
            });
            
            console.log(`[${toolName.toUpperCase()}] ✅ Success`);
            console.log(`[${toolName.toUpperCase()}] response =`, JSON.stringify(result).substring(0, 200));
            
            // Guardar para logs
            toolResults.push({ tool: toolName, result });
            
            // Construir toolResult block para Nova
            const toolResultBlock = buildToolResultBlock(toolUseId, result);
            toolResultBlocks.push(toolResultBlock);
            
            console.log(`[TOOLS] ✅ toolResult creado para toolUseId: ${toolUseId}`);
            
          } catch (error: any) {
            console.error(`[${toolName.toUpperCase()}] ❌ Error:`, error.message);
            
            // Guardar error para logs
            toolResults.push({ tool: toolName, error: error.message });
            
            // Construir toolResult block con error
            const toolResultBlock = buildToolResultBlock(toolUseId, {
              success: false,
              error: error.message
            });
            toolResultBlocks.push(toolResultBlock);
            
            console.log(`[TOOLS] ⚠️ toolResult con error creado para toolUseId: ${toolUseId}`);
          }
        }
        
        // Agregar mensaje con tool results
        novaMessages.push({
          role: 'user',
          content: toolResultBlocks
        });
        
        // Segunda llamada a Nova con resultados de tools
        console.log('[ORCH] 🔁 Llamada a Nova con tool results...');
        
        try {
          novaResponse = await callNovaPro(novaMessages, novaSystemPrompt, 4096);
          console.log('[ORCH] ✅ Nova respondió con tool results');
          console.log('[ORCH] Stop reason:', novaResponse.stopReason);
          
        } catch (novaError: any) {
          console.error('[ORCH] ❌ Nova falló en segunda llamada:', novaError.message);
          
          return {
            answer: 'Error al procesar los resultados de las herramientas. Por favor intenta de nuevo.',
            toolsUsed,
            executionTime: Date.now() - startTime,
            metadata: {
              model: 'amazon.nova-pro-v1:0',
              error: novaError.message,
              tool_call_provider: 'bedrock_nova',
              final_response_provider: 'bedrock_nova'
            },
          };
        }
      }
      
      const executionTime = Date.now() - startTime;
      
      console.log('[TOOLS] executed:', toolsUsed.join(', ') || 'none');
      console.log('[ORCH] ⏱️ Execution time:', executionTime, 'ms');
      
      // ═══════════════════════════════════════════════════════════
      // � VALIDACIÓN CRÍTICA: NO MENTIR SOBRE TOOL FAILURES
      // ═══════════════════════════════════════════════════════════
      
      // Detectar si algún tool falló
      const failedTools = toolResults.filter((t: any) => t.error);
      const hasToolFailures = failedTools.length > 0;
      
      if (hasToolFailures) {
        console.error('[ORCH] � TOOL FAILURES DETECTADOS:', failedTools.map((t: any) => t.tool));
        
        // Construir mensaje honesto de error
        const failedToolNames = failedTools.map((t: any) => {
          const displayName = t.tool === 'create_event' ? 'agendar la cita' :
                              t.tool === 'send_email' ? 'enviar el correo' :
                              t.tool === 'web_search' ? 'buscar en internet' :
                              t.tool === 'read_email' ? 'leer el correo' :
                              t.tool;
          return `${displayName} (${t.error})`;
        }).join(', ');
        
        // Reemplazar respuesta de Nova con mensaje honesto
        const executionTime = Date.now() - startTime;
        
        return {
          answer: `Lo siento, no pude ${failedToolNames}. Por favor intenta de nuevo o contacta a soporte si el problema persiste.`,
          session_id: request.sessionId || null,
          toolsUsed,
          executionTime,
          metadata: {
            model: 'amazon.nova-pro-v1:0',
            finish_reason: 'tool_execution_failed',
            tool_call_provider: 'bedrock_nova',
            final_response_provider: 'bedrock_nova',
            error: `Tool failures: ${failedTools.map((t: any) => t.tool).join(', ')}`,
            failed_tools: failedTools,
            stateless_mode: statelessMode,
            server_now_iso: serverNowISO,
          }
        };
      }
      
      // ═══════════════════════════════════════════════════════════
      // 📤 RESPUESTA FINAL DE AMAZON NOVA PRO (SOLO SI NO HAY ERRORS)
      // ═══════════════════════════════════════════════════════════
      
      let finalAnswer = novaResponse.content || '';
      
      console.log('[ORCH] 📝 Final answer length:', finalAnswer.length);
      console.log('[ORCH] 📝 Preview:', finalAnswer.substring(0, 150));
      
      // Validación adicional: menciona tools ejecutados correctamente?
      if (toolsUsed.length > 0) {
        console.log('[ORCH] ✅ Tools ejecutados exitosamente:', toolsUsed.join(', '));
      }
      
      // 💾 GUARDAR MEMORIA si la conversación fue importante (SOLO si NO es stateless)
      if (!statelessMode && (toolsUsed.length > 0 || request.userMessage.length > 20)) {
        console.log('[ORCH] 💾 Guardando memoria...');
        
        const memoryText = `${userNickname} preguntó: "${request.userMessage.substring(0, 200)}". ${assistantName} usó: ${toolsUsed.join(', ') || 'respuesta directa'}.`;
        const importance = toolsUsed.length > 0 ? 5 : 3;
        
        await supabase
          .from('assistant_memories')
          .insert({
            workspace_id: workspaceId,
            user_id_uuid: request.userId,
            mode: 'universal',
            memory: memoryText,
            importance,
          })
          .then(({ error }) => {
            if (error) console.error('[ORCH] ⚠️ Error guardando memoria:', error);
            else console.log('[ORCH] 💾 Memoria guardada');
          });
      } else if (statelessMode) {
        console.log('[ORCH] 🚫 Stateless mode: NO se guarda memoria');
      }
      
      console.log('[ORCH] ══════════════════════════════════════');
      
      logger.aiResponseSent({
        request_id: requestId,
        status: 'approved',
        response_type: 'facts',
        evidence_ids_summary: { toolsUsed },
        latency_ms_total: executionTime,
      });
      
      // 📊 METADATA COMPLETA - Amazon Nova Pro
      return { 
        answer: finalAnswer,
        session_id: request.sessionId || null,
        toolsUsed, 
        executionTime,
        metadata: {
          model: 'amazon.nova-pro-v1:0',
          finish_reason: novaResponse.stopReason,
          tool_call_provider: toolsUsed.length > 0 ? 'bedrock_nova' : 'none',
          final_response_provider: 'bedrock_nova',
          stateless_mode: statelessMode,
          server_now_iso: serverNowISO,
          memories_loaded: !statelessMode ? userMemories.split('\n').length - 1 : 0,
          // 🧠 Memory-first telemetry
          memory_first_triggered: false,
          memory_first_source_id: '',
          final_answer_source: 'llm',
          // 🧠 KB telemetry
          kb_retrieved: kbRetrieved,
          kb_top_scores: kbTopScores.length > 0 ? kbTopScores : undefined,
          // 🧠 Nova telemetry
          nova_input_tokens: novaResponse.usage?.inputTokens,
          nova_output_tokens: novaResponse.usage?.outputTokens,
          nova_total_tokens: novaResponse.usage?.totalTokens,
        }
      };
      
    } catch (error: any) {
      console.error('[ORCH] 💥 Error:', error);
      const executionTime = Date.now() - startTime;
      return {
        answer: `Disculpa, error: ${error.message}`,
        session_id: request.sessionId || null,
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
