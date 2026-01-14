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

const router = Router();

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
