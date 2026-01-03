/**
 * =====================================================
 * EMAIL ENCRYPTION SERVICE - AES-256-GCM
 * =====================================================
 * 
 * Cifrado seguro de credenciales IMAP/SMTP
 * 
 * NUNCA guardar passwords en claro en DB
 * Usa EMAIL_CRED_ENC_KEY de ENV (32 bytes)
 * =====================================================
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64;

/**
 * Obtener clave de cifrado desde ENV
 * Debe ser de 32 bytes (64 caracteres hex)
 */
function getEncryptionKey(): Buffer {
  const key = process.env.EMAIL_CRED_ENC_KEY;
  
  if (!key) {
    throw new Error('EMAIL_CRED_ENC_KEY no configurado en ENV');
  }
  
  if (key.length !== 64) {
    throw new Error('EMAIL_CRED_ENC_KEY debe ser 64 caracteres hex (32 bytes)');
  }
  
  return Buffer.from(key, 'hex');
}

/**
 * Cifrar texto plano con AES-256-GCM
 * 
 * @param plaintext - Texto a cifrar (ej: password SMTP)
 * @returns String base64 en formato: iv:authTag:encrypted
 */
export function encryptCredential(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Formato: iv:authTag:encrypted (todo en hex)
    const combined = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    
    // Retornar en base64 para almacenamiento
    return Buffer.from(combined).toString('base64');
  } catch (error: any) {
    console.error('[ENCRYPT] ❌ Error al cifrar:', error.message);
    throw new Error('Error al cifrar credencial');
  }
}

/**
 * Descifrar texto cifrado con AES-256-GCM
 * 
 * @param encryptedB64 - String base64 en formato: iv:authTag:encrypted
 * @returns Texto plano (password original)
 */
export function decryptCredential(encryptedB64: string): string {
  try {
    const key = getEncryptionKey();
    
    // Decodificar de base64
    const combined = Buffer.from(encryptedB64, 'base64').toString('utf8');
    
    // Separar componentes
    const parts = combined.split(':');
    if (parts.length !== 3) {
      throw new Error('Formato de credencial cifrada inválido');
    }
    
    const [ivHex, authTagHex, encryptedHex] = parts;
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error: any) {
    console.error('[DECRYPT] ❌ Error al descifrar:', error.message);
    throw new Error('Error al descifrar credencial');
  }
}

/**
 * Generar nueva clave de cifrado (para setup inicial)
 * Ejecutar una vez y guardar en ENV
 */
export function generateEncryptionKey(): string {
  const key = crypto.randomBytes(32); // 256 bits
  return key.toString('hex'); // 64 caracteres hex
}

/**
 * Validar que la clave de cifrado esté configurada correctamente
 */
export function validateEncryptionKey(): boolean {
  try {
    const key = process.env.EMAIL_CRED_ENC_KEY;
    
    if (!key || key.length !== 64) {
      return false;
    }
    
    // Test de cifrado/descifrado
    const test = 'test-password-123';
    const encrypted = encryptCredential(test);
    const decrypted = decryptCredential(encrypted);
    
    return test === decrypted;
  } catch {
    return false;
  }
}
