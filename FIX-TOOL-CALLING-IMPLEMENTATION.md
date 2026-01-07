# 🔧 IMPLEMENTACIÓN: Tool Calling Real para AL-E

**Para:** Core (Programador Backend)  
**De:** Patricia (con análisis de GitHub Copilot)  
**Prioridad:** P0 CRÍTICO  
**Tiempo estimado:** 4-6 horas

---

## 🎯 OBJETIVO

Implementar **function calling nativo** de Groq/OpenAI para que AL-E:
1. Decida inteligentemente qué herramientas usar
2. Ejecute herramientas con parámetros correctos
3. Use datos reales en sus respuestas
4. Deje de responder como chatbot genérico

---

## 📋 CAMBIOS REQUERIDOS

### **PASO 1: Crear definiciones de herramientas en JSON**

**Archivo NUEVO:** `src/ai/tools/toolDefinitions.ts`

```typescript
/**
 * Tool Definitions para Function Calling
 * 
 * JSON schemas que se pasan al LLM para que sepa qué herramientas tiene disponibles.
 * Compatible con OpenAI Function Calling format.
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

// ═══════════════════════════════════════════════════════════════
// EMAIL TOOLS
// ═══════════════════════════════════════════════════════════════

export const LIST_EMAILS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_emails',
    description: 'Lista los correos electrónicos del usuario. Usa esto cuando el usuario pida: "revisa mis correos", "¿tengo emails?", "checa mi inbox", etc.',
    parameters: {
      type: 'object',
      properties: {
        unreadOnly: {
          type: 'boolean',
          description: 'Si true, solo muestra correos no leídos. Usar cuando el usuario diga "no leídos" o "sin leer".'
        },
        limit: {
          type: 'number',
          description: 'Número máximo de correos a retornar. Default: 10',
          default: 10
        },
        accountEmail: {
          type: 'string',
          description: 'Email de la cuenta específica a revisar (opcional)'
        }
      },
      required: []
    }
  }
};

export const READ_EMAIL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_email',
    description: 'Lee el contenido completo de un correo específico. Usa esto cuando el usuario pida leer un correo en particular.',
    parameters: {
      type: 'object',
      properties: {
        emailId: {
          type: 'string',
          description: 'ID del correo a leer'
        }
      },
      required: ['emailId']
    }
  }
};

export const SEND_EMAIL_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'send_email',
    description: 'Envía un correo electrónico. Usa esto cuando el usuario diga: "envía un email a...", "manda un correo...", etc.',
    parameters: {
      type: 'object',
      properties: {
        to: {
          type: 'string',
          description: 'Dirección de email del destinatario'
        },
        subject: {
          type: 'string',
          description: 'Asunto del correo'
        },
        body: {
          type: 'string',
          description: 'Contenido del correo (texto plano o HTML)'
        },
        inReplyTo: {
          type: 'string',
          description: 'ID del correo al que se está respondiendo (opcional)'
        }
      },
      required: ['to', 'subject', 'body']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// WEB SEARCH TOOLS
// ═══════════════════════════════════════════════════════════════

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Busca información actualizada en internet usando Tavily. USA ESTO cuando el usuario pregunte por: empresas, productos, precios actuales, noticias, eventos recientes, información que cambia con el tiempo, verificación de existencia de sitios web, etc. NUNCA inventes información sobre entidades externas sin buscar primero.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query de búsqueda en lenguaje natural'
        },
        maxResults: {
          type: 'number',
          description: 'Número máximo de resultados (default: 5)',
          default: 5
        }
      },
      required: ['query']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// CALENDAR TOOLS
// ═══════════════════════════════════════════════════════════════

export const LIST_EVENTS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_events',
    description: 'Lista eventos del calendario interno de AL-E. Usa esto cuando el usuario pregunte: "qué tengo hoy", "mi agenda", "eventos de mañana", etc.',
    parameters: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Fecha de inicio (ISO 8601 format, ej: 2026-01-08)'
        },
        endDate: {
          type: 'string',
          description: 'Fecha de fin (ISO 8601 format)'
        }
      },
      required: []
    }
  }
};

export const CREATE_EVENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_event',
    description: 'Crea un evento en el calendario interno. Usa esto cuando el usuario diga: "agrega reunión", "pon una cita", "recordatorio para...", etc.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Título del evento'
        },
        startTime: {
          type: 'string',
          description: 'Fecha y hora de inicio (ISO 8601 format)'
        },
        endTime: {
          type: 'string',
          description: 'Fecha y hora de fin (ISO 8601 format)'
        },
        description: {
          type: 'string',
          description: 'Descripción detallada del evento (opcional)'
        }
      },
      required: ['title', 'startTime']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// MEMORY TOOLS
// ═══════════════════════════════════════════════════════════════

export const SAVE_MEMORY_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'save_memory',
    description: 'Guarda información importante para recordar más tarde. Usa esto cuando el usuario comparta: decisiones, acuerdos, preferencias, hechos sobre su negocio, etc.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Contenido de la memoria a guardar'
        },
        memoryType: {
          type: 'string',
          enum: ['fact', 'preference', 'decision', 'project_info'],
          description: 'Tipo de memoria'
        },
        importance: {
          type: 'number',
          description: 'Importancia de 0 a 1 (0.3 = baja, 0.7 = alta, 1.0 = crítica)',
          minimum: 0,
          maximum: 1
        }
      },
      required: ['content', 'memoryType']
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// EXPORT ALL TOOLS
// ═══════════════════════════════════════════════════════════════

export const ALL_TOOLS: ToolDefinition[] = [
  // Email
  LIST_EMAILS_TOOL,
  READ_EMAIL_TOOL,
  SEND_EMAIL_TOOL,
  
  // Web
  WEB_SEARCH_TOOL,
  
  // Calendar
  LIST_EVENTS_TOOL,
  CREATE_EVENT_TOOL,
  
  // Memory
  SAVE_MEMORY_TOOL
];

/**
 * Get tools basado en contexto
 * Esto permite limitar qué herramientas se pasan al LLM según el caso
 */
export function getToolsForContext(context: {
  hasEmailAccess: boolean;
  hasCalendarAccess: boolean;
  hasWebAccess: boolean;
}): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  
  if (context.hasEmailAccess) {
    tools.push(LIST_EMAILS_TOOL, READ_EMAIL_TOOL, SEND_EMAIL_TOOL);
  }
  
  if (context.hasWebAccess) {
    tools.push(WEB_SEARCH_TOOL);
  }
  
  if (context.hasCalendarAccess) {
    tools.push(LIST_EVENTS_TOOL, CREATE_EVENT_TOOL);
  }
  
  // Memory siempre disponible
  tools.push(SAVE_MEMORY_TOOL);
  
  return tools;
}
```

