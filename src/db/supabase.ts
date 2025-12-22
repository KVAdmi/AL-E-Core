import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env';

// Supabase client with service role for backend operations
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // Service role for full access
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Database helper functions
export class DatabaseService {
  
  /**
   * MÉTODOS CRÍTICOS PARA MEMORIA PERSISTENTE
   */
  
  // Ejecutar SQL crudo (para funciones complejas)
  async executeRaw(query: string, params: any[] = []): Promise<any[]> {
    const { data, error } = await supabase.rpc('exec_sql', { 
      query, 
      params: JSON.stringify(params) 
    });
    
    if (error) {
      console.error('[DB-CRITICAL] Error ejecutando SQL:', error);
      throw error;
    }
    
    return data || [];
  }
  
  // Ejecutar función de base de datos
  async executeFunction(functionName: string, params: Record<string, any> = {}): Promise<any> {
    const { data, error } = await supabase.rpc(functionName, params);
    
    if (error) {
      console.error(`[DB-CRITICAL] Error ejecutando función ${functionName}:`, error);
      throw error;
    }
    
    return data;
  }
  
  // SELECT genérico
  async select(
    table: string, 
    filters: Record<string, any> = {}, 
    options: { limit?: number; orderBy?: string; offset?: number } = {}
  ): Promise<any[]> {
    let query = supabase.from(table).select('*');
    
    // Aplicar filtros
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    
    // Aplicar opciones
    if (options.orderBy) {
      const [column, direction] = options.orderBy.split(' ');
      query = query.order(column, { ascending: direction !== 'DESC' });
    }
    
    if (options.limit) {
      query = query.limit(options.limit);
    }
    
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 100) - 1);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error(`[DB-CRITICAL] Error en SELECT ${table}:`, error);
      throw error;
    }
    
    return data || [];
  }
  
  // INSERT genérico
  async insert(table: string, data: Record<string, any>): Promise<any> {
    const { data: result, error } = await supabase
      .from(table)
      .insert(data)
      .select()
      .single();
    
    if (error) {
      console.error(`[DB-CRITICAL] Error en INSERT ${table}:`, error);
      throw error;
    }
    
    return result;
  }
  
  // UPDATE genérico
  async update(
    table: string, 
    data: Record<string, any>, 
    filters: Record<string, any>
  ): Promise<any[]> {
    let query = supabase.from(table).update(data);
    
    Object.entries(filters).forEach(([key, value]) => {
      query = query.eq(key, value);
    });
    
    const { data: result, error } = await query.select();
    
    if (error) {
      console.error(`[DB-CRITICAL] Error en UPDATE ${table}:`, error);
      throw error;
    }
    
    return result || [];
  }
  
  // ============================================
  // SESSIONS
  // ============================================
  
  async createSession(data: {
    workspaceId?: string;
    userId: string;
    mode?: string;
    assistantId?: string;
  }) {
    const { data: session, error } = await supabase
      .from('ae_sessions')
      .insert({
        workspace_id: data.workspaceId || 'default',
        user_id: data.userId,
        mode: data.mode || 'aleon',
        meta: data.assistantId ? { assistantId: data.assistantId } : {}
      })
      .select()
      .single();
    
    if (error) throw error;
    return session;
  }
  
  async getSessions(userId: string, workspaceId?: string) {
    let query = supabase
      .from('ae_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('archived', false)
      .order('last_message_at', { ascending: false });
    
    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  
  async getSession(sessionId: string, userId: string) {
    const { data: session, error: sessionError } = await supabase
      .from('ae_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();
    
    if (sessionError) throw sessionError;
    
    const { data: messages, error: messagesError } = await supabase
      .from('ae_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    
    if (messagesError) throw messagesError;
    
    return { session, messages };
  }
  
  async updateSession(sessionId: string, userId: string, updates: {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
  }) {
    const { data, error } = await supabase
      .from('ae_sessions')
      .update(updates)
      .eq('id', sessionId)
      .eq('user_id', userId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  async deleteSession(sessionId: string, userId: string) {
    const { error } = await supabase
      .from('ae_sessions')
      .delete()
      .eq('id', sessionId)
      .eq('user_id', userId);
    
    if (error) throw error;
    return true;
  }
  
  // ============================================
  // MESSAGES
  // ============================================
  
  async addMessage(data: {
    sessionId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    meta?: Record<string, any>;
  }) {
    const { data: message, error } = await supabase
      .from('ae_messages')
      .insert({
        session_id: data.sessionId,
        role: data.role,
        content: data.content,
        meta: data.meta || {}
      })
      .select()
      .single();
    
    if (error) throw error;
    return message;
  }
  
  async getMessages(sessionId: string, limit?: number) {
    let query = supabase
      .from('ae_messages')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    
    if (limit) {
      query = query.limit(limit);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  
  // ============================================
  // FILES
  // ============================================
  
  async createFile(data: {
    userId: string;
    sessionId?: string;
    messageId?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
  }) {
    const { data: file, error } = await supabase
      .from('ae_files')
      .insert({
        user_id: data.userId,
        session_id: data.sessionId,
        message_id: data.messageId,
        file_name: data.fileName,
        mime_type: data.mimeType,
        size_bytes: data.sizeBytes,
        storage_path: data.storagePath
      })
      .select()
      .single();
    
    if (error) throw error;
    return file;
  }
  
  async updateFileStatus(fileId: string, status: string, extractedText?: string) {
    const updates: any = { status };
    if (extractedText) {
      updates.extracted_text = extractedText;
    }
    
    const { data, error } = await supabase
      .from('ae_files')
      .update(updates)
      .eq('id', fileId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
  
  async getFiles(sessionId: string) {
    const { data, error } = await supabase
      .from('ae_files')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    return data;
  }
  
  // ============================================
  // MEMORY (enhanced)
  // ============================================
  
  async saveMemory(data: {
    workspaceId: string;
    userId: string;
    mode: string;
    memory: string;
    importance?: number;
    memoryType?: string;
  }) {
    const { data: memory, error } = await supabase
      .from('assistant_memories')
      .upsert({
        workspace_id: data.workspaceId,
        user_id: data.userId,
        mode: data.mode,
        memory: data.memory,
        importance: data.importance || 1,
        memory_type: data.memoryType || 'semantic'
      })
      .select()
      .single();
    
    if (error) throw error;
    return memory;
  }
  
  async getRelevantMemories(workspaceId: string, userId: string, mode: string, limit = 10) {
    const { data, error } = await supabase
      .from('assistant_memories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .eq('mode', mode)
      .order('importance', { ascending: false })
      .limit(limit);
    
    if (error) throw error;
    return data;
  }
  
  // ============================================
  // REQUEST LOGGING
  // ============================================
  
  async logRequest(data: {
    sessionId?: string;
    userId: string;
    endpoint: string;
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    costUsd?: number;
    statusCode?: number;
    errorMessage?: string;
  }) {
    const { error } = await supabase
      .from('ae_requests')
      .insert({
        session_id: data.sessionId,
        user_id: data.userId,
        endpoint: data.endpoint,
        model: data.model,
        tokens_in: data.tokensIn,
        tokens_out: data.tokensOut,
        latency_ms: data.latencyMs,
        cost_usd: data.costUsd,
        status_code: data.statusCode,
        error_message: data.errorMessage
      });
    
    if (error) console.error('Failed to log request:', error);
    // Don't throw - logging shouldn't break main flow
  }
  
  // ============================================
  // ACTIONS
  // ============================================
  
  async createAction(data: {
    sessionId?: string;
    userId: string;
    actionType: string;
    payload: Record<string, any>;
  }) {
    const { data: action, error } = await supabase
      .from('ae_actions')
      .insert({
        session_id: data.sessionId,
        user_id: data.userId,
        action_type: data.actionType,
        payload: data.payload
      })
      .select()
      .single();
    
    if (error) throw error;
    return action;
  }
  
  async updateAction(actionId: string, result: any, status: string) {
    const { data, error } = await supabase
      .from('ae_actions')
      .update({
        result,
        status,
        completed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : null
      })
      .eq('id', actionId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
}

export const db = new DatabaseService();