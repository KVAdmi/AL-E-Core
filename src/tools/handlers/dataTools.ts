/**
 * =====================================================
 * TOOL HANDLERS - Datos Cotidianos
 * =====================================================
 * 
 * Implementaciones de herramientas para:
 * - Tipo de cambio (ExchangeRate API)
 * - Recetas (TheMealDB)
 * - Cómputo/Matemáticas (Wolfram Alpha)
 * =====================================================
 */

import axios from 'axios';
import { ToolResult } from '../registry';

// ═══════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════

const EXCHANGERATE_API_KEY = process.env.EXCHANGERATE_API_KEY;
const WOLFRAM_APP_ID = process.env.WOLFRAM_APP_ID;

// ═══════════════════════════════════════════════════════════════
// EXCHANGE RATE
// ═══════════════════════════════════════════════════════════════

export async function getExchangeRateHandler(args: { 
  from: string; 
  to: string; 
  amount?: number 
}): Promise<ToolResult> {
  const { from, to, amount = 1 } = args;
  
  try {
    if (!EXCHANGERATE_API_KEY) {
      throw new Error('EXCHANGERATE_API_KEY no configurada');
    }

    console.log(`[TOOL] get_exchange_rate: ${from} → ${to}`);

    const response = await axios.get(
      `https://v6.exchangerate-api.com/v6/${EXCHANGERATE_API_KEY}/pair/${from}/${to}/${amount}`,
      { timeout: 10000 }
    );

    const data = {
      from,
      to,
      amount,
      rate: response.data.conversion_rate,
      result: response.data.conversion_result,
      lastUpdate: response.data.time_last_update_utc
    };

    return {
      success: true,
      data,
      source: 'ExchangeRate API',
      timestamp: new Date().toISOString(),
      provider: 'exchangerate-api'
    };
  } catch (error: any) {
    console.error('[TOOL] get_exchange_rate error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'exchangerate-api'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// RECIPES (TheMealDB)
// ═══════════════════════════════════════════════════════════════

export async function searchRecipesHandler(args: {
  ingredient?: string;
  name?: string;
  category?: string;
}): Promise<ToolResult> {
  const { ingredient, name, category } = args;
  
  try {
    console.log('[TOOL] search_recipes:', { ingredient, name, category });

    let url = 'https://www.themealdb.com/api/json/v1/1/';
    
    if (ingredient) {
      url += `filter.php?i=${encodeURIComponent(ingredient)}`;
    } else if (name) {
      url += `search.php?s=${encodeURIComponent(name)}`;
    } else if (category) {
      url += `filter.php?c=${encodeURIComponent(category)}`;
    }

    const response = await axios.get(url, { timeout: 10000 });

    let meals = response.data.meals || [];
    
    // Si es búsqueda por ingrediente/categoría, solo trae ID e imagen
    // Necesitamos fetch de detalles
    if (ingredient || category) {
      meals = meals.slice(0, 5); // Limitar a 5 para no sobrecargar
    }

    const data = {
      criteria: { ingredient, name, category },
      meals: meals.map((meal: any) => ({
        id: meal.idMeal,
        name: meal.strMeal,
        category: meal.strCategory,
        area: meal.strArea,
        thumbnail: meal.strMealThumb,
        instructions: meal.strInstructions?.substring(0, 500)
      })),
      count: meals.length
    };

    return {
      success: true,
      data,
      source: 'TheMealDB',
      timestamp: new Date().toISOString(),
      provider: 'themealdb'
    };
  } catch (error: any) {
    console.error('[TOOL] search_recipes error:', error.message);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      provider: 'themealdb'
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// WOLFRAM ALPHA
// ═══════════════════════════════════════════════════════════════

export async function wolframComputeHandler(args: {
  query: string;
  format?: 'plaintext' | 'image' | 'json';
}): Promise<ToolResult> {
  const { query, format = 'plaintext' } = args;
  
  try {
    if (!WOLFRAM_APP_ID) {
      throw new Error('WOLFRAM_APP_ID no configurado');
    }

    console.log(`[TOOL] wolfram_compute: "${query}"`);

    // Usar Spoken Results API para respuestas simples
    const response = await axios.get('http://api.wolframalpha.com/v1/result', {
      params: {
        appid: WOLFRAM_APP_ID,
        i: query
      },
      timeout: 20000
    });

    const data = {
      query,
      answer: response.data,
      format: 'plaintext'
    };

    return {
      success: true,
      data,
      source: 'Wolfram Alpha',
      timestamp: new Date().toISOString(),
      provider: 'wolfram'
    };
  } catch (error: any) {
    // Si falla, intentar con la API completa
    try {
      const response = await axios.get('http://api.wolframalpha.com/v2/query', {
        params: {
          appid: WOLFRAM_APP_ID,
          input: query,
          format: 'plaintext',
          output: 'json'
        },
        timeout: 20000
      });

      const pods = response.data.queryresult?.pods || [];
      const answer = pods
        .filter((pod: any) => pod.primary || pod.title === 'Result')
        .map((pod: any) => pod.subpods?.[0]?.plaintext)
        .filter(Boolean)
        .join('\n');

      const data = {
        query,
        answer: answer || 'No se pudo obtener respuesta',
        pods: pods.map((pod: any) => ({
          title: pod.title,
          text: pod.subpods?.[0]?.plaintext
        }))
      };

      return {
        success: true,
        data,
        source: 'Wolfram Alpha',
        timestamp: new Date().toISOString(),
        provider: 'wolfram'
      };
    } catch (fallbackError: any) {
      console.error('[TOOL] wolfram_compute error:', fallbackError.message);
      return {
        success: false,
        error: fallbackError.message,
        timestamp: new Date().toISOString(),
        provider: 'wolfram'
      };
    }
  }
}
