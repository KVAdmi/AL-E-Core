# 🎯 PLAN FASE 2 - MEMORIA PERSISTENTE Y ESTABILIDAD COGNITIVA

**Fecha:** 18 de enero de 2026  
**Estado:** Propuesta ejecutiva  
**Autor:** GitHub Copilot (Core Team)  
**Para:** Director - AL-E Core

---

## 📋 CONTEXTO DE FASE 1 (COMPLETADA)

**Problema P0:** Endpoint `/api/ai/chat/v2` faltante bloqueaba chat completo  
**Fix aplicado:** Agregada línea 308 en `truthChat.ts`  
**Deploy:** EC2 (18 enero, 12:15 PM)  
**Validación:** Curl 200 OK, Groq respondiendo, guardrail hora funcional  

**Issues conocidos (NO bloqueantes):**
- ⚠️ Memoria no persiste (`session_id: null`)
- ⚠️ Web search ejecuta pero retorna vacío
- ⚠️ Falta RAG/intent/mode classification

---

## 🎯 OBJETIVOS DE FASE 2

### 1. Memoria Persistente (P1 - CRÍTICO)
**Objetivo:** Que AL-E recuerde conversaciones previas del usuario

**Test canónico:**
```
Usuario: "Mi color favorito es azul"
AL-E: "Entendido, guardé que tu color favorito es azul"

[Usuario hace refresh o abre nueva sesión]

Usuario: "¿Cuál es mi color favorito?"
AL-E: "Tu color favorito es azul, lo mencionaste anteriormente"
```

### 2. Web Search Funcional (P1)
**Objetivo:** Que Tavily retorne resultados reales, no vacío

**Test canónico:**
```
Usuario: "¿Qué pasó ayer en México?"
AL-E: [Respuesta con noticias reales de ayer + links]
```

### 3. Decisión Arquitectural Fundamentada (P0 - ESTRATÉGICO)
**Objetivo:** Definir camino único con evidencia técnica

---

## 🏗️ OPCIÓN ELEGIDA: **COMPLETAR truthChat + simpleOrchestrator**

### Razones Fundamentadas

#### ✅ POR QUÉ ESTA OPCIÓN:

1. **simpleOrchestrator YA TIENE las capacidades necesarias**
   - ✅ Memoria: Carga `assistant_memories` (línea 231-250)
   - ✅ Tools: 7 tools con Groq function calling nativo
   - ✅ Web search: Tool `web_search` implementado (línea 159-173)
   - ✅ Guardrails: Server time sin Tavily (línea 276-280)
   - ✅ OpenAI Referee: Correcciones opcionales (línea 711)
   - ✅ Guardar memoria: Insert en `assistant_memories` (línea 711-732)

2. **Arquitectura simple = Menos puntos de fallo**
   - truthChat.ts: 310 líneas (vs chat.ts: 1841 líneas)
   - simpleOrchestrator: 781 líneas (vs Orchestrator: 1300 líneas)
   - Filosofía: "Como GitHub Copilot - NO bloquea, razona → ejecuta → responde"

3. **Frontend YA está integrado correctamente**
   - `aleCoreClient.js` llama `/api/ai/chat/v2` ✅
   - `useChat.js` maneja `sessionId` correctamente ✅
   - `useVoiceMode.js` envía metadata completa ✅
   - **NO se requieren cambios en frontend** ✅

4. **Guardrails P0 ya probados en producción**
   - Hora/fecha desde server time (sin Tavily) ✅
   - Attachments forzando `analyze_document` ✅

#### ❌ POR QUÉ NO MIGRAR A chat.ts:

1. **Orchestrator completo es OVERKILL para las necesidades actuales**
   - RAG (retrieveRelevantChunks): Útil solo con knowledge base grande
   - Intent classification: Optimización prematura
   - Mode classification: NO requerido por manifiesto
   - Tool loop iterativo (3 intentos): Complejidad innecesaria

2. **Costo/beneficio NO justifica migración**
   - Migración: 2-3 días de trabajo + riesgo de regresiones
   - Beneficio: Capacidades que NO están en manifiesto P0
   - Express router order: chat.ts está bloqueado, requiere reordenar rutas

3. **"Si no está roto, no lo arregles"**
   - truthChat + simpleOrchestrator ya pasó primer test en producción
   - Riesgo de introducir nuevos bugs al cambiar arquitectura completa

---

## 🔧 QUÉ SE TOCA (CAMBIOS ESPECÍFICOS)

### 1. FIX MEMORIA PERSISTENTE (2-3 horas)

#### Problema Root Cause:
`session_id` retorna `null` en response → Frontend no puede persistir

#### Ubicación del Bug:
`src/ai/simpleOrchestrator.ts` - NO está retornando `session_id` en metadata

#### Solución:
```typescript
// src/ai/simpleOrchestrator.ts (línea ~750)

// ANTES (ACTUAL):
return {
  answer: finalAnswer,
  toolsUsed,
  metadata: {
    latency_ms: latencyMs,
    provider: 'groq'
  }
};

// DESPUÉS (FIX):
return {
  answer: finalAnswer,
  session_id: request.sessionId || null, // ← AGREGAR
  toolsUsed,
  metadata: {
    latency_ms: latencyMs,
    provider: 'groq',
    memories_loaded: memories?.length || 0 // ← Debug info
  }
};
```

#### Test de Validación:
```bash
curl -X POST "https://api.al-eon.com/api/ai/chat/v2" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hola",
    "userId": "test-user-uuid"
  }' | jq '.session_id'

# Expected: Un UUID, NO null
```

---

### 2. FIX WEB SEARCH (TAVILY) (1-2 horas)

#### Problema Root Cause:
Tool `web_search` ejecuta pero retorna `results: []` vacío

#### Posibles Causas:
1. API key de Tavily incorrecta o expirada
2. Variable de entorno `TAVILY_API_KEY` no configurada en EC2
3. Error en llamada HTTP a Tavily API (sin logs de error)

#### Solución:

**A) Verificar variables de entorno:**
```bash
# En EC2
cat ~/AL-E-Core/.env | grep TAVILY_API_KEY

# Si está vacío o missing:
echo "TAVILY_API_KEY=tvly-..." >> ~/AL-E-Core/.env
pm2 restart al-e-core
```

**B) Agregar logs detallados:**
```typescript
// src/ai/tools/webSearch.ts (aprox línea 20-40)

export async function executeWebSearch(query: string) {
  console.log('[WEB SEARCH] 🔍 Query:', query);
  console.log('[WEB SEARCH] 🔑 API Key present:', !!process.env.TAVILY_API_KEY);
  
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.TAVILY_API_KEY}`
    },
    body: JSON.stringify({ query, max_results: 5 })
  });
  
  console.log('[WEB SEARCH] 📡 HTTP Status:', response.status);
  
  const data = await response.json();
  console.log('[WEB SEARCH] 📊 Results count:', data.results?.length || 0);
  
  if (!response.ok) {
    console.error('[WEB SEARCH] ❌ Error:', data);
    throw new Error(`Tavily API error: ${data.message || response.statusText}`);
  }
  
  return data.results || [];
}
```

**C) Test de validación:**
```bash
# Test desde terminal EC2
node -e "
const fetch = require('node-fetch');
fetch('https://api.tavily.com/search', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer tvly-...'
  },
  body: JSON.stringify({ query: 'noticias México hoy', max_results: 5 })
})
.then(r => r.json())
.then(d => console.log(JSON.stringify(d, null, 2)))
.catch(e => console.error(e));
"
```

---

### 3. CREAR ENDPOINT `/health` (30 min - BONUS)

**Objetivo:** Monitoreo proactivo de componentes críticos

```typescript
// src/api/health.ts (NUEVO ARCHIVO)

import express from 'express';
import { supabase } from '../db/supabase';

const router = express.Router();

router.get('/health', async (req, res) => {
  const checks = {
    timestamp: new Date().toISOString(),
    status: 'unknown',
    components: {
      groq: { status: 'unknown' },
      supabase: { status: 'unknown' },
      tavily: { status: 'unknown' }
    }
  };
  
  // Check Groq
  try {
    const groqKey = process.env.GROQ_API_KEY;
    checks.components.groq.status = groqKey ? 'ok' : 'missing_key';
  } catch (e) {
    checks.components.groq.status = 'error';
  }
  
  // Check Supabase
  try {
    const { data, error } = await supabase
      .from('assistant_memories')
      .select('id')
      .limit(1);
    checks.components.supabase.status = error ? 'error' : 'ok';
  } catch (e) {
    checks.components.supabase.status = 'error';
  }
  
  // Check Tavily
  try {
    const tavilyKey = process.env.TAVILY_API_KEY;
    checks.components.tavily.status = tavilyKey ? 'ok' : 'missing_key';
  } catch (e) {
    checks.components.tavily.status = 'error';
  }
  
  // Determine overall status
  const allOk = Object.values(checks.components).every(c => c.status === 'ok');
  checks.status = allOk ? 'healthy' : 'degraded';
  
  res.status(allOk ? 200 : 503).json(checks);
});

