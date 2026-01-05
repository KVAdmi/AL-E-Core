/**
 * =====================================================
 * SES VALIDATION & PROTECTION
 * =====================================================
 * 
 * CONTEXTO CRÍTICO:
 * Amazon SES está "under review" por bounce rate 12.72%.
 * Este módulo protege la cuenta implementando:
 * 
 * 1. Whitelist de tipos de correo (SOLO transaccionales)
 * 2. Blacklist de dominios de prueba
 * 3. Validación de formato de email
 * 4. Lista de supresión local
 * 5. Prevención de envíos duplicados
 * 
 * OBJETIVO: Mantener bounce rate <5%
 * =====================================================
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

/**
 * Tipos de correo PERMITIDOS para SES
 * SOLO correos transaccionales del sistema
 */
const ALLOWED_EMAIL_TYPES = [
  'password_reset',
  'email_verification',
  'onboarding_welcome',
  'account_created',
  'system_notification',
  'account_alert',
  'security_alert',
  'two_factor_auth',
  'subscription_confirmation',
  'payment_receipt'
] as const;

type AllowedEmailType = typeof ALLOWED_EMAIL_TYPES[number];

/**
 * Dominios PROHIBIDOS (testing/fake)
 * NO enviar a estos dominios via SES
 */
const BLACKLISTED_DOMAINS = [
  'test.com',
  'example.com',
  'fake.com',
  'testing.com',
  'demo.com',
  'localhost',
  'invalid.com',
  'sample.com',
  'dummy.com'
];

/**
 * Simulador de SES para testing
 * USAR ESTOS EMAILS para pruebas técnicas
 */
export const SES_SIMULATOR = {
  SUCCESS: 'success@simulator.amazonses.com',
  BOUNCE: 'bounce@simulator.amazonses.com',
  COMPLAINT: 'complaint@simulator.amazonses.com',
  SUPPRESSION: 'suppressionlist@simulator.amazonses.com'
};

// ═══════════════════════════════════════════════════════════════
// LISTA DE SUPRESIÓN LOCAL
// ═══════════════════════════════════════════════════════════════

/**
 * Lista de supresión en memoria
 * Complementa la Account-level Suppression List de AWS
 */
const localSuppressionList = new Set<string>();

/**
 * Agregar email a lista de supresión local
 */
export function addToSuppressionList(email: string, reason: 'bounce' | 'complaint' | 'invalid') {
  const normalized = email.toLowerCase().trim();
  localSuppressionList.add(normalized);
  
  console.log('[SES SUPPRESSION] Email agregado:', {
    email: normalized,
    reason,
    timestamp: new Date().toISOString()
  });
}

/**
 * Verificar si email está en lista de supresión
 */
export function isInSuppressionList(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  return localSuppressionList.has(normalized);
}

/**
 * Obtener tamaño de lista de supresión
 */
export function getSuppressionListSize(): number {
  return localSuppressionList.size;
}

/**
 * Exportar lista de supresión (para persistencia)
 */
export function exportSuppressionList(): string[] {
  return Array.from(localSuppressionList);
}

/**
 * Importar lista de supresión (desde DB o archivo)
 */
export function importSuppressionList(emails: string[]) {
  emails.forEach(email => {
    localSuppressionList.add(email.toLowerCase().trim());
  });
  console.log('[SES SUPPRESSION] Importados', emails.length, 'emails');
}

// ═══════════════════════════════════════════════════════════════
// VALIDACIÓN DE EMAILS
// ═══════════════════════════════════════════════════════════════

/**
 * Validar formato de email (RFC 5322 simplificado)
 */
export function isValidEmailFormat(email: string): boolean {
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return emailRegex.test(email);
}

/**
 * Extraer dominio de email
 */
function extractDomain(email: string): string | null {
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  return parts[1].toLowerCase();
}

/**
 * Verificar si dominio está en blacklist
 */
function isBlacklistedDomain(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) return true; // Email inválido = blacklisted
  
  return BLACKLISTED_DOMAINS.includes(domain);
}

/**
 * Verificar si es email del simulador de SES
 */
function isSESSimulator(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  return normalized.endsWith('@simulator.amazonses.com');
}

// ═══════════════════════════════════════════════════════════════
// VALIDACIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════

export interface SESValidationResult {
  allowed: boolean;
  reason: string;
  details?: string;
}

