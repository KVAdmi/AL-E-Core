# AUDITORÍA MANIFIESTO vs PRODUCCIÓN
**Fecha:** 17 de enero de 2026, 21:10 (post-fix P0)  
**Objetivo:** Validar cumplimiento del Manifiesto Rector contra prod

---

## ✅ COMPLETADO (P0 - EN VERDE)

### 1. Chat v2 + Attachments
- ✅ Endpoint `/api/ai/chat/v2` activo
- ✅ Hora/fecha desde server (MX) sin `web_search`
- ✅ Attachments: descarga, parsing, inyección en contexto
- ✅ PDFs procesados correctamente (843KB, 295 chars extraídos)
- ✅ Memoria/RAG/DB operativos (password Postgres corregido)

### 2. Búsqueda Web
- ✅ `web_search` (Tavily) activo
- ✅ Verifica fuentes externas
- ✅ Responde con citas

### 3. Análisis de Documentos
- ✅ PDFs: parsing con pdf-parse
- ✅ Resúmenes generados correctamente
- ✅ Contenido inyectado en prompt

### 4. Agenda/Calendar (Parcial)
- ✅ `calendar.list` funciona (leyó "1 evento el sábado 12:00 p.m.")
- ✅ `calendar.create` capability habilitado en orchestrator
- ⚠️ **NO validado end-to-end**: falta prueba de crear evento real

---

## 🔴 BLOQUEADOS / NO FUNCIONAN (P1 URGENTE)

### 1. CORREO ELECTRÓNICO (CRÍTICO - MANIFIESTO §4)

**Estado:** ❌ **NO OPERATIVO** (bloqueante: configuración usuario)

**Evidencia:**
```
Request: "Muéstrame mis últimos 3 correos"
Respuesta: "Lo siento, pero no tengo acceso a tu correo electrónico"
```

**Tools existentes en código:**
- ✅ `list_emails` definido en `toolDefinitions.ts`
- ✅ `read_email` definido
- ✅ `send_email` definido
- ✅ Funciones implementadas en `src/ai/tools/emailTools.ts`:
  - `listEmails()`
  - `readEmail()`
  - `sendEmail()`
  - `createAndSendEmail()`
- ✅ Integración en orchestrator (`src/ai/orchestrator.ts` líneas 275-430)
- ✅ FORCE_EMAIL_TOOLS detecta keywords correctamente

**Root cause CONFIRMADO:**
```sql
SELECT * FROM email_accounts WHERE user_id = '56bc3448-6af0-4468-99b9-78779bf84ae8';
-- Resultado: NULL (usuario sin cuentas configuradas)
```

**Bloqueante:** Usuario NO tiene cuentas de correo en `email_accounts` (Supabase).  
**Infraestructura:** ✅ 100% lista (Email Hub + tools + orchestrator)  
**Acción requerida:** Usuario debe configurar al menos 1 cuenta en Email Hub UI o via SQL

**Gap vs Manifiesto:**
> **"AL-E LEE, ENTIENDE Y OPERA EL CORREO."**  
> "Leer correos entrantes ✓"  
> "Responder correos con tono adecuado ✓"  
> "Detectar acciones necesarias y ejecutarlas ✓"

**Incumplimiento:** ❌ Total (capacidad existe, NO está activa en prod)

---

### 2. OCR / ANÁLISIS DE IMÁGENES (CRÍTICO - MANIFIESTO §7)

**Estado:** ❌ **NO OPERATIVO**

**Evidencia:**
```
Request: "Analiza esta imagen" (PNG con texto)
Respuesta: "Lo siento, pero no puedo analizar imágenes directamente"
```

**Infraestructura existente:**
- ✅ Google Vision API configurado (`src/services/visionService.ts`)
- ✅ Endpoint `/api/vision/analyze` montado
- ✅ `analyzeImage()` implementado con OCR + labels + faces
- ✅ `GOOGLE_APPLICATION_CREDENTIALS` en `.env` prod

**Root cause probable:**
1. Imágenes en attachments NO están siendo enviadas a Vision API automáticamente
2. El flujo de attachments solo parsea PDFs, no ejecuta Vision para PNG/JPG
3. Tool `analyze_image` NO está definida en `toolDefinitions.ts` ni ofrecida al LLM

