/**
 * =====================================================
 * TOOL HANDLERS - Image Generation
 * =====================================================
 * 
 * Implementaciones de herramientas para:
 * - Generar imágenes con Replicate (Stable Diffusion XL)
 * - Procesar prompts de imagen
 * =====================================================
 */

import axios from 'axios';
import { ToolResult } from '../registry';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const REPLICATE_API_KEY = process.env.REPLICATE_API_KEY;
const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

// ═══════════════════════════════════════════════════════════════
// GENERATE IMAGE (Replicate - SDXL)
// ═══════════════════════════════════════════════════════════════

export async function generateImageHandler(args: {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
}): Promise<ToolResult> {
  const { 
    prompt, 
    negativePrompt = 'low quality, blurry, distorted',
    width = 1024,
    height = 1024
  } = args;
  
  try {
    if (!REPLICATE_API_KEY) {
      throw new Error('REPLICATE_API_KEY no configurado');
    }

    console.log(`[TOOL] generate_image: "${prompt.substring(0, 50)}..."`);

    // 1. Crear predicción
    const createResponse = await axios.post(
      `${REPLICATE_API_BASE}/predictions`,
      {
        version: 'stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
        input: {
          prompt,
          negative_prompt: negativePrompt,
          width,
          height,
          num_outputs: 1,
          scheduler: 'K_EULER'
        }
      },
      {
        headers: {
          'Authorization': `Token ${REPLICATE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    const predictionId = createResponse.data.id;
    const getUrl = createResponse.data.urls.get;

    // 2. Polling hasta que termine (máximo 60 segundos)
    let status = 'starting';
    let outputUrl = null;
    let attempts = 0;
    const maxAttempts = 30; // 30 intentos x 2 seg = 60 seg

    while (status !== 'succeeded' && status !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 seg
      
      const statusResponse = await axios.get(getUrl, {
        headers: {
          'Authorization': `Token ${REPLICATE_API_KEY}`
        },
        timeout: 5000
      });

      status = statusResponse.data.status;
      
      if (status === 'succeeded') {
        outputUrl = statusResponse.data.output?.[0];
        break;
      }
      
      if (status === 'failed') {
        throw new Error(`Generación falló: ${statusResponse.data.error}`);
      }

      attempts++;
    }

    if (!outputUrl) {
      throw new Error('Timeout: imagen no generada en 60 segundos');
    }

    const data = {
      prompt,
      imageUrl: outputUrl,
      width,
      height,
      predictionId
    };

    return {
      success: true,
      data,
      source: 'Replicate (Stable Diffusion XL)',
      timestamp: new Date().toISOString(),
      provider: 'replicate'
    };
  } catch (error: any) {
    console.error('[TOOL] generate_image error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'replicate'
    };
  }
}
