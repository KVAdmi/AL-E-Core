/**
 * =====================================================
 * SMTP SERVICE - EMAIL HUB UNIVERSAL
 * =====================================================
 * 
 * Envía correos usando credenciales SMTP de la cuenta del usuario
 * Compatible con Gmail, Outlook, Hostinger, Zoho, etc.
 * 
 * Características:
 * - Soporte TLS/SSL
 * - HTML + texto plano
 * - Adjuntos
 * - Rate limiting
 * =====================================================
 */

import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import { decryptCredential } from '../utils/emailEncryption';

export interface SMTPConfig {
  host: string;
  port: number;
  secure: boolean; // true para 465, false para 587/25
  user: string;
  pass_enc: string; // Password cifrado
}

export interface SMTPTestResult {
  success: boolean;
  error?: string;
  serverResponse?: string;
}

export interface EmailToSend {
  from: {
    email: string;
    name?: string;
  };
  to: Array<{ email: string; name?: string }>;
  cc?: Array<{ email: string; name?: string }>;
  bcc?: Array<{ email: string; name?: string }>;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  replyTo?: string;
  inReplyTo?: string; // Para threading
  references?: string; // Para threading
  attachments?: Array<{
    filename: string;
    content?: Buffer | string;
    path?: string; // Path a archivo local
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Test de conexión SMTP
 */
export async function testSMTPConnection(config: SMTPConfig): Promise<SMTPTestResult> {
  let transporter: Transporter | null = null;
  
  try {
    console.log('[SMTP] 🔌 Probando conexión a', config.host);
    
    // Validar puerto permitido
    const allowedPorts = [25, 465, 587, 2525]; // 2525 es para algunos proveedores alternativos
    if (!allowedPorts.includes(config.port)) {
      throw new Error(`Puerto ${config.port} no permitido. Usa 25, 465, 587 o 2525`);
    }
    
    // Descifrar password
    const password = decryptCredential(config.pass_enc);
    
    // Crear transporter
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure, // true para 465, false para 587/25
      auth: {
        user: config.user,
        pass: password
      },
      connectionTimeout: 15000, // 15 segundos
      greetingTimeout: 10000,
      socketTimeout: 20000
    });
    
    // Verificar conexión
    await transporter.verify();
    
    console.log('[SMTP] ✅ Conexión exitosa');
    
    return {
      success: true,
      serverResponse: 'OK'
    };
  } catch (error: any) {
    console.error('[SMTP] ❌ Error de conexión:', error.message);
    
    let errorMsg = 'Error desconocido';
    
    if (error.message?.includes('Invalid login')) {
      errorMsg = 'SMTP_AUTH_FAILED';
    } else if (error.message?.includes('ETIMEDOUT') || error.message?.includes('timeout')) {
      errorMsg = 'SMTP_CONNECT_TIMEOUT';
    } else if (error.message?.includes('ENOTFOUND')) {
      errorMsg = 'SMTP_HOST_NOT_FOUND';
    } else if (error.message?.includes('ECONNREFUSED')) {
      errorMsg = 'SMTP_CONNECTION_REFUSED';
    } else if (error.message?.includes('self signed certificate')) {
      errorMsg = 'SMTP_SSL_CERTIFICATE_ERROR';
    } else {
      errorMsg = error.message;
    }
    
    return {
      success: false,
      error: errorMsg
    };
  } finally {
    if (transporter) {
      transporter.close();
    }
  }
}

/**
 * Enviar correo usando SMTP
 */
