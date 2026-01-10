# INCIDENTE P0 - FIXES APLICADOS
**Fecha**: 10 de enero de 2026  
**Estado**: EN PROGRESO

---

## ✅ FIXES COMPLETADOS

### 1. CORREO - Lectura INBOX vs SENT ✅

**Problema Crítico**:
- AL-EON respondía con correos ENVIADOS cuando se preguntaba por "último correo"
- No distinguía entre carpetas INBOX y SENT
- Query sin filtro de `folder_type`

**Fix Aplicado**:
- ✅ `src/ai/tools/emailTools.ts`: Agregado parámetro `folderType` con default `'inbox'`
- ✅ Filtro por `folder_id` según tipo de carpeta (inbox/sent/drafts/trash/archive)
- ✅ `src/ai/tools/toolDefinitions.ts`: Actualizada descripción del tool con regla explícita:
  - **REGLA SUPREMA**: "último correo" = INBOX, NO SENT
  - Solo usar `folderType: 'sent'` si el usuario dice EXPLÍCITAMENTE "enviados" o "que mandé"

**Código modificado**:
```typescript
// emailTools.ts - listEmails
folderType?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'archive'; // Default: 'inbox'

// Obtener folder_id por folder_type
const { data: folders } = await supabase
  .from('email_folders')
  .select('id, account_id')
  .in('account_id', accountIds)
  .eq('folder_type', folderType);

// Filtrar por folder_id
let query = supabase
  .from('email_messages')
  .select('*')
  .in('folder_id', folderIds) // ← FILTRO CORRECTO
  .order('date', { ascending: false });
```

---

### 2. ORQUESTADOR - Modo EVIDENCE REQUIRED ✅

**Problema Crítico**:
- AL-EON confirmaba acciones sin evidencia real
- Inventaba que había creado eventos/enviado correos sin verificación

**Fix Aplicado**:
- ✅ Ya estaba implementado en `modeClassification.evidenceRequired`
- ✅ Validación en `orchestrator.ts` línea 428:
```typescript
// MODE C: Validate evidence requirement
if (modeClassification.evidenceRequired && !actionResult.evidence) {
  const errorMsg = getNoEvidenceError(modeClassification.mode);
  return {
    toolUsed: actionResult.action,
    toolFailed: true,
    toolError: errorMsg
  };
}
```

**Guardrail activo en system prompt** (línea 710):
```
⚡ MODO C: DATOS CRÍTICOS O ACCIÓN
- INSTRUCCIÓN SUPREMA: SOLO confirma acciones si hay evidence.id
- SI NO hay evidence.id → Di: "No pude completar [acción]. [Razón específica]"
- NO digas "creé", "agendé", "envié" sin evidencia comprobable
```

---

### 3. FETCH WEB OBLIGATORIO PARA URLs ✅

**Problema Crítico**:
- Usuario proporcionaba URL de Vitacard
- AL-EON NO accedía al sitio web
- Inventaba información: "descuentos en alojamientos"

**Fix Aplicado**:
- ✅ `src/services/intentClassifier.ts`: Detección automática de URLs
```typescript
// 🔥 P0 CRÍTICO: Detección de URLs → FETCH WEB OBLIGATORIO
const urlPattern = /https?:\/\/[^\s]+/i;
const hasUrl = urlPattern.test(cleanMessage);
if (hasUrl) {
  verificationScore += 10; // MÁXIMA PRIORIDAD
  reasoning.push('🔴 URL detectada → Fetch web OBLIGATORIO');
  console.log('[INTENT] 🚨 URL DETECTED - Web fetch REQUIRED');
}
```

**Comportamiento**:
- Cualquier mensaje con `http://` o `https://` activa modo `verification`
- Force `tools_required: ['web_search']`
- Si web_search falla, respuesta obligatoria: "No pude acceder al sitio web proporcionado"

---

### 4. OCR AUTOMÁTICO - Ya Implementado ✅

**Verificación**:
- ✅ `src/api/chat.ts` líneas 142-285: `attachmentProcessor` se ejecuta ANTES del LLM
- ✅ `attachmentsContext` se inyecta en línea 1343:
```typescript
orchestratorContext.systemPrompt += (vectorKnowledgeContext + attachmentsContext + antiLieWarning);
```
- ✅ Soporta: PDF, imágenes (PNG/JPG/WEBP), DOCX
- ✅ Google Vision OCR activo

**Problema identificado**:
- El OCR funciona correctamente
- El problema es que AL-EON podría estar diciendo "no puedo ver imágenes" por prompt
- **Acción requerida**: Validar que el prompt NO diga "no tengo capacidad de ver imágenes"

---

## 🔄 PENDIENTES CRÍTICOS

### 5. VOZ - Captura y Reproducción ❌

