# RUNBOOK — Deploy P0 Chat v2 (CORE backend)

Fecha: 2026-01-17

## Objetivo
Asegurar que producción use **/api/ai/chat/v2** y que:
- Hora/fecha se responda correctamente en MX **sin web_search**.
- Attachments se procesen **con analyze_document** o (si falla) se bloquee con **428 explícito**.
- `/api/ai/chat/v2` NO caiga en `[SIMPLE ORCH]` (legacy).

## Qué se desplegó en este patch
- Separación de rutas: `/api/ai/chat/v2` vuelve al flujo v2 real (en `src/api/chat.ts`).
- Guardrails en legacy (`/api/ai/chat` vía `src/api/truthChat.ts`):
  - Hora/fecha: responde por server time MX, **toolsUsed: []**.
  - Attachments: fuerza `analyze_document` sin depender del LLM; si no hay URL usable o falla, responde **428 explícito**.
- Normalización: `toolsUsed` nunca puede ser `undefined` (siempre array).

## Deploy (EC2 + PM2)
> Importante: producción corre desde `dist/`. No basta con `git pull`.

En la instancia EC2:

```bash
cd AL-E-Core

git pull
npm ci
npm run build
pm2 restart al-e-core
```

## Validación por logs (obligatoria)
### 1) Confirmar que v2 es v2 (no legacy)
Buscar en logs:
- Debe aparecer: `route: '/api/ai/chat/v2'`
- Debe NO aparecer para ese request: `[SIMPLE ORCH]`

### 2) Prueba canónica A — Hora/fecha
Prompt:
- “¿Qué día y hora es en México?”

Esperado:
- Respuesta correcta en MX.
- Debe verse `toolsUsed: []`.
- Debe NO verse `web_search`.

### 3) Prueba canónica B — Documento / Attachment
Prompt:
- “Analiza este documento” + adjuntar archivo (docx/pdf/etc)

Esperado:
- O bien:
  - `toolsUsed: ['analyze_document']` y respuesta con resumen/hallazgos.
- O bien (stop bleeding):
  - HTTP **428** con `ATTACHMENT_ANALYSIS_REQUIRED` o `ATTACHMENT_ANALYSIS_FAILED`.

Prohibido:
- “No veo tu documento” si llegaron attachments.

## Filtros útiles (opcional)
Si PM2 está ruidoso, filtrar por rutas:

```bash
pm2 logs al-e-core --lines 400 --nostream | grep -E "route: '/api/ai/chat/v2'|\[SIMPLE ORCH\]|\[TRUTH CHAT\]|analyze_document|web_search|ATTACHMENT_ANALYSIS"
```

## PASS/FAIL
- **PASS** si ambas pruebas canónicas pasan y en logs se confirma `/api/ai/chat/v2` sin `[SIMPLE ORCH]`.
- **FAIL** si:
  - sigue llegando tráfico a `/api/ai/chat` desde frontend,
  - aparece `[SIMPLE ORCH]` en requests v2,
  - hora/fecha usa `web_search`,
  - attachments no disparan `analyze_document` ni 428 explícito.
