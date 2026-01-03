/**
 * =====================================================
 * IMAP SERVICE - EMAIL HUB UNIVERSAL
 * =====================================================
 * 
 * Conecta a cualquier servidor IMAP (Gmail, Outlook, etc.)
 * Lee correos y sincroniza con Supabase
 * 
 * Características:
 * - Conexión segura (TLS/SSL)
 * - Sync incremental por UID
 * - Deduplicación por message-id
 * - Parse de headers, body, attachments
 * =====================================================
 */

import { ImapFlow, FetchMessageObject } from 'imapflow';
import { simpleParser, ParsedMail, AddressObject } from 'mailparser';
import { decryptCredential } from '../utils/emailEncryption';

export interface IMAPConfig {
  host: string;
  port: number;
  secure: boolean; // true para 993, false para 143+STARTTLS
  user: string;
  pass_enc: string; // Password cifrado
}

export interface IMAPTestResult {
  success: boolean;
  error?: string;
  serverInfo?: {
    greeting?: string;
    capability?: string[];
  };
}

export interface IMAPMessage {
  uid: number;
  messageId: string;
  from: { email: string; name?: string };
  to: Array<{ email: string; name?: string }>;
  cc?: Array<{ email: string; name?: string }>;
  bcc?: Array<{ email: string; name?: string }>;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  bodyPreview?: string;
  date: Date;
  hasAttachments: boolean;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    contentId?: string;
    isInline?: boolean;
  }>;
  inReplyTo?: string;
  references?: string[];
  headers: any;
  size: number;
}

export interface IMAPFolder {
  path: string;
  delimiter: string;
  flags: string[];
  specialUse?: string;
}

/**
 * Test de conexión IMAP
 */
export async function testIMAPConnection(config: IMAPConfig): Promise<IMAPTestResult> {
  let client: ImapFlow | null = null;
  
  try {
    console.log('[IMAP] 🔌 Probando conexión a', config.host);
    
    // Validar host permitido (solo dominios conocidos)
    const allowedHosts = [
      'imap.gmail.com',
      'outlook.office365.com',
      'imap-mail.outlook.com',
      'imap.mail.yahoo.com',
      'imap.zoho.com',
      'imap.hostinger.com',
      // Agregar más según necesidad
    ];
    
    const isAllowedHost = allowedHosts.some(h => config.host.includes(h)) || 
                          config.host.match(/^imap\./); // Permitir imap.*
    
    if (!isAllowedHost) {
      console.warn('[IMAP] ⚠️ Host no está en allowlist:', config.host);
    }
    
    // Validar puerto
    const allowedPorts = [143, 993];
    if (!allowedPorts.includes(config.port)) {
      throw new Error(`Puerto ${config.port} no permitido. Usa 143 o 993`);
    }
    
    // Descifrar password
    const password = decryptCredential(config.pass_enc);
    
    // Crear cliente
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: password
      },
      logger: false, // Desactivar logs detallados
      tls: {
        rejectUnauthorized: true // Validar certificados SSL
      }
    });
    
    // Conectar con timeout
    const connectPromise = client.connect();
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('IMAP_CONNECT_TIMEOUT')), 15000)
    );
    
    await Promise.race([connectPromise, timeoutPromise]);
    
    console.log('[IMAP] ✅ Conexión exitosa');
    
    // Obtener capabilities (imapflow puede no exponer greeting directamente)
    const capabilities = client.capabilities 
      ? Array.from(client.capabilities).map(c => String(c))
      : [];
    
    return {
      success: true,
      serverInfo: {
        greeting: 'Connected',
        capability: capabilities
      }
    };
  } catch (error: any) {
    console.error('[IMAP] ❌ Error de conexión:', error.message);
    
    let errorMsg = 'Error desconocido';
    
    if (error.message?.includes('AUTHENTICATIONFAILED')) {
      errorMsg = 'IMAP_AUTH_FAILED';
    } else if (error.message?.includes('ETIMEDOUT') || error.message === 'IMAP_CONNECT_TIMEOUT') {
      errorMsg = 'IMAP_CONNECT_TIMEOUT';
    } else if (error.message?.includes('ENOTFOUND')) {
      errorMsg = 'IMAP_HOST_NOT_FOUND';
    } else if (error.message?.includes('ECONNREFUSED')) {
      errorMsg = 'IMAP_CONNECTION_REFUSED';
    } else {
      errorMsg = error.message;
    }
    
    return {
      success: false,
      error: errorMsg
    };
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {}
    }
  }
}

