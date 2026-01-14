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

export interface CreateEmailMessageResult {
  message: EmailMessage | null;
  wasInserted: boolean;  // true = INSERT nuevo, false = duplicate skip
}

/**
 * Crear mensaje (IDEMPOTENTE con UPSERT - elimina race conditions)
 * Retorna { message, wasInserted } para distinguir entre INSERT real y duplicate skip
 */
export async function createEmailMessage(data: CreateEmailMessageData): Promise<CreateEmailMessageResult> {
  console.log(`[REPO:createEmailMessage] 🔵 Iniciando - account_id: ${data.account_id}, message_uid: ${data.message_uid}, message_id: ${data.message_id}`);
  
  // UPSERT idempotente - ON CONFLICT DO NOTHING
  console.log(`[REPO:createEmailMessage] 💾 UPSERT con ON CONFLICT - subject: "${data.subject}", from: ${data.from_address}`);
  
  const insertData = {
    ...data,
    date: data.date ? data.date.toISOString() : null,
    is_read: false,
    is_starred: false,
    is_important: false,
    has_attachments: data.has_attachments || false,
    attachment_count: data.attachment_count || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  // Intentar INSERT normal primero
  const { data: message, error } = await supabase
    .from('email_messages')
    .insert(insertData)
    .select()
    .single();
  
  if (error) {
    // Si es duplicate key (23505), buscar el existente y retornarlo (NO es error real)
    if (error.code === '23505') {
      console.log(`[REPO:createEmailMessage] ⏭️ Duplicate key detectado - buscando mensaje existente`);
      
      // Buscar por UID (constraint único real)
      if (data.message_uid) {
        const existing = await getEmailMessageByUid(data.account_id, data.message_uid);
        if (existing) {
          console.log(`[REPO:createEmailMessage] ✅ Skipped duplicate (UID) - id: ${existing.id}`);
          return { message: existing, wasInserted: false };
        }
      }
      
      // Fallback: buscar por message_id
      const existing = await getEmailMessageByMessageId(data.account_id, data.message_id);
      if (existing) {
        console.log(`[REPO:createEmailMessage] ✅ Skipped duplicate (message_id) - id: ${existing.id}`);
        return { message: existing, wasInserted: false };
      }
      
      // Si llegamos aquí, hay inconsistencia en DB (constraint sin dato)
      console.error(`[REPO:createEmailMessage] ❌ INCONSISTENCIA: Duplicate key pero mensaje no existe - account: ${data.account_id}, uid: ${data.message_uid}`);
      return { message: null, wasInserted: false };
    }
    
    // Error real (NO duplicate) - este SÍ debe loggearse completo
    console.error(`[REPO:createEmailMessage] ❌ Error REAL al crear mensaje (code: ${error.code}): ${error.message}`);
    return { message: null, wasInserted: false };
  }
  
  console.log(`[REPO:createEmailMessage] ✅ Mensaje insertado exitosamente - id: ${message.id}`);
  return { message, wasInserted: true };
}

/**
 * Buscar mensaje por message_uid (constraint único con account_id)
 */
export async function getEmailMessageByUid(
  accountId: string,
  messageUid: string
): Promise<EmailMessage | null> {
  console.log(`[REPO:getEmailMessageByUid] 🔍 Buscando - account_id: ${accountId}, message_uid: ${messageUid}`);
  
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('account_id', accountId)
    .eq('message_uid', messageUid)
    .maybeSingle();
  
  if (error) {
    console.error(`[REPO:getEmailMessageByUid] ❌ Error al buscar mensaje por UID: ${error.message}`, error);
    return null;
  }
  
  if (data) {
    console.log(`[REPO:getEmailMessageByUid] ✅ Mensaje encontrado - id: ${data.id}`);
  } else {
    console.log(`[REPO:getEmailMessageByUid] ⚪ No encontrado`);
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
  console.log(`[REPO:getEmailMessageByMessageId] 🔍 Buscando - account_id: ${accountId}, message_id: ${messageId}`);
  
  const { data, error } = await supabase
    .from('email_messages')
    .select('*')
    .eq('account_id', accountId)
    .eq('message_id', messageId)
    .maybeSingle();
  
  if (error) {
    console.error(`[REPO:getEmailMessageByMessageId] ❌ Error al buscar mensaje: ${error.message}`, error);
    return null;
  }
  
  if (data) {
    console.log(`[REPO:getEmailMessageByMessageId] ✅ Mensaje encontrado - id: ${data.id}`);
  } else {
    console.log(`[REPO:getEmailMessageByMessageId] ⚪ No encontrado`);
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