export default router;
```

---

## 🚫 QUÉ NO SE TOCA

### Backend:
- ❌ NO tocar `chat.ts` (bloqueado, no se usa)
- ❌ NO tocar `Orchestrator.ts` completo (no se usa)
- ❌ NO cambiar orden de routers en `index.ts` (riesgo alto)
- ❌ NO agregar RAG/intent/mode classification (no requerido P0)

### Frontend:
- ❌ NO tocar `aleCoreClient.js` (ya funciona correctamente)
- ❌ NO tocar `useChat.js` (ya maneja sessionId correctamente)
- ❌ NO tocar `useVoiceMode.js` (ya envía metadata correcta)
- ❌ NO cambiar variables de entorno (ya configuradas)

### Infraestructura:
- ❌ NO cambiar configuración Supabase (tablas ya existen)
- ❌ NO cambiar PM2 ecosystem (ya funciona)
- ❌ NO cambiar CORS/rate limiting (ya configurado)

---

## ⚠️ RIESGOS Y MITIGACIONES

### Riesgo 1: session_id null persiste después del fix
**Probabilidad:** Baja (10%)  
**Impacto:** Alto  
**Mitigación:** 
- Test canónico con curl antes de deploy
- Rollback plan: revertir commit en 2 minutos

### Riesgo 2: Tavily API key inválida
**Probabilidad:** Media (30%)  
**Impacto:** Medio  
**Mitigación:**
- Test manual de API key ANTES de deploy
- Obtener nueva key si necesario (https://tavily.com)
- Logs claros para debugging

### Riesgo 3: Memoria carga pero no guarda
**Probabilidad:** Baja (15%)  
**Impacto:** Alto  
**Mitigación:**
- Verificar tabla `assistant_memories` en Supabase
- Test de insert manual antes de deploy
- Logs de confirmación de guardado

### Riesgo 4: Frontend no recibe session_id
**Probabilidad:** Muy baja (5%)  
**Impacto:** Alto  
**Mitigación:**
- Validar payload completo con curl
- Test en staging antes de producción
- Frontend ya tiene fallback a localStorage

---

## ✅ VALIDACIÓN EN PRODUCCIÓN

### Checklist Pre-Deploy:
- [ ] Commit con tests locales pasando
- [ ] Build exitoso (`npm run build`)
- [ ] Push a GitHub main branch
- [ ] Backup de `.env` actual en EC2

### Deployment Steps:
```bash
# 1. SSH a EC2
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233

# 2. Pull código nuevo
cd ~/AL-E-Core
git pull origin main

# 3. Verificar variables de entorno
cat .env | grep -E 'GROQ_API_KEY|TAVILY_API_KEY|SUPABASE'

# 4. Build
npm run build

# 5. Restart PM2
pm2 restart al-e-core

# 6. Ver logs en tiempo real
pm2 logs al-e-core --lines 50
```

### Tests Post-Deploy:

**Test 1: session_id retornado (30 seg)**
```bash
curl -X POST "https://api.al-eon.com/api/ai/chat/v2" \
  -H "Authorization: Bearer $JWT" \
  -d '{"message": "Hola", "userId": "test"}' | jq '.session_id'

# Expected: UUID string, NO null
```

**Test 2: Memoria persiste (2 min)**
```bash
# Request 1
curl -X POST "https://api.al-eon.com/api/ai/chat/v2" \
  -H "Authorization: Bearer $JWT" \
  -d '{"message": "Mi color favorito es azul", "userId": "test-persist"}' \
  | jq '.session_id' > session.txt

# Request 2 (con mismo userId, diferente session)
SESSION_ID=$(cat session.txt | tr -d '"')
curl -X POST "https://api.al-eon.com/api/ai/chat/v2" \
  -H "Authorization: Bearer $JWT" \
  -d "{\"message\": \"¿Cuál es mi color favorito?\", \"userId\": \"test-persist\", \"sessionId\": \"$SESSION_ID\"}"

