/**
 * =====================================================
 * EMAIL SYNC WORKER - AUTO SYNC
 * =====================================================
 * 
 * Job que sincroniza automáticamente todas las cuentas
 * activas cada 5 minutos
 * 
 * Características:
 * - Ejecuta en background
 * - Maneja errores sin crashear
 * - Logging detallado
 * =====================================================
 */

import { syncIMAPMessages } from '../services/imapService';
import * as accountsRepo from '../repositories/emailAccountsRepo';
import * as messagesRepo from '../repositories/emailMessagesRepo';
import * as foldersRepo from '../repositories/emailFoldersRepo';
import * as syncLogRepo from '../repositories/emailSyncLogRepo';

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const MAX_MESSAGES_PER_SYNC = 50; // Límite para evitar sobrecarga

/**
 * Sincronizar una cuenta
 */
async function syncAccount(account: any): Promise<void> {
  console.log('[SYNC WORKER] 🔄 Sincronizando cuenta:', account.id, '(' + account.from_email + ')');
  
  // Crear sync log
  const logId = await syncLogRepo.createSyncLog({
    account_id: account.id,
    sync_type: 'auto'
  });
  
  try {
    // Obtener folders de la cuenta
    const folders = await foldersRepo.listEmailFolders(account.id, account.owner_user_id);
    
    if (folders.length === 0) {
      console.log('[SYNC WORKER] ⚠️ No hay folders para sincronizar');
      await syncLogRepo.completeSyncLog(logId, {
        status: 'failed',
        messages_fetched: 0,
        messages_new: 0,
        messages_updated: 0,
        errors: 'No folders found'
      });
      return;
    }
    
    let totalFetched = 0;
    let totalNew = 0;
    const errors: string[] = [];
    
    // Sincronizar solo INBOX por ahora (para evitar sobrecarga)
    const inboxFolder = folders.find(f => f.imap_path === 'INBOX');
    
    if (!inboxFolder) {
      console.log('[SYNC WORKER] ⚠️ Folder INBOX no encontrado');
      await syncLogRepo.completeSyncLog(logId, {
        status: 'failed',
        messages_fetched: 0,
        messages_new: 0,
        messages_updated: 0,
        errors: 'INBOX folder not found'
      });
      return;
    }
    
    try {
      // Obtener último UID sincronizado
      const lastUid = await messagesRepo.getLastSyncedUid(account.id, inboxFolder.id);
      
      console.log('[SYNC WORKER] 📬 Sincronizando INBOX, último UID:', lastUid);
      
      // Sincronizar mensajes
      const imapMessages = await syncIMAPMessages(
        {
          host: account.imap_host,
          port: account.imap_port,
          secure: account.imap_secure,
          user: account.imap_user,
          pass_enc: account.imap_pass_enc
        },
        inboxFolder.imap_path || 'INBOX',
        lastUid,
        MAX_MESSAGES_PER_SYNC
      );
      
      console.log('[SYNC WORKER] 📨 Mensajes obtenidos:', imapMessages.length);
      
      totalFetched += imapMessages.length;
      
      // Guardar en DB
      for (const msg of imapMessages) {
        try {
          const created = await messagesRepo.createEmailMessage({
            account_id: account.id,
            owner_user_id: account.owner_user_id,
            folder_id: inboxFolder.id,
            message_uid: msg.uid.toString(),
            message_id: msg.messageId,
            from_address: msg.from.email,
            from_name: msg.from.name,
            to_addresses: msg.to.map(t => t.email),
            cc_addresses: msg.cc?.map(c => c.email),
            subject: msg.subject,
            body_text: msg.bodyText,
            body_html: msg.bodyHtml,
            body_preview: msg.bodyPreview,
            has_attachments: msg.hasAttachments,
            attachment_count: msg.attachments.length,
            date: msg.date,
            in_reply_to: msg.inReplyTo,
            size_bytes: msg.size
          });
          
          if (created) totalNew++;
        } catch (error: any) {
          console.error('[SYNC WORKER] ⚠️ Error al guardar mensaje:', error.message);
          errors.push(`Error saving message ${msg.messageId}: ${error.message}`);
        }
      }
    } catch (error: any) {
      console.error('[SYNC WORKER] ❌ Error al sincronizar INBOX:', error.message);
      errors.push(`INBOX: ${error.message}`);
    }
    
    // Completar sync log
    const status = errors.length === 0 ? 'success' : (totalNew > 0 ? 'partial' : 'failed');
    
    await syncLogRepo.completeSyncLog(logId, {
      status,
      messages_fetched: totalFetched,
      messages_new: totalNew,
      messages_updated: 0,
      errors: errors.length > 0 ? errors.join('; ') : undefined
    });
    
    console.log('[SYNC WORKER] ✅ Sync completado:', {
      account: account.from_email,
      fetched: totalFetched,
      new: totalNew,
      status
    });
  } catch (error: any) {
    console.error('[SYNC WORKER] ❌ Error general en sync:', error.message);
    
    await syncLogRepo.completeSyncLog(logId, {
      status: 'failed',
      messages_fetched: 0,
      messages_new: 0,
      messages_updated: 0,
      errors: error.message
    });
  }
}

/**
 * Ejecutar sync de todas las cuentas activas
 */
async function runSync(): Promise<void> {
  try {
    console.log('[SYNC WORKER] 🚀 Iniciando sync automático...');
    
    // Obtener cuentas activas con IMAP configurado
    const accounts = await accountsRepo.listActiveEmailAccounts();
    
    if (accounts.length === 0) {
      console.log('[SYNC WORKER] ℹ️ No hay cuentas activas para sincronizar');
      return;
    }
    
    console.log('[SYNC WORKER] 📬 Cuentas a sincronizar:', accounts.length);
    
    // Sincronizar cada cuenta (secuencial para evitar sobrecarga)
    for (const account of accounts) {
      try {
        await syncAccount(account);
        
        // Esperar 2 segundos entre cuentas
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error: any) {
        console.error('[SYNC WORKER] ❌ Error al sincronizar cuenta:', account.id, error.message);
      }
    }
    
    console.log('[SYNC WORKER] ✅ Sync automático completado');
  } catch (error: any) {
    console.error('[SYNC WORKER] ❌ Error en runSync:', error.message);
  }
}

/**
 * Iniciar worker de sincronización
 */
export function startEmailSyncWorker(): void {
  console.log('[SYNC WORKER] 🎬 Iniciando Email Sync Worker...');
  console.log('[SYNC WORKER] ⏱️ Intervalo:', SYNC_INTERVAL_MS / 1000, 'segundos');
  
  // Ejecutar primera sync después de 30 segundos (para dar tiempo al servidor)
  setTimeout(() => {
    console.log('[SYNC WORKER] 🔄 Primera sincronización...');
    runSync();
  }, 30000);
  
  // Programar syncs periódicos
  setInterval(() => {
    runSync();
  }, SYNC_INTERVAL_MS);
  
  console.log('[SYNC WORKER] ✅ Worker iniciado');
}

/**
 * Forzar sync manual (útil para testing)
 */
export async function forceSync(): Promise<void> {
  await runSync();
}
