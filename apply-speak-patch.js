#!/usr/bin/env node
const fs = require('fs');

const filePath = './src/api/chat.ts';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Endpoint /chat - respuesta exitosa
content = content.replace(
  /res\.json\(\{\s+answer: answer,\s+session_id: sessionId,\s+memories_to_add: \[\]\s+\}\);/,
  `res.json({
      answer: answer,
      speak_text: markdownToSpeakable(answer),
      should_speak: shouldSpeak(answer),
      session_id: sessionId,
      memories_to_add: []
    });`
);

// 2. Endpoint /chat - respuesta error
content = content.replace(
  /res\.status\(500\)\.json\(\{\s+answer: 'Error interno del servidor',\s+session_id: sessionId,\s+memories_to_add: \[\]\s+\}\);/,
  `res.status(500).json({
      answer: 'Error interno del servidor',
      speak_text: 'Ocurrió un error al procesar tu solicitud.',
      should_speak: true,
      session_id: sessionId,
      memories_to_add: []
    });`
);

// 3. Endpoint /chat/v2 - timeout fallback
content = content.replace(
  /return res\.json\(\{\s+answer: fallbackMessage,\s+session_id: sessionId,\s+memories_to_add: \[\],\s+metadata: \{\s+timeout: true,\s+latency_ms: Date\.now\(\) - startTime\s+\}\s+\}\);/,
  `return res.json({
          answer: fallbackMessage,
          speak_text: markdownToSpeakable(fallbackMessage),
          should_speak: true,
          session_id: sessionId,
          memories_to_add: [],
          metadata: {
            timeout: true,
            latency_ms: Date.now() - startTime
          }
        });`
);

// 4. Endpoint /chat/v2 - tool directo
content = content.replace(
  /return res\.json\(\{\s+answer,\s+session_id: sessionId,\s+memories_to_add: \[\],\s+metadata: \{\s+latency_ms: Date\.now\(\) - startTime,\s+direct_tool_response: true,\s+tool_used: orchestratorContext\.toolUsed\s+\}\s+\}\);/,
  `return res.json({
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
      });`
);

// 5. Endpoint /chat/v2 - respuesta final
content = content.replace(
  /return res\.json\(\{\s+answer: finalAnswer,\s+session_id: sessionId,/,
  `return res.json({
      answer: finalAnswer,
      speak_text: markdownToSpeakable(finalAnswer),
      should_speak: shouldSpeak(finalAnswer),
      session_id: sessionId,`
);

// 6. Endpoint /chat/v2 - error handler
content = content.replace(
  /return res\.status\(500\)\.json\(\{\s+error: 'INTERNAL_ERROR',\s+message: error\.message,\s+session_id: sessionId,\s+memories_to_add: \[\]\s+\}\);/,
  `return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: error.message,
      speak_text: 'Ocurrió un error al procesar tu solicitud.',
      should_speak: true,
      session_id: sessionId,
      memories_to_add: []
    });`
);

fs.writeFileSync(filePath, content);
console.log('✅ Parche aplicado exitosamente');
