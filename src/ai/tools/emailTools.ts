/**
 * Email Tools para AL-E
 * 
 * Herramientas que permiten a AL-E:
 * - Leer correos del usuario
 * - Analizar contenido y contexto
 * - Proponer respuestas inteligentes
 * - Enviar correos automáticamente
 * - Detectar citas y compromisos
 */

import { supabase } from '../../db/supabase';
import axios from 'axios';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface EmailMessage {
  id: string;
  from_address: string;
  from_name?: string;
  subject: string;
  body_text?: string;
  body_html?: string;
  body_preview?: string;
  date: string;
  is_read: boolean;
  has_attachments: boolean;
}

export interface EmailAnalysis {
  summary: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';
  key_points: string[];
  action_required: boolean;
  suggested_response?: string;
  detected_dates?: Array<{
    date: string;
    context: string;
    type: 'meeting' | 'deadline' | 'reminder';
  }>;
}

export interface DraftEmail {
  to: string;
  subject: string;
  body: string;
  in_reply_to?: string;
}

// ═══════════════════════════════════════════════════════════════
// EMAIL TOOLS
// ═══════════════════════════════════════════════════════════════

/**
 * Listar correos del usuario
 */
export async function listEmails(
  userId: string,
  filters?: {
    accountEmail?: string;
    unreadOnly?: boolean;
    limit?: number;
  }
): Promise<EmailMessage[]> {
  try {
    console.log('[EMAIL TOOLS] Listando correos para usuario:', userId);

    // Obtener cuentas del usuario
    const { data: accounts, error: accountError } = await supabase
      .from('email_accounts')
      .select('id, from_email')
      .eq('owner_user_id', userId);

    if (accountError || !accounts || accounts.length === 0) {
      console.log('[EMAIL TOOLS] No se encontraron cuentas de correo');
      return [];
    }

    // Filtrar por cuenta específica si se especifica
    let accountIds = accounts.map(a => a.id);
    if (filters?.accountEmail) {
      const filteredAccount = accounts.find(a => 
        a.from_email.toLowerCase().includes(filters.accountEmail!.toLowerCase())
      );
      if (filteredAccount) {
        accountIds = [filteredAccount.id];
      }
    }

    // Construir query
    let query = supabase
      .from('email_messages')
      .select('*')
      .in('account_id', accountIds)
      .order('date', { ascending: false });

    if (filters?.unreadOnly) {
      query = query.eq('is_read', false);
    }

    if (filters?.limit) {
      query = query.limit(filters.limit);
    } else {
      query = query.limit(20);
    }

    const { data: messages, error: messagesError } = await query;

    if (messagesError) {
      console.error('[EMAIL TOOLS] Error obteniendo mensajes:', messagesError);
      throw new Error(`Error al listar correos: ${messagesError.message}`);
    }

    console.log(`[EMAIL TOOLS] ✓ ${messages?.length || 0} correos encontrados`);
    return messages || [];

  } catch (error: any) {
    console.error('[EMAIL TOOLS] Error en listEmails:', error);
    throw error;
  }
}

/**
 * Leer correo completo con todos los detalles
 */
export async function readEmail(
  userId: string,
  emailId: string
): Promise<EmailMessage | null> {
  try {
    console.log('[EMAIL TOOLS] Leyendo correo:', emailId);

    const { data: message, error } = await supabase
      .from('email_messages')
      .select('*')
      .eq('id', emailId)
      .eq('owner_user_id', userId)
      .single();

    if (error) {
      console.error('[EMAIL TOOLS] Error leyendo correo:', error);
      throw new Error(`Error al leer correo: ${error.message}`);
    }

    if (!message) {
      console.log('[EMAIL TOOLS] Correo no encontrado');
      return null;
    }

    // Marcar como leído
    await supabase
      .from('email_messages')
      .update({ is_read: true })
      .eq('id', emailId);

    console.log('[EMAIL TOOLS] ✓ Correo leído exitosamente');
    return message;

  } catch (error: any) {
    console.error('[EMAIL TOOLS] Error en readEmail:', error);
    throw error;
  }
}

/**
 * Analizar correo con IA (sentiment, key points, actions)
 */
export async function analyzeEmail(
  userId: string,
  emailId: string
): Promise<EmailAnalysis> {
  try {
    console.log('[EMAIL TOOLS] Analizando correo:', emailId);

    const email = await readEmail(userId, emailId);
    if (!email) {
      throw new Error('Correo no encontrado');
    }

    const content = email.body_text || email.body_preview || '';
    
    // Análisis básico
    const analysis: EmailAnalysis = {
      summary: generateSummary(content, email.subject),
      sentiment: detectSentiment(content),
      key_points: extractKeyPoints(content),
      action_required: detectActionRequired(content),
      detected_dates: extractDates(content)
    };

    console.log('[EMAIL TOOLS] ✓ Análisis completado');
    return analysis;

  } catch (error: any) {
    console.error('[EMAIL TOOLS] Error en analyzeEmail:', error);
    throw error;
  }
}

