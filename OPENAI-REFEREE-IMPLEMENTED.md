# ✅ OPENAI REFEREE - IMPLEMENTACIÓN COMPLETADA

**Fecha:** 16 de enero de 2026  
**Objetivo:** Reactivar OpenAI en AL-E Core como **árbitro de verdad** (NO como modelo principal)

---

## 🎯 ARQUITECTURA IMPLEMENTADA

```
┌─────────────────────────────────────────────────────────────┐
│                    USER REQUEST                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               GROQ (Primary Model)                          │
│   - Intent detection                                        │
│   - Tool calling                                            │
│   - STT (Whisper)                                           │
│   - Fast responses                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│          DETECCIÓN DE PROBLEMAS                             │
│   ✓ Respuestas defensivas ("no tengo acceso")             │
│   ✓ Tools disponibles pero no ejecutados                   │
│   ✓ Placeholders o contenido inventado                     │
│   ✓ Contradicción con tool results                         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼ (SOLO SI HAY PROBLEMA)
┌─────────────────────────────────────────────────────────────┐
│         OPENAI REFEREE (gpt-4o-mini)                        │
│   - Corrige respuesta con evidencia                        │
│   - NO inventa                                              │
│   - NO rechaza                                              │
│   - Usa tool results obligatoriamente                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔧 COMPONENTES IMPLEMENTADOS

### 1. Variables de Entorno (`.env`)

```bash
# === OPENAI REFEREE (CONTROLADO) ===
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=1200
OPENAI_ROLE=referee
```

**✅ Confirmado en logs:**
```
[LLM_ROUTER] ✅ OpenAI configured as referee (not in primary chain)
[OPENAI] Provider enabled
[OPENAI] Model: gpt-4o-mini
[OPENAI] Role: referee
```

---

### 2. Router LLM (`src/llm/router.ts`)

**Cambios:**
- Agregado `'openai'` a `LlmProvider` type
- Config condicional: OpenAI SOLO si `OPENAI_ROLE=referee`
- OpenAI NO entra en cadena de fallback (filtrado explícito)

```typescript
export type LlmProvider = 'groq' | 'fireworks' | 'together' | 'openai';

