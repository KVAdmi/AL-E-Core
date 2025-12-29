/**
 * =====================================================
 * ENCRYPTION SERVICE - AL-E CORE
 * =====================================================
 * 
 * Encriptación AES-256-GCM para credenciales sensibles
 * - Passwords SMTP/IMAP
 * - Tokens de Telegram
 * - Cualquier dato sensible en DB
 * 
 * CRÍTICO: ENCRYPTION_KEY debe estar en .env (32 bytes en hex)
 * =====================================================
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // AES block size
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 64;

/**
 * Obtener clave de encriptación desde ENV
 * Si no existe, genera una y la muestra (solo dev)
 */
function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    console.error('\n⚠️  ENCRYPTION_KEY no está definida en .env');
    console.error('Genera una nueva clave con:');
    console.error('  node -e "console.log(crypto.randomBytes(32).toString(\'hex\'))"');
    console.error('\nLuego agrégala a .env:');
    console.error('  ENCRYPTION_KEY=<tu_clave_aqui>\n');
    
    throw new Error('ENCRYPTION_KEY no definida en .env');
  }
  
  // Convertir de hex a buffer
  return Buffer.from(key, 'hex');
}

/**
 * Encriptar un string
 * 
 * Formato de salida: iv:authTag:encryptedData (todo en hex)
 * 
 * @param plaintext Texto plano a encriptar
 * @returns String encriptado en formato "iv:authTag:data"
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    throw new Error('No se puede encriptar un string vacío');
  }
  
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Formato: iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Desencriptar un string
 * 
 * @param encryptedText String en formato "iv:authTag:data"
 * @returns Texto plano desencriptado
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) {
    throw new Error('No se puede desencriptar un string vacío');
  }
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de encriptación inválido (debe ser iv:authTag:data)');
  }
  
  const [ivHex, authTagHex, encryptedData] = parts;
  
  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generar una nueva clave de encriptación (solo para setup)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generar un secret aleatorio (para webhooks, tokens, etc)
 */
export function generateSecret(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}
