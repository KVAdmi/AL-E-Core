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
}

const stats: SESStats = {
  totalAllowed: 0,
  totalBlocked: 0,
  blockReasons: {},
  suppressionListSize: 0
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
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export default {
  canUseSES,
  addToSuppressionList,
  isInSuppressionList,
  checkRateLimit,
  getSESStats,
  sesHealthCheck,
  SES_SIMULATOR,
  ALLOWED_EMAIL_TYPES
};
