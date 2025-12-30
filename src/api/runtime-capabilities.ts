/**
 * Runtime Capabilities API
 * 
 * Endpoint para exponer las capacidades reales del sistema
 * que AL-EON (frontend) usa para habilitar/deshabilitar features.
 * 
 * CRÍTICO: Este archivo lee runtime-capabilities.json (LEY SUPREMA)
 */

import express from 'express';
import { requireAuth } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

const router = express.Router();

/**
 * GET /api/runtime-capabilities
 * 
 * Devuelve las capacidades reales del sistema.
 * REQUIERE autenticación JWT.
 * 
 * Response exitoso:
 * {
 *   "mail.send": true,
 *   "mail.inbox": false,
 *   "calendar.create": true,
 *   ...
 * }
 * 
 * Response con error:
 * {
 *   "success": false,
 *   "userMessage": "Mensaje para el usuario"
 * }
 */
router.get('/', requireAuth, async (req, res) => {
  try {
    console.log('[RUNTIME-CAP] Request from user:', req.user?.id);
    
    // Leer el archivo runtime-capabilities.json
    const capabilitiesPath = path.join(__dirname, '../../CONTRACTS/runtime-capabilities.json');
    
    if (!fs.existsSync(capabilitiesPath)) {
      console.error('[RUNTIME-CAP] ❌ File not found:', capabilitiesPath);
      return res.status(500).json({
        success: false,
        userMessage: 'No se pudo cargar la configuración de capacidades del sistema.'
      });
    }
    
    const fileContent = fs.readFileSync(capabilitiesPath, 'utf-8');
    const capabilities = JSON.parse(fileContent);
    
    console.log('[RUNTIME-CAP] ✓ Capabilities loaded:', Object.keys(capabilities).length, 'keys');
    
    // Devolver las capacidades directamente
    res.json(capabilities);
    
  } catch (error) {
    console.error('[RUNTIME-CAP] ❌ Error loading capabilities:', error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    res.status(500).json({
      success: false,
      userMessage: 'Error al cargar las capacidades del sistema. Por favor, intenta más tarde.'
    });
  }
});

export default router;