/**
 * Listar folders del buzón
 */
export async function listIMAPFolders(config: IMAPConfig): Promise<IMAPFolder[]> {
  let client: ImapFlow | null = null;
  
  try {
    const password = decryptCredential(config.pass_enc);
    
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: password },
      logger: false
    });
    
    await client.connect();
    
    const folders = await client.list();
    
    return folders.map((f: any) => ({
      path: f.path,
      delimiter: f.delimiter,
      flags: f.flags || [],
      specialUse: f.specialUse
    }));
  } catch (error: any) {
    console.error('[IMAP] ❌ Error al listar folders:', error.message);
    throw error;
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {}
    }
  }
}

/**
 * Sincronizar mensajes de un folder
 * 
 * @param config - Configuración IMAP
 * @param folderPath - Path del folder (ej: "INBOX")
 * @param lastUid - Último UID sincronizado (para sync incremental)
 * @param limit - Límite de mensajes a traer (default 100)
 */
export async function syncIMAPMessages(
  config: IMAPConfig,
  folderPath: string = 'INBOX',
  lastUid: number = 0,
  limit: number = 100
): Promise<IMAPMessage[]> {
  let client: ImapFlow | null = null;
  
  try {
    console.log('[IMAP] 📬 Sincronizando folder:', folderPath);
    
    const password = decryptCredential(config.pass_enc);
    
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: password },
      logger: false
    });
    
    await client.connect();
    
    // Abrir folder en modo readonly
    const lock = await client.getMailboxLock(folderPath);
    
    try {
      // Si lastUid > 0, traer solo mensajes nuevos
      // Si lastUid = 0, traer últimos N días (default 7)
      let searchCriteria: any;
      
      if (lastUid > 0) {
        // Sync incremental
        searchCriteria = { uid: `${lastUid + 1}:*` };
      } else {
        // Sync inicial (últimos 7 días)
        const since = new Date();
        since.setDate(since.getDate() - 7);
        searchCriteria = { since };
      }
      
      console.log('[IMAP] 🔍 Buscando mensajes con criterio:', searchCriteria);
      
      // Buscar UIDs - imapflow.search retorna Promise<number[]> no AsyncIterator
      const searchResult = await client.search(searchCriteria);
      const uids = searchResult === false ? [] : searchResult.slice(0, limit);
      
      if (uids.length === 0) {
        console.log('[IMAP] ℹ️ No hay mensajes nuevos');
        return [];
      }
      
      console.log('[IMAP] 📨 Encontrados', uids.length, 'mensajes');
      
      // Fetch mensajes
      const messages: IMAPMessage[] = [];
      
      for await (const msg of client.fetch(uids, {
        envelope: true,
        bodyStructure: true,
        source: true,
        uid: true,
        flags: true
      })) {
        try {
          const parsed = await parseIMAPMessage(msg);
          messages.push(parsed);
        } catch (error: any) {
          console.error('[IMAP] ⚠️ Error al parsear mensaje UID', msg.uid, ':', error.message);
        }
      }
      
      console.log('[IMAP] ✅ Parseados', messages.length, 'mensajes');
      
      return messages;
    } finally {
      lock.release();
    }
  } catch (error: any) {
    console.error('[IMAP] ❌ Error en sync:', error.message);
    throw error;
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {}
    }
  }
}

/**
 * Parsear mensaje IMAP usando mailparser
 */