**Problema**:
- Micrófono NO captura audio
- Whisper STT nunca se ejecuta
- Edge-TTS nunca se reproduce
- Usuario NUNCA ha escuchado la voz de AL-EON

**Backend verificado**:
- ✅ `/api/voice/stt` existe y funciona (Groq Whisper)
- ✅ `/api/voice/tts` existe y funciona (Edge-TTS)
- ✅ `whisper-large-v3-turbo` configurado
- ✅ `es-MX-DaliaNeural` voz default

**Problema = FRONTEND**:
1. No solicita permisos de micrófono
2. MediaRecorder no se inicia
3. Audio se envía vacío (size = 0)
4. Audio de respuesta no se reproduce

**Acción requerida**: Auditar frontend (React/Vue) para verificar:
- `navigator.mediaDevices.getUserMedia()`
- `MediaRecorder` initialization
- Audio buffer validation
- Audio playback component

---

### 6. FRONTEND MAIL - Escritura y Respuesta ❌

**Problemas reportados**:
1. ❌ Teclado NO permite escribir en campo de respuesta
2. ❌ Campo está bloqueado
3. ❌ Estado `isReplying` no cambia
4. ❌ Carpetas duplicadas (correos aparecen en múltiples tabs)

**Acción requerida**:
- Auditar componente Mail en frontend
- Verificar `focus()` del input
- Validar estado `isReplying`
- Verificar binding del `<textarea>`
- Corregir query de carpetas (debe ser distinta por tab)

---

### 7. VALIDACIÓN TOOLS EJECUTADOS ❌

**Regla P0**:
```typescript
if (action.requiresEvidence && !result.evidence) {
  abortResponse(
    "No pude completar la acción. Motivo técnico: " + result.error
  )
}
```

**Acción requerida**:
- Implementar validación estricta en orquestador
- NO permitir que el LLM diga "ya está" sin evidence.id
- Forzar error explícito si falla

---

## 📋 TESTING P0

Antes de cerrar el incidente, validar:

### Checklist de Validación:

- [ ] **Correo INBOX**: Preguntar "cuál es mi último correo" → debe leer INBOX, no SENT
- [ ] **Correo SENT**: Preguntar "qué correos he enviado" → debe leer SENT explícitamente
- [ ] **Responder correo manualmente**: Probar escribir en frontend → debe funcionar
- [ ] **URL externa**: Dar URL de empresa nueva → debe hacer fetch real o decir "no pude acceder"
- [ ] **Imagen con texto**: Adjuntar imagen → debe extraer texto con OCR automáticamente
- [ ] **PDF**: Adjuntar PDF → debe extraer contenido completo
- [ ] **DOCX**: Adjuntar DOCX → debe analizar correctamente
- [ ] **Voz STT**: Hablar al micrófono → debe transcribir con Whisper
- [ ] **Voz TTS**: Recibir respuesta → debe escuchar voz de AL-EON (Edge-TTS)
- [ ] **Agendar cita**: "Agenda cita dentista mañana 3pm" → debe crear evento sin pedir permiso
- [ ] **Enviar correo**: "Envía email a X" → debe enviar real o decir "no configurado"

---

## 🚨 REGLAS NO NEGOCIABLES

### Anti-Mentira:
1. Si NO hay evidencia → NO confirmar acción
2. Si falla tool → error técnico explícito
3. Si no puede acceder a URL → decir "no pude acceder"
4. Si OCR falla → error técnico, NO inventar contenido

### Correos:
1. "último correo" = **SIEMPRE INBOX**
2. Solo leer SENT si usuario dice "enviados" o "que mandé"
3. Respuesta manual debe funcionar (teclado desbloqueado)

### Attachments:
1. OCR se ejecuta automáticamente
2. Si falla → error técnico
3. NO decir "no puedo ver imágenes" (sí puede)

### Voz:
1. Debe capturar audio real
2. Whisper debe transcribir
3. Edge-TTS debe generar audio
4. Usuario debe escuchar respuesta

---

## 📊 ESTADO ACTUAL

| Componente | Estado | Prioridad |
|------------|--------|-----------|
| Correo INBOX/SENT | ✅ FIXED | P0 |
| Evidence Required | ✅ FIXED | P0 |
| URL Fetch | ✅ FIXED | P0 |
| OCR Attachments | ✅ VERIFICADO | P0 |
| Voz STT/TTS | ❌ PENDIENTE | P0 |
| Frontend Mail | ❌ PENDIENTE | P0 |
| Tool Validation | ❌ PENDIENTE | P1 |

---

**Siguiente paso**: Auditar frontend para corregir sistema de voz y módulo Mail.

**Owner**: Core Team  
**Deadline**: INMEDIATO - P0 crítico