/**
 * Generar borrador de respuesta inteligente
 */
export async function draftReply(
  userId: string,
  emailId: string,
  customInstructions?: string
): Promise<DraftEmail> {
  try {
    console.log('[EMAIL TOOLS] Generando borrador de respuesta para:', emailId);

    const email = await readEmail(userId, emailId);
    if (!email) {
      throw new Error('Correo no encontrado');
    }

    const analysis = await analyzeEmail(userId, emailId);

    // Generar respuesta basada en análisis
    const responseBody = generateResponseBody(email, analysis, customInstructions);

    const draft: DraftEmail = {
      to: email.from_address,
      subject: email.subject.startsWith('RE:') ? email.subject : `RE: ${email.subject}`,
      body: responseBody,
      in_reply_to: emailId
    };

    console.log('[EMAIL TOOLS] ✓ Borrador generado');
    return draft;

  } catch (error: any) {
    console.error('[EMAIL TOOLS] Error en draftReply:', error);
    throw error;
  }
}

/**
 * Enviar correo (nuevo o respuesta)
 */
export async function sendEmail(
  userId: string,
  draft: DraftEmail,
  accountEmail?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    console.log('[EMAIL TOOLS] Enviando correo a:', draft.to);

    // Obtener cuenta del usuario
    let query = supabase
      .from('email_accounts')
      .select('id, from_email')
      .eq('owner_user_id', userId);

    if (accountEmail) {
      query = query.eq('from_email', accountEmail);
    }

    const { data: accounts, error: accountError } = await query;

    if (accountError || !accounts || accounts.length === 0) {
      throw new Error('No se encontró cuenta de correo configurada');
    }

    const account = accounts[0];

    // Llamar a la API de envío
    const response = await axios.post(
      `${API_BASE}/api/mail/send`,
      {
        from: account.from_email,
        to: draft.to,
        subject: draft.subject,
        text: draft.body,
        inReplyTo: draft.in_reply_to
      },
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('[EMAIL TOOLS] ✓ Correo enviado exitosamente');
    return {
      success: true,
      messageId: response.data.messageId
    };

  } catch (error: any) {
    console.error('[EMAIL TOOLS] Error enviando correo:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Crear y enviar correo nuevo
 */
export async function createAndSendEmail(
  userId: string,
  to: string,
  subject: string,
  body: string,
  accountEmail?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    console.log('[EMAIL TOOLS] Creando correo nuevo para:', to);

    const draft: DraftEmail = {
      to,
      subject,
      body
    };

    return await sendEmail(userId, draft, accountEmail);

  } catch (error: any) {
    console.error('[EMAIL TOOLS] Error en createAndSendEmail:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS DE ANÁLISIS
// ═══════════════════════════════════════════════════════════════

function generateSummary(content: string, subject: string): string {
  const preview = content.substring(0, 200).trim();
  return `${subject} - ${preview}${content.length > 200 ? '...' : ''}`;
}

function detectSentiment(content: string): 'positive' | 'neutral' | 'negative' | 'urgent' {
  const lower = content.toLowerCase();
  
  // Urgente
  if (lower.includes('urgente') || lower.includes('inmediato') || lower.includes('asap')) {
    return 'urgent';
  }
  
  // Positivo
  if (lower.includes('gracias') || lower.includes('excelente') || lower.includes('perfecto')) {
    return 'positive';
  }
  
  // Negativo
  if (lower.includes('problema') || lower.includes('error') || lower.includes('falla')) {
    return 'negative';
  }
  
  return 'neutral';
}

function extractKeyPoints(content: string): string[] {
  // Extrae oraciones cortas como puntos clave
  const sentences = content
    .split(/[.!?]\s+/)
    .filter(s => s.length > 20 && s.length < 150)
    .slice(0, 3);
  
  return sentences.length > 0 ? sentences : ['Sin puntos clave identificados'];
}

function detectActionRequired(content: string): boolean {
  const lower = content.toLowerCase();
  const actionWords = [
    'necesito', 'requiero', 'puedes', 'podrías', 
    'favor', 'solicito', 'confirma', 'revisa'
  ];
  
  return actionWords.some(word => lower.includes(word));
}

function extractDates(content: string): Array<{ date: string; context: string; type: 'meeting' | 'deadline' | 'reminder' }> {
  const dates: Array<{ date: string; context: string; type: 'meeting' | 'deadline' | 'reminder' }> = [];
  
  // Patrones de fecha simples
  const datePatterns = [
    /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/g,
    /(mañana|pasado mañana|la próxima semana)/gi,
    /(\d{1,2}\s+de\s+\w+)/gi
  ];
  
  datePatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      matches.forEach(match => {
        dates.push({
          date: match,
          context: content.substring(Math.max(0, content.indexOf(match) - 50), content.indexOf(match) + 50),
          type: content.toLowerCase().includes('reunión') || content.toLowerCase().includes('junta') ? 'meeting' : 'deadline'
        });
      });
    }
  });
  
  return dates;
}

function generateResponseBody(email: EmailMessage, analysis: EmailAnalysis, customInstructions?: string): string {
  let response = '';
  
  // Saludo
  const fromName = email.from_name || email.from_address.split('@')[0];
  response += `Hola ${fromName},\n\n`;
  
  // Cuerpo (personalizado o template)
  if (customInstructions) {
    response += customInstructions;
  } else {
    // Respuesta automática basada en sentimiento
    switch (analysis.sentiment) {
      case 'urgent':
        response += `He recibido tu mensaje urgente sobre "${email.subject}". `;
        response += `Estoy revisando el asunto y te responderé con los detalles lo antes posible.\n\n`;
        break;
      case 'positive':
        response += `Gracias por tu mensaje. Me alegra saber que todo va bien. `;
        response += `Cualquier cosa que necesites, no dudes en contactarme.\n\n`;
        break;
      case 'negative':
        response += `He recibido tu mensaje sobre el inconveniente mencionado. `;
        response += `Estoy trabajando en resolverlo y te mantendré informado del progreso.\n\n`;
        break;
      default:
        response += `Gracias por tu mensaje sobre "${email.subject}". `;
        response += `Lo he revisado y te responderé en breve con los detalles necesarios.\n\n`;
    }
  }
  
  // Cierre
  response += `Saludos,\nAL-E Assistant`;
  
  return response;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTAR DEFINICIONES DE HERRAMIENTAS PARA LLM
// ═══════════════════════════════════════════════════════════════

export const EMAIL_TOOLS_DEFINITIONS = [
  {
    name: 'list_emails',
    description: 'Lista los correos electrónicos del usuario. Puedes filtrar por cuenta, solo no leídos, o limitar la cantidad.',
    parameters: {
      type: 'object',
      properties: {
        accountEmail: {
          type: 'string',
          description: 'Email de la cuenta específica a consultar (opcional)'
        },
        unreadOnly: {
          type: 'boolean',
          description: 'Si true, solo muestra correos no leídos'
        },
        limit: {
          type: 'number',
          description: 'Número máximo de correos a retornar (default: 20)'
        }
      }
    }
  },
  {
    name: 'read_email',
    description: 'Lee el contenido completo de un correo específico por su ID. Marca el correo como leído.',
    parameters: {
      type: 'object',
      properties: {
        emailId: {
          type: 'string',
          description: 'ID del correo a leer'
        }
      },
      required: ['emailId']
    }
  },
  {
    name: 'analyze_email',
    description: 'Analiza un correo y extrae: resumen, sentimiento, puntos clave, si requiere acción, y fechas/citas detectadas.',
    parameters: {
      type: 'object',
      properties: {
        emailId: {
          type: 'string',
          description: 'ID del correo a analizar'
        }
      },
      required: ['emailId']
    }
  },
  {
    name: 'draft_reply',
    description: 'Genera un borrador de respuesta inteligente para un correo. Puedes dar instrucciones personalizadas.',
    parameters: {
      type: 'object',
      properties: {
        emailId: {
          type: 'string',
          description: 'ID del correo al que se responde'
        },
        customInstructions: {
          type: 'string',
          description: 'Instrucciones específicas sobre qué incluir en la respuesta (opcional)'
        }
      },
      required: ['emailId']
    }
  },
  {
    name: 'send_email',
    description: 'Envía un correo (nuevo o respuesta) desde la cuenta del usuario.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Email del destinatario'
        },
        subject: {
          type: 'string',
          description: 'Asunto del correo'
        },
        body: {
          type: 'string',
          description: 'Contenido del correo'
        },
        inReplyTo: {
          type: 'string',
          description: 'ID del correo al que se responde (opcional)'
        },
        accountEmail: {
          type: 'string',
          description: 'Email de la cuenta desde la que enviar (opcional)'
        }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'create_and_send_email',
    description: 'Crea y envía un correo nuevo desde cero.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Email del destinatario'
        },
        subject: {
          type: 'string',
          description: 'Asunto del correo'
        },
        body: {
          type: 'string',
          description: 'Contenido del correo'
        },
        accountEmail: {
          type: 'string',
          description: 'Email de la cuenta desde la que enviar (opcional)'
        }
      },
      required: ['to', 'subject', 'body']
    }
  }
];
