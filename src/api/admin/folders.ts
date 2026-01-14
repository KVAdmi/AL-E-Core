/**
 * =====================================================
 * ADMIN ENDPOINTS - EMAIL FOLDERS
 * =====================================================
 * 
 * Endpoints administrativos para gestionar folders
 * 
 * =====================================================
 */

import { Router, Request, Response } from 'express';
import { populateFoldersForUser, populateFoldersForAllAccounts } from '../../services/emailFoldersService';
import { supabase } from '../../db/supabase';

const router = Router();

/**
 * GET /api/admin/folders/check/:userId
 * Verifica folders en DB para un usuario
 */
router.get('/check/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    console.log('[ADMIN] Verificando folders para usuario:', userId);
    
    // Obtener folders
    const { data: folders, error: foldersError } = await supabase
      .from('email_folders')
      .select('id, account_id, folder_name, folder_type, imap_path')
      .eq('owner_user_id', userId)
      .order('created_at', { ascending: false });
    
    // Obtener cuentas
    const { data: accounts, error: accountsError } = await supabase
      .from('email_accounts')
      .select('id, from_email, is_active')
      .eq('owner_user_id', userId);
    
    res.json({
      success: true,
      userId,
      folders: {
        count: folders?.length || 0,
        items: folders || []
      },
      accounts: {
        count: accounts?.length || 0,
        items: accounts || []
      },
      errors: {
        folders: foldersError,
        accounts: accountsError
      }
    });
    
  } catch (error: any) {
    console.error('[ADMIN] Error verificando folders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/folders/repopulate/:userId
 * Elimina folders existentes y los vuelve a descubrir (útil para fix de normalization bugs)
 */
router.post('/repopulate/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    console.log('[ADMIN] Re-poblando folders para usuario:', userId);
    
    // Eliminar folders existentes del usuario
    const { error: deleteError } = await supabase
      .from('email_folders')
      .delete()
      .eq('owner_user_id', userId);
    
    if (deleteError) {
      throw new Error(`Error eliminando folders: ${deleteError.message}`);
    }
    
    console.log('[ADMIN] ✅ Folders antiguos eliminados');
    
    // Poblar folders nuevamente
    await populateFoldersForUser(userId);
    
    res.json({
      success: true,
      message: `Folders re-poblados exitosamente para usuario ${userId}`
    });
    
  } catch (error: any) {
    console.error('[ADMIN] Error re-poblando folders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/folders/populate/:userId
 * Pobla folders para un usuario específico
 */
router.post('/populate/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    console.log('[ADMIN] Poblando folders para usuario:', userId);
    
    await populateFoldersForUser(userId);
    
    res.json({
      success: true,
      message: `Folders poblados exitosamente para usuario ${userId}`
    });
    
  } catch (error: any) {
    console.error('[ADMIN] Error poblando folders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/folders/populate-all
 * Pobla folders para todas las cuentas activas
 */
router.post('/populate-all', async (req: Request, res: Response) => {
  try {
    console.log('[ADMIN] Poblando folders para TODAS las cuentas...');
    
    await populateFoldersForAllAccounts();
    
    res.json({
      success: true,
      message: 'Folders poblados exitosamente para todas las cuentas'
    });
    
  } catch (error: any) {
    console.error('[ADMIN] Error poblando folders:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
