/**
 * =====================================================
 * SES BLOCKER - PROTECCIÓN ABSOLUTA
 * =====================================================
 * 
 * CONTEXTO CRÍTICO:
 * Amazon SES está COMPLETAMENTE DESHABILITADO en AL-E Core
 * durante la fase de construcción del producto.
 * 
 * PROHIBICIONES ABSOLUTAS:
 * ❌ SendEmail
 * ❌ SendRawEmail  
 * ❌ SMTP SES
 * ❌ Webhooks SES
 * ❌ S3 Inbound (relacionado con SES)
 * ❌ Cualquier envío automático
 * ❌ Reply / Forward automático
 * ❌ Parsing de emails para reenvío
 * 
 * OBJETIVO:
 * Asegurar que ningún flujo de AL-E pueda disparar SES
 * bajo ninguna circunstancia, ni directa ni indirectamente.
 * 
 * CRITERIO DE REACTIVACIÓN (FUTURO):
 * Solo se podrá reactivar SES cuando:
 * 1. Exista whitelist explícita de destinatarios
 * 2. Todos los correos estén hardcodeados
 * 3. No existan destinatarios dinámicos
 * 4. Uso sea estrictamente manual
 * 5. Aprobación explícita de arquitectura
 * =====================================================
 */

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

/**
 * Flag global de seguridad
 * NO cambiar este valor sin aprobación explícita
 */
const ENABLE_SES = process.env.ENABLE_SES === 'true';

/**
 * Mensaje de error estándar
 */
const SES_DISABLED_MESSAGE = 
  'Amazon SES está completamente deshabilitado por política de seguridad. ' +
  'Los correos personales deben usar Gmail/Outlook APIs. ' +
  'Contacta al equipo de arquitectura si necesitas reactivar SES.';

// ═══════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: throwIfSESAttempted
// ═══════════════════════════════════════════════════════════════

/**
 * Lanza error si se intenta usar SES
 * Usar al inicio de CUALQUIER función que pueda tocar SES
 */
export function throwIfSESAttempted(context?: string): void {
  if (!ENABLE_SES) {
    const errorMsg = context 
      ? `[SES BLOCKED] ${context}: ${SES_DISABLED_MESSAGE}`
      : `[SES BLOCKED] ${SES_DISABLED_MESSAGE}`;
    
    console.error(errorMsg);
    
    throw new Error('SES_DISABLED_BY_POLICY');
  }
}

/**
 * Valida que SES esté completamente bloqueado
 * Retorna objeto con estado del bloqueo
 */
export function validateSESBlocked(): {
  blocked: boolean;
  reason: string;
  canUse: boolean;
} {
  const blocked = !ENABLE_SES;
  
  return {
    blocked,
    canUse: !blocked,
    reason: blocked ? SES_DISABLED_MESSAGE : 'SES está habilitado'
  };
}

/**
 * Middleware Express para bloquear endpoints relacionados con SES
 */
export function sesBlockerMiddleware(req: any, res: any, next: any) {
  if (!ENABLE_SES) {
    console.error('[SES BLOCKER] 🚫 Intento de acceder a endpoint SES bloqueado:', req.path);
    
    return res.status(403).json({
      success: false,
      error: 'SES_DISABLED',
      message: SES_DISABLED_MESSAGE,
      timestamp: new Date().toISOString()
    });
  }
  
  next();
}

/**
 * Verifica configuración de SES y lanza error si está activa
 * Usar en inicialización de servicios
 */
export function ensureSESIsDisabled(): void {
  if (ENABLE_SES) {
    const errorMsg = 
      '❌ CONFIGURACIÓN CRÍTICA: ENABLE_SES=true detectado. ' +
      'Debe ser false. Revisar .env inmediatamente.';
    
    console.error(errorMsg);
    throw new Error('SES_MUST_BE_DISABLED');
  }
  
  console.log('✅ [SES BLOCKER] SES correctamente deshabilitado');
}

/**
 * Log de auditoría para intentos bloqueados
 */
export function logBlockedSESAttempt(details: {
  endpoint?: string;
  userId?: string;
  action?: string;
  reason?: string;
}): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event: 'SES_ATTEMPT_BLOCKED',
    enabled: ENABLE_SES,
    ...details
  };
  
  console.warn('[SES BLOCKER] 🚫 Intento bloqueado:', JSON.stringify(logEntry, null, 2));
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

export const SES_BLOCKER = {
  isEnabled: ENABLE_SES,
  isDisabled: !ENABLE_SES,
  message: SES_DISABLED_MESSAGE,
  throw: throwIfSESAttempted,
  validate: validateSESBlocked,
  middleware: sesBlockerMiddleware,
  ensure: ensureSESIsDisabled,
  log: logBlockedSESAttempt
};

/**
 * Verificar al importar este módulo
 */
if (ENABLE_SES) {
  console.warn('⚠️  [SES BLOCKER] ADVERTENCIA: ENABLE_SES=true - SES está HABILITADO');
} else {
  console.log('✅ [SES BLOCKER] SES correctamente deshabilitado');
}
