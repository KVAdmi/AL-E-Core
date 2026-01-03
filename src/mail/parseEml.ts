/**
 * EMAIL PARSER
 * Parsea archivos .eml usando mailparser
 */

import { simpleParser, ParsedMail, AddressObject } from 'mailparser';

export interface ParsedEmail {
  messageId: string;
  from: { email: string; name?: string };
  to: { email: string; name?: string }[];
  cc: { email: string; name?: string }[];
  bcc: { email: string; name?: string }[];
  replyTo?: string;
  subject: string;
  date: Date;
  textBody: string;
  htmlBody: string;
  snippet: string;
  headers: Record<string, any>;
  attachments: ParsedAttachment[];
  inReplyTo?: string;
  references?: string[];
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
  isInline: boolean;
  content: Buffer;
}

/**
 * Parsea un archivo .eml desde Buffer
 */
export async function parseEmail(emlBuffer: Buffer): Promise<ParsedEmail> {
  const parsed: ParsedMail = await simpleParser(emlBuffer);

  // Extraer from
  const from = extractFirstAddress(parsed.from);
  if (!from) {
    throw new Error('Email sin remitente (from) válido');
  }

  // Extraer to
  const to = extractAddresses(parsed.to);
  if (to.length === 0) {
    throw new Error('Email sin destinatarios (to) válidos');
  }

  // Extraer cc y bcc
  const cc = extractAddresses(parsed.cc);
  const bcc = extractAddresses(parsed.bcc);

  // Reply-To
  const replyTo = parsed.replyTo ? extractFirstAddress(parsed.replyTo)?.email : undefined;

  // Subject
  const subject = parsed.subject || '(Sin asunto)';

  // Date
  const date = parsed.date || new Date();

  // Body
  const textBody = parsed.text || '';
  const htmlBody = parsed.html || '';

  // Snippet (primeros 200 caracteres del texto)
  const snippet = textBody.substring(0, 200).replace(/\n/g, ' ').trim();

  // Headers
  const headers: Record<string, any> = {};
  if (parsed.headers) {
    for (const [key, value] of parsed.headers) {
      headers[key] = value;
    }
  }

  // Message-ID
  const messageId = parsed.messageId || headers['message-id'] || `<generated-${Date.now()}@al-eon.com>`;

  // In-Reply-To
  const inReplyTo = parsed.inReplyTo || headers['in-reply-to'];

  // References
  const references = parsed.references || (headers['references'] ? headers['references'].split(/\s+/) : []);

  // Attachments
  const attachments: ParsedAttachment[] = [];
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      attachments.push({
        filename: att.filename || 'unknown',
        contentType: att.contentType || 'application/octet-stream',
        size: att.size || 0,
        contentId: att.cid,
        isInline: !!att.cid,
        content: att.content
      });
    }
  }

  return {
    messageId,
    from,
    to,
    cc,
    bcc,
    replyTo,
    subject,
    date,
    textBody,
    htmlBody,
    snippet,
    headers,
    attachments,
    inReplyTo,
    references
  };
}

/**
 * Extrae el primer email de un AddressObject
 */
function extractFirstAddress(addressObj: AddressObject | AddressObject[] | undefined): { email: string; name?: string } | null {
  if (!addressObj) return null;

  const addresses = Array.isArray(addressObj) ? addressObj : [addressObj];
  
  for (const addr of addresses) {
    if (addr.value && addr.value.length > 0) {
      const first = addr.value[0];
      return {
        email: first.address || '',
        name: first.name || undefined
      };
    }
  }

  return null;
}

/**
 * Extrae todos los emails de un AddressObject
 */
function extractAddresses(addressObj: AddressObject | AddressObject[] | undefined): { email: string; name?: string }[] {
  if (!addressObj) return [];

  const addresses = Array.isArray(addressObj) ? addressObj : [addressObj];
  const result: { email: string; name?: string }[] = [];

  for (const addr of addresses) {
    if (addr.value && addr.value.length > 0) {
      for (const val of addr.value) {
        if (val.address) {
          result.push({
            email: val.address,
            name: val.name || undefined
          });
        }
      }
    }
  }

  return result;
}