/**
 * Validar si un correo puede enviarse via Amazon SES
 * 
 * REGLAS:
 * 1. SOLO tipos de correo en whitelist
 * 2. NO dominios de prueba/fake
 * 3. NO emails en lista de supresión
 * 4. Formato válido de email
 * 5. Simulador de SES SIEMPRE permitido
 * 
 * @param emailType - Tipo de correo (debe estar en ALLOWED_EMAIL_TYPES)
 * @param to - Email destinatario
 * @returns Objeto con allowed=true/false y razón
 */
export function canUseSES(emailType: string, to: string): SESValidationResult {
  const normalizedEmail = to.toLowerCase().trim();
  
  // REGLA 0: Simulador de SES siempre permitido (para testing)
  if (isSESSimulator(normalizedEmail)) {
    console.log('[SES ALLOWED] SES Mailbox Simulator:', normalizedEmail);
    return {
      allowed: true,
      reason: 'SES_SIMULATOR'
    };
  }
  
  // REGLA 1: Validar tipo de correo
  if (!ALLOWED_EMAIL_TYPES.includes(emailType as AllowedEmailType)) {
    console.error('[SES BLOCKED] Tipo de correo no permitido:', {
      emailType,
      to: normalizedEmail,
      allowedTypes: ALLOWED_EMAIL_TYPES
    });
    
    return {
      allowed: false,
      reason: 'INVALID_EMAIL_TYPE',
      details: `Tipo '${emailType}' no permitido. SES solo para correos transaccionales del sistema.`
    };
  }
  
  // REGLA 2: Validar formato
  if (!isValidEmailFormat(normalizedEmail)) {
    console.error('[SES BLOCKED] Formato de email inválido:', normalizedEmail);
    
    return {
      allowed: false,
      reason: 'INVALID_EMAIL_FORMAT',
      details: 'El formato del email no es válido'
    };
  }
  
  // REGLA 3: Verificar dominio blacklisted
  if (isBlacklistedDomain(normalizedEmail)) {
    const domain = extractDomain(normalizedEmail);
    console.error('[SES BLOCKED] Dominio blacklisted:', {
      email: normalizedEmail,
      domain
    });
    
    return {
      allowed: false,
      reason: 'BLACKLISTED_DOMAIN',
      details: `Dominio '${domain}' no permitido para SES. Usar SES Mailbox Simulator para pruebas.`
    };
  }
  
  // REGLA 4: Verificar lista de supresión
  if (isInSuppressionList(normalizedEmail)) {
    console.error('[SES BLOCKED] Email en lista de supresión:', normalizedEmail);
    
    return {
      allowed: false,
      reason: 'EMAIL_SUPPRESSED',
      details: 'Este email está en la lista de supresión (bounce/complaint previo)'
    };
  }
  
  // ✅ TODAS LAS VALIDACIONES PASARON
  console.log('[SES ALLOWED] Email válido para SES:', {
    type: emailType,
    to: normalizedEmail
  });
  
  return {
    allowed: true,
    reason: 'VALIDATED'
  };
}

// ═══════════════════════════════════════════════════════════════
// RATE LIMITING (Prevención de spam/abuso)
// ═══════════════════════════════════════════════════════════════

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Verificar rate limit por email
 * Máximo 5 correos por hora por destinatario
 */
export function checkRateLimit(email: string): boolean {
  const normalized = email.toLowerCase().trim();
  const now = Date.now();
  const hourInMs = 60 * 60 * 1000;
  const maxEmailsPerHour = 5;
  
  const entry = rateLimitMap.get(normalized);
  
  // Primer envío o ventana expirada
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(normalized, {
      count: 1,
      resetAt: now + hourInMs
    });
    return true; // Permitir
  }
  
  // Incrementar contador
  if (entry.count < maxEmailsPerHour) {
    entry.count++;
    return true; // Permitir
  }
  
  // Límite excedido
  console.warn('[SES RATE LIMIT] Límite excedido:', {
    email: normalized,
    count: entry.count,
    resetIn: Math.round((entry.resetAt - now) / 1000 / 60) + ' minutos'
  });
  
  return false; // Bloquear
}

// ═══════════════════════════════════════════════════════════════
// ESTADÍSTICAS Y MONITOREO
// ═══════════════════════════════════════════════════════════════

interface SESStats {
  totalAllowed: number;
  totalBlocked: number;
  blockReasons: Record<string, number>;
  suppressionListSize: number;
  blocked?: number; // Para logBlockedSESAttempt
}