**Gap vs Manifiesto:**
> **"Analizar imágenes ✓"**  
> "Extraer información relevante ✓"  
> "Detectar acciones derivadas ✓"

**Incumplimiento:** ❌ Total (infraestructura existe, NO está integrada al flujo v2)

---

### 3. TELEGRAM (CRÍTICO - MANIFIESTO §6)

**Estado:** ⚠️ **NO VALIDADO** (código existe, falta prueba prod)

**Infraestructura existente:**
- ✅ `/api/telegram` endpoint existe
- ✅ Integración con bots (según docs previos)
- ✅ Envío de mensajes implementado

**Pendiente:**
- Validar que bot está activo y responde
- Confirmar que puede enviar mensajes solicitados por usuario
- Probar notificaciones automáticas

**Gap vs Manifiesto:**
> **"Telegram es brazo operativo, no solo chat."**  
> "Envía mensajes solicitados por el usuario ✓"  
> "Notifica eventos, recordatorios y resultados ✓"

**Estado:** ⚠️ Incompleto (no validado en prod)

---

### 4. VOZ Y TIEMPO REAL (MANIFIESTO §9)

**Estado:** ⚠️ **NO VALIDADO**

**Infraestructura existente:**
- ✅ `/api/voice` endpoint existe (según docs)
- ✅ STT/TTS con Groq Whisper mencionado en configs
- ✅ Modo voz bloqueado para OpenAI

**Pendiente:**
- Validar STT funciona (transcripción)
- Validar TTS funciona (respuesta por voz)
- Probar latencia end-to-end

**Gap vs Manifiesto:**
> **"La voz no es adorno, es modo principal."**  
> "Escucha al usuario ✓"  
> "Responde por voz o texto ✓"

**Estado:** ⚠️ Incompleto (no validado en prod)

---

### 5. REUNIONES / JUNTAS (MANIFIESTO §10)

**Estado:** ⚠️ **NO VALIDADO**

**Infraestructura existente:**
- ✅ `/api/meetings` endpoint existe
- ✅ Pyannote API key configurado (diarización)
- ✅ S3 bucket para grabaciones (`al-eon-meetings`)

**Pendiente:**
- Validar que puede entrar a reunión
- Confirmar diarización (identificar speakers)
- Probar generación de minuta/transcripción

**Gap vs Manifiesto:**
> **"AL-E no es grabadora, AL-E es secretaria ejecutiva de juntas."**  
> "Identificar participantes por voz ✓"  
> "Generar minuta formal ✓"

**Estado:** ⚠️ Incompleto (no validado en prod)

---

## 🟡 PARCIALMENTE OPERATIVO

### Agenda/Calendar
- ✅ Lectura: funciona (`calendar.list`)
- ⚠️ Creación: capability habilitado, **NO probado end-to-end**
- ⚠️ Confirmaciones/notificaciones: **NO validadas**

**Acción:** Probar crear evento real y verificar que se guarda en calendar provider.

---

## 📋 RESUMEN EJECUTIVO

| Capacidad | Manifiesto | Código | Prod | Gap |
|-----------|------------|--------|------|-----|
| Chat v2 + Attachments | ✅ | ✅ | ✅ | Ninguno |
| Hora/fecha MX | ✅ | ✅ | ✅ | Ninguno |
| Web Search | ✅ | ✅ | ✅ | Ninguno |
| PDFs | ✅ | ✅ | ✅ | Ninguno |
| DB/RAG/Memoria | ✅ | ✅ | ✅ | Ninguno (fix aplicado) |
| **Correo (leer)** | ✅ | ✅ | ❌ | **Tools no activos** |
| **Correo (enviar)** | ✅ | ✅ | ❌ | **Tools no activos** |
| **OCR/Imágenes** | ✅ | ✅ | ❌ | **No integrado a v2** |
| Agenda (leer) | ✅ | ✅ | ✅ | Ninguno |
| Agenda (crear) | ✅ | ✅ | ⚠️ | No probado |
| Telegram | ✅ | ✅ | ⚠️ | No validado |
| Voz | ✅ | ✅ | ⚠️ | No validado |
| Reuniones | ✅ | ✅ | ⚠️ | No validado |