---

### **PASO 2: Modificar Groq Provider para tool calling**

**Archivo:** `src/ai/providers/groqProvider.ts`

**Cambio 1:** Actualizar interfaces (línea 18-27)

```typescript
export interface GroqMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';  // ← Agregar 'tool'
  content: string | null;  // ← Permitir null
  tool_calls?: any[];  // ← Agregar tool_calls
  tool_call_id?: string;  // ← Para respuestas de tool
  name?: string;  // ← Nombre del tool
}

export interface GroqChatOptions {
  messages: GroqMessage[];
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: any[];  // ← NUEVO: Tool definitions
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };  // ← NUEVO
}
```

**Cambio 2:** Actualizar llamada (línea 68-75)

```typescript
const completion = await groq.chat.completions.create({
  messages: finalMessages as any,
  model: model,
  temperature: temperature,
  max_tokens: maxTokens,
  top_p: topP,
  stream: false,
  // ← NUEVO: Agregar tools si existen
  ...(options.tools && options.tools.length > 0 && {
    tools: options.tools,
    tool_choice: options.toolChoice || 'auto'
  })
});
```

**Cambio 3:** Procesar tool_calls (línea 77-90)

```typescript
const content = completion.choices[0]?.message?.content || '';
const toolCalls = completion.choices[0]?.message?.tool_calls;  // ← NUEVO
const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

// ← NUEVO: Detectar si hay tool calls
if (toolCalls && toolCalls.length > 0) {
  console.log(`[GROQ] 🔧 LLM requested ${toolCalls.length} tool call(s)`);
  toolCalls.forEach((tc: any) => {
    console.log(`[GROQ]    - ${tc.function.name}(${tc.function.arguments})`);
  });
}

console.log(`[GROQ] ✓ Respuesta recibida (${usage.completion_tokens} tokens)`);
console.log(`[GROQ] Usage: ${usage.prompt_tokens} in + ${usage.completion_tokens} out = ${usage.total_tokens} total`);

return {
  content,
  raw: {
    model: completion.model,
    usage: {
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      total_tokens: usage.total_tokens
    },
    finish_reason: completion.choices[0]?.finish_reason || 'stop',
    tool_calls: toolCalls || []  // ← NUEVO: Incluir tool_calls en respuesta
  }
};
```

