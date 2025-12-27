/**
 * Gmail Service
 * 
 * EJECUCIÓN REAL de Gmail API (NO stub)
 * CRÍTICO: Si el usuario tiene Gmail conectado, EJECUTAR sin preguntar
 */

import { google } from 'googleapis';
import { getSupabaseClient } from '../db/supabase';

export interface GmailReadResult {
  success: boolean;
  error?: string;
  message: string;
  emails?: Array<{
    id: string;
    from: string;
    subject: string;
    snippet: string;
    date: string;
  }>;
}

export interface GmailSendResult {
  success: boolean;
  error?: string;
  message: string;
  sent_id?: string;
}

/**
 * Obtener cliente OAuth2 autenticado del usuario
 */
async function getAuthenticatedClient(userId: string) {
  const supabase = getSupabaseClient();
  
  console.log(`[GMAIL] 🔍 Looking for OAuth tokens - userId: ${userId}, userId type: ${typeof userId}`);
  
  // Primero: verificar si la tabla user_integrations existe y tiene datos
  const { data: allIntegrations, error: countError } = await supabase
    .from('user_integrations')
    .select('user_id, integration_type')
    .limit(5);
  
  console.log(`[GMAIL] 🔍 Sample integrations in DB: ${allIntegrations?.length || 0} rows, error: ${countError?.message || 'none'}`);
  if (allIntegrations && allIntegrations.length > 0) {
    console.log(`[GMAIL] 🔍 Sample row:`, JSON.stringify(allIntegrations[0]));
  }
  
  // Obtener tokens de Supabase (tabla: user_integrations según schema)
  const { data: tokenData, error } = await supabase
    .from('user_integrations')
    .select('access_token, refresh_token, expires_at, integration_type')
    .eq('user_id', userId)
    .or('integration_type.eq.gmail,integration_type.eq.google,integration_type.eq.google-gmail')
    .maybeSingle(); // Usar maybeSingle() en vez de single() para evitar error si no existe
  
  console.log(`[GMAIL] 🔍 Query result - found: ${!!tokenData}, integration_type: ${tokenData?.integration_type || 'N/A'}, error: ${error?.message || 'none'}, error code: ${error?.code || 'N/A'}`);
  
  if (error || !tokenData) {
    console.log(`[GMAIL] ❌ OAuth tokens not found for user: ${userId}`);
    throw new Error('OAUTH_NOT_CONNECTED');
  }
  
  console.log(`[GMAIL] ✅ OAuth tokens found for user: ${userId}`);
  
  // Verificar si el token expiró (expires_at es timestamp de Supabase)
  if (tokenData.expires_at) {
    const expiresAtDate = new Date(tokenData.expires_at);
    const now = new Date();
    
    if (expiresAtDate < now) {
      console.log(`[GMAIL] ⚠️ Token expired at ${tokenData.expires_at}`);
      // TODO: Implementar refresh token
      throw new Error('OAUTH_TOKEN_EXPIRED');
    }
  }
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  oauth2Client.setCredentials({
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token
  });
  
  return oauth2Client;
}

/**
 * Leer correos del usuario
 * 
 * EJECUCIÓN REAL - NO preguntar, EJECUTAR
 */
export async function readGmail(
  userId: string, 
  query?: string,
  maxResults: number = 10
): Promise<GmailReadResult> {
  try {
    console.log('[GMAIL] � readGmail - Executing real API call...');
    
    const auth = await getAuthenticatedClient(userId);
    const gmail = google.gmail({ version: 'v1', auth });
    
    // Construir query
    let searchQuery = 'is:unread'; // Default: no leídos
    if (query) {
      searchQuery += ` ${query}`;
    }
    
    // Obtener lista de mensajes
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: searchQuery,
      maxResults
    });
    
    if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
      return {
        success: true,
        message: `No hay correos nuevos${query ? ` relacionados con "${query}"` : ''}.`,
        emails: []
      };
    }
    
    // Obtener detalles de cada mensaje
    const emails = await Promise.all(
      listResponse.data.messages.slice(0, 5).map(async (msg) => {
        const msgData = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id!,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });
        
        const headers = msgData.data.payload?.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || 'Desconocido';
        const subject = headers.find(h => h.name === 'Subject')?.value || '(sin asunto)';
        const date = headers.find(h => h.name === 'Date')?.value || '';
        
        return {
          id: msg.id!,
          from,
          subject,
          snippet: msgData.data.snippet || '',
          date
        };
      })
    );
    
    console.log(`[GMAIL] ✅ Found ${emails.length} emails`);
    
    return {
      success: true,
      message: `Encontré ${emails.length} correo${emails.length > 1 ? 's' : ''} nuevo${emails.length > 1 ? 's' : ''}.`,
      emails
    };
    
  } catch (error: any) {
    console.error('[GMAIL] ❌ Error:', error.message);
    
    if (error.message === 'OAUTH_NOT_CONNECTED') {
      return {
        success: false,
        error: 'OAUTH_NOT_CONNECTED',
        message: 'No tienes Gmail conectado. Necesitas autorizar AL-E en tu perfil primero.'
      };
    }
    
    if (error.message === 'OAUTH_TOKEN_EXPIRED') {
      return {
        success: false,
        error: 'OAUTH_TOKEN_EXPIRED',
        message: 'Tu sesión de Gmail expiró. Por favor, reconecta tu cuenta en el perfil.'
      };
    }
    
    return {
      success: false,
      error: 'GMAIL_API_ERROR',
      message: `Error al leer correos: ${error.message}`
    };
  }
}

/**
 * Enviar correo
 * 
 * EJECUCIÓN REAL - NO preguntar, EJECUTAR
 */
export async function sendGmail(
  userId: string,
  to: string,
  subject: string,
  body: string
): Promise<GmailSendResult> {
  try {
    console.log('[GMAIL] � sendGmail - Executing real API call...');
    
    const auth = await getAuthenticatedClient(userId);
    const gmail = google.gmail({ version: 'v1', auth });
    
    // Crear mensaje en formato RFC 2822
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      '',
      body
    ];
    const message = messageParts.join('\n');
    
    // Codificar en base64
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    
    // Enviar
    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });
    
    console.log(`[GMAIL] ✅ Sent email - ID: ${response.data.id}`);
    
    return {
      success: true,
      message: `Correo enviado a ${to}.`,
      sent_id: response.data.id
    };
    
  } catch (error: any) {
    console.error('[GMAIL] ❌ Error:', error.message);
    
    if (error.message === 'OAUTH_NOT_CONNECTED') {
      return {
        success: false,
        error: 'OAUTH_NOT_CONNECTED',
        message: 'No tienes Gmail conectado. Necesitas autorizar AL-E en tu perfil primero.'
      };
    }
    
    return {
      success: false,
      error: 'GMAIL_SEND_ERROR',
      message: `Error al enviar correo: ${error.message}`
    };
  }
}
