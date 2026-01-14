/**
 * AUTHORITY MATRIX - RUNTIME ENFORCEMENT
 * 
 * Define qué nivel de autoridad requiere cada tool y si necesita confirmación.
 * Este es el CANDADO PRINCIPAL que evita que AL-E ejecute acciones sin permiso.
 * 
 * Niveles:
 * - A0: Observador (default, solo puede preguntar/explicar)
 * - A1: Informativo (lecturas no sensibles)
 * - A2: Operador Supervisado (necesita confirmación)
 * - A3: Operador Autónomo Limitado (sin confirmación, bajo riesgo)
 */

export type AuthorityLevel = 'A0' | 'A1' | 'A2' | 'A3';

export interface ToolAuthority {
  min: AuthorityLevel;           // Nivel mínimo requerido
  confirm: boolean;              // ¿Requiere confirmación del usuario?
  sensitive: boolean;            // ¿Datos sensibles involucrados?
  description: string;           // Explicación de por qué ese nivel
}

/**
 * MATRIZ DE AUTORIDAD POR TOOL
 * Esta es la fuente de verdad para enforcement
 */
export const AUTH_MATRIX: Record<string, ToolAuthority> = {
  // ═══════════════════════════════════════════════════════════════
  // EMAIL
  // ═══════════════════════════════════════════════════════════════
  'list_emails': {
    min: 'A2',
    confirm: false,
    sensitive: true,
    description: 'Lee correos del usuario (privacidad alta)'
  },
  'read_email': {
    min: 'A2',
    confirm: false,
    sensitive: true,
    description: 'Lee contenido completo de correo (privacidad alta)'
  },
  'send_email': {
    min: 'A2',
    confirm: true, // SIEMPRE requiere confirmación
    sensitive: true,
    description: 'Envía correo en nombre del usuario (acción irreversible)'
  },
  'create_and_send_email': {
    min: 'A2',
    confirm: true, // SIEMPRE requiere confirmación
    sensitive: true,
    description: 'Crea y envía correo (acción irreversible)'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // CALENDAR
  // ═══════════════════════════════════════════════════════════════
  'list_events': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Lista eventos del calendario (solo lectura)'
  },
  'get_event': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Obtiene detalles de un evento (solo lectura)'
  },
  'create_event': {
    min: 'A2',
    confirm: true,
    sensitive: true,
    description: 'Crea evento en calendario (modificación)'
  },
  'update_event': {
    min: 'A2',
    confirm: true,
    sensitive: true,
    description: 'Modifica evento existente (puede afectar compromisos)'
  },
  'delete_event': {
    min: 'A2',
    confirm: true,
    sensitive: true,
    description: 'Elimina evento (acción irreversible)'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // MEETINGS (Grabación/Transcripción)
  // ═══════════════════════════════════════════════════════════════
  'meeting_start': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Inicia sesión de grabación (operación técnica)'
  },
  'meeting_chunk': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Procesa chunk de audio (operación técnica)'
  },
  'meeting_stop': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Finaliza grabación (operación técnica)'
  },
  'meeting_status': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Obtiene status de meeting (solo lectura)'
  },
  'meeting_result': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Obtiene resultado/transcript (solo lectura)'
  },
  'meeting_send': {
    min: 'A2',
    confirm: true,
    sensitive: true,
    description: 'Envía minuta por correo (acción irreversible)'
  },
  'meeting_to_calendar': {
    min: 'A2',
    confirm: true,
    sensitive: true,
    description: 'Crea evento de calendario desde meeting (modificación)'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // DOCUMENTS / OCR
  // ═══════════════════════════════════════════════════════════════
  'read_document': {
    min: 'A2',
    confirm: false,
    sensitive: true,
    description: 'Lee documento/PDF (privacidad alta)'
  },
  'ocr_extract': {
    min: 'A2',
    confirm: false,
    sensitive: true,
    description: 'Extrae texto de imagen (privacidad alta)'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // WEB SEARCH
  // ═══════════════════════════════════════════════════════════════
  'web_search': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Busca información en la web (sin datos sensibles)'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // TELEGRAM / WHATSAPP (actualmente deshabilitados)
  // ═══════════════════════════════════════════════════════════════
  'telegram_send': {
    min: 'A2',
    confirm: true,
    sensitive: true,
    description: 'Envía mensaje por Telegram (acción irreversible)'
  },
  'whatsapp_send': {
    min: 'A2',
    confirm: true,
    sensitive: true,
    description: 'Envía mensaje por WhatsApp (acción irreversible)'
  },
  
  // ═══════════════════════════════════════════════════════════════
  // CONTACTS / CRM
  // ═══════════════════════════════════════════════════════════════
  'list_contacts': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Lista contactos (solo lectura)'
  },
  'get_contact': {
    min: 'A1',
    confirm: false,
    sensitive: false,
    description: 'Obtiene detalles de contacto (solo lectura)'
  },
  'create_contact': {
    min: 'A2',
    confirm: false,
    sensitive: true,
    description: 'Crea contacto en CRM (modificación)'
  },
  'update_contact': {
    min: 'A2',
    confirm: false,
    sensitive: true,
    description: 'Actualiza contacto existente (modificación)'
  },
};

/**
 * COMPARADOR DE NIVELES
 */
export function compareAuthority(current: AuthorityLevel, required: AuthorityLevel): number {
  const levels: AuthorityLevel[] = ['A0', 'A1', 'A2', 'A3'];
  const currentIndex = levels.indexOf(current);
  const requiredIndex = levels.indexOf(required);
  return currentIndex - requiredIndex; // >= 0 significa que current >= required
}

/**
 * VERIFICAR SI UN NIVEL CUMPLE EL REQUERIDO
 */
export function hasAuthority(current: AuthorityLevel, required: AuthorityLevel): boolean {
  return compareAuthority(current, required) >= 0;
}

/**
 * OBTENER AUTORIDAD REQUERIDA PARA UN TOOL
 */
export function getToolAuthority(toolName: string): ToolAuthority | null {
  return AUTH_MATRIX[toolName] || null;
}

/**
 * OBTENER AUTORIDAD MÁS ALTA REQUERIDA PARA UN CONJUNTO DE TOOLS
 */
export function getMaxRequiredAuthority(toolNames: string[]): AuthorityLevel {
  let maxLevel: AuthorityLevel = 'A0';
  
  for (const toolName of toolNames) {
    const auth = getToolAuthority(toolName);
    if (!auth) continue;
    
    if (compareAuthority(auth.min, maxLevel) > 0) {
      maxLevel = auth.min;
    }
  }
  
  return maxLevel;
}

/**
 * VERIFICAR SI ALGÚN TOOL REQUIERE CONFIRMACIÓN
 */
export function needsConfirmation(toolNames: string[]): boolean {
  return toolNames.some(toolName => {
    const auth = getToolAuthority(toolName);
    return auth?.confirm === true;
  });
}

/**
 * VERIFICAR SI ALGÚN TOOL MANEJA DATOS SENSIBLES
 */
export function hasSensitiveData(toolNames: string[]): boolean {
  return toolNames.some(toolName => {
    const auth = getToolAuthority(toolName);
    return auth?.sensitive === true;
  });
}
