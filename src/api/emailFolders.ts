/**
 * =====================================================
 * EMAIL FOLDERS API
 * =====================================================
 * 
 * Endpoints para gestionar folders de email
 * 
 * POST /api/email/folders/resync - Resincronizar folders desde IMAP
 * =====================================================
 */

import { Router } from 'express';
import * as accountsRepo from '../repositories/emailAccountsRepo';
import * as foldersRepo from '../repositories/emailFoldersRepo';
import { listIMAPFolders } from '../services/imapService';

const router = Router();

/**
 * POST /api/email/folders/resync
 * 
 * Resincroniza folders desde IMAP para todas las cuentas activas
 * Detecta automáticamente las rutas IMAP correctas para cada proveedor
 * 
 * Body: {}
 * 
 * Response: {
 *   success: true,
 *   results: [
 *     {
 *       accountEmail: string,
 *       foldersUpdated: number,
 *       folders: Array<{name, type, path}>
 *     }
 *   ]
 * }
 */
router.post('/resync', async (req, res) => {
  try {
    console.log('[FOLDERS API] 🔄 Iniciando resincronización de folders...');
    
    // Obtener todas las cuentas activas
    const accounts = await accountsRepo.listActiveEmailAccounts();
    console.log(`[FOLDERS API] 📧 Encontradas ${accounts.length} cuentas activas`);
    
    if (accounts.length === 0) {
      return res.json({
        success: true,
        message: 'No hay cuentas activas para resincronizar',
        results: []
      });
    }
    
    const results = [];
    
    for (const account of accounts) {
      try {
        console.log(`[FOLDERS API] 🔍 Procesando: ${account.from_email}`);
        
        // Listar folders desde IMAP (detecta automáticamente el proveedor)
        const imapFolders = await listIMAPFolders({
          host: account.imap_host,
          port: account.imap_port,
          secure: account.imap_secure,
          user: account.imap_user,
          pass_enc: account.imap_pass_enc
        });
        
        console.log(`[FOLDERS API] 📂 Detectados ${imapFolders.length} folders en IMAP`);
        
        // Sincronizar folders (UPSERT: actualiza existentes o crea nuevos)
        const syncedFolders = await foldersRepo.syncFoldersFromIMAP(
          account.id,
          account.owner_user_id,
          imapFolders
        );
        
        console.log(`[FOLDERS API] ✅ Sincronizados ${syncedFolders.length} folders`);
        
        results.push({
          accountEmail: account.from_email,
          foldersUpdated: syncedFolders.length,
          folders: syncedFolders.map(f => ({
            name: f.folder_name,
            type: f.folder_type,
            path: f.imap_path
          }))
        });
        
      } catch (error: any) {
        console.error(`[FOLDERS API] ❌ Error en ${account.from_email}:`, error.message);
        results.push({
          accountEmail: account.from_email,
          error: error.message,
          foldersUpdated: 0
        });
      }
    }
    
    console.log('[FOLDERS API] 🎉 Resincronización completada');
    
    res.json({
      success: true,
      message: `Resincronizados folders para ${accounts.length} cuenta(s)`,
      results
    });
    
  } catch (error: any) {
    console.error('[FOLDERS API] ❌ Error fatal:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
