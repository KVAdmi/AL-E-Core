/**
 * =====================================================
 * ENDPOINT - Tool Calling Test
 * =====================================================
 * 
 * POST /api/tools/test
 * 
 * Endpoint para probar el sistema de tool calling completo:
 * 1. User query → LLM
 * 2. LLM decide tools → Router ejecuta
 * 3. Results → LLM sintetiza → Response
 * =====================================================
 */

import { Router, Request, Response } from 'express';
import { llmFactory } from '../llm/providerFactory';
import { executeToolCallsBatch } from '../tools/router';
import { generateToolsPrompt } from '../tools/registry';

const router = Router();

// ═══════════════════════════════════════════════════════════════
// TOOL CALLING TEST ENDPOINT
// ═══════════════════════════════════════════════════════════════

router.post('/test', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query es requerido'
      });
    }

    console.log('[TOOLS TEST] Query:', query);

    // 1. Generar system prompt con herramientas disponibles
    const systemPrompt = `Eres AL-E, un asistente inteligente con acceso a herramientas verificables.

Tu filosofía: NO INVENTES DATOS. Si no sabes algo, usa las herramientas disponibles.

${generateToolsPrompt()}

REGLAS CRÍTICAS:
1. Si necesitas información externa → USA HERRAMIENTAS
2. Prefiere múltiples fuentes para validar
3. SIEMPRE cita la fuente en tu respuesta
4. Si una herramienta falla → intenta otra o admite limitación
5. Responde en español, claro y conciso

Piensa paso a paso qué herramientas necesitas.`;

    // 2. Primera llamada LLM: decidir tools
    const step1Response = await llmFactory.createCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query }
    ], {
      temperature: 0.3 // Más determinístico para tool selection
    });

    console.log('[TOOLS TEST] Step 1 - Tool calls:', step1Response.toolCalls);

    // 3. Si no hay tool_calls → responder directamente
    if (!step1Response.toolCalls || step1Response.toolCalls.length === 0) {
      return res.json({
        success: true,
        response: step1Response.content,
        toolsUsed: [],
        steps: 1
      });
    }

    // 4. Ejecutar tools en paralelo
    const toolResults = await executeToolCallsBatch(
      step1Response.toolCalls.map(tc => ({
        name: tc.name,
        args: tc.args
      }))
    );

    console.log('[TOOLS TEST] Tool results:', toolResults.map(r => r.success));

    // 5. Segunda llamada LLM: sintetizar con resultados
    const toolResultsText = toolResults
      .map((result, idx) => {
        const toolName = step1Response.toolCalls![idx].name;
        if (result.success) {
          return `[${toolName}] ✅ ${JSON.stringify(result.data, null, 2)}`;
        } else {
          return `[${toolName}] ❌ Error: ${result.error}`;
        }
      })
      .join('\n\n');

    const step2Response = await llmFactory.createCompletion([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
      { role: 'assistant', content: `Usaré las siguientes herramientas: ${step1Response.toolCalls.map(tc => tc.name).join(', ')}` },
      { role: 'user', content: `Resultados de herramientas:\n\n${toolResultsText}\n\nAhora sintetiza una respuesta clara citando las fuentes.` }
    ], {
      temperature: 0.7
    });

    console.log('[TOOLS TEST] Step 2 - Final response generated');

    // 6. Respuesta final
    return res.json({
      success: true,
      response: step2Response.content,
      toolsUsed: step1Response.toolCalls.map(tc => tc.name),
      toolResults: toolResults.map((r, idx) => ({
        tool: step1Response.toolCalls![idx].name,
        success: r.success,
        provider: r.provider
      })),
      steps: 2,
      usage: {
        step1: step1Response.usage,
        step2: step2Response.usage
      }
    });

  } catch (error: any) {
    console.error('[TOOLS TEST] Error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// LISTAR HERRAMIENTAS DISPONIBLES
// ═══════════════════════════════════════════════════════════════

router.get('/list', async (req: Request, res: Response) => {
  const { listTools } = require('../tools/registry');
  
  try {
    const tools = listTools();
    return res.json({
      success: true,
      tools: tools.map(t => ({
        name: t.name,
        description: t.description,
        category: t.category,
        rateLimit: t.rateLimit
      }))
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
