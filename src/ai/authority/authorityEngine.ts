/**
 * AUTHORITY ENGINE - RUNTIME ENFORCEMENT
 * 
 * Motor que hace cumplir la matriz de autoridad.
 * Decide si una acción puede ejecutarse, si necesita confirmación, y maneja downgrades.
 * 
 * REGLAS:
 * 1. Siempre arranca en A0 (Observador)
 * 2. Solo escala si tools lo requieren Y capabilities están disponibles
 * 3. Si cualquier tool falla → downgrade a A0 automático
 * 4. Si falta confirmación → blocked
 */

import {
  AuthorityLevel,
  getToolAuthority,
  getMaxRequiredAuthority,
  hasAuthority,
  needsConfirmation,
  hasSensitiveData,
} from './authorityMatrix';

export interface RuntimeCapabilities {
  'mail.send': boolean;
  'mail.inbox': boolean;
  'calendar.create': boolean;
  'calendar.list': boolean;
  'calendar.update': boolean;
  'calendar.delete': boolean;
  'documents.read': boolean;
  'web.search': boolean;
  'telegram': boolean;
}

export interface AuthorityContext {
  currentLevel: AuthorityLevel;
  userId: string;
  sessionId?: string;
}

export interface EnforcementResult {
  allowed: boolean;
  reason?: string;
  requiredAuthority?: AuthorityLevel;
  needsConfirmation?: boolean;
  blockedTools?: string[];
  details?: any;
}

export interface ToolExecution {
  tool: string;
  args?: any;
  result?: any;
  output?: any;
  success: boolean;
}

/**
 * CLASE PRINCIPAL: AUTHORITY ENGINE
 */
export class AuthorityEngine {
  private runtimeCapabilities: RuntimeCapabilities;
  
  constructor(capabilities: RuntimeCapabilities) {
    this.runtimeCapabilities = capabilities;
  }
  
  /**
   * ENFORCE: Validar si un conjunto de tools puede ejecutarse
   * 
   * @param context - Contexto de autoridad actual
   * @param requiredTools - Tools que el planner quiere ejecutar
   * @param userConfirmed - ¿El usuario dio confirmación explícita?
   * @returns EnforcementResult
   */
  enforce(
    context: AuthorityContext,
    requiredTools: string[],
    userConfirmed: boolean = false
  ): EnforcementResult {
    console.log('[AUTH ENGINE] ═══════════════════════════════════════');
    console.log('[AUTH ENGINE] ENFORCEMENT CHECK');
    console.log('[AUTH ENGINE] Current authority:', context.currentLevel);
    console.log('[AUTH ENGINE] Required tools:', requiredTools);
    console.log('[AUTH ENGINE] User confirmed:', userConfirmed);
    
    // 1. Validar capabilities (LEY SUPREMA)
    const blockedByCapabilities = this.checkCapabilities(requiredTools);
    if (blockedByCapabilities.length > 0) {
      console.log('[AUTH ENGINE] ❌ BLOCKED: Capabilities disabled');
      console.log('[AUTH ENGINE] Blocked tools:', blockedByCapabilities);
      
      return {
        allowed: false,
        reason: 'capability_disabled',
        blockedTools: blockedByCapabilities,
        details: {
          message: 'Una o más funciones requeridas no están disponibles actualmente.',
          disabledTools: blockedByCapabilities.map(t => ({
            tool: t,
            capability: this.mapToolToCapability(t),
          })),
        },
      };
    }
    
    // 2. Calcular autoridad requerida
    const requiredAuthority = getMaxRequiredAuthority(requiredTools);
    console.log('[AUTH ENGINE] Required authority:', requiredAuthority);
    
    // 3. Verificar si el nivel actual es suficiente
    if (!hasAuthority(context.currentLevel, requiredAuthority)) {
      console.log('[AUTH ENGINE] ❌ BLOCKED: Insufficient authority');
      
      return {
        allowed: false,
        reason: 'authority_insufficient',
        requiredAuthority,
        details: {
          message: `Esta operación requiere nivel de autoridad ${requiredAuthority}, pero actualmente tienes ${context.currentLevel}.`,
          currentLevel: context.currentLevel,
          requiredLevel: requiredAuthority,
        },
      };
    }
    
    // 4. Verificar si algún tool requiere confirmación
    const confirmationRequired = needsConfirmation(requiredTools);
    if (confirmationRequired && !userConfirmed) {
      console.log('[AUTH ENGINE] ❌ BLOCKED: Confirmation required');
      
      const toolsNeedingConfirmation = requiredTools.filter(t => {
        const auth = getToolAuthority(t);
        return auth?.confirm === true;
      });
      
      return {
        allowed: false,
        reason: 'confirmation_required',
        needsConfirmation: true,
        blockedTools: toolsNeedingConfirmation,
        details: {
          message: 'Esta acción requiere tu confirmación explícita antes de ejecutarse.',
          toolsNeedingConfirmation,
          confirmationPrompt: this.generateConfirmationPrompt(toolsNeedingConfirmation),
        },
      };
    }
    
    // 5. TODO APROBADO
    console.log('[AUTH ENGINE] ✅ ENFORCEMENT PASSED');
    console.log('[AUTH ENGINE] ═══════════════════════════════════════');
    
    return {
      allowed: true,
    };
  }
  
  /**
   * DOWNGRADE ON FAILURE: Si algún tool falló, bajar a A0
   */
  downgradeOnFailure(executions: ToolExecution[]): AuthorityLevel {
    const hasFailed = executions.some(e => !e.success);
    
    if (hasFailed) {
      const failedTools = executions.filter(e => !e.success).map(e => e.tool);
      console.log('[AUTH ENGINE] 🔻 DOWNGRADE: Tools failed:', failedTools);
      console.log('[AUTH ENGINE] Authority reset to A0');
      return 'A0';
    }
    
    return 'A1'; // Mantener nivel bajo si todo salió bien
  }
  
  /**
   * GET CAPABILITIES: Retornar snapshot de capabilities actuales
   */
  getCapabilities(): Record<string, boolean> {
    return { ...this.runtimeCapabilities };
  }
  
  /**
   * CHECK CAPABILITIES: Validar contra runtime-capabilities.json
   */
  private checkCapabilities(requiredTools: string[]): string[] {
    const blocked: string[] = [];
    
    for (const tool of requiredTools) {
      const capability = this.mapToolToCapability(tool);
      
      if (capability && this.runtimeCapabilities[capability] === false) {
        blocked.push(tool);
      }
    }
    
    return blocked;
  }
  
  /**
   * MAP TOOL TO CAPABILITY: Traducir nombre de tool a capability key
   */
  private mapToolToCapability(tool: string): keyof RuntimeCapabilities | null {
    // EMAIL
    if (tool.includes('email') || tool === 'list_emails' || tool === 'read_email') {
      if (tool.includes('send')) return 'mail.send';
      return 'mail.inbox';
    }
    
    // CALENDAR
    if (tool.includes('event')) {
      if (tool === 'list_events' || tool === 'get_event') return 'calendar.list';
      if (tool === 'create_event') return 'calendar.create';
      if (tool === 'update_event') return 'calendar.update';
      if (tool === 'delete_event') return 'calendar.delete';
    }
    
    // DOCUMENTS
    if (tool.includes('document') || tool.includes('ocr')) {
      return 'documents.read';
    }
    
    // WEB
    if (tool === 'web_search') {
      return 'web.search';
    }
    
    // TELEGRAM
    if (tool.includes('telegram')) {
      return 'telegram';
    }
    
    return null;
  }
  
  /**
   * GENERATE CONFIRMATION PROMPT: Crear mensaje de confirmación
   */
  private generateConfirmationPrompt(tools: string[]): string {
    if (tools.includes('send_email') || tools.includes('create_and_send_email')) {
      return '¿Confirmas que quieres enviar este correo?';
    }
    
    if (tools.includes('create_event')) {
      return '¿Confirmas que quieres crear este evento en el calendario?';
    }
    
    if (tools.includes('update_event')) {
      return '¿Confirmas que quieres modificar este evento?';
    }
    
    if (tools.includes('delete_event')) {
      return '¿Confirmas que quieres eliminar este evento?';
    }
    
    if (tools.includes('meeting_send')) {
      return '¿Confirmas que quieres enviar la minuta por correo?';
    }
    
    return '¿Confirmas esta acción?';
  }
  
  /**
   * DETECT USER CONFIRMATION: Detectar si el mensaje del usuario contiene confirmación
   */
  detectUserConfirmation(userMessage: string): boolean {
    const lowerMsg = userMessage.toLowerCase().trim();
    
    // Patrones de confirmación explícita
    const confirmPatterns = [
      /^sí$/,
      /^si$/,
      /^yes$/,
      /^confirmo$/,
      /^confirmar$/,
      /^adelante$/,
      /^hazlo$/,
      /^envíalo$/,
      /^envialo$/,
      /^créalo$/,
      /^crealo$/,
      /^ok$/,
      /^okay$/,
      /^procede$/,
      /sí,?\s+(envía|crea|hazlo|adelante)/,
      /confirma?\s+(envío|enviar|crear|modificar)/,
    ];
    
    return confirmPatterns.some(pattern => pattern.test(lowerMsg));
  }
  
  /**
   * ESCALATE AUTHORITY: Determinar si el contexto permite escalar autoridad
   * Solo usarlo cuando tools requieren mayor nivel y están disponibles
   */
  escalateAuthority(
    current: AuthorityLevel,
    requiredTools: string[],
    hasConfirmation: boolean
  ): AuthorityLevel {
    const required = getMaxRequiredAuthority(requiredTools);
    
    // Si no hay confirmación pero se requiere, no escalar
    if (needsConfirmation(requiredTools) && !hasConfirmation) {
      console.log('[AUTH ENGINE] Cannot escalate: confirmation required');
      return current;
    }
    
    // Escalar solo si es necesario
    if (hasAuthority(current, required)) {
      return current; // Ya tiene suficiente
    }
    
    console.log(`[AUTH ENGINE] Escalating authority: ${current} → ${required}`);
    return required;
  }
}

/**
 * FACTORY: Crear engine desde runtime capabilities
 */
export async function createAuthorityEngine(): Promise<AuthorityEngine> {
  // Leer runtime capabilities (podría venir de archivo o DB)
  const fs = await import('fs/promises');
  const path = await import('path');
  
  try {
    const capabilitiesPath = path.join(__dirname, '../../../CONTRACTS/runtime-capabilities.json');
    const data = await fs.readFile(capabilitiesPath, 'utf-8');
    const capabilities: RuntimeCapabilities = JSON.parse(data);
    
    console.log('[AUTH ENGINE] Runtime capabilities loaded:', capabilities);
    return new AuthorityEngine(capabilities);
  } catch (error) {
    console.error('[AUTH ENGINE] Error loading capabilities, using safe defaults');
    
    // Defaults seguros (todo deshabilitado)
    return new AuthorityEngine({
      'mail.send': false,
      'mail.inbox': false,
      'calendar.create': false,
      'calendar.list': false,
      'calendar.update': false,
      'calendar.delete': false,
      'documents.read': false,
      'web.search': false,
      'telegram': false,
    });
  }
}
