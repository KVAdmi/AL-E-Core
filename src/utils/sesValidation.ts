/**
 * =====================================================
 * SES VALIDATION & PROTECTION - DESHABILITADO
 * =====================================================
 * 
 * ❌ ESTADO: SES COMPLETAMENTE DESHABILITADO
 * 
 * CONTEXTO CRÍTICO:
 * Amazon SES está BLOQUEADO por política de seguridad.
 * Este módulo ahora SIEMPRE retorna blocked=true.
 * 
 * NO se permiten envíos de ningún tipo vía SES.
 * Usar Gmail/Outlook APIs para correos personales.
 * =====================================================
 */

import { SES_BLOCKER } from './sesBlocker';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

/**
 * Tipos de correo PERMITIDOS para SES
 * SOLO correos transaccionales del sistema
 */
export const ALLOWED_EMAIL_TYPES = [
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
/**
 * Validar si se puede usar SES - SIEMPRE RETORNA BLOQUEADO
 */
export function canUseSES(emailType: string, to: string): SESValidationResult {
  SES_BLOCKER.log({
    action: 'canUseSES',
    reason: `Intento de validar SES para ${to}`
  });

  return {
    allowed: false,
    reason: 'SES_DISABLED_BY_POLICY',
    details: SES_BLOCKER.message
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
/**
 * Bloquear correos de usuarios en SES - SIEMPRE RETORNA BLOQUEADO
 */
export function blockUserEmailsInSES(params: {
  provider: string;
  from: string;
  accountId?: string;
}): { blocked: boolean; reason?: string } {
  SES_BLOCKER.log({
    action: 'blockUserEmailsInSES',
    reason: `Intento de validar SES para ${params.from}`
  });

  return {
    blocked: true,
    reason: `SES_DISABLED: ${SES_BLOCKER.message}`
  };
}

/**
 * REGLA ABSOLUTA: Valida que un correo cumple todas las reglas para SES
 * 
/**
 * Validar reglas absolutas de SES - SIEMPRE RETORNA BLOQUEADO
 */
export function validateSESAbsoluteRules(params: {
  from: string;
  to: string | string[];
  type?: string;
}): { valid: boolean; error?: string } {
  SES_BLOCKER.log({
    action: 'validateSESAbsoluteRules',
    reason: `Intento de validar reglas SES para ${params.from} -> ${params.to}`
  });

  return {
    valid: false,
    error: `SES_DISABLED: ${SES_BLOCKER.message}`
  };
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