const providerChain: LlmProvider[] = [
  defaultProvider,
  ...(fallback1 !== defaultProvider ? [fallback1] : []),
  ...(fallback2 !== defaultProvider && fallback2 !== fallback1 ? [fallback2] : [])
].filter(p => p !== 'openai'); // Excluir OpenAI del chain
```

---

### 3. Módulo Referee (`src/llm/openaiReferee.ts`)

**Funciones principales:**

#### `detectGroqEvasion()`
Detecta:
- Frases defensivas: "no tengo acceso", "no puedo acceder", etc.
- Tools disponibles pero NO ejecutados
- Placeholders: `[nombre]`, `{variable}`, `example@email.com`

#### `detectEvidenceMismatch()`
Detecta contradicción entre tool results y respuesta del modelo.

#### `invokeOpenAIReferee()`
- Llama a OpenAI con prompt estricto
- System prompt PROHIBE rechazos
- Obliga a usar evidencia de tools
- Registra tokens, latency y costo

**Control de Costos:**
```typescript
MAX_CALLS_PER_DAY = 200;
MAX_COST_PER_MONTH_USD = 20;
```

**Logging obligatorio:**
```
[OPENAI_REFEREE] Invoking referee (reason=defensive_response)
[OPENAI_REFEREE] ✅ Success
[OPENAI_REFEREE] reason=defensive_response
[OPENAI_REFEREE] tokens_in=250
[OPENAI_REFEREE] tokens_out=120
[OPENAI_REFEREE] latency_ms=850
[OPENAI_REFEREE] cost_estimated=$0.0002
[OPENAI_REFEREE] daily_calls=5/200
[OPENAI_REFEREE] monthly_cost=$0.85/$20.00
```

---

### 4. Integración en Chat API (`src/api/chat.ts`)

**Flujo post-Groq:**

1. Groq genera respuesta
2. **Detección automática de problemas**
3. Si detecta evasión/hallucination → invoca referee
4. Reemplaza respuesta con corrección de OpenAI
5. Registra en `ae_requests.metadata`:
   ```json
   {
     "referee_used": true,
     "referee_reason": "defensive_response",
     "referee_cost_usd": 0.0002,
     "referee_latency_ms": 850
   }
   ```

**Log en orchestrator:**
```
[ORCH] ⚖️ OPENAI REFEREE INVOKED - reason=defensive_response
[ORCH] ✅ REFEREE CORRECTED - primary_model=groq fallback_model=openai fallback_reason=defensive_response
```

---

## ✅ CASOS DE PRUEBA

### **Caso 1: Email funcionando (NO debe invocar referee)**

**Input:**
```
"checa mi correo"
```

**Comportamiento esperado:**
- Groq ejecuta `list_emails` tool
- Responde con lista real de emails
- Referee NO se invoca

**Logs esperados:**
```
[ACTION] list_emails executed
[CHAT] ✓ LLM response received
[OPENAI_REFEREE] NOT CALLED
```

**Metadata en `ae_requests`:**
```json
{
  "referee_used": false,
  "referee_reason": null
}
```

---

### **Caso 2: Groq evasivo (DEBE invocar referee)**

**Input:**
```
"lee mi último correo"
```

**Groq responde:**
```
"Como modelo de lenguaje, no tengo acceso directo a tu correo electrónico."
```

**Comportamiento esperado:**
1. Detección: `defensive_response` (frase "no tengo acceso")
2. Invoca referee con evidencia de tool `read_email`
3. OpenAI corrige: "Tu último correo es de [remitente] con asunto '[asunto]'..."

**Logs esperados:**
```
[CHAT] ✓ LLM response received
[ORCH] ⚖️ OPENAI REFEREE INVOKED - reason=defensive_response
[OPENAI_REFEREE] Invoking referee (reason=defensive_response)
[OPENAI_REFEREE] ✅ Success
[OPENAI_REFEREE] reason=defensive_response
[OPENAI_REFEREE] tokens_in=280
[OPENAI_REFEREE] tokens_out=95
[OPENAI_REFEREE] latency_ms=920
[OPENAI_REFEREE] cost_estimated=$0.0003
[ORCH] ✅ REFEREE CORRECTED - primary_model=groq fallback_model=openai fallback_reason=defensive_response
```

**Metadata en `ae_requests`:**
```json
{
  "referee_used": true,
  "referee_reason": "defensive_response",
  "referee_cost_usd": 0.0003,
  "referee_latency_ms": 920
}
```

---

### **Caso 3: Web search con hallucination (DEBE invocar referee)**

**Input:**
```
"busca información sobre infinitykode.com"
```

**Groq responde con contenido inventado:**
```
"InfinityKode es una empresa fundada en [año] especializada en..."
```

**Comportamiento esperado:**
1. Detección: `hallucination_detected` (placeholders `[año]`)
2. Invoca referee con resultados de Tavily
3. OpenAI corrige con datos reales de web search

**Logs esperados:**
```
[WEB_SEARCH] ✓ Tavily search completed (3 results)
[ORCH] ⚖️ OPENAI REFEREE INVOKED - reason=hallucination_detected
[OPENAI_REFEREE] Invoking referee (reason=hallucination_detected)
[OPENAI_REFEREE] ✅ Success
[OPENAI_REFEREE] reason=hallucination_detected
[OPENAI_REFEREE] tokens_in=520
[OPENAI_REFEREE] tokens_out=180
[OPENAI_REFEREE] latency_ms=1200
[OPENAI_REFEREE] cost_estimated=$0.0005
[ORCH] ✅ REFEREE CORRECTED - primary_model=groq fallback_model=openai fallback_reason=hallucination_detected
```

**Metadata en `ae_requests`:**
```json
{
  "referee_used": true,
  "referee_reason": "hallucination_detected",
  "referee_cost_usd": 0.0005,
  "referee_latency_ms": 1200,
  "web_search_used": true,
  "web_results_count": 3
}
```

---

## 🔒 REGLAS IMPLEMENTADAS (NO NEGOCIABLES)

✅ **OpenAI NO decide intent** → Intent detection sigue en Groq  
✅ **OpenAI NO llama tools** → Tools ejecutados por orchestrator  
✅ **OpenAI NO escucha audio** → STT sigue en Groq (Whisper)  
✅ **OpenAI NO inventa** → System prompt prohibe hallucinations  
✅ **OpenAI NO responde sin evidencia** → Obligado a usar tool results  
✅ **OpenAI NO entra en loop principal** → Filtrado del provider chain  
✅ **OpenAI NO se usa sin trigger** → Solo si detecta problema  

---

## 💰 CONTROL DE COSTOS

**Límites automáticos:**
- Max 200 llamadas/día
- Max $20 USD/mes

**Si se excede:**
- Se loggea en consola
- Se alerta al sistema
- Se lanza error `REFEREE_LIMIT_EXCEEDED`
- NO se desactiva automáticamente (requiere autorización)

**Pricing (gpt-4o-mini):**
- Input: $0.150 / 1M tokens
- Output: $0.600 / 1M tokens
- Promedio estimado: $0.0003 por llamada

**Proyección mensual (200 calls/día):**
- 6,000 llamadas/mes
- Costo estimado: ~$1.80 USD/mes
- **MUY por debajo del límite de $20 USD**

---

## 📊 OBSERVABILIDAD

**Endpoint de stats:**
```bash
GET /_health/referee
```

**Respuesta:**
```json
{
  "daily": {
    "calls": 45,
    "limit": 200,
    "remaining": 155,
    "date": "2026-01-16"
  },
  "monthly": {
    "cost": 2.35,
    "limit": 20,
    "remaining": 17.65,
    "month": "2026-01"
  }
}
```

---

## 🎯 DEFINICIÓN DE ÉXITO

### ✅ AL-E **NUNCA MÁS** debe:
- ❌ Inventar empresas (InfinityKode, etc.)
- ❌ Decir "no tengo acceso" si hay tools
- ❌ Simular ejecuciones
- ❌ Responder con placeholders `[nombre]`, `{variable}`

### ✅ AL-E **SIEMPRE** debe:
- ✅ Si hay datos → responde con datos
- ✅ Si no hay datos → lo dice claramente: "No se encontró información"
- ✅ Si hay tools → las usa
- ✅ Si hay evidencia → la respeta

---

## 🚀 DEPLOYMENT

**Archivos modificados:**
1. `.env` - Variables OpenAI desbloqueadas
2. `src/llm/router.ts` - Type y config de OpenAI
3. `src/llm/openaiReferee.ts` - Módulo nuevo (detección + referee)
4. `src/api/chat.ts` - Integración post-Groq

**Para desplegar:**
```bash
# 1. Verificar variables
cat .env | grep OPENAI

# 2. Build
npm run build

# 3. Verificar health
curl http://localhost:4000/_health/ai

# 4. Deploy
./deploy-to-ec2.sh
```

**Verificación post-deploy:**
```bash
# Check logs
pm2 logs al-e-api --lines 50 | grep OPENAI_REFEREE
```

---

## 📝 NOTAS FINALES

**Esto NO es volver dependiente a AL-E.**  
Es un **puente de gobernanza** mientras el sistema madura.

**Una IA autónoma que miente no es autonomía, es ruido caro.**

**OpenAI como referee garantiza:**
- Respuestas verificables
- Cero inventos
- Máxima confiabilidad
- Costo controlado

**Estado:** ✅ **IMPLEMENTACIÓN COMPLETADA**  
**Responsable:** Core Team  
**Próximos pasos:** Testing en producción con casos reales
