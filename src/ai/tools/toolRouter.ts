/**
 * Tool Router
 * 
 * Sistema centralizado que ejecuta herramientas solicitadas por el LLM.
 * Maneja email, calendar, telegram, y otras capacidades.
 */

import {
  listEmails,
  readEmail,
  analyzeEmail,
  draftReply,
  sendEmail,
  createAndSendEmail,
  EMAIL_TOOLS_DEFINITIONS
} from './emailTools';

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

    // Email Tools
    switch (name) {
      case 'list_emails':
        const emails = await listEmails(userId, parameters);
        return {
          success: true,
          data: {
            count: emails.length,
            emails: emails.map(e => ({
              id: e.id,
              from: e.from_address,
              subject: e.subject,
              preview: e.body_preview,
              date: e.date,
              is_read: e.is_read,
              has_attachments: e.has_attachments
            }))
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
        return {
          success: sendResult.success,
          data: sendResult.success ? { messageId: sendResult.messageId } : undefined,
          error: sendResult.error
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
    ...EMAIL_TOOLS_DEFINITIONS
    // Aquí se agregarán: CALENDAR_TOOLS, TELEGRAM_TOOLS, etc.
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
    'envía', 'enviar', 'mandar', 'crear'
  ];
  
  return emailKeywords.some(keyword => lower.includes(keyword));
}

/**
 * Detecta qué herramientas se necesitan para una consulta
 */
export function detectRequiredTools(query: string): string[] {
  const lower = query.toLowerCase();
  const tools: string[] = [];
  
  // Email tools
  if (lower.includes('lee') || lower.includes('leer') || lower.includes('muestra')) {
    if (lower.includes('último') || lower.includes('reciente')) {
      tools.push('list_emails');
    } else {
      tools.push('read_email');
    }
  }
  
  if (lower.includes('analiza') || lower.includes('analizar') || lower.includes('de qué trata')) {
    tools.push('analyze_email');
  }
  
  if (lower.includes('responde') || lower.includes('responder') || lower.includes('contesta')) {
    tools.push('draft_reply', 'send_email');
  }
  
  if (lower.includes('crea') || lower.includes('crear') || lower.includes('envía') || lower.includes('enviar')) {
    tools.push('create_and_send_email');
  }
  
  return tools;
}