const stats: SESStats = {
  totalAllowed: 0,
  totalBlocked: 0,
  blockReasons: {},
  suppressionListSize: 0,
  blocked: 0
};

/**
 * Registrar resultado de validación
 */
export function recordValidation(result: SESValidationResult) {
  if (result.allowed) {
    stats.totalAllowed++;
  } else {
    stats.totalBlocked++;
    stats.blockReasons[result.reason] = (stats.blockReasons[result.reason] || 0) + 1;
  }
  stats.suppressionListSize = getSuppressionListSize();
}

/**
 * Obtener estadísticas
 */
export function getSESStats(): SESStats {
  return { ...stats };
}

/**
 * Resetear estadísticas
 */
export function resetSESStats() {
  stats.totalAllowed = 0;
  stats.totalBlocked = 0;
  stats.blockReasons = {};
  stats.suppressionListSize = getSuppressionListSize();
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Health check de protecciones SES
 */
export function sesHealthCheck(): {
  healthy: boolean;
  stats: SESStats;
  warnings: string[];
} {
  const warnings: string[] = [];
  
  // Verificar tamaño de lista de supresión
  if (stats.suppressionListSize > 100) {
    warnings.push(`Lista de supresión grande: ${stats.suppressionListSize} emails`);
  }
  
  // Verificar tasa de bloqueo
  const totalRequests = stats.totalAllowed + stats.totalBlocked;
  if (totalRequests > 0) {
    const blockRate = (stats.totalBlocked / totalRequests) * 100;
    if (blockRate > 10) {
      warnings.push(`Tasa de bloqueo alta: ${blockRate.toFixed(1)}%`);
    }
  }
  
  return {
    healthy: warnings.length === 0,
    stats: getSESStats(),
    warnings
  };
}

// ═══════════════════════════════════════════════════════════════
// REGLAS ABSOLUTAS - PROTECCIÓN MÁXIMA SES
// ═══════════════════════════════════════════════════════════════

/**
 * Dominios del sistema permitidos para SES
 * REGLA ABSOLUTA: SES SOLO puede enviar desde estos dominios
 */
const SYSTEM_DOMAINS = ['al-eon.com', 'infinitykode.com'];

/**
 * Valida si un dominio es del sistema
 */
export function isSystemDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase();
  return SYSTEM_DOMAINS.includes(domain);
}

/**
 * REGLA ABSOLUTA: Bloquea cualquier intento de usar SES para correos de usuarios
 * 
 * @param provider - Proveedor de envío (debe ser 'SES' para validar)
 * @param from - Email del remitente
 * @param accountId - ID de cuenta de usuario (si existe, es correo de usuario)
 * @returns {blocked: true, reason: string} si se debe bloquear
 */
export function blockUserEmailsInSES(params: {
  provider: string;
  from: string;
  accountId?: string;
}): { blocked: boolean; reason?: string } {
  const { provider, from, accountId } = params;
  
  // Normalizar provider
  const providerUpper = provider.toUpperCase();
  
  // Si el provider es SES
  if (providerUpper === 'SES' || providerUpper === 'AWS_SES' || providerUpper === 'AMAZON_SES') {
    // REGLA 1: Si hay accountId, es correo de usuario → BLOQUEAR
    if (accountId) {
      return {
        blocked: true,
        reason: 'SES_USER_EMAIL_BLOCKED: SES no puede usarse para correos de usuarios. Usa Gmail OAuth, Outlook OAuth o SMTP del usuario.'
      };
    }
    
    // REGLA 2: Si from no es dominio del sistema → BLOQUEAR
    if (!isSystemDomain(from)) {
      return {
        blocked: true,
        reason: `SES_INVALID_DOMAIN: SES solo acepta correos de: ${SYSTEM_DOMAINS.join(', ')}. From recibido: ${from}`
      };
    }
    
    // REGLA 3: From NO puede ser correo personal conocido
    const personalEmailDomains = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'];
    const fromDomain = from.split('@')[1]?.toLowerCase();
    if (personalEmailDomains.includes(fromDomain)) {
      return {
        blocked: true,
        reason: `SES_PERSONAL_EMAIL: No puedes usar SES con correos personales (${fromDomain}). Usa OAuth o SMTP directo.`
      };
    }
  }
  
  return { blocked: false };
}

