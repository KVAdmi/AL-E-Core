/**
 * Tool Router
 * 
 * Sistema centralizado que ejecuta herramientas solicitadas por el LLM.
 * Maneja email, calendar, telegram, y otras capacidades.
 */

import { supabase } from '../../db/supabase';

import {
  listEmails,
  readEmail,
  analyzeEmail,
  draftReply,
  sendEmail,
  createAndSendEmail,
  EMAIL_TOOLS_DEFINITIONS
} from './emailTools';

import {
  analyzeDocument,
  extractTextFromImage,
  DOCUMENT_TOOLS_DEFINITIONS
} from './documentTools';

import {
  calculateFinancialProjection,
  estimateProjectCost,
  FINANCIAL_TOOLS_DEFINITIONS
} from './financialTools';

import {
  createCalendarEvent,
  listEvents,
  extractAndSchedule,
  CALENDAR_TOOLS_DEFINITIONS
} from './calendarTools';

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface ToolCall {
  name: string;
  parameters: Record<string, any>;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>; // Error codes, tool info, etc.
}

// ═══════════════════════════════════════════════════════════════
// TOOL ROUTER
// ═══════════════════════════════════════════════════════════════

/**
 * Ejecuta una herramienta solicitada por el LLM
 */
export async function executeTool(
  userId: string,
  toolCall: ToolCall
): Promise<ToolResult> {
  try {
    console.log(`[TOOL ROUTER] Ejecutando tool: ${toolCall.name}`);
    console.log(`[TOOL ROUTER] Parámetros:`, JSON.stringify(toolCall.parameters, null, 2));

    const { name, parameters } = toolCall;

    // ════════════════════════════════════════════════════════
    // USER INFO TOOL (para todos los usuarios)
    // ════════════════════════════════════════════════════════
    
    if (name === 'get_user_info') {
      // Obtener configuración del usuario desde DB
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('preferred_name, assistant_name, tone_pref')
        .eq('user_id', userId)
        .single();
      
      return {
        success: true,
        data: {
          user_name: userProfile?.preferred_name || 'Usuario',
          assistant_name: userProfile?.assistant_name || 'AL-E',
          tone: userProfile?.tone_pref || 'profesional',
          message: `Tú eres ${userProfile?.assistant_name || 'AL-E'}, asistente ejecutiva de ${userProfile?.preferred_name || 'Usuario'}.`
        }
      };
    }

    // ════════════════════════════════════════════════════════
    // EMAIL TOOLS
    // ════════════════════════════════════════════════════════
    switch (name) {
      case 'list_emails':
        const emails = await listEmails(userId, parameters);
        return {
          success: true,
          data: {
            count: emails.length,
            emails: emails.map(e => ({
              emailId: e.id,  // ← Renombrar a emailId para ser más explícito
              from: e.from_address,
              from_name: e.from_name,
              subject: e.subject,
              preview: e.body_preview || '(Sin preview disponible)',
              date: e.date,
              is_read: e.is_read,
              has_attachments: e.has_attachments
            }))
            // P1 FIX: instruction eliminada - no contaminar data para UI
          }
        };

      case 'read_email':
        if (!parameters.emailId) {
          throw new Error('emailId es requerido');
        }
        const email = await readEmail(userId, parameters.emailId);
        if (!email) {
          return {
            success: false,
            error: 'Correo no encontrado'
          };
        }
        return {
          success: true,
          data: {
            id: email.id,
            from: email.from_address,
            from_name: email.from_name,
            subject: email.subject,
            body: email.body_text || email.body_preview,
            date: email.date,
            has_attachments: email.has_attachments
          }
        };

      case 'analyze_email':
        if (!parameters.emailId) {
          throw new Error('emailId es requerido');
        }
        const analysis = await analyzeEmail(userId, parameters.emailId);
        return {
          success: true,
          data: analysis
        };

      case 'draft_reply':
        if (!parameters.emailId) {
          throw new Error('emailId es requerido');
        }
        const draft = await draftReply(
          userId,
          parameters.emailId,
          parameters.customInstructions
        );
        return {
          success: true,
          data: draft
        };

      case 'send_email':
        if (!parameters.to || !parameters.subject || !parameters.body) {
          throw new Error('to, subject y body son requeridos');
        }
        const sendResult = await sendEmail(
          userId,
          {
            to: parameters.to,
            subject: parameters.subject,
            body: parameters.body,
            in_reply_to: parameters.inReplyTo
          },
          parameters.accountEmail
        );
        
        // 🚨 PROPAGAR ERROR CODES al metadata
        if (!sendResult.success) {
          return {
            success: false,
            error: sendResult.error,
            metadata: {
              errorCode: sendResult.errorCode,
              errorDetails: sendResult.errorDetails,
              tool: 'send_email'
            }
          };
        }
        
        return {
          success: true,
          data: { messageId: sendResult.messageId },
          metadata: {
            tool: 'send_email',
            to: parameters.to,
            subject: parameters.subject
          }
        };

      case 'create_and_send_email':
        if (!parameters.to || !parameters.subject || !parameters.body) {
          throw new Error('to, subject y body son requeridos');
        }
        const createResult = await createAndSendEmail(
          userId,
          parameters.to,
          parameters.subject,
          parameters.body,
          parameters.accountEmail
        );
        return {
          success: createResult.success,
          data: createResult.success ? { messageId: createResult.messageId } : undefined,
          error: createResult.error
        };

      // Calendar Tools
      case 'list_events':
        const startDate = parameters.startDate || new Date().toISOString();
        const endDate = parameters.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        
        const eventsResult = await listEvents(userId, startDate, endDate);
        
        if (!eventsResult.success || !eventsResult.events) {
          throw new Error(eventsResult.error || 'Error listando eventos');
        }
        
        // 🚨 P0 FIX: Si NO hay eventos, lanzar error explícito para que Nova NO invente
        if (eventsResult.events.length === 0) {
          const start = new Date(startDate);
          const end = new Date(endDate);
          throw new Error(`NO_EVENTS_FOUND: No tienes eventos agendados entre ${start.toLocaleDateString('es-MX')} y ${end.toLocaleDateString('es-MX')}. Tu agenda está vacía para ese período.`);
        }
        
        return {
          success: true,
          data: {
            events: eventsResult.events.map(e => ({
              id: e.id,
              title: e.title,
              start: e.start_at,
              end: e.end_at,
              description: e.description
            }))
          }
        };

      case 'create_event':
        if (!parameters.title || !parameters.startTime) {
          throw new Error('title y startTime son requeridos');
        }
        
        // P0 FIX: Validar que la fecha no sea pasado (Groq alucinando 2023)
        const eventStartDate = new Date(parameters.startTime);
        const now = new Date();
        
        if (eventStartDate.getFullYear() < 2025) {
          console.error('[TOOL ROUTER] 🚨 FECHA INVÁLIDA detectada:', parameters.startTime);
          throw new Error(`Fecha inválida: ${parameters.startTime}. La fecha debe ser 2026 o posterior. Fecha actual: ${now.toISOString().split('T')[0]}`);
        }
        
        const eventResult = await createCalendarEvent(userId, {
          title: parameters.title,
          start_at: parameters.startTime,
          end_at: parameters.endTime || new Date(eventStartDate.getTime() + 60 * 60 * 1000).toISOString(), // +1 hora por defecto
          description: parameters.description || ''
        });
        
        if (!eventResult.success || !eventResult.event) {
          throw new Error(eventResult.error || 'Error creando evento');
        }
        
        return {
          success: true,
          data: {
            eventId: eventResult.event.id,
            title: eventResult.event.title,
            start: eventResult.event.start_at,
            end: eventResult.event.end_at
          }
        };

      case 'delete_event':
        if (!parameters.eventId) {
          throw new Error('eventId es requerido para borrar evento');
        }
        
        const { deleteEvent } = await import('./calendarTools');
        const deleteResult = await deleteEvent(userId, parameters.eventId);
        
        if (!deleteResult.success) {
          throw new Error(deleteResult.error || 'Error eliminando evento');
        }
        
        return {
          success: true,
          data: {
            message: 'Evento eliminado correctamente'
          }
        };

      // Document Analysis Tools
      case 'analyze_document':
        if (!parameters.fileUrl) {
          throw new Error('fileUrl es requerido');
        }
        const docResult = await analyzeDocument(parameters.fileUrl, parameters.fileType);
        return {
          success: docResult.success,
          data: docResult.success ? {
            type: docResult.documentType,
            text: docResult.extractedText?.substring(0, 2000), // Primeros 2000 chars
            numbers: docResult.numbers?.slice(0, 10),
            dates: docResult.dates?.slice(0, 5),
            keyFindings: docResult.keyFindings,
            risks: docResult.risks,
            summary: docResult.summary
          } : undefined,
          error: docResult.error
        };

      case 'extract_text_from_image':
        if (!parameters.imageUrl) {
          throw new Error('imageUrl es requerido');
        }
        const ocrResult = await extractTextFromImage(parameters.imageUrl);
        return {
          success: ocrResult.success,
          data: ocrResult.success ? {
            text: ocrResult.extractedText,
            summary: ocrResult.summary
          } : undefined,
          error: ocrResult.error
        };

      // Financial Tools
      case 'calculate_financial_projection':
        if (!parameters.project_name || !parameters.initial_investment || !parameters.monthly_costs || !parameters.monthly_revenue) {
          throw new Error('project_name, initial_investment, monthly_costs y monthly_revenue son requeridos');
        }
        const projResult = await calculateFinancialProjection({
          name: parameters.project_name,
          initial_investment: parameters.initial_investment,
          monthly_costs: parameters.monthly_costs,
          monthly_revenue_base: parameters.monthly_revenue,
          growth_rate: parameters.growth_rate
        });
        return {
          success: projResult.success,
          data: projResult
        };

      case 'estimate_project_cost':
        if (!parameters.project_type || !parameters.complexity || !parameters.features) {
          throw new Error('project_type, complexity y features son requeridos');
        }
        const costResult = await estimateProjectCost(
          parameters.project_type,
          parameters.complexity,
          parameters.features
        );
        return {
          success: costResult.success,
          data: costResult
        };

      // Calendar Tools (LEGACY - eliminar después de migrar frontend)
      case 'create_calendar_event':
        if (!parameters.title || !parameters.start_at) {
          throw new Error('title y start_at son requeridos');
        }
        const legacyEventResult = await createCalendarEvent(userId, {
          title: parameters.title,
          description: parameters.description,
          start_at: parameters.start_at,
          end_at: parameters.end_at,
          timezone: parameters.timezone,
          location: parameters.location,
          attendees_json: parameters.attendees_json || parameters.attendees,
          notification_minutes: parameters.notification_minutes || parameters.reminder_minutes
        });
        return {
          success: legacyEventResult.success,
          data: legacyEventResult.event,
          error: legacyEventResult.error
        };

      case 'list_calendar_events':
        const listResult = await listEvents(
          userId,
          parameters.start_at || parameters.start_date,
          parameters.end_at || parameters.end_date
        );
        return {
          success: listResult.success,
          data: { events: listResult.events },
          error: listResult.error
        };

      case 'extract_and_schedule':
        if (!parameters.text) {
          throw new Error('text es requerido');
        }
        const scheduleResult = await extractAndSchedule(userId, parameters.text, {
          source: parameters.source || 'chat',
          source_id: parameters.source_id,
          default_title: parameters.default_title
        });
        return {
          success: scheduleResult.success,
          data: { events: scheduleResult.events },
          error: scheduleResult.error
        };

      // Web Search Tool
      case 'web_search':
        if (!parameters.query) {
          throw new Error('query es requerido para web_search');
        }
        
        const { webSearch } = await import('../../services/tavilySearch');
        const searchResults = await webSearch({
          query: parameters.query,
          maxResults: parameters.maxResults || 5
        });
        
        // 🚨 P0 FIX: Truncar content para evitar HTTP 424 de Nova
        // Nova crashea con toolResults >10KB. Limitamos a 500 chars por resultado.
        return {
          success: true,
          data: {
            query: parameters.query,
            results: searchResults.results.map((r: any) => ({
              title: r.title,
              url: r.url,
              content: r.content?.substring(0, 500) || '', // MAX 500 chars
              score: r.score
            }))
          }
        };

      // Memory Tool
      case 'save_memory':
        if (!parameters.content || !parameters.memoryType) {
          throw new Error('content y memoryType son requeridos');
        }
        
        const { supabase } = await import('../../db/supabase');
        
        const { data: memoryData, error: memoryError } = await supabase
          .from('assistant_memories')
          .insert({
            user_id_uuid: userId,
            workspace_id: 'default',  // TODO: Obtener del contexto
            memory: parameters.content,
            memory_type: parameters.memoryType,
            importance: parameters.importance || 0.7,
            created_at: new Date().toISOString()
          })
          .select()
          .single();
        
        if (memoryError) {
          throw memoryError;
        }
        
        return {
          success: true,
          data: {
            id: memoryData.id,
            content: memoryData.memory,
            type: memoryData.memory_type
          }
        };

      // ════════════════════════════════════════════════════════
      // COHERE COMMAND R (RAG / BÚSQUEDA INTERNA)
      // ════════════════════════════════════════════════════════
      
      case 'search_internal_docs':
        if (!parameters.query) {
          throw new Error('query es requerido');
        }
        
        const { callCohere } = await import('../providers/cohereClient');
        
        const cohereResult = await callCohere({
          query: parameters.query,
          documents: parameters.documents || [], // Opcional: pasar docs para RAG
          maxTokens: 1024,
          temperature: 0.3
        });
        
        return {
          success: true,
          data: {
            answer: cohereResult.text,
            citations: cohereResult.citations
          }
        };

      // ════════════════════════════════════════════════════════
      // MEETINGS TOOLS (🚧 EN DESARROLLO - NO OPERATIVO)
      // ════════════════════════════════════════════════════════
      
      case 'start_live_meeting':
        return {
          success: false,
          data: {
            error: 'Feature en desarrollo',
            message: '🚧 Las reuniones en vivo NO están operativas aún. Requieren pipeline de streaming de audio que no está implementado.',
            status: 'not_implemented'
          }
        };

      case 'get_meeting_status':
        if (!parameters.meetingId) {
          throw new Error('meetingId es requerido');
        }
        
        // Fetch meeting details via API (placeholder)
        const meetingResponse = await fetch(`${process.env.ALE_CORE_URL || 'http://localhost:4000'}/api/meetings/${parameters.meetingId}`, {
          headers: {
            'Authorization': `Bearer ${userId}` // TODO: Pasar token real
          }
        });
        
        if (!meetingResponse.ok) {
          return {
            success: false,
            error: 'Meeting not found or access denied'
          };
        }
        
        const meetingData = await meetingResponse.json();
        
        return {
          success: true,
          data: meetingData
        };

      case 'stop_meeting':
        if (!parameters.meetingId) {
          throw new Error('meetingId es requerido');
        }
        
        return {
          success: true,
          data: {
            message: 'Para detener la reunión, usa el botón "Detener" en la app. El backend generará la minuta automáticamente.',
            meetingId: parameters.meetingId
          }
        };

      case 'send_minutes':
        if (!parameters.meetingId) {
          throw new Error('meetingId es requerido');
        }
        
        return {
          success: true,
          data: {
            message: `Minuta de reunión ${parameters.meetingId} programada para envío`,
            sendEmail: parameters.sendEmail || false,
            sendTelegram: parameters.sendTelegram || false
          }
        };

      case 'search_meetings':
        if (!parameters.query) {
          throw new Error('query es requerido');
        }
        
        return {
          success: true,
          data: {
            message: 'Búsqueda en meetings integrada con RAG (implementación pendiente)',
            query: parameters.query,
            results: []
          }
        };

      default:
        console.log(`[TOOL ROUTER] ⚠️  Tool no implementado: ${name}`);
        return {
          success: false,
          error: `Herramienta "${name}" no está disponible aún`
        };
    }

  } catch (error: any) {
    console.error('[TOOL ROUTER] Error ejecutando tool:', error);
    return {
      success: false,
      error: error.message || 'Error ejecutando herramienta'
    };
  }
}

