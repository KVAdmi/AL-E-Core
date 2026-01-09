/**
 * =====================================================
 * SCRIPT: Resincronizar folders desde IMAP
 * =====================================================
 * 
 * Este script conecta a IMAP y resincroniza los folders
 * con sus rutas correctas (ej: [Gmail]/Spam)
 * 
 * USO:
 * node debug-resync-folders.js
 * =====================================================
 */

const { listIMAPFolders } = require('./dist/services/imapService');
const { getActiveEmailAccounts } = require('./dist/repositories/emailAccountsRepo');
const { syncFoldersFromIMAP } = require('./dist/repositories/emailFoldersRepo');

async function resyncFolders() {
  try {
    console.log('[RESYNC] 🔄 Iniciando resincronización de folders...');
    
    // Obtener cuentas activas
    const accounts = await getActiveEmailAccounts();
    console.log(`[RESYNC] 📧 Encontradas ${accounts.length} cuentas activas`);
    
    for (const account of accounts) {
      console.log(`\n[RESYNC] 🔍 Procesando cuenta: ${account.from_email}`);
      
      try {
        // Listar folders desde IMAP
        const imapFolders = await listIMAPFolders({
          host: account.imap_host,
          port: account.imap_port,
          secure: account.imap_secure,
          user: account.imap_user,
          pass_enc: account.imap_pass_enc
        });
        
        console.log(`[RESYNC] 📂 Encontrados ${imapFolders.length} folders en IMAP:`);
        imapFolders.forEach(f => {
          console.log(`  - ${f.path} ${f.specialUse ? '(' + f.specialUse + ')' : ''}`);
        });
        
        // Sincronizar folders en DB (esto actualiza imap_path con UPSERT)
        const syncedFolders = await syncFoldersFromIMAP(
          account.id,
          account.owner_user_id,
          imapFolders
        );
        
        console.log(`[RESYNC] ✅ Sincronizados ${syncedFolders.length} folders para ${account.from_email}`);
        
        // Mostrar resultado
        syncedFolders.forEach(f => {
          console.log(`  ✓ ${f.folder_name} (${f.folder_type}) → ${f.imap_path}`);
        });
        
      } catch (error) {
        console.error(`[RESYNC] ❌ Error en cuenta ${account.from_email}:`, error.message);
      }
    }
    
    console.log('\n[RESYNC] 🎉 Resincronización completada');
    process.exit(0);
    
  } catch (error) {
    console.error('[RESYNC] ❌ Error fatal:', error);
    process.exit(1);
  }
}

resyncFolders();
