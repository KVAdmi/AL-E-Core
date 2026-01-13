# PARCHE PARA AGREGAR speak_text + should_speak en chat.ts

## Instrucciones:
1. Agregar import en línea 6:
```typescript
import { markdownToSpeakable, shouldSpeak } from '../utils/textCleaners';
```

## Cambios en respuestas JSON (4 lugares):

### 1. Endpoint /chat - respuesta exitosa (línea ~952)
ANTES:
```typescript
    res.json({
      answer: answer,
      session_id: sessionId,
      memories_to_add: []
    });
```

DESPUÉS:
```typescript
    res.json({
      answer: answer,
      speak_text: markdownToSpeakable(answer),
      should_speak: shouldSpeak(answer),
      session_id: sessionId,
      memories_to_add: []
    });
```

### 2. Endpoint /chat - respuesta error (línea ~960)
ANTES:
```typescript
    res.status(500).json({
      answer: 'Error interno del servidor',
      session_id: sessionId,
      memories_to_add: []
    });
```

DESPUÉS:
```typescript
    res.status(500).json({
      answer: 'Error interno del servidor',
      speak_text: 'Ocurrió un error al procesar tu solicitud.',
      should_speak: true,
      session_id: sessionId,
      memories_to_add: []
    });
```

### 3. Endpoint /chat/v2 - timeout fallback (línea ~1389)
ANTES:
```typescript
        return res.json({
          answer: fallbackMessage,
          session_id: sessionId,
          memories_to_add: [],
          metadata: {
            timeout: true,
            latency_ms: Date.now() - startTime
          }
        });
```

DESPUÉS:
```typescript
        return res.json({
          answer: fallbackMessage,
          speak_text: markdownToSpeakable(fallbackMessage),
          should_speak: true,
          session_id: sessionId,
          memories_to_add: [],
          metadata: {
            timeout: true,
            latency_ms: Date.now() - startTime
          }
        });
```

### 4. Endpoint /chat/v2 - tool directo (línea ~1453)
ANTES:
```typescript
      return res.json({
        answer,
        session_id: sessionId,
        memories_to_add: [],
        metadata: {
          latency_ms: Date.now() - startTime,
          direct_tool_response: true,
          tool_used: orchestratorContext.toolUsed
        }
      });
```

DESPUÉS:
```typescript
      return res.json({
        answer,
        speak_text: markdownToSpeakable(answer),
        should_speak: shouldSpeak(answer),
        session_id: sessionId,
        memories_to_add: [],
        metadata: {
          latency_ms: Date.now() - startTime,
          direct_tool_response: true,
          tool_used: orchestratorContext.toolUsed
        }
      });
```

### 5. Endpoint /chat/v2 - respuesta final (línea ~1639)
ANTES:
```typescript
    return res.json({
      answer: finalAnswer,
      session_id: sessionId,
      memories_to_add: [],
      sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
      metadata: {
        latency_ms,
        provider: llmResult.fallbackChain.final_provider,
        model: orchestratorContext.modelSelected,
        intent: orchestratorContext.intent?.intent_type,
        action_executed: orchestratorContext.toolUsed !== 'none',
        guardrail_applied: guardrailResult.sanitized
      }
    });
```

DESPUÉS:
```typescript
    return res.json({
      answer: finalAnswer,
      speak_text: markdownToSpeakable(finalAnswer),
      should_speak: shouldSpeak(finalAnswer),
      session_id: sessionId,
      memories_to_add: [],
      sources: knowledgeSources.length > 0 ? knowledgeSources : undefined,
      metadata: {
        latency_ms,
        provider: llmResult.fallbackChain.final_provider,
        model: orchestratorContext.modelSelected,
        intent: orchestratorContext.intent?.intent_type,
        action_executed: orchestratorContext.toolUsed !== 'none',
        guardrail_applied: guardrailResult.sanitized
      }
    });
```

### 6. Endpoint /chat/v2 - error handler (línea ~1688)
ANTES:
```typescript
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message,
      session_id: sessionId,
      memories_to_add: []
    });
```

DESPUÉS:
```typescript
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message,
      speak_text: 'Ocurrió un error al procesar tu solicitud.',
      should_speak: true,
      session_id: sessionId,
      memories_to_add: []
    });
```

## Verificación:
Después de aplicar, buscar "res.json" y "res.status" en chat.ts y verificar que TODAS las respuestas tengan speak_text + should_speak.
