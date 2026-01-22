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
 * 
 * 🔥 P0 FIX: Por defecto lee INBOX (entrantes), NO SENT (enviados)
 * Solo leer SENT si se solicita explícitamente con folderType: 'sent'
 */
export async function listEmails(
  userId: string,
  filters?: {
    accountEmail?: string;
    unreadOnly?: boolean;
    limit?: number;
    folderType?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive';
  }
): Promise<EmailMessage[]> {
  try {
    console.log('[EMAIL TOOLS] 📧 Listando emails para usuario:', userId);
    
    // 🔥 P0 FIX: Por defecto = INBOX (entrantes)
    const folderType = filters?.folderType || 'inbox';
    console.log(`[EMAIL TOOLS] 📁 Leyendo carpeta: ${folderType.toUpperCase()}`);

    // 1. VERIFICAR SI HAY CUENTAS CONFIGURADAS
    console.log('[EMAIL TOOLS] 🔍 Verificando cuentas configuradas...');
    const { data: accounts, error: accountError } = await supabase
      .from('email_accounts')
      .select('id, from_email, from_name, is_active, owner_user_id, provider, status')
      .eq('owner_user_id', userId);

    console.log('[EMAIL TOOLS] 📊 Cuentas encontradas:', accounts?.length || 0);
    if (accountError) {
      console.error('[EMAIL TOOLS] Account error:', accountError);
      throw new Error(`ERROR_CHECKING_ACCOUNTS: ${accountError.message}`);
    }
    
    if (!accounts || accounts.length === 0) {
      console.log('[EMAIL TOOLS] ⚠️ Usuario sin cuentas de email configuradas');
      throw new Error('NO_EMAIL_ACCOUNTS: No tienes cuentas de correo configuradas.\n\nPara usar esta función, agrega una cuenta en Configuración → Email Hub.');
    }
    
    if (accounts.length > 0) {
      console.log('[EMAIL TOOLS] ✅ Primera cuenta:', {
        id: accounts[0].id,
        email: accounts[0].from_email,
        name: accounts[0].from_name,
        status: accounts[0].status,
        is_active: accounts[0].is_active,
        owner_user_id: accounts[0].owner_user_id
      });
    }

    // 2. FILTRAR SOLO CUENTAS ACTIVAS
    const activeAccounts = accounts.filter(a => a.is_active !== false && a.status === 'active');
    console.log('[EMAIL TOOLS] Cuentas activas:', activeAccounts.length);
    
    if (activeAccounts.length === 0) {
      console.log('[EMAIL TOOLS] ❌ No hay cuentas activas');
      throw new Error('NO_ACTIVE_ACCOUNTS: Tienes cuentas configuradas pero ninguna está activa.');
    }

    // 3. FILTRAR POR CUENTA ESPECÍFICA SI SE ESPECIFICA
    let accountIds = activeAccounts.map(a => a.id);
    console.log('[EMAIL TOOLS] Account IDs a buscar:', accountIds);
    
    if (filters?.accountEmail) {
      const filteredAccount = activeAccounts.find(a => 
        (a.from_email || '').toLowerCase().includes(filters.accountEmail!.toLowerCase())
      );
      if (filteredAccount) {
        accountIds = [filteredAccount.id];
        console.log('[EMAIL TOOLS] Filtrando por cuenta:', filteredAccount.from_email);
      }
    }

    // 4. OBTENER FOLDER_ID POR FOLDER_TYPE
    console.log('[EMAIL TOOLS] 🔍 Buscando folders tipo:', folderType);
    const { data: folders, error: folderError } = await supabase
      .from('email_folders')
      .select('id, account_id, imap_path, folder_type')
      .in('account_id', accountIds)
      .eq('folder_type', folderType);
    
    console.log('[EMAIL TOOLS] 📁 Folders encontrados:', folders?.length || 0);
    if (folderError) {
      console.error('[EMAIL TOOLS] Folder error:', folderError);
    }
    if (folders && folders.length > 0) {
      console.log('[EMAIL TOOLS] Primer folder:', folders[0]);
    }
    
    if (folderError) {
      console.error('[EMAIL TOOLS] Error obteniendo folders:', folderError);
      throw new Error(`Error al obtener carpeta ${folderType}: ${folderError.message}`);
    }
    
    if (!folders || folders.length === 0) {
      console.log(`[EMAIL TOOLS] ⚠️ No se encontró carpeta tipo "${folderType}" para las cuentas del usuario`);
      return [];
    }
    
    const folderIds = folders.map(f => f.id);
    console.log(`[EMAIL TOOLS] 📁 Buscando en ${folderIds.length} folder(s) tipo "${folderType}"`);

    // Construir query - 🔥 AHORA FILTRA POR FOLDER_ID
    let query = supabase
      .from('email_messages')
      .select('*')
      .in('folder_id', folderIds) // 🔥 FILTRO CORRECTO
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

    // 🚨 P0 FIX: VALIDACIÓN CRÍTICA - NO INVENTAR CORREOS
    if (!messages || messages.length === 0) {
      console.log(`[EMAIL TOOLS] ⚠️ No se encontraron correos en carpeta "${folderType}"`);
      throw new Error(`NO_EMAILS_FOUND: No hay correos en tu ${folderType === 'inbox' ? 'bandeja de entrada' : folderType}. Verifica que la sincronización IMAP esté funcionando.`);
    }

    // Validar que cada correo tenga metadatos mínimos reales
    const validEmails = messages.filter(email => 
      email.from_address && 
      email.subject && 
      email.date && 
      email.id
    );

    if (validEmails.length === 0) {
      console.error('[EMAIL TOOLS] ❌ Correos sin metadatos válidos detectados');
      throw new Error('EMAIL_VALIDATION_FAILED: Los correos encontrados no tienen metadatos válidos (from, subject, date, id). Reporta este error a soporte.');
    }

    if (validEmails.length < messages.length) {
      console.warn(`[EMAIL TOOLS] ⚠️ ${messages.length - validEmails.length} correos con metadatos incompletos fueron filtrados`);
    }

    console.log(`[EMAIL TOOLS] ✓ ${validEmails.length} correos válidos encontrados en carpeta "${folderType}"`);
    return validEmails;

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

    // ✅ FIX: Resolver alias "latest" o "last" a UUID real
    let resolvedEmailId = emailId;
    if (emailId === 'latest' || emailId === 'last') {
      console.log('[EMAIL TOOLS] 🔍 Resolviendo alias "latest" a UUID...');
      const { data: latestEmail, error: queryError } = await supabase
        .from('email_messages')
        .select('id')
        .eq('owner_user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (queryError || !latestEmail) {
        console.error('[EMAIL TOOLS] Error resolviendo "latest":', queryError);
        throw new Error('No se encontró ningún correo reciente');
      }
      
      resolvedEmailId = latestEmail.id;
      console.log('[EMAIL TOOLS] ✅ "latest" resuelto a:', resolvedEmailId);
    }

    const { data: message, error } = await supabase
      .from('email_messages')
      .select('*')
      .eq('id', resolvedEmailId)
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

    // 🚨 FIX: Usar message_id real del correo (RFC header), no el ID de DB
    const emailAny = email as any;
    const inReplyTo = emailAny.message_id || emailAny.in_reply_to || undefined;
    
    if (!inReplyTo) {
      console.warn('[EMAIL TOOLS] ⚠️ Email sin message_id, reply sin threading');
    }

    const draft: DraftEmail = {
      to: email.from_address,
      subject: email.subject.startsWith('RE:') ? email.subject : `RE: ${email.subject}`,
      body: responseBody,
      in_reply_to: inReplyTo // 🔥 Ahora usa Message-ID real
    };

    console.log('[EMAIL TOOLS] ✓ Borrador generado con threadId:', inReplyTo);
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
): Promise<{ success: boolean; messageId?: string; error?: string; errorCode?: string; errorDetails?: any }> {
  try {
    console.log('[SEND_EMAIL] 📤 Iniciando envío de correo');
    console.log('[SEND_EMAIL] 📧 To:', draft.to);
    console.log('[SEND_EMAIL] 📝 Subject:', draft.subject);
    console.log('[SEND_EMAIL] 👤 User ID:', userId);

    // Obtener cuenta del usuario con TODOS los campos necesarios
    let query = supabase
      .from('email_accounts')
      .select('id, from_email, provider, status, oauth_access_token, oauth_refresh_token, oauth_token_expiry, smtp_host, smtp_port, smtp_user, smtp_pass_enc')
      .eq('owner_user_id', userId);

    if (accountEmail) {
      query = query.eq('from_email', accountEmail);
    }

    const { data: accounts, error: accountError } = await query;

    if (accountError || !accounts || accounts.length === 0) {
      console.error('[SEND_EMAIL] ❌ No se encontró cuenta configurada');
      return {
        success: false,
        error: 'NO_EMAIL_ACCOUNT_CONFIGURED',
        errorCode: 'NO_ACCOUNT',
        errorDetails: { userId, accountEmail }
      };
    }

    const account = accounts[0];
    console.log('[SEND_EMAIL] ✅ Cuenta encontrada:', account.from_email);
    console.log('[SEND_EMAIL] 🔧 Provider:', account.provider);
    console.log('[SEND_EMAIL] 📊 Status:', account.status);

    // 🚨 DIAGNÓSTICO SMTP (MÉTODO REAL DE ENVÍO)
    console.log('[SEND_EMAIL] 🔐 SMTP Configuration:');
    console.log('  - Host:', account.smtp_host || 'NOT_SET');
    console.log('  - Port:', account.smtp_port || 'NOT_SET');
    console.log('  - User:', account.smtp_user || 'NOT_SET');
    console.log('  - Password:', account.smtp_pass_enc ? 'ENCRYPTED_PRESENT' : 'MISSING');
    
    // NOTA: OAuth tokens NO SE USAN para SMTP. Solo para IMAP sync.
    // El envío usa nodemailer con smtp_host, smtp_port, smtp_user, smtp_pass_enc.
    
    if (!account.smtp_host || !account.smtp_port || !account.smtp_pass_enc) {
      console.error('[SEND_EMAIL] ❌ Credenciales SMTP incompletas');
      return {
        success: false,
        error: 'SMTP_CREDENTIALS_INCOMPLETE: Faltan credenciales SMTP (host, port o password). Reconfigura tu cuenta en Email Hub.',
        errorCode: 'SMTP_INCOMPLETE',
        errorDetails: {
          account: account.from_email,
          smtp_host: account.smtp_host || 'missing',
          smtp_port: account.smtp_port || 'missing',
          has_password: !!account.smtp_pass_enc
        }
      };
    }
    
    // Si es Gmail, advertir sobre App Password
    if (account.smtp_host?.includes('gmail.com')) {
      console.log('[SEND_EMAIL] ⚠️ Gmail detectado - debe usar App Password (16 chars)');
      console.log('[SEND_EMAIL] ℹ️ Password normal de Gmail NO funciona desde 2022');
      console.log('[SEND_EMAIL] ℹ️ Generar en: https://myaccount.google.com/apppasswords');
    }

    // Llamar a la API de envío
    console.log('[SEND_EMAIL] 📡 Llamando a /api/mail/send...');
    const response = await axios.post(
      `${API_BASE}/api/mail/send`,
      {
        accountId: account.id,
        from: account.from_email,
        to: draft.to,
        subject: draft.subject,
        text: draft.body,
        inReplyTo: draft.in_reply_to
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId // ← Agregar user ID para bypass interno
        },
        validateStatus: () => true // No lanzar error en 4xx/5xx
      }
    );

    if (response.status === 401) {
      console.error('[SEND_EMAIL] ❌ 401 Unauthorized del API /api/mail/send');
      console.error('[SEND_EMAIL] Response data:', response.data);
      
      // SMTP 401 = Credenciales inválidas (no OAuth)
      let errorMessage = 'SMTP_AUTH_FAILED: Las credenciales SMTP son inválidas.';
      
      if (account.smtp_host?.includes('gmail.com')) {
        errorMessage += '\n\n⚠️ Gmail requiere App Password (NO password normal).\nGenera uno en: https://myaccount.google.com/apppasswords';
      } else {
        errorMessage += '\n\nVerifica usuario y password SMTP en Configuración → Email Hub.';
      }
      
      return {
        success: false,
        error: errorMessage,
        errorCode: 'SMTP_AUTH_FAILED',
        errorDetails: {
          status: 401,
          smtp_host: account.smtp_host,
          smtp_user: account.smtp_user,
          responseData: response.data,
          account: account.from_email
        }
      };
    }

    if (response.status >= 400) {
      console.error('[SEND_EMAIL] ❌ Error del API:', response.status);
      console.error('[SEND_EMAIL] Response data:', response.data);
      
      return {
        success: false,
        error: `EMAIL_SEND_FAILED: ${response.data?.message || 'Error desconocido'}`,
        errorCode: 'API_ERROR',
        errorDetails: {
          status: response.status,
          responseData: response.data
        }
      };
    }

    console.log('[SEND_EMAIL] ✅ Correo enviado exitosamente');
    console.log('[SEND_EMAIL] 📬 Message ID:', response.data.messageId);
    
    return {
      success: true,
      messageId: response.data.messageId
    };

  } catch (error: any) {
    console.error('[SEND_EMAIL] ❌ Exception capturada:', error.message);
    console.error('[SEND_EMAIL] Stack:', error.stack);
    
    return {
      success: false,
      error: `SEND_EMAIL_EXCEPTION: ${error.message}`,
      errorCode: 'EXCEPTION',
      errorDetails: {
        message: error.message,
        stack: error.stack
      }
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
