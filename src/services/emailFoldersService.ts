/**
 * =====================================================
 * EMAIL FOLDERS SERVICE
 * =====================================================
 * 
 * Gestiona el descubrimiento y población de folders IMAP
 * en la base de datos email_folders
 * 
 * =====================================================
 */

import { supabase } from '../db/supabase';
import { discoverIMAPFolders, DiscoveredFolder, IMAPConfig } from './imapService';

export interface EmailAccount {
  id: string;
  owner_user_id: string;
  from_email: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_user: string;
  imap_pass_enc: string;
  is_active: boolean;
}

/**
 * Descubre y guarda folders para una cuenta específica
 */
export async function discoverAndSaveFolders(account: EmailAccount): Promise<void> {
  try {
    console.log('[FOLDERS SERVICE] 🔍 Descubriendo folders para', account.from_email);
    
    // Validar IMAP config
    if (!account.imap_host || !account.imap_user || !account.imap_pass_enc) {
      console.warn('[FOLDERS SERVICE] ⚠️ Cuenta sin configuración IMAP completa');
      return;
    }
    
    const imapConfig: IMAPConfig = {
      host: account.imap_host,
      port: account.imap_port,
      secure: account.imap_secure,
      user: account.imap_user,
      pass_enc: account.imap_pass_enc
    };
    
    // Descubrir folders via IMAP
    const discovered = await discoverIMAPFolders(imapConfig);
    
    console.log('[FOLDERS SERVICE] 📁 Descubiertos', discovered.length, 'folders');
    
    // Insertar en base de datos
    const foldersToInsert = discovered.map(folder => ({
      account_id: account.id,
      owner_user_id: account.owner_user_id,
      folder_name: folder.displayName,
      folder_type: folder.folderType,
      imap_path: folder.path,
      unread_count: 0,
      total_count: 0,
      sort_order: getSortOrder(folder.folderType)
    }));
    
    const { data, error } = await supabase
      .from('email_folders')
      .upsert(foldersToInsert, {
        onConflict: 'account_id,imap_path',
        ignoreDuplicates: false
      })
      .select();
    
    if (error) {
      console.error('[FOLDERS SERVICE] ❌ Error insertando folders:', error);
      throw error;
    }
    
    console.log('[FOLDERS SERVICE] ✅ Guardados', data?.length || 0, 'folders en DB');
    
  } catch (error: any) {
    console.error('[FOLDERS SERVICE] ❌ Error en discoverAndSaveFolders:', error.message);
    throw error;
  }
}

/**
 * Pobla folders para todas las cuentas activas de un usuario
 */
export async function populateFoldersForUser(userId: string): Promise<void> {
  try {
    console.log('[FOLDERS SERVICE] 👤 Poblando folders para usuario:', userId);
    
    // Obtener cuentas activas del usuario
    const { data: accounts, error } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('owner_user_id', userId)
      .eq('is_active', true);
    
    if (error) {
      throw error;
    }
    
    if (!accounts || accounts.length === 0) {
      console.warn('[FOLDERS SERVICE] ⚠️ No se encontraron cuentas activas');
      return;
    }
    
    console.log('[FOLDERS SERVICE] 📧 Encontradas', accounts.length, 'cuentas activas');
    
    // Poblar folders para cada cuenta
    for (const account of accounts) {
      try {
        await discoverAndSaveFolders(account as EmailAccount);
      } catch (error: any) {
        console.error(`[FOLDERS SERVICE] ❌ Error poblando folders para ${account.from_email}:`, error.message);
        // Continuar con las demás cuentas
      }
    }
    
    console.log('[FOLDERS SERVICE] ✅ Proceso completado');
    
  } catch (error: any) {
    console.error('[FOLDERS SERVICE] ❌ Error en populateFoldersForUser:', error.message);
    throw error;
  }
}

/**
 * Pobla folders para todas las cuentas activas del sistema
 */
export async function populateFoldersForAllAccounts(): Promise<void> {
  try {
    console.log('[FOLDERS SERVICE] 🌐 Poblando folders para TODAS las cuentas...');
    
    // Obtener todas las cuentas activas
    const { data: accounts, error } = await supabase
      .from('email_accounts')
      .select('*')
      .eq('is_active', true);
    
    if (error) {
      throw error;
    }
    
    if (!accounts || accounts.length === 0) {
      console.warn('[FOLDERS SERVICE] ⚠️ No se encontraron cuentas activas en el sistema');
      return;
    }
    
    console.log('[FOLDERS SERVICE] 📧 Encontradas', accounts.length, 'cuentas activas');
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const account of accounts) {
      try {
        await discoverAndSaveFolders(account as EmailAccount);
        successCount++;
      } catch (error: any) {
        console.error(`[FOLDERS SERVICE] ❌ Error poblando folders para ${account.from_email}:`, error.message);
        errorCount++;
      }
    }
    
    console.log(`[FOLDERS SERVICE] ✅ Proceso completado: ${successCount} exitosas, ${errorCount} errores`);
    
  } catch (error: any) {
    console.error('[FOLDERS SERVICE] ❌ Error en populateFoldersForAllAccounts:', error.message);
    throw error;
  }
}

/**
 * Verifica si una cuenta tiene folders configurados
 */
export async function accountHasFolders(accountId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('email_folders')
      .select('id')
      .eq('account_id', accountId)
      .limit(1);
    
    if (error) {
      console.error('[FOLDERS SERVICE] ❌ Error verificando folders:', error);
      return false;
    }
    
    return data && data.length > 0;
    
  } catch (error) {
    console.error('[FOLDERS SERVICE] ❌ Error en accountHasFolders:', error);
    return false;
  }
}

/**
 * Define el orden de los folders en la UI
 */
function getSortOrder(folderType: string): number {
  const order: Record<string, number> = {
    inbox: 1,
    drafts: 2,
    sent: 3,
    spam: 4,
    trash: 5,
    archive: 6,
    other: 99
  };
  
  return order[folderType] || 99;
}