---

### **PASO 3: Implementar tool loop en Orchestrator**

**Archivo:** `src/ai/orchestrator.ts`

**Cambio 1:** Importar tool definitions (línea 1-10)

```typescript
import { getToolsForContext, ALL_TOOLS } from './tools/toolDefinitions';
import { executeTool } from './tools/toolRouter';
```

**Cambio 2:** Agregar método de tool loop (agregar ANTES de `buildSystemPrompt`)

```typescript
/**
 * STEP X: Execute tool calling loop
 * 
 * Si el LLM retorna tool_calls, ejecutarlos y volver a llamar al LLM con resultados.
 * Máximo 3 iteraciones para evitar loops infinitos.
 */
private async executeToolLoop(
  userId: string,
  messages: Array<any>,
  systemPrompt: string,
  tools: any[],
  maxIterations: number = 3
): Promise<any> {
  let iteration = 0;
  
  while (iteration < maxIterations) {
    iteration++;
    console.log(`[ORCH] 🔄 Tool loop iteration ${iteration}/${maxIterations}`);
    
    // Llamar al LLM
    const { callGroqChat } = await import('./providers/groqProvider');
    const response = await callGroqChat({
      messages,
      systemPrompt,
      tools,
      toolChoice: 'auto'
    });
    
    // Si no hay tool_calls, retornar respuesta final
    if (!response.raw.tool_calls || response.raw.tool_calls.length === 0) {
      console.log('[ORCH] ✓ No more tool calls, returning final response');
      return response;
    }
    
    // Ejecutar herramientas
    console.log(`[ORCH] 🔧 Executing ${response.raw.tool_calls.length} tool(s)...`);
    
    // Agregar mensaje del assistant con tool_calls
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: response.raw.tool_calls
    });
    
    // Ejecutar cada tool call
    for (const toolCall of response.raw.tool_calls) {
      try {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);
        
        console.log(`[ORCH]    - Executing: ${functionName}(${JSON.stringify(functionArgs)})`);
        
        // Ejecutar herramienta
        const result = await executeTool(userId, {
          name: functionName,
          parameters: functionArgs
        });
        
        // Agregar resultado a mensajes
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: functionName,
          content: JSON.stringify(result)
        });
        
        console.log(`[ORCH]    ✓ Tool ${functionName} executed successfully`);
      } catch (error: any) {
        console.error(`[ORCH]    ❌ Tool execution failed:`, error);
        
        // Agregar error como resultado
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({
            success: false,
            error: error.message || 'Unknown error'
          })
        });
      }
    }
    
    // Continuar loop para que el LLM procese los resultados
  }
  
  console.log('[ORCH] ⚠️ Max tool iterations reached, forcing final response');
  
  // Si llegamos aquí, forzar respuesta final
  const { callGroqChat } = await import('./providers/groqProvider');
  return await callGroqChat({
    messages,
    systemPrompt,
    toolChoice: 'none'  // Forzar que NO use más tools
  });
}
```

**Cambio 3:** Usar tool loop en el método principal (buscar donde se llama al LLM)

```typescript
// ANTES (aproximadamente línea 700-750)
const { callGroqChat } = await import('./providers/groqProvider');
const llmResponse = await callGroqChat({
  messages: conversationMessages,
  systemPrompt: systemPrompt,
  model: selectedModel,
  temperature: 0.7,
  maxTokens: maxOutputTokens
});

// DESPUÉS
const { callGroqChat } = await import('./providers/groqProvider');

// Determinar qué tools están disponibles
const toolsAvailable = getToolsForContext({
  hasEmailAccess: !!userIdentity,  // Si está autenticado, puede tener email
  hasCalendarAccess: true,  // Calendario siempre disponible
  hasWebAccess: !!tavilyResponse || shouldUseWebSearch(userMessage)  // Web según contexto
});

console.log(`[ORCH] 🔧 Passing ${toolsAvailable.length} tools to LLM`);

// Ejecutar tool loop
const llmResponse = await this.executeToolLoop(
  userId,
  conversationMessages,
  systemPrompt,
  toolsAvailable,
  3  // Max 3 iteraciones
);
```

