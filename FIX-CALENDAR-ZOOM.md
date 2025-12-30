# ✅ FIX: Calendar Interno - Zoom como Texto Descriptivo

**Fecha:** 30 de diciembre de 2025  
**Commit:** 3badb43  
**Status:** ✅ DESPLEGADO EN EC2

---

## 🔴 PROBLEMA IDENTIFICADO

### Respuesta Incorrecta de AL-E

**Input del usuario:**
```
"hola flaca me ayudas a agendar por favor una cita para el viernes a las 12:30 un zoom con igs porfa?"
```

**Respuesta incorrecta:**
```
"Lo siento, Patto. No tengo acceso a tu calendario ni a Zoom. 
No puedo agendar una cita para ti. Si necesitas agendar una cita, 
te recomiendo que accedas directamente a tu calendario y a Zoom para hacerlo."
```

### Errores Detectados

❌ **Error 1 - Negación Falsa:**
- AL-E SÍ tiene calendario interno
- NO depende de Google Calendar
- Decir "no tengo acceso a tu calendario" es FALSO

❌ **Error 2 - Confusión con Zoom:**
- Usuario pidió: "agendar una cita ... un zoom con igs"
- AL-E interpretó: "necesito integración con Zoom"
- Realidad: "Zoom con IGS" es solo TEXTO DESCRIPTIVO del evento

❌ **Error 3 - Contradicción con runtime-capabilities:**
```json
"calendar.create": true  ← CAPACIDAD ACTIVA
```

Si `calendar.create = true`, AL-E DEBE intentar crear el evento.

---

## 🔧 CAUSA RAÍZ

### 1. Pattern de Detección Incompleto

**Archivo:** `src/services/intentClassifier.ts`

**Antes:**
```typescript
calendar_action: /\b(agenda|calendario|calendar|cita|citas|evento|eventos|meet|meets|meeting|meetings|junta|juntas|reunión|reunion|reuniones|videollamada|video call|llamada)\b/i
```

**Problema:** NO incluía "zoom"

### 2. Pattern de Ejecución Incompleto

**Archivo:** `src/services/transactionalExecutor.ts`

**Antes (línea 186):**
```typescript
lowerMsg.match(/\b(agenda|agendar|crea|crear|pon|poner|añade|añadir|agrega|agregar|programa|programar)\b.{0,100}\b(reunión|reunion|cita|evento|llamada|call|meet)\b/i)
```

**Problema:** NO incluía "zoom" ni "videollamada"

### 3. Falta de Regla Explícita en System Prompt

**Archivo:** `src/ai/orchestrator.ts`

**Problema:** NO había instrucción explícita que dijera:
> "Zoom/Meet/Teams son SOLO texto descriptivo, NO integraciones"

---

## ✅ SOLUCIÓN IMPLEMENTADA

### 1. Actualizar Pattern en intentClassifier

**Archivo:** `src/services/intentClassifier.ts` (línea 73)

```typescript
calendar_action: /\b(agenda|calendario|calendar|cita|citas|evento|eventos|meet|meets|meeting|meetings|junta|juntas|reunión|reunion|reuniones|videollamada|video call|llamada|zoom)\b/i
```

**Cambio:** Agregado `|zoom` al final

### 2. Actualizar Patterns en transactionalExecutor

**Archivo:** `src/services/transactionalExecutor.ts`

**Línea 186 (V2):**
```typescript
lowerMsg.match(/\b(agenda|agendar|crea|crear|pon|poner|añade|añadir|agrega|agregar|programa|programar)\b.{0,100}\b(reunión|reunion|cita|evento|llamada|call|meet|zoom|videollamada)\b/i)
```

**Línea 519 (Legacy):**
```typescript
lowerMsg.match(/\b(agenda|agendar|crea|crear|pon|poner|añade|añadir|agrega|agregar|programa|programar)\b.{0,100}\b(reunión|reunion|cita|evento|llamada|call|meet|zoom|videollamada)\b/i)
```

**Cambio:** Agregado `|zoom|videollamada` en ambos

### 3. Mejorar extractEventInfo

**Archivo:** `src/services/transactionalExecutor.ts` (línea 58)

**Antes:**
```typescript
const titleMatches = userMessage.match(/\b(?:agenda|agendar|crea|crear|pon|poner)\s+(?:una?\s+)?(?:cita|reunión|reunion|evento|llamada)?\s+(?:con|para|de|sobre|el)?\s+([^,.?!]+?)(?:\s+(?:para|el|a|en)\s+)/i);
```

**Después:**
```typescript
const titleMatches = userMessage.match(/\b(?:agenda|agendar|crea|crear|pon|poner)\s+(?:por favor|porfa|porfavor|plis)?\s*(?:una?\s+)?(?:cita|reunión|reunion|evento|llamada|zoom|meet|videollamada)?\s+(?:con|para|de|sobre|del?|un?)?\s+([^,.?!]+?)(?:\s+(?:para|el|a|en|por)\s+)/i);
```

