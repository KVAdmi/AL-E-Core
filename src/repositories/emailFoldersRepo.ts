/**
 * =====================================================
 * EMAIL FOLDERS REPOSITORY
 * =====================================================
 * 
 * Acceso a tabla email_folders en Supabase
 * Gestión de carpetas/folders del buzón
 * =====================================================
 */

import { supabase } from '../db/supabase';

export interface EmailFolder {
  id: string;
  account_id: string;
  owner_user_id: string;
  folder_name: string;
  folder_type: string; // inbox, sent, drafts, trash, archive, custom
  imap_path: string | null;
  unread_count: number;
  total_count: number;
  icon: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailFolderData {
  account_id: string;
  owner_user_id: string;
  folder_name: string;
  folder_type: string;
  imap_path: string;
  icon?: string;
  color?: string;
  sort_order?: number;
}

/**
 * Crear folder
 */
export async function createEmailFolder(data: CreateEmailFolderData): Promise<EmailFolder> {
  // Verificar si ya existe
  const existing = await getEmailFolderByPath(data.account_id, data.imap_path);
  if (existing) {
    console.log('[REPO] ℹ️ Folder ya existe:', data.imap_path);
    return existing;
  }
  
  const { data: folder, error } = await supabase
    .from('email_folders')
    .insert({
      ...data,
      unread_count: 0,
      total_count: 0,
      sort_order: data.sort_order || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) {
    console.error('[REPO] ❌ Error al crear folder:', error);
    throw new Error(`Error al crear folder: ${error.message}`);
  }
  
  return folder;
}

/**
 * Obtener folder por path IMAP
 */
export async function getEmailFolderByPath(
  accountId: string,
  imapPath: string
): Promise<EmailFolder | null> {
  const { data, error } = await supabase
    .from('email_folders')
    .select('*')
    .eq('account_id', accountId)
    .eq('imap_path', imapPath)
    .maybeSingle();
  
  if (error) {
    console.error('[REPO] ❌ Error al buscar folder:', error);
    return null;
  }
  
  return data;
}

/**
 * Obtener folder por tipo (Inbox, Sent, Drafts, etc)
 */
export async function getEmailFolderByType(
  accountId: string,
  folderType: string
): Promise<EmailFolder | null> {
  const { data, error } = await supabase
    .from('email_folders')
    .select('*')
    .eq('account_id', accountId)
    .eq('folder_type', folderType)
    .maybeSingle();
  
  if (error) {
    console.error('[REPO] ❌ Error al buscar folder por tipo:', error);
    return null;
  }
  
  return data;
}

/**
 * Listar folders de una cuenta
 */
export async function listEmailFolders(
  accountId: string,
  userId: string
): Promise<EmailFolder[]> {
  const { data, error } = await supabase
    .from('email_folders')
    .select('*')
    .eq('account_id', accountId)
    .eq('owner_user_id', userId)
    .order('sort_order', { ascending: true })
    .order('folder_name', { ascending: true });
  
  if (error) {
    console.error('[REPO] ❌ Error al listar folders:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Actualizar contadores de folder
 */
export async function updateFolderCounts(
  folderId: string,
  unreadCount: number,
  totalCount: number
): Promise<void> {
  const { error } = await supabase
    .from('email_folders')
    .update({
      unread_count: unreadCount,
      total_count: totalCount,
      updated_at: new Date().toISOString()
    })
    .eq('id', folderId);
  
  if (error) {
    console.error('[REPO] ❌ Error al actualizar contadores:', error);
  }
}

/**
 * Obtener folder por ID
 */
export async function getEmailFolderById(
  folderId: string,
  userId: string
): Promise<EmailFolder | null> {
  const { data, error } = await supabase
    .from('email_folders')
    .select('*')
    .eq('id', folderId)
    .eq('owner_user_id', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null;
    }
    console.error('[REPO] ❌ Error al obtener folder:', error);
    return null;
  }
  
  return data;
}

/**
 * Sincronizar folders desde IMAP (UPSERT)
 * 
 * Actualiza folders existentes o crea nuevos
 */
export async function syncFoldersFromIMAP(
  accountId: string,
  userId: string,
  imapFolders: Array<{ path: string; delimiter: string; flags: string[]; specialUse?: string }>
): Promise<EmailFolder[]> {
  const syncedFolders: EmailFolder[] = [];
  
  for (const imapFolder of imapFolders) {
    // Determinar tipo de folder
    let folderType = 'custom';
    let icon = '📁';
    let sortOrder = 999;
    
    const pathLower = imapFolder.path.toLowerCase();
    
    if (pathLower === 'inbox' || imapFolder.specialUse === '\\Inbox') {
      folderType = 'inbox';
      icon = '📥';
      sortOrder = 1;
    } else if (pathLower.includes('sent') || imapFolder.specialUse === '\\Sent') {
      folderType = 'sent';
      icon = '📤';
      sortOrder = 2;
    } else if (pathLower.includes('draft') || imapFolder.specialUse === '\\Drafts') {
      folderType = 'drafts';
      icon = '📝';
      sortOrder = 3;
    } else if (pathLower.includes('trash') || imapFolder.specialUse === '\\Trash') {
      folderType = 'trash';
      icon = '🗑️';
      sortOrder = 4;
    } else if (pathLower.includes('spam') || pathLower.includes('junk') || imapFolder.specialUse === '\\Junk') {
      folderType = 'spam';
      icon = '⚠️';
      sortOrder = 5;
    } else if (pathLower.includes('archive') || imapFolder.specialUse === '\\Archive') {
      folderType = 'archive';
      icon = '📦';
      sortOrder = 6;
    }
    
    try {
      // 🔥 UPSERT: Buscar folder existente por folder_type (más confiable que por nombre)
      const { data: existingFolder } = await supabase
        .from('email_folders')
        .select('*')
        .eq('account_id', accountId)
        .eq('folder_type', folderType)
        .single();
      
      if (existingFolder) {
        // Actualizar folder existente con la ruta IMAP correcta
        console.log(`[REPO] 🔄 Actualizando folder ${folderType}: ${existingFolder.imap_path} → ${imapFolder.path}`);
        
        const { data: updated, error: updateError } = await supabase
          .from('email_folders')
          .update({
            folder_name: imapFolder.path,
            imap_path: imapFolder.path,
            icon,
            sort_order: sortOrder,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingFolder.id)
          .select()
          .single();
        
        if (updateError) {
          console.error('[REPO] ❌ Error actualizando folder:', updateError);
        } else if (updated) {
          syncedFolders.push(updated);
        }
      } else {
        // Crear nuevo folder
        console.log(`[REPO] ➕ Creando nuevo folder ${folderType}: ${imapFolder.path}`);
        
        const folder = await createEmailFolder({
          account_id: accountId,
          owner_user_id: userId,
          folder_name: imapFolder.path,
          folder_type: folderType,
          imap_path: imapFolder.path,
          icon,
          sort_order: sortOrder
        });
        
        syncedFolders.push(folder);
      }
    } catch (error) {
      console.error('[REPO] ⚠️ Error al sincronizar folder:', imapFolder.path, error);
    }
  }
  
  return syncedFolders;
}