---

### **PASO 4: Actualizar toolRouter para soportar web_search**

**Archivo:** `src/ai/tools/toolRouter.ts`

**Agregar case para web_search** (aproximadamente línea 150-160)

```typescript
case 'web_search':
  if (!parameters.query) {
    throw new Error('query es requerido para web_search');
  }
  
  const { webSearch } = await import('../../services/tavilySearch');
  const searchResults = await webSearch(parameters.query, {
    maxResults: parameters.maxResults || 5
  });
  
  return {
    success: true,
    data: {
      query: parameters.query,
      results: searchResults.results.map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score
      }))
    }
  };
```

**Agregar case para save_memory** (después de web_search)

```typescript
case 'save_memory':
  if (!parameters.content || !parameters.memoryType) {
    throw new Error('content y memoryType son requeridos');
  }
  
  const { supabase } = await import('../../db/supabase');
  
  const { data: memoryData, error: memoryError } = await supabase
    .from('assistant_memories')
    .insert({
      user_id_uuid: userId,
      workspace_id: 'default',  // TODO: Obtener del contexto
      memory: parameters.content,
      memory_type: parameters.memoryType,
      importance: parameters.importance || 0.7,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (memoryError) {
    throw memoryError;
  }
  
  return {
    success: true,
    data: {
      id: memoryData.id,
      content: memoryData.memory,
      type: memoryData.memory_type
    }
  };
```

---

## 🧪 TESTING

### Test 1: Email tools

```bash
# En el frontend o con curl
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Revisa mis últimos 3 correos"
      }
    ]
  }'
```

**Esperado:**
```
[ORCH] 🔧 Passing 7 tools to LLM
[GROQ] 🔧 LLM requested 1 tool call(s)
[GROQ]    - list_emails({"limit": 3})
[ORCH]    ✓ Tool list_emails executed successfully
[ORCH] ✓ No more tool calls, returning final response
```

**Respuesta AL-E:**
```
Revisé tus últimos 3 correos:

1. De: john@example.com
   Asunto: Reunion proyecto X
   Preview: Hola Patricia, necesito confirmar la...
   Fecha: 7 de enero, 10:30 AM

2. De: invoice@stripe.com
   Asunto: Invoice #12345
   Preview: Your payment of $299 has been...
   Fecha: 6 de enero, 4:15 PM

3. De: team@slack.com
   Asunto: Weekly digest
   Preview: You have 12 unread messages in...
   Fecha: 5 de enero, 9:00 AM

¿Quieres que lea alguno en detalle?
```

---

### Test 2: Web search

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Cuánto cuesta Mistral API actualmente?"
      }
    ]
  }'
```

**Esperado:**
```
[ORCH] 🔧 Passing 7 tools to LLM
[GROQ] 🔧 LLM requested 1 tool call(s)
[GROQ]    - web_search({"query": "Mistral API pricing 2026"})
[ORCH]    ✓ Tool web_search executed successfully
[ORCH] ✓ No more tool calls, returning final response
```

**Respuesta AL-E:**
```
Según la información actualizada, Mistral API tiene estos precios:

- Mistral 7B: $0.25 por millón de tokens
- Mixtral 8x7B: $0.70 por millón de tokens  
- Mistral Medium: $2.50 por millón de tokens
- Mistral Large: $8.00 por millón de tokens