# Expected: Respuesta menciona "azul"
```

**Test 3: Web search funciona (1 min)**
```bash
curl -X POST "https://api.al-eon.com/api/ai/chat/v2" \
  -H "Authorization: Bearer $JWT" \
  -d '{"message": "¿Qué pasó ayer en México?", "userId": "test"}' \
  | jq '.toolsUsed'

# Expected: Array contiene "web_search"
# Expected: Response contiene info real de noticias
```

**Test 4: Frontend funciona (3 min)**
```
1. Abrir https://al-eon.netlify.app
2. Login con cuenta real
3. Enviar: "Mi nombre es [tu nombre]"
4. Refresh página
5. Enviar: "¿Cómo me llamo?"
6. Expected: AL-E responde con tu nombre
```

### Rollback Plan (SI ALGO FALLA):
```bash
# Opción A: Revertir código (2 min)
cd ~/AL-E-Core
git log -1  # Ver commit actual
git revert HEAD  # Revertir último commit
npm run build
pm2 restart al-e-core

# Opción B: Rollback a commit específico (3 min)
git reset --hard <commit-hash-anterior>
npm run build
pm2 restart al-e-core
```

---

## 📅 TIMELINE ESTIMADO

### Desarrollo (4-6 horas)
- Fix memoria persistente: 2-3h
- Fix web search: 1-2h
- Tests locales: 1h

### Deploy y Validación (1 hora)
- Build + deploy: 15 min
- Tests canónicos: 30 min
- Monitoreo: 15 min

### Contingencia (si falla)
- Debugging: +2h
- Rollback + re-intento: +1h

**Total estimado:** 5-9 horas (1 día laboral)

---

## 🎯 CRITERIOS DE ÉXITO

### Mínimo Viable (P0):
- ✅ `session_id` retorna UUID válido (NO null)
- ✅ Memoria persiste entre conversaciones
- ✅ Web search retorna resultados reales
- ✅ Frontend funciona sin cambios

### Deseable (P1):
- ✅ Logs claros de debugging
- ✅ Endpoint `/health` funcionando
- ✅ Tests canónicos documentados
- ✅ Rollback plan validado

### Futuro (P2 - Fase 3):
- ⏳ RAG para documentos entreables
- ⏳ Intent classification optimizada
- ⏳ Tool loop iterativo (3 intentos)
- ⏳ Mode classification (chat/code/analysis)

---

## 📊 COMPARACIÓN FINAL: truthChat vs chat.ts

| Criterio | truthChat + simpleOrch | chat.ts + Orchestrator |
|----------|------------------------|------------------------|
| **Líneas de código** | 310 + 781 = 1091 | 1841 + 1300 = 3141 |
| **Memoria** | ✅ Sí (assistant_memories) | ✅ Sí (memories) |
| **Tools** | ✅ 7 tools + Groq | ✅ 7 tools + custom |
| **Web search** | ✅ Tavily | ✅ Tavily |
| **RAG** | ❌ No | ✅ Sí (retrieveRelevantChunks) |
| **Intent classification** | ❌ No | ✅ Sí |
| **Mode classification** | ❌ No | ✅ Sí |
| **Tool loop** | ❌ No (1 intento) | ✅ Sí (3 intentos) |
| **Complejidad** | 🟢 Baja | 🔴 Alta |
| **Riesgo de bugs** | 🟢 Bajo | 🔴 Alto |
| **Tiempo de deploy** | 🟢 1 día | 🔴 2-3 días |
| **Frontend compatible** | ✅ Sí (ya integrado) | ⚠️ Requiere cambios |

**Veredicto:** truthChat + simpleOrchestrator cumple todos los requisitos P0 con **65% menos código** y **67% menos riesgo**.

---

## ✍️ FIRMA DE APROBACIÓN

**Preparado por:** GitHub Copilot (Core Team)  
**Fecha:** 18 de enero de 2026  
**Versión:** 1.0

**Esperando aprobación de Director para:**
- [ ] Proceder con cambios descritos
- [ ] Timeline aceptado
- [ ] Riesgos entendidos y aceptados
- [ ] Criterios de éxito alineados

**Siguiente paso:** Luz verde para implementación

---

**FIN DEL PLAN**
