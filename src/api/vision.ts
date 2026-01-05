/**
 * =====================================================
 * VISION API ROUTER - P0 EXPRESS
 * =====================================================
 * POST /api/vision/analyze - Analiza imagen con Google Vision
 */

import express from 'express';
import { analyzeImage, sanitizePII } from '../services/visionService';
import { supabase } from '../db/supabase';

const router = express.Router();

// ═══════════════════════════════════════════════════════════════
// POST /api/vision/analyze - Analizar imagen
// ═══════════════════════════════════════════════════════════════

router.post('/analyze', async (req, res) => {
  try {
    const { imageBase64, imageUrl, sanitize = false } = req.body;
    
    if (!imageBase64 && !imageUrl) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_IMAGE',
        message: 'Debes proveer imageBase64 o imageUrl'
      });
    }
    
    console.log('[VISION] 📸 Request recibido');
    
    // Analizar imagen
    const result = await analyzeImage(imageBase64 || imageUrl);
    
    // Sanitizar PII si se solicita
    const finalText = sanitize ? sanitizePII(result.fullText) : result.fullText;
    
    // Guardar en DB para auditoría
    await supabase
      .from('vision_requests')
      .insert({
        request_id: result.requestId,
        image_hash: result.imageHash,
        full_text: finalText,
        entities: result.entities,
        structured: result.structured,
        sanitized: sanitize
      })
      .select()
      .single();
    
    console.log('[VISION] ✅ Análisis completado:', result.requestId);
    
    return res.json({
      success: true,
      requestId: result.requestId,
      imageHash: result.imageHash,
      fullText: finalText,
      entities: result.entities,
      structured: result.structured,
      charCount: finalText.length
    });
    
  } catch (error: any) {
    console.error('[VISION] ❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: 'VISION_ERROR',
      message: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/vision/history - Historial de análisis
// ═══════════════════════════════════════════════════════════════

router.get('/history', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    const { data, error } = await supabase
      .from('vision_requests')
      .select('request_id, image_hash, created_at, full_text, entities')
      .order('created_at', { ascending: false })
      .limit(parseInt(limit as string));
    
    if (error) throw error;
    
    return res.json({
      success: true,
      history: data || []
    });
    
  } catch (error: any) {
    console.error('[VISION] ❌ Error fetching history:', error);
    return res.status(500).json({
      success: false,
      error: 'DB_ERROR',
      message: error.message
    });
  }
});

export default router;
