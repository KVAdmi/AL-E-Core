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
  
  // DEBUG: Verificar contenido de tokens
  console.log(`[GMAIL] 🔍 Token details - has access_token: ${!!tokenData.access_token}, has refresh_token: ${!!tokenData.refresh_token}, expires_at: ${tokenData.expires_at || 'N/A'}`);
  
  // CRÍTICO: Verificar que access_token NO esté NULL o vacío
  if (!tokenData.access_token || tokenData.access_token.trim() === '') {
    console.log(`[GMAIL] ❌ CRITICAL: access_token is NULL or empty - Integration record exists but tokens are missing`);
    throw new Error('OAUTH_TOKENS_MISSING');
  }
  
  if (!tokenData.refresh_token || tokenData.refresh_token.trim() === '') {
    console.log(`[GMAIL] ⚠️ WARNING: refresh_token is NULL or empty`);
  }
  
  // Verificar si el token expiró (expires_at es timestamp de Supabase)
  if (tokenData.expires_at) {
    const expiresAtDate = new Date(tokenData.expires_at);
    const now = new Date();
    
    if (expiresAtDate < now) {
      console.log(`[GMAIL] ⚠️ Token expired at ${tokenData.expires_at} - Refreshing...`);
      
      // 🔄 REFRESH TOKEN IMPLEMENTATION
      if (!tokenData.refresh_token) {
        console.log(`[GMAIL] ❌ No refresh_token available`);
        throw new Error('OAUTH_TOKEN_EXPIRED');
      }
      
      try {
        // Crear cliente OAuth2 temporal para refresh
        const tempOAuth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        
        tempOAuth2Client.setCredentials({
          refresh_token: tokenData.refresh_token
        });
        
        // Refresh automático (googleapis lo hace internamente)
        const { credentials } = await tempOAuth2Client.refreshAccessToken();
        
        console.log(`[GMAIL] ✅ Token refreshed successfully`);
        
        // Actualizar en BD
        const newExpiresAt = new Date(Date.now() + (credentials.expiry_date || 3600000));
        
        await supabase
          .from('user_integrations')
          .update({
            access_token: credentials.access_token,
            expires_at: newExpiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('integration_type', tokenData.integration_type);
        
        // Actualizar tokens locales
        tokenData.access_token = credentials.access_token!;
        tokenData.expires_at = newExpiresAt.toISOString();
        
      } catch (refreshError: any) {
        console.error(`[GMAIL] ❌ Failed to refresh token:`, refreshError.message);
        throw new Error('OAUTH_TOKEN_EXPIRED');
      }
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
    console.log('[GMAIL] 📧 readGmail - Executing real API call...');
    
    const auth = await getAuthenticatedClient(userId);
    const gmail = google.gmail({ version: 'v1', auth });
    
    // P0 DEBUG: Verificar CUÁL cuenta Gmail está usando este token
    try {
      const profileResponse = await gmail.users.getProfile({ userId: 'me' });
      console.log(`[GMAIL] 🔍 CUENTA GMAIL REAL: ${profileResponse.data.emailAddress}`);
    } catch (profileError) {
      console.log('[GMAIL] ⚠️ No se pudo obtener emailAddress del perfil');
    }
    
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
        const dateRaw = headers.find(h => h.name === 'Date')?.value || '';
        
        // P0 FIX: Convertir fecha a timezone de México (America/Mexico_City)
        let dateFormatted = dateRaw;
        try {
          if (dateRaw) {
            const parsedDate = new Date(dateRaw);
            dateFormatted = parsedDate.toLocaleString('es-MX', {
              timeZone: 'America/Mexico_City',
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit'
            });
          }
        } catch (err) {
          console.log('[GMAIL] ⚠️ Error parsing date, using raw:', dateRaw);
        }
        
        return {
          id: msg.id!,
          from,
          subject,
          snippet: msgData.data.snippet || '',
          date: dateFormatted
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
    console.error('[GMAIL] ❌ Error details:', JSON.stringify(error, null, 2));
    
    // Detectar errores de OAuth específicos de Google
    if (error.message && error.message.includes('No access, refresh token')) {
      return {
        success: false,
        error: 'OAUTH_TOKENS_INVALID',
        message: 'Los tokens de Gmail están vacíos o inválidos. Reconecta tu cuenta en el perfil.'
      };
    }
    
    if (error.message === 'OAUTH_TOKENS_MISSING') {
      return {
        success: false,
        error: 'OAUTH_TOKENS_MISSING',
        message: 'Gmail está "conectado" pero los tokens están vacíos. Desconecta y vuelve a conectar tu cuenta.'
      };
    }
    
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