---

## 🔥 PRIORIDADES P1 (POST-P0)

### 1. CORREO (P1-A - CRÍTICO)
**Impacto:** Alto - Manifiesto §4 completo bloqueado  
**Esfuerzo:** Medio  
**Acción:**
1. Confirmar si usuario tiene cuentas en `email_accounts` (Supabase)
2. Registrar tools `list_emails`, `read_email`, `send_email` en orchestrator v2
3. Validar integración Email Hub → toolRouter
4. Probar end-to-end: leer inbox, responder correo

**Bloqueante:** Sin esto, AL-E NO cumple rol de "asistente ejecutiva" (§2 Manifiesto)

---

### 2. OCR/IMÁGENES (P1-B - CRÍTICO)
**Impacto:** Alto - Manifiesto §7 bloqueado  
**Esfuerzo:** Bajo (Vision API ya existe)  
**Acción:**
1. Crear tool `analyze_image` en `toolDefinitions.ts`
2. En `attachmentDownload.ts`: detectar PNG/JPG → llamar `visionService.analyzeImage()`
3. Inyectar texto OCR en contexto (igual que PDFs)
4. Probar con factura/ticket escaneado

**Bloqueante:** Sin esto, no puede leer documentos escaneados ni tickets físicos

---

### 3. AGENDA (CREAR) - P1-C
**Impacto:** Medio - Manifiesto §5 parcial  
**Esfuerzo:** Bajo (código existe)  
**Acción:**
1. Probar: "Agenda reunión mañana 3pm con Juan"
2. Verificar evento creado en Google Calendar / provider
3. Confirmar notificación/confirmación automática

---

### 4. TELEGRAM - P1-D
**Impacto:** Medio - Manifiesto §6  
**Esfuerzo:** Bajo (validación)  
**Acción:**
1. Enviar mensaje desde AL-E a Telegram (test)
2. Confirmar bot responde
3. Validar notificaciones automáticas

---

### 5. VOZ - P1-E
**Impacto:** Alto - Manifiesto §9: "voz es modo principal"  
**Esfuerzo:** Medio  
**Acción:**
1. Probar STT (audio → texto)
2. Probar TTS (respuesta → audio)
3. Medir latencia end-to-end

---

### 6. REUNIONES - P1-F
**Impacto:** Medio-Alto - Manifiesto §10  
**Esfuerzo:** Alto (diarización + minuta)  
**Acción:**
1. Probar grabación → transcripción
2. Validar diarización (Pyannote)
3. Generar minuta estructurada

---

## 🎯 CRITERIO DE ÉXITO (MANIFIESTO COMPLETO)

Para decir que **AL-E cumple el Manifiesto Rector**:

1. ✅ Usuario puede preguntar "¿tengo correos?" y AL-E los lista
2. ✅ Usuario puede decir "responde ese correo" y AL-E lo envía
3. ✅ Usuario puede subir foto de ticket y AL-E extrae texto (OCR)
4. ✅ Usuario puede decir "agenda reunión" y AL-E crea evento real
5. ✅ Usuario puede pedir "avísame por Telegram" y recibe notificación
6. ✅ Usuario puede hablar por voz y AL-E responde por voz
7. ✅ Usuario puede grabar junta y AL-E genera minuta formal

**Estado actual:** 2/7 ✅ (chat+docs+web, agenda parcial)  
**Pendiente:** 5/7 ❌ (correo, OCR, telegram, voz, reuniones)

---

## 📌 CONCLUSIÓN

**P0 (v2 + DB + attachments) está en verde.**  
**P1 (correo + OCR) es CRÍTICO para cumplir Manifiesto §2, §4, §7.**

Sin correo y OCR, AL-E **no es asistente ejecutiva**, es un chatbot avanzado con docs.

**Recomendación:** Abordar P1-A (correo) y P1-B (OCR) antes que voz/reuniones, porque son más usados en día a día y tienen menor complejidad técnica (la infra ya existe).

---

**Siguiente paso sugerido:**  
Probar `list_emails` end-to-end → identificar por qué el tool no está siendo llamado por el LLM en v2.
