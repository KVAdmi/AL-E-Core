/**
 * STRUCTURED LOGGER - EVENTOS OBLIGATORIOS
 * 
 * Sistema de logging estructurado para AL-E Core.
 * Todos los eventos críticos del sistema deben pasar por aquí.
 * 
 * REGLAS:
 * - Formato JSON estructurado
 * - Correlación via request_id y meeting_id
 * - No secrets en logs (passwords, tokens filtrados)
 * - Stack traces solo en desarrollo
 * - Append-only (no modificar logs existentes)
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * NIVEL DE LOG
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

/**
 * ESTRUCTURA BASE DE EVENTO
 */
interface BaseEvent {
  timestamp: string;
  event: string;
  level: LogLevel;
  request_id?: string;
  meeting_id?: string;
  user_id?: string;
  [key: string]: any;
}

/**
 * LOGGER CLASS
 */
class StructuredLogger {
  private isProd: boolean;
  
  constructor() {
    this.isProd = process.env.NODE_ENV === 'production';
  }
  
  /**
   * LOG: Método principal
   */
  private log(level: LogLevel, event: string, data: Record<string, any> = {}): void {
    const logEntry: BaseEvent = {
      timestamp: new Date().toISOString(),
      event,
      level,
      ...this.sanitize(data),
    };
    
    // En producción: JSON puro
    // En desarrollo: formato legible
    if (this.isProd) {
      console.log(JSON.stringify(logEntry));
    } else {
      console.log(`[${level.toUpperCase()}] ${event}`, logEntry);
    }
  }
  
