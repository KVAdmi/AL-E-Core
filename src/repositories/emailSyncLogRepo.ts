/**
 * =====================================================
 * EMAIL SYNC LOG REPOSITORY
 * =====================================================
 * 
 * Registro de sincronizaciones (éxito/errores)
 * =====================================================
 */

import { supabase } from '../db/supabase';

export interface EmailSyncLog {
  id: string;
  account_id: string;
  sync_type: 'manual' | 'auto' | 'webhook';
  status: 'success' | 'partial' | 'failed';
  messages_fetched: number;
  messages_new: number;
  messages_updated: number;
  errors: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

/**
 * Crear log de sync
 */
export async function createSyncLog(data: {
  account_id: string;
  sync_type: 'manual' | 'auto' | 'webhook';
}): Promise<string> {
  const { data: log, error } = await supabase
    .from('email_sync_log')
    .insert({
      ...data,
      status: 'partial', // Inicialmente partial
      messages_fetched: 0,
      messages_new: 0,
      messages_updated: 0,
      started_at: new Date().toISOString()
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('[REPO] ❌ Error al crear sync log:', error);
    throw new Error(`Error al crear sync log: ${error.message}`);
  }
  
  return log.id;
}

/**
 * Completar log de sync
 */
export async function completeSyncLog(
  logId: string,
  data: {
    status: 'success' | 'partial' | 'failed';
    messages_fetched: number;
    messages_new: number;
    messages_updated: number;
    errors?: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from('email_sync_log')
    .update({
      ...data,
      completed_at: new Date().toISOString(),
      duration_ms: null // TODO: calcular desde started_at
    })
    .eq('id', logId);
  
  if (error) {
    console.error('[REPO] ❌ Error al completar sync log:', error);
  }
}

/**
 * Obtener último sync exitoso de una cuenta
 */
export async function getLastSuccessfulSync(accountId: string): Promise<EmailSyncLog | null> {
  const { data, error } = await supabase
    .from('email_sync_log')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error) {
    console.error('[REPO] ❌ Error al obtener último sync:', error);
    return null;
  }
  
  return data;
}