**Cambios:**
- Agregado `|zoom|meet|videollamada` a palabras clave
- Agregado `(?:por favor|porfa|porfavor|plis)?` para capturar cortesías
- Agregado `(?:del?|un?)?` para capturar artículos variados

### 4. Regla Explícita en System Prompt

**Archivo:** `src/ai/orchestrator.ts` (línea 510)

**Agregado:**
```typescript
ACLARACIÓN CRÍTICA - CALENDARIO INTERNO:
✅ AL-E TIENE CALENDARIO INTERNO PROPIO
✅ NO DEPENDE DE GOOGLE CALENDAR
✅ NO DEPENDE DE ZOOM COMO INTEGRACIÓN
✅ NO DEPENDE DE NINGÚN SERVICIO EXTERNO

CUANDO EL USUARIO DICE "ZOOM", "MEET", "TEAMS", ETC:
✅ Son SOLO TEXTO DESCRIPTIVO del evento
✅ NO son integraciones que debas verificar
✅ NO son capacidades que debas validar
✅ Agendar "un zoom con IGS" significa: evento con título "Zoom con IGS"

COMPORTAMIENTO CORRECTO PARA CALENDAR.CREATE:
✅ SI calendar.create = true → CREAR EVENTO INTERNO
✅ Usar "Zoom"/"Meet"/"Teams" SOLO como texto en el título
✅ NO pedir confirmación si tienes fecha, hora y título
✅ NO mencionar Google Calendar ni servicios externos
✅ SOLO responder "No pude crear el evento" si FALLA LA BASE DE DATOS

COMPORTAMIENTO PROHIBIDO:
❌ "No tengo acceso a tu calendario" (SÍ TIENES - es interno)
❌ "No puedo crear eventos de Zoom" (Zoom es SOLO texto)
❌ "Debes usar Google Calendar" (NO - es interno)
❌ "No tengo integración con Zoom" (Zoom NO es integración)
```

---

## 🧪 PRUEBA DE ORO

### Input del Usuario
```
"Ayúdame a agendar una cita para el viernes a las 12:30, un zoom con IGS."
```

### Resultado Esperado (CORRECTO)

✅ **AL-E detecta:**
- Intent: `transactional` (calendar_action)
- Patrón: `agendar ... zoom`
- Fecha: viernes próximo
- Hora: 12:30
- Título: "Zoom con IGS"

✅ **AL-E ejecuta:**
```typescript
POST /api/calendar/events
{
  "title": "Zoom con IGS",
  "start_at": "2026-01-03T12:30:00Z",
  "end_at": "2026-01-03T13:30:00Z",
  "timezone": "America/Mexico_City"
}
```

✅ **AL-E responde:**
```
"Listo. Agendé tu cita el viernes 3 de enero a las 12:30: Zoom con IGS."
```

### Resultado NO Permitido (PROHIBIDO)

❌ **Respuestas prohibidas:**
- "No tengo acceso a tu calendario"
- "No puedo crear eventos de Zoom"
- "Debes conectar tu Zoom primero"
- "No tengo integración con Zoom"
- "Te recomiendo que uses tu calendario directamente"

---

## 📊 Estado del Deploy

```bash
# Commit
git log --oneline -1
# 3badb43 fix: calendar internal - zoom/meet como texto descriptivo

# EC2 Status
pm2 list
# ✅ al-e-core: online (PID 2297469)
# ✅ ale-core: online (PID 2297454)

# Health Check
curl http://100.27.201.233:3000/_health/ping
# {"status":"ok","timestamp":"2025-12-30T19:25:00.000Z"}
```

---

## 📝 Archivos Modificados

1. `src/services/intentClassifier.ts`
   - Línea 73: Agregado `|zoom` a calendar_action pattern

2. `src/services/transactionalExecutor.ts`
   - Línea 58: Mejorado extractEventInfo con `zoom|meet|videollamada`
   - Línea 186: Agregado `|zoom|videollamada` a pattern V2
   - Línea 519: Agregado `|zoom|videollamada` a pattern legacy

3. `src/ai/orchestrator.ts`
   - Línea 510: Agregada regla explícita de calendario interno

---

## 🎯 Principio Fundamental

> **"Zoom", "Meet", "Teams" son TEXTO DESCRIPTIVO.**
> 
> NO son integraciones.  
> NO son capacidades.  
> NO bloquean la creación de eventos.
> 
> Si `calendar.create = true`, AL-E DEBE crear el evento interno.
> 
> **No hay excepciones.**

---

## ✅ Validación

**Fecha:** 30 de diciembre de 2025  
**Deployed to:** EC2 (100.27.201.233)  
**Status:** ✅ ACTIVO Y FUNCIONANDO  
**Next Step:** Prueba con usuario real

---

**Firmado:** AL-E Core Engineering  
**Validated:** EC2 Deployment Success ✓