  /**
   * SANITIZE: Filtrar secrets
   */
  private sanitize(data: Record<string, any>): Record<string, any> {
    const sanitized = { ...data };
    
    // Filtrar campos sensibles
    const sensitiveFields = [
      'password',
      'token',
      'jwt',
      'authorization',
      'secret',
      'api_key',
      'smtp_pass',
      'imap_pass',
      'pass_enc',
    ];
    
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '***REDACTED***';
      }
    }
    
    // Filtrar stacks en producción
    if (this.isProd && sanitized.stack) {
      delete sanitized.stack;
    }
    
    return sanitized;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // A) ORCHESTRATOR LIFECYCLE
  // ═══════════════════════════════════════════════════════════════
  
  aiRequestReceived(data: {
    request_id: string;
    user_id: string;
    workspace_id: string;
    route: string;
    message_length: number;
    channel: 'web' | 'app' | 'api';
  }): void {
    this.log(LogLevel.INFO, 'ai.request.received', data);
  }
  
  aiIntentDetected(data: {
    request_id: string;
    intent: string;
    confidence?: number;
    required_tools: string[];
    optional_tools: string[];
  }): void {
    this.log(LogLevel.INFO, 'ai.intent.detected', data);
  }
  
  aiAuthorityResolved(data: {
    request_id: string;
    authority_current: string;
    authority_required: string;
    confirmation_required: boolean;
    user_confirmed: boolean;
    decision: 'approved' | 'blocked';
    reason?: string;
  }): void {
    this.log(LogLevel.INFO, 'ai.authority.resolved', data);
  }
  
  aiToolsPlan(data: {
    request_id: string;
    required_tools: string[];
    tool_count: number;
    runtime_capabilities_snapshot: Record<string, boolean>;
  }): void {
    this.log(LogLevel.INFO, 'ai.tools.plan', data);
  }
  
  aiToolsExecuteStart(data: {
    request_id: string;
    tool_name: string;
    args_schema_version?: string;
    attempt: number;
  }): void {
    this.log(LogLevel.INFO, 'ai.tools.execute.start', data);
  }
  
  aiToolsExecuteResult(data: {
    request_id: string;
    tool_name: string;
    success: boolean;
    duration_ms: number;
    evidence_ids?: Record<string, any>;
    output_size_bytes?: number;
    error_code?: string;
    error_message?: string;
  }): void {
    this.log(
      data.success ? LogLevel.INFO : LogLevel.ERROR,
      'ai.tools.execute.result',
      data
    );
  }
  
  aiTruthgateVerdict(data: {
    request_id: string;
    status: 'approved' | 'blocked';
    reason?: string;
    missing_tools?: string[];
    failed_tools?: string[];
    claims_blocked?: string[];
  }): void {
    this.log(
      data.status === 'approved' ? LogLevel.INFO : LogLevel.WARN,
      'ai.truthgate.verdict',
      data
    );
  }
  
  aiResponseSent(data: {
    request_id: string;
    status: 'approved' | 'blocked';
    response_type: 'facts' | 'blocked' | 'question';
    evidence_ids_summary?: Record<string, any>;
    latency_ms_total: number;
  }): void {
    this.log(LogLevel.INFO, 'ai.response.sent', data);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // B) RUNTIME CAPABILITIES
  // ═══════════════════════════════════════════════════════════════
  
  runtimeCapabilitiesLoaded(data: {
    source: 'file' | 'db';
    capabilities: Record<string, boolean>;
  }): void {
    this.log(LogLevel.INFO, 'runtime.capabilities.loaded', data);
  }
  
  runtimeCapabilityBlocked(data: {
    request_id: string;
    capability_name: string;
    intent: string;
    tool_name: string;
  }): void {
    this.log(LogLevel.WARN, 'runtime.capability.blocked', data);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // C) MEETINGS
  // ═══════════════════════════════════════════════════════════════
  
  meetingsLiveStart(data: {
    meeting_id: string;
    title: string;
    user_id: string;
  }): void {
    this.log(LogLevel.INFO, 'meetings.live.start', data);
  }
  
  meetingsLiveChunkReceived(data: {
    meeting_id: string;
    chunk_index: number;
    bytes: number;
    duration_ms_estimated?: number;
    upload_success: boolean;
  }): void {
    this.log(LogLevel.INFO, 'meetings.live.chunk.received', data);
  }
  
  meetingsLiveStop(data: {
    meeting_id: string;
    total_chunks: number;
    total_bytes: number;
    duration_seconds: number;
  }): void {
    this.log(LogLevel.INFO, 'meetings.live.stop', data);
  }
  
  meetingsQueueEnqueued(data: {
    meeting_id: string;
    job_id: string;
    queue_name: string;
  }): void {
    this.log(LogLevel.INFO, 'meetings.queue.enqueued', data);
  }
  
  meetingsProcessingStatus(data: {
    meeting_id: string;
    state: 'uploaded' | 'processing' | 'ready' | 'failed';
    transcript_state: 'pending' | 'ready' | 'failed';
    minutes_state: 'pending' | 'ready' | 'failed';
  }): void {
    this.log(LogLevel.INFO, 'meetings.processing.status', data);
  }
  
  meetingsResultServed(data: {
    meeting_id: string;
    status: 'approved' | 'blocked';
    reason?: string;
    evidence_ids?: Record<string, any>;
  }): void {
    this.log(
      data.status === 'approved' ? LogLevel.INFO : LogLevel.WARN,
      'meetings.result.served',
      data
    );
  }
  
  meetingsSendRequested(data: {
    meeting_id: string;
    to_count: number;
    channel: 'email' | 'telegram';
  }): void {
    this.log(LogLevel.INFO, 'meetings.send.requested', data);
  }
  
  meetingsSendResult(data: {
    meeting_id: string;
    success: boolean;
    smtp_message_id?: string;
    error_message?: string;
  }): void {
    this.log(
      data.success ? LogLevel.INFO : LogLevel.ERROR,
      'meetings.send.result',
      data
    );
  }
  
  // ═══════════════════════════════════════════════════════════════
  // D) EMAIL
  // ═══════════════════════════════════════════════════════════════
  
  mailAccountsStatus(data: {
    user_id: string;
    accounts_count: number;
    blocked_if_zero: boolean;
  }): void {
    this.log(
      data.blocked_if_zero && data.accounts_count === 0 ? LogLevel.WARN : LogLevel.INFO,
      'mail.accounts.status',
      data
    );
  }
  
  mailInboxListResult(data: {
    request_id?: string;
    user_id: string;
    count: number;
    newest_message_id?: string;
  }): void {
    this.log(LogLevel.INFO, 'mail.inbox.list.result', data);
  }
  
  mailSendResult(data: {
    request_id?: string;
    user_id: string;
    success: boolean;
    smtp_message_id?: string;
    to_domain_summary?: string; // e.g., "gmail.com, outlook.com"
    error_code?: string;
    error_message?: string;
  }): void {
    this.log(
      data.success ? LogLevel.INFO : LogLevel.ERROR,
      'mail.send.result',
      data
    );
  }
  
  // ═══════════════════════════════════════════════════════════════
  // UTILIDADES
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * DEBUG: Solo en desarrollo
   */
  debug(message: string, data?: Record<string, any>): void {
    if (!this.isProd) {
      this.log(LogLevel.DEBUG, 'debug', { message, ...data });
    }
  }
  
  /**
   * ERROR: Errores generales
   */
  error(message: string, error: Error, data?: Record<string, any>): void {
    this.log(LogLevel.ERROR, 'error', {
      message,
      error_message: error.message,
      stack: error.stack,
      ...data,
    });
  }
  
  /**
   * WARN: Advertencias
   */
  warn(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.WARN, 'warning', { message, ...data });
  }
}

/**
 * SINGLETON: Instancia global del logger
 */
export const logger = new StructuredLogger();

/**
 * GENERATE REQUEST ID: Helper para generar request_id
 */
export function generateRequestId(): string {
  return uuidv4();
}

/**
 * EXTRACT DOMAIN: Extraer dominio de email (para logs)
 */
export function extractDomain(email: string): string {
  const match = email.match(/@(.+)$/);
  return match ? match[1] : 'unknown';
}

/**
 * EXTRACT DOMAINS SUMMARY: Para múltiples emails
 */
export function extractDomainsSummary(emails: string[]): string {
  const domains = emails.map(extractDomain);
  const uniqueDomains = Array.from(new Set(domains));
  return uniqueDomains.join(', ');
}