/**
 * REGLA ABSOLUTA: Valida que un correo cumple todas las reglas para SES
 * 
 * @param from - Email del remitente (DEBE ser @al-eon.com o @infinitykode.com)
 * @param to - Destinatario(s)
 * @param type - Tipo de correo (debe ser transaccional)
 * @returns {valid: true} o {valid: false, error: string}
 */
export function validateSESAbsoluteRules(params: {
  from: string;
  to: string | string[];
  type?: string;
}): { valid: boolean; error?: string } {
  const { from, to, type } = params;
  
  // REGLA ABSOLUTA 1: From DEBE ser dominio del sistema
  if (!isSystemDomain(from)) {
    return {
      valid: false,
      error: `REGLA_ABSOLUTA_VIOLATED: SES solo acepta correos de: ${SYSTEM_DOMAINS.join(', ')}. From: ${from}`
    };
  }
  
  // REGLA ABSOLUTA 2: Type debe ser correo transaccional (si se especifica)
  if (type && !ALLOWED_EMAIL_TYPES.includes(type as any)) {
    return {
      valid: false,
      error: `REGLA_ABSOLUTA_VIOLATED: Tipo '${type}' no permitido. SES solo para: ${ALLOWED_EMAIL_TYPES.join(', ')}`
    };
  }
  
  // REGLA ABSOLUTA 3: NO enviar a dominios de prueba (excepto SES Simulator)
  const recipients = Array.isArray(to) ? to : [to];
  for (const recipient of recipients) {
    const domain = recipient.split('@')[1]?.toLowerCase();
    
    // Permitir SES Simulator
    if (recipient === SES_SIMULATOR.SUCCESS || 
        recipient === SES_SIMULATOR.BOUNCE || 
        recipient === SES_SIMULATOR.COMPLAINT) {
      continue;
    }
    
    // Bloquear dominios de prueba
    if (BLACKLISTED_DOMAINS.includes(domain)) {
      return {
        valid: false,
        error: `REGLA_ABSOLUTA_VIOLATED: Dominio prohibido: ${domain}. Usa SES Mailbox Simulator para pruebas: ${SES_SIMULATOR.SUCCESS}`
      };
    }
  }
  
  return { valid: true };
}

/**
 * Obtiene el remitente correcto del sistema según el tipo de correo
 */
export function getSystemSender(type: AllowedEmailType): { email: string; name: string } {
  const senders: Record<string, { email: string; name: string }> = {
    'password_reset': { email: 'seguridad@al-eon.com', name: 'AL-E Seguridad' },
    'email_verification': { email: 'verificacion@al-eon.com', name: 'AL-E Verificación' },
    'onboarding_welcome': { email: 'bienvenida@al-eon.com', name: 'AL-E Team' },
    'account_created': { email: 'bienvenida@al-eon.com', name: 'AL-E Team' },
    'system_notification': { email: 'notificaciones@al-eon.com', name: 'AL-E Notificaciones' },
    'account_alert': { email: 'alertas@al-eon.com', name: 'AL-E Alertas' },
    'security_alert': { email: 'seguridad@al-eon.com', name: 'AL-E Seguridad' },
    'two_factor_auth': { email: 'seguridad@al-eon.com', name: 'AL-E Seguridad' },
    'subscription_confirmation': { email: 'suscripciones@al-eon.com', name: 'AL-E Suscripciones' },
    'payment_receipt': { email: 'pagos@al-eon.com', name: 'AL-E Pagos' }
  };
  
  return senders[type] || { email: 'notificaciones@al-eon.com', name: 'AL-E' };
}

/**
 * Registra intento bloqueado para auditoría
 */
export function logBlockedSESAttempt(params: {
  userId?: string;
  from: string;
  to: string | string[];
  reason: string;
  provider: string;
}): void {
  console.error('[SES PROTECTION] 🚫 Intento bloqueado:', {
    timestamp: new Date().toISOString(),
    severity: 'CRITICAL',
    ...params
  });
  
  // Incrementar contador de intentos bloqueados
  stats.blocked++;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  canUseSES,
  addToSuppressionList,
  isInSuppressionList,
  checkRateLimit,
  getSESStats,
  sesHealthCheck,
  blockUserEmailsInSES,
  validateSESAbsoluteRules,
  isSystemDomain,
  getSystemSender,
  logBlockedSESAttempt,
  SES_SIMULATOR,
  ALLOWED_EMAIL_TYPES,
  SYSTEM_DOMAINS
};

