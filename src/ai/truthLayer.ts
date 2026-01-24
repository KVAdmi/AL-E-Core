/**
 * TRUTH LAYER - VALIDADOR POST-RESPUESTA
 * 
 * Regla de oro: NO se puede afirmar una acción sin toolResult verificable.
 * 
 * Si toolsUsed = 0 y el intent requería tool → BLOQUEAR respuesta.
 */

import { isCapabilityEnabled, getCapabilityDisabledMessage } from '../config/capabilities';

export interface ToolResult {
  tool: string;
  success: boolean;
  result?: any;
  error?: string;
  timestamp: number;
}

export interface ValidationResult {
  allowed: boolean;
  error?: string;
  sanitizedAnswer?: string;
}

/**
 * Detecta intents que requieren tools específicos
 */
export function detectRequiredTools(userMessage: string): string[] {
  const message = userMessage.toLowerCase();
  const required: string[] = [];

  // EMAIL READ
  if (/revisa.*correo|checa.*correo|checar.*correo|ver.*correo|leer.*correo|mis.*mensaje|inbox|últimos.*correo/i.test(message)) {
    required.push('list_emails');
  }

  // EMAIL SEND
  if (/responde.*correo|contesta.*correo|envía.*correo|manda.*correo|escribe.*correo|dile que/i.test(message)) {
    required.push('send_email');
  }

  // CALENDAR
  if (/agenda.*reunión|crea.*evento|programa.*cita|revisa.*agenda|mis.*evento|qué.*tengo.*hoy/i.test(message)) {
    required.push('create_event', 'list_events');
  }

  // WEB SEARCH
  if (/busca.*en.*web|investiga|búsqueda.*google|qué.*dice.*internet|información.*sobre/i.test(message)) {
    required.push('web_search');
  }

  // ATTACHMENTS
  if (/analiza.*documento|lee.*archivo|qué.*dice.*imagen|contenido.*pdf/i.test(message)) {
    required.push('analyze_document');
  }

  return required;
}

/**
 * Valida que la respuesta esté respaldada por toolResults
 */
export function validateResponse(
  userMessage: string,
  answer: string,
  toolsUsed: string[],
  toolResults?: ToolResult[]
): ValidationResult {
  const requiredTools = detectRequiredTools(userMessage);

  // Si no se requieren tools específicos, permitir respuesta
  if (requiredTools.length === 0) {
    return { allowed: true };
  }

  // Verificar capabilities habilitadas
  for (const tool of requiredTools) {
    const capability = mapToolToCapability(tool);
    if (capability && !isCapabilityEnabled(capability)) {
      return {
        allowed: false,
        error: getCapabilityDisabledMessage(capability),
        sanitizedAnswer: getCapabilityDisabledMessage(capability)
      };
    }
  }

  // Si se requieren tools pero NO se ejecutaron: BLOQUEAR
  if (toolsUsed.length === 0) {
    return {
      allowed: false,
      error: 'TOOL_EXECUTION_REQUIRED',
      sanitizedAnswer: `No pude completar esta acción porque no se ejecutaron las herramientas necesarias (${requiredTools.join(', ')}). Esto puede ser un problema temporal. Por favor, intenta de nuevo o contacta a soporte.`
    };
  }

  // Verificar que al menos un tool requerido se haya ejecutado
  const executedRequired = requiredTools.filter(tool => toolsUsed.includes(tool));
  if (executedRequired.length === 0) {
    return {
      allowed: false,
      error: 'WRONG_TOOLS_EXECUTED',
      sanitizedAnswer: `Ejecuté herramientas (${toolsUsed.join(', ')}) pero no las necesarias para tu solicitud (${requiredTools.join(', ')}). Por favor, reformula tu pregunta.`
    };
  }

  // Verificar que los tools ejecutados hayan sido exitosos
  if (toolResults) {
    const failedTools = toolResults.filter(r => !r.success);
    if (failedTools.length > 0) {
      const errors = failedTools.map(t => `${t.tool}: ${t.error}`).join('; ');
      return {
        allowed: false,
        error: 'TOOL_EXECUTION_FAILED',
        sanitizedAnswer: `Intenté completar tu solicitud pero encontré errores: ${errors}`
      };
    }
  }

  // Validar que la respuesta NO contenga afirmaciones sin evidencia
  const validation = validateAnswerClaims(answer, toolsUsed, toolResults);
  if (!validation.allowed) {
    return validation;
  }

  // Todo OK
  return { allowed: true };
}