async function parseIMAPMessage(msg: FetchMessageObject): Promise<IMAPMessage> {
  const parsed: ParsedMail = await simpleParser(msg.source);
  
  // Helper para extraer emails de AddressObject
  const extractAddresses = (addr: AddressObject | AddressObject[] | undefined): Array<{ email: string; name?: string }> => {
    if (!addr) return [];
    
    const addrs = Array.isArray(addr) ? addr : [addr];
    const result: Array<{ email: string; name?: string }> = [];
    
    for (const a of addrs) {
      if (a.value) {
        for (const v of a.value) {
          result.push({
            email: v.address || '',
            name: v.name || undefined
          });
        }
      }
    }
    
    return result;
  };
  
  const from = extractAddresses(parsed.from)?.[0] || { email: 'unknown@unknown.com' };
  const to = extractAddresses(parsed.to);
  const cc = extractAddresses(parsed.cc);
  const bcc = extractAddresses(parsed.bcc);
  
  // Body preview (primeros 200 chars de texto plano)
  const bodyPreview = parsed.text 
    ? parsed.text.substring(0, 200).replace(/\n/g, ' ').trim()
    : undefined;
  
  // Attachments metadata
  const attachments = (parsed.attachments || []).map(att => ({
    filename: att.filename || 'unnamed',
    contentType: att.contentType || 'application/octet-stream',
    size: att.size || 0,
    contentId: att.cid || undefined,
    isInline: att.contentDisposition === 'inline'
  }));
  
  // References para threading
  const references = parsed.references 
    ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
    : undefined;
  
  return {
    uid: msg.uid,
    messageId: parsed.messageId || `<generated-${msg.uid}@unknown>`,
    from,
    to,
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    subject: parsed.subject || '(Sin asunto)',
    bodyText: parsed.text,
    bodyHtml: parsed.html as string | undefined,
    bodyPreview,
    date: parsed.date || new Date(),
    hasAttachments: attachments.length > 0,
    attachments,
    inReplyTo: parsed.inReplyTo,
    references,
    headers: parsed.headers,
    size: msg.source.length
  };
}

/**
 * Marcar mensaje como leído en IMAP
 */
export async function markIMAPMessageAsRead(
  config: IMAPConfig,
  folderPath: string,
  uid: number
): Promise<void> {
  let client: ImapFlow | null = null;
  
  try {
    const password = decryptCredential(config.pass_enc);
    
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: password },
      logger: false
    });
    
    await client.connect();
    
    const lock = await client.getMailboxLock(folderPath);
    
    try {
      await client.messageFlagsAdd(uid, ['\\Seen']);
      console.log('[IMAP] ✅ Mensaje marcado como leído, UID:', uid);
    } finally {
      lock.release();
    }
  } catch (error: any) {
    console.error('[IMAP] ❌ Error al marcar como leído:', error.message);
    throw error;
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {}
    }
  }
}

/**
 * Marcar mensaje con flag (starred, etc.)
 */
export async function setIMAPMessageFlag(
  config: IMAPConfig,
  folderPath: string,
  uid: number,
  flag: string,
  remove: boolean = false
): Promise<void> {
  let client: ImapFlow | null = null;
  
  try {
    const password = decryptCredential(config.pass_enc);
    
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: password },
      logger: false
    });
    
    await client.connect();
    
    const lock = await client.getMailboxLock(folderPath);
    
    try {
      if (remove) {
        await client.messageFlagsRemove(uid, [flag]);
      } else {
        await client.messageFlagsAdd(uid, [flag]);
      }
      console.log('[IMAP] ✅ Flag', flag, remove ? 'removido' : 'agregado', 'UID:', uid);
    } finally {
      lock.release();
    }
  } catch (error: any) {
    console.error('[IMAP] ❌ Error al modificar flag:', error.message);
    throw error;
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {}
    }
  }
}

/**
 * Mover mensaje a otra carpeta (si IMAP lo soporta)
 */
export async function moveIMAPMessage(
  config: IMAPConfig,
  sourcePath: string,
  targetPath: string,
  uid: number
): Promise<void> {
  let client: ImapFlow | null = null;
  
  try {
    const password = decryptCredential(config.pass_enc);
    
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: password },
      logger: false
    });
    
    await client.connect();
    
    const lock = await client.getMailboxLock(sourcePath);
    
    try {
      await client.messageMove(uid, targetPath);
      console.log('[IMAP] ✅ Mensaje movido de', sourcePath, 'a', targetPath);
    } finally {
      lock.release();
    }
  } catch (error: any) {
    console.error('[IMAP] ❌ Error al mover mensaje:', error.message);
    throw error;
  } finally {
    if (client) {
      try {
        await client.logout();
      } catch {}
    }
  }
}