/**
 * Obtiene todas las definiciones de herramientas disponibles
 */
export function getAvailableTools(): any[] {
  return [
    ...EMAIL_TOOLS_DEFINITIONS,
    ...DOCUMENT_TOOLS_DEFINITIONS,
    ...FINANCIAL_TOOLS_DEFINITIONS,
    ...CALENDAR_TOOLS_DEFINITIONS
  ];
}

/**
 * Determina si se necesitan herramientas para una consulta
 */
export function needsTools(query: string): boolean {
  const lower = query.toLowerCase();
  
  // Keywords de email
  const emailKeywords = [
    'correo', 'email', 'mensaje', 'bandeja',
    'lee', 'leer', 'revisar', 'consultar',
    'responde', 'responder', 'contestar',
    'envía', 'enviar', 'mandar'
  ];
  
  // Keywords de documentos
  const docKeywords = [
    'pdf', 'documento', 'archivo', 'excel',
    'word', 'imagen', 'analiza', 'extrae'
  ];
  
  // Keywords financieros
  const finKeywords = [
    'proyección', 'costo', 'roi', 'inversión',
    'capex', 'opex', 'payback', 'financiero'
  ];
  
  // Keywords de calendario
  const calendarKeywords = [
    'cita', 'reunión', 'agenda', 'calendario',
    'evento', 'recordatorio', 'junta'
  ];
  
  return (
    emailKeywords.some(kw => lower.includes(kw)) ||
    docKeywords.some(kw => lower.includes(kw)) ||
    finKeywords.some(kw => lower.includes(kw)) ||
    calendarKeywords.some(kw => lower.includes(kw))
  );
}