/**
 * Valida que la respuesta NO contenga afirmaciones falsas
 */
function validateAnswerClaims(
  answer: string,
  toolsUsed: string[],
  toolResults?: ToolResult[]
): ValidationResult {
  const answerLower = answer.toLowerCase();

  // CLAIM: "enviado" / "mandé" sin send_email
  if (/(enviado|mandé|envié|entregado|despachado).*correo/i.test(answer)) {
    if (!toolsUsed.includes('send_email')) {
      return {
        allowed: false,
        error: 'FALSE_CLAIM_EMAIL_SENT',
        sanitizedAnswer: 'No puedo confirmar el envío del correo porque no se ejecutó la herramienta de envío.'
      };
    }
  }

  // CLAIM: "revisé" / "tienes X correos" sin list_emails
  if (/(revisé|encontré|tienes|últimos).*correo/i.test(answer)) {
    if (!toolsUsed.includes('list_emails')) {
      return {
        allowed: false,
        error: 'FALSE_CLAIM_EMAILS_LISTED',
        sanitizedAnswer: 'No puedo listar tus correos porque no se ejecutó la consulta de correos.'
      };
    }
  }

  // CLAIM: "agendé" / "creé evento" sin create_event
  if (/(agendé|creé|programé|guardé).*evento|reunión|cita/i.test(answer)) {
    if (!toolsUsed.includes('create_event')) {
      return {
        allowed: false,
        error: 'FALSE_CLAIM_EVENT_CREATED',
        sanitizedAnswer: 'No puedo confirmar la creación del evento porque no se ejecutó la herramienta de calendario.'
      };
    }
  }

  // CLAIM: "analicé" / "el documento dice" sin analyze_document
  if (/(analicé|leí|revisé).*documento|archivo|pdf|imagen/i.test(answer)) {
    if (!toolsUsed.includes('analyze_document')) {
      return {
        allowed: false,
        error: 'FALSE_CLAIM_DOCUMENT_ANALYZED',
        sanitizedAnswer: 'No puedo analizar el documento porque no se ejecutó la herramienta de análisis.'
      };
    }
  }

  return { allowed: true };
}

/**
 * Mapea tool a capability
 */
function mapToolToCapability(tool: string): keyof typeof import('../config/capabilities').CAPABILITIES | null {
  const map: Record<string, keyof typeof import('../config/capabilities').CAPABILITIES> = {
    'list_emails': 'EMAIL_READ',
    'read_email': 'EMAIL_READ',
    'send_email': 'EMAIL_SEND',
    'reply_to_email': 'EMAIL_SEND',
    'create_event': 'CALENDAR',
    'list_events': 'CALENDAR',
    'update_event': 'CALENDAR',
    'delete_event': 'CALENDAR',
    'web_search': 'WEB_SEARCH',
    'analyze_document': 'ATTACHMENTS',
    'analyze_image': 'ATTACHMENTS'
  };

  return map[tool] || null;
}

/**
 * Genera metadata de debug para logging
 */
export function generateDebugMetadata(
  userMessage: string,
  answer: string,
  toolsUsed: string[],
  toolResults?: ToolResult[]
): any {
  return {
    timestamp: new Date().toISOString(),
    requiredTools: detectRequiredTools(userMessage),
    toolsExecuted: toolsUsed,
    toolResults: toolResults?.map(r => ({
      tool: r.tool,
      success: r.success,
      hasResult: !!r.result,
      error: r.error
    })),
    validation: validateResponse(userMessage, answer, toolsUsed, toolResults)
  };
}
