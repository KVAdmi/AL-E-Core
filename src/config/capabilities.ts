/**
 * KILL SWITCHES - CAPABILITIES
 * 
 * Cada capability tiene un switch ON/OFF.
 * Si está OFF: AL-E NO puede mencionar, simular ni "intentar".
 * 
 * Regla: Solo ON si la funcionalidad está 100% confirmada.
 */

export interface CapabilityConfig {
  enabled: boolean;
  reason?: string; // Por qué está deshabilitada
}

export interface Capabilities {
  EMAIL_READ: CapabilityConfig;
  EMAIL_SEND: CapabilityConfig;
  CALENDAR: CapabilityConfig;
  VOICE: CapabilityConfig;
  ATTACHMENTS: CapabilityConfig;
  WEB_SEARCH: CapabilityConfig;
  TELEGRAM: CapabilityConfig;
}

/**
 * ESTADO ACTUAL DE CAPABILITIES (23 ENE 2026)
 * 
 * ✅ = Verificado funcionando end-to-end
 * ⚠️ = Funciona parcialmente (con limitaciones)
 * ❌ = NO funciona o NO está implementado
 */
export const CAPABILITIES: Capabilities = {
  // ✅ Email sync funciona, force-execution implementado
  EMAIL_READ: {
    enabled: true, // ON - Orquestador fuerza ejecución de list_emails
    reason: 'Force-execution implementado en orquestador. Sincronización IMAP funcional.'
  },

  // ⚠️ Tool existe pero Nova no lo ejecuta consistentemente
  EMAIL_SEND: {
    enabled: false,
    reason: 'Nova Pro no ejecuta send_email. SMTP auth sin validar.'
  },

  // ✅ Base de datos interna funcional
  CALENDAR: {
    enabled: true, // ON - create_event y list_events funcionan
    reason: 'DB interna funcional. Eventos se guardan correctamente.'
  },

  // ❌ STT funciona, pero crea nueva sesión + TTS se dispara sin permiso
  VOICE: {
    enabled: false,
    reason: 'Crea nueva sesión (pierde contexto). TTS se activa sin modo voz.'
  },

  // ❌ Tool analiza metadata, no descarga ni lee archivo real
  ATTACHMENTS: {
    enabled: false,
    reason: 'No descarga archivo real. Analiza metadata del request.'
  },

  // ✅ Serper API funciona
  WEB_SEARCH: {
    enabled: true
  },

  // ❌ Backend listo, webhook no configurado, frontend desconectado
  TELEGRAM: {
    enabled: false,
    reason: 'Webhook no configurado. Frontend no conectado a backend.'
  }
};

/**
 * Verifica si una capability está habilitada
 */
export function isCapabilityEnabled(capability: keyof Capabilities): boolean {
  return CAPABILITIES[capability].enabled;
}

/**
 * Obtiene el mensaje de error para una capability deshabilitada
 */
export function getCapabilityDisabledMessage(capability: keyof Capabilities): string {
  const config = CAPABILITIES[capability];
  return `Esta funcionalidad está temporalmente deshabilitada. ${config.reason || ''}`;
}

/**
 * Lista todas las capabilities habilitadas
 */
export function getEnabledCapabilities(): string[] {
  return Object.entries(CAPABILITIES)
    .filter(([_, config]) => config.enabled)
    .map(([name]) => name);
}

/**
 * Lista todas las capabilities deshabilitadas con razón
 */
export function getDisabledCapabilities(): Array<{ name: string; reason: string }> {
  return Object.entries(CAPABILITIES)
    .filter(([_, config]) => !config.enabled)
    .map(([name, config]) => ({
      name,
      reason: config.reason || 'No especificada'
    }));
}
