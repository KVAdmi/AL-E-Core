/**
 * =====================================================
 * EMAIL MESSAGES REPOSITORY
 * =====================================================
 * 
 * Acceso a tabla email_messages en Supabase
 * Almacenamiento y consulta de mensajes sincronizados
 * =====================================================
 */

import { supabase } from '../db/supabase';

export interface EmailMessage {
  id: string;
  account_id: string;
  owner_user_id: string;
  folder_id: string | null;
  message_uid: string | null;
  message_id: string | null;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string[] | null;
  cc_addresses: string[] | null;
  bcc_addresses: string[] | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  body_preview: string | null;
  has_attachments: boolean;
  attachment_count: number;
  is_read: boolean;
  is_starred: boolean;
  is_important: boolean;
  labels: string[] | null;
  date: string | null;
  in_reply_to: string | null;
  thread_id: string | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
  current_folder_id: string | null;
}

export interface CreateEmailMessageData {
  account_id: string;
  owner_user_id: string;
  folder_id?: string;
  message_uid?: string;
  message_id: string;
  from_address: string;
  from_name?: string;
  to_addresses: string[];
  cc_addresses?: string[];
  bcc_addresses?: string[];
  subject: string;
  body_text?: string;
  body_html?: string;
  body_preview?: string;
  has_attachments?: boolean;
  attachment_count?: number;
  date?: Date;
  in_reply_to?: string;
  thread_id?: string;
  size_bytes?: number;
}

/**
 * Crear mensaje (con deduplicación por message_uid + message_id)
 */
export async function createEmailMessage(data: CreateEmailMessageData): Promise<EmailMessage | null> {
  // Verificar si ya existe por UID (constraint único DB)
  if (data.message_uid) {
    const existingByUid = await getEmailMessageByUid(data.account_id, data.message_uid);
    if (existingByUid) {
      console.log('[REPO] ℹ️ Mensaje ya existe (UID):', data.message_uid);
      return existingByUid;
    }
  }
  
  // Verificar si ya existe por message_id (backup)
  const existing = await getEmailMessageByMessageId(data.account_id, data.message_id);
  if (existing) {
    console.log('[REPO] ℹ️ Mensaje ya existe (message_id):', data.message_id);
    return existing;
  }
  
  const { data: message, error } = await supabase
    .from('email_messages')
    .insert({
      ...data,
      date: data.date ? data.date.toISOString() : null,
      is_read: false,
      is_starred: false,
      is_important: false,
      has_attachments: data.has_attachments || false,
      attachment_count: data.attachment_count || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) {
    console.error('[REPO] ❌ Error al crear mensaje:', error);
    return null;
  }
  
  return message;
}

/**
 * Buscar mensaje por message_uid (constraint único con account_id)
 */
export async function getEmailMessageByUid(
  accountId: string,
  messageUid: string
): Promise<EmailMessage | null> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('account_id', accountId)
    .eq('message_uid', messageUid)
    .maybeSingle();
  
  if (error) {
    console.error('[REPO] ❌ Error al buscar mensaje por UID:', error);
    return null;
  }
  
  return data;
}

/**
 * Buscar mensaje por message_id (para deduplicación)
 */
export async function getEmailMessageByMessageId(
  accountId: string,
  messageId: string
): Promise<EmailMessage | null> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('account_id', accountId)
    .eq('message_id', messageId)
    .maybeSingle();
  
  if (error) {
    console.error('[REPO] ❌ Error al buscar mensaje:', error);
    return null;
  }
  
  return data;
}

/**
 * Obtener mensaje por ID (con validación de user_id)
 */
export async function getEmailMessageById(
  messageId: string,
  userId: string
): Promise<EmailMessage | null> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('id', messageId)
    .eq('owner_user_id', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('[REPO] ❌ Error al obtener mensaje:', error);
    throw new Error(`Error al obtener mensaje: ${error.message}`);
  }
  
  return data;
}

/**
 * Listar mensajes de una cuenta (inbox)
 */
export async function listEmailMessages(
  accountId: string,
  userId: string,
  options: {
    folderId?: string;
    limit?: number;
    offset?: number;
    onlyUnread?: boolean;
    isStarred?: boolean;
  } = {}
): Promise<{ messages: EmailMessage[]; total: number }> {
  let query = supabase
    .from('email_messages')
    .select('*', { count: 'exact' })
    .eq('account_id', accountId)
    .eq('owner_user_id', userId);
  
  if (options.folderId) {
    query = query.eq('current_folder_id', options.folderId);
  }
  
  if (options.onlyUnread) {
    query = query.eq('is_read', false);
  }
  
  if (options.isStarred) {
    query = query.eq('is_starred', true);
  }
  
  query = query.order('date', { ascending: false });
  
  if (options.limit) {
    query = query.limit(options.limit);
  }
  
  if (options.offset) {
    query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
  }
  
  const { data, error, count } = await query;
  
  if (error) {
    console.error('[REPO] ❌ Error al listar mensajes:', error);
    throw new Error(`Error al listar mensajes: ${error.message}`);
  }
  
  return {
    messages: data || [],
    total: count || 0
  };
}

/**
 * Actualizar mensaje
 */
export async function updateEmailMessage(
  messageId: string,
  userId: string,
  updates: Partial<EmailMessage>
): Promise<EmailMessage> {
  const { data, error } = await supabase
    .from('email_messages')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', messageId)
    .eq('owner_user_id', userId)
    .select()
    .single();
  
  if (error) {
    console.error('[REPO] ❌ Error al actualizar mensaje:', error);
    throw new Error(`Error al actualizar mensaje: ${error.message}`);
  }
  
  return data;
}

/**
 * Marcar mensaje como leído
 */
export async function markMessageAsRead(
  messageId: string,
  userId: string,
  isRead: boolean = true
): Promise<void> {
  await updateEmailMessage(messageId, userId, { is_read: isRead });
}

/**
 * Marcar mensaje como destacado
 */
export async function markMessageAsStarred(
  messageId: string,
  userId: string,
  isStarred: boolean = true
): Promise<void> {
  await updateEmailMessage(messageId, userId, { is_starred: isStarred });
}

/**
 * Mover mensaje a folder
 */
export async function moveMessageToFolder(
  messageId: string,
  userId: string,
  folderId: string
): Promise<void> {
  await updateEmailMessage(messageId, userId, { current_folder_id: folderId });
}

/**
 * Obtener último UID sincronizado para una cuenta/folder
 */
export async function getLastSyncedUid(
  accountId: string,
  folderId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('message_uid')
    .eq('account_id', accountId)
    .eq('folder_id', folderId)
    .not('message_uid', 'is', null)
    .order('message_uid', { ascending: false })
    .limit(1)
    .maybeSingle();
  
  if (error || !data || !data.message_uid) {
    return 0;
  }
  
  return parseInt(data.message_uid, 10);
}

/**
 * Buscar mensajes por texto
 */
export async function searchEmailMessages(
  accountId: string,
  userId: string,
  searchText: string,
  limit: number = 50
): Promise<EmailMessage[]> {
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('account_id', accountId)
    .eq('owner_user_id', userId)
    .or(`subject.ilike.%${searchText}%,body_text.ilike.%${searchText}%,from_address.ilike.%${searchText}%`)
    .order('date', { ascending: false })
    .limit(limit);
  
  if (error) {
    console.error('[REPO] ❌ Error al buscar mensajes:', error);
    return [];
  }
  
  return data || [];
}