/**
 * Detecta qué herramientas se necesitan para una consulta
 */
export function detectRequiredTools(query: string): string[] {
  const lower = query.toLowerCase();
  const tools: string[] = [];
  
  // Email tools - MEJORADO para detectar más variaciones
  const hasEmailIntent = lower.includes('correo') || lower.includes('email') || lower.includes('mensaje') || lower.includes('bandeja');
  
  if (hasEmailIntent) {
    // Detectar lectura de correos
    if (lower.includes('lee') || lower.includes('leer') || lower.includes('muestra') || 
        lower.includes('checa') || lower.includes('checar') || lower.includes('revisar') ||
        lower.includes('ver') || lower.includes('consulta') || lower.includes('dime')) {
      tools.push('list_emails');
    }
    
    // Detectar análisis
    if (lower.includes('analiza') || lower.includes('análisis') || lower.includes('resume')) {
      tools.push('analyze_email');
    }
    
    // Detectar respuesta
    if (lower.includes('responde') || lower.includes('responder') || lower.includes('contestar')) {
      tools.push('draft_reply');
    }
    
    // Detectar envío
    if (lower.includes('envía') || lower.includes('enviar') || lower.includes('mandar')) {
      tools.push('send_email');
    }
  }
  
  // Document tools
  if (lower.includes('pdf') || lower.includes('documento') || lower.includes('archivo')) {
    tools.push('analyze_document');
  }
  
  if (lower.includes('imagen') || lower.includes('ocr') || lower.includes('extrae texto')) {
    tools.push('extract_text_from_image');
  }
  
  // Financial tools
  if (lower.includes('proyección') || lower.includes('roi') || lower.includes('payback')) {
    tools.push('calculate_financial_projection');
  }
  
  if (lower.includes('costo') && (lower.includes('proyecto') || lower.includes('desarrollo'))) {
    tools.push('estimate_project_cost');
  }
  
  // Calendar tools (CANON: create_event / list_events)
  if (lower.includes('agenda') || lower.includes('cita') || lower.includes('reunión')) {
    if (lower.includes('crea') || lower.includes('agendar')) {
      tools.push('create_event'); // CANON (era create_calendar_event legacy)
    } else if (lower.includes('lista') || lower.includes('tengo')) {
      tools.push('list_calendar_events');
    } else if (lower.includes('detecta') || lower.includes('extrae')) {
      tools.push('extract_and_schedule');
    }
  }
  
  return tools;
}