[Fuente: mistral.ai/pricing](https://mistral.ai/pricing)

Comparado con OpenAI:
- GPT-4: $30/millón tokens (4x más caro que Mistral Large)
- GPT-3.5: $2/millón tokens (similar a Mistral Medium)

Para tu caso de uso con AL-E, Mixtral 8x7B ($0.70/M tokens) es excelente relación precio/rendimiento.

Con 100K mensajes/mes promediando 500 tokens c/u = 50M tokens.
Costo mensual: ~$35 USD.

¿Quieres que compare con otros proveedores?
```

---

### Test 3: Conversación que requiere múltiples tools

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Revisa mis correos y si hay algo urgente avísame"
      }
    ]
  }'
```

**Esperado:**
```
[ORCH] 🔄 Tool loop iteration 1/3
[GROQ] 🔧 LLM requested 1 tool call(s)
[GROQ]    - list_emails({"unreadOnly": true})
[ORCH]    ✓ Tool list_emails executed successfully
[ORCH] 🔄 Tool loop iteration 2/3
[GROQ] 🔧 LLM requested 1 tool call(s)
[GROQ]    - read_email({"emailId": "abc123"})
[ORCH]    ✓ Tool read_email executed successfully
[ORCH] 🔄 Tool loop iteration 3/3
[ORCH] ✓ No more tool calls, returning final response
```

**Respuesta AL-E:**
```
⚠️ Tienes 1 correo urgente:

De: client@company.com
Asunto: URGENTE: Deploy fallando en producción
Fecha: Hoy, 11:45 AM

Contenido: "Patricia, el deploy que hicimos esta mañana está tirando errores 500 en producción. Los usuarios no pueden hacer login. Necesitamos rollback ASAP. El equipo está esperando tu aprobación."

Acción requerida:
- Responder al cliente
- Revisar logs de producción
- Considerar rollback

¿Quieres que te ayude a redactar una respuesta o prefieres que agende una llamada de emergencia?
```

---

## 🔍 DEBUGGING

### Si no ejecuta tools:

1. **Verificar logs:**
```bash
pm2 logs ale-core | grep "🔧"
```

Deberías ver:
```
[ORCH] 🔧 Passing 7 tools to LLM
[GROQ] 🔧 LLM requested 1 tool call(s)
```

2. **Verificar que Groq recibe tools:**
```typescript
// Agregar en groqProvider.ts línea 68
console.log('[GROQ] Tools passed:', JSON.stringify(options.tools, null, 2));
```

3. **Verificar que el modelo soporta function calling:**
```typescript
// En groqProvider.ts, cambiar model default si es necesario
model = 'llama-3.3-70b-versatile'  // ✅ Soporta tools
// NO usar: llama-3.1-8b (limitado en tool calling)
```

---

### Si ejecuta tools pero responde mal:

1. **Verificar que tool results llegan al LLM:**
```typescript
// En orchestrator.ts, dentro de executeToolLoop
console.log('[ORCH] Tool result:', JSON.stringify(result, null, 2));
```

2. **Verificar formato de mensajes:**
```typescript
// Debe ser exactamente:
{
  role: 'tool',
  tool_call_id: 'call_abc123',  // ← CRÍTICO: debe coincidir con el ID del LLM
  name: 'list_emails',
  content: '{"success": true, "data": {...}}'  // ← Siempre string JSON
}
```

---

## 📊 MÉTRICAS DE ÉXITO

### KPIs a monitorear:

1. **Tool usage rate**
   - Meta: 40-60% de queries usan herramientas
   - Tracking: Contador en orchestrator

2. **Tool execution success rate**
   - Meta: >90% de tool calls exitosos
   - Tracking: Ratio success/total en toolRouter

3. **Response quality (subjetivo)**
   - Meta: Respuestas con datos específicos vs genéricas
   - Tracking: Revisión manual de logs

4. **Average tool calls per query**
   - Meta: 1-2 tools por query compleja
   - Tracking: Promedio en orchestrator

---

## 🚀 DEPLOY CHECKLIST

- [ ] Crear `toolDefinitions.ts` con todos los schemas
- [ ] Modificar `groqProvider.ts` para tool calling
- [ ] Implementar `executeToolLoop` en orchestrator
- [ ] Agregar cases `web_search` y `save_memory` en toolRouter
- [ ] Testing local con casos reales
- [ ] Deploy a staging
- [ ] Testing en staging con Patto
- [ ] Deploy a producción con feature flag
- [ ] Monitorear logs por 24 horas
- [ ] Documentar casos edge encontrados

---

## 🔥 NOTA FINAL

Este cambio es **TRANSFORMACIONAL** para AL-E.

**Antes:** AL-E es un chatbot que "habla bonito"
**Después:** AL-E es un agente que **ejecuta acciones reales**

El código que existe ya es bueno. Solo falta conectar el LLM con las herramientas usando el protocolo estándar de function calling.

**Tiempo estimado:**
- Tool definitions: 1 hora
- Groq provider changes: 30 min
- Orchestrator tool loop: 2 horas
- Testing: 1 hora
- Deploy: 30 min
- **Total: 5 horas**

Una vez implementado, AL-E será **autónoma de verdad**.

---

**¿Alguna duda sobre la implementación?**