export async function sendEmailViaSMTP(
  config: SMTPConfig,
  email: EmailToSend
): Promise<SendEmailResult> {
  let transporter: Transporter | null = null;
  
  try {
    console.log('[SMTP] 📤 Enviando correo a', email.to.map(t => t.email).join(', '));
    
    // Validaciones básicas
    if (!email.to || email.to.length === 0) {
      throw new Error('Debe especificar al menos un destinatario');
    }
    
    if (!email.subject) {
      throw new Error('El asunto es requerido');
    }
    
    if (!email.bodyText && !email.bodyHtml) {
      throw new Error('Debe incluir bodyText o bodyHtml');
    }
    
    // Descifrar password
    const password = decryptCredential(config.pass_enc);
    
    // Crear transporter
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: password
      },
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000 // Más tiempo para envío
    });
    
    // Formatear direcciones
    const formatAddress = (addr: { email: string; name?: string }) => {
      return addr.name ? `"${addr.name}" <${addr.email}>` : addr.email;
    };
    
    const to = email.to.map(formatAddress).join(', ');
    const cc = email.cc ? email.cc.map(formatAddress).join(', ') : undefined;
    const bcc = email.bcc ? email.bcc.map(formatAddress).join(', ') : undefined;
    const from = formatAddress(email.from);
    
    // Preparar mail options
    const mailOptions: SendMailOptions = {
      from,
      to,
      cc,
      bcc,
      subject: email.subject,
      text: email.bodyText,
      html: email.bodyHtml,
      replyTo: email.replyTo,
      inReplyTo: email.inReplyTo,
      references: email.references,
      attachments: email.attachments
    };
    
    // Enviar
    const info = await transporter.sendMail(mailOptions);
    
    console.log('[SMTP] ✅ Correo enviado, messageId:', info.messageId);
    
    return {
      success: true,
      messageId: info.messageId
    };
  } catch (error: any) {
    console.error('[SMTP] ❌ Error al enviar:', error.message);
    
    let errorMsg = 'Error desconocido';
    
    if (error.message?.includes('Invalid login')) {
      errorMsg = 'SMTP_AUTH_FAILED';
    } else if (error.message?.includes('timeout')) {
      errorMsg = 'SMTP_SEND_TIMEOUT';
    } else if (error.message?.includes('Recipient address rejected')) {
      errorMsg = 'SMTP_INVALID_RECIPIENT';
    } else if (error.message?.includes('Message size exceeds')) {
      errorMsg = 'SMTP_MESSAGE_TOO_LARGE';
    } else if (error.message?.includes('Daily sending quota exceeded')) {
      errorMsg = 'SMTP_QUOTA_EXCEEDED';
    } else {
      errorMsg = error.message;
    }
    
    return {
      success: false,
      error: errorMsg
    };
  } finally {
    if (transporter) {
      transporter.close();
    }
  }
}

/**
 * Validar dirección de email
 */
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Sanitizar asunto (remover caracteres peligrosos)
 */
export function sanitizeSubject(subject: string): string {
  return subject
    .replace(/[\r\n]/g, ' ') // Remover saltos de línea
    .replace(/\s+/g, ' ') // Normalizar espacios
    .trim()
    .substring(0, 500); // Limitar longitud
}

/**
 * Generar preview de texto plano desde HTML
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>.*?<\/style>/gi, '') // Remover CSS
    .replace(/<script[^>]*>.*?<\/script>/gi, '') // Remover JS
    .replace(/<[^>]+>/g, '') // Remover tags HTML
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ') // Normalizar espacios
    .trim();
}

/**
 * Rate limiter simple (en memoria)
 * Para producción, usar Redis
 */
const sendRateLimits = new Map<string, { count: number; resetAt: number }>();

export function checkSendRateLimit(accountId: string, maxPerMinute: number = 10): boolean {
  const now = Date.now();
  const key = `send:${accountId}`;
  
  const limit = sendRateLimits.get(key);
  
  if (!limit || now > limit.resetAt) {
    // Reset o primera vez
    sendRateLimits.set(key, {
      count: 1,
      resetAt: now + 60000 // 1 minuto
    });
    return true;
  }
  
  if (limit.count >= maxPerMinute) {
    return false; // Rate limit excedido
  }
  
  limit.count++;
  return true;
}

/**
 * Limpiar rate limits expirados (ejecutar periódicamente)
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  
  for (const [key, limit] of sendRateLimits.entries()) {
    if (now > limit.resetAt) {
      sendRateLimits.delete(key);
    }
  }
}
