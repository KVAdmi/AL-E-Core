# ✅ MODE SELECTOR + ACTION GATEWAY - IMPLEMENTADO

**Fecha:** 2025-06-XX  
**Estado:** ✅ COMPLETADO - Compilado y listo para deploy  
**Prioridad:** P0 CORE (Executive VIP Quality)

---

## 🎯 OBJETIVO CUMPLIDO

Implementar arquitectura de 3 modos de respuesta para garantizar calidad VIP:
- **70-85%** queries → Respuesta directa sin tools (MODE_A)
- **10-25%** queries → Web search con fuentes citadas (MODE_B)  
- **5-10%** queries → APIs/Actions con evidence obligatorio (MODE_C)

**Problema resuelto:** ALEON estaba usando tools para todo, incluyendo preguntas generales. Para "altos ejecutivos VIP" necesitamos PRECISIÓN, no links sin datos.

---

## 📋 ARQUITECTURA IMPLEMENTADA

### 1️⃣ MODE SELECTOR (`/src/services/modeSelector.ts`)

**Clasificación antes de responder:**
```typescript
export type ResponseMode = 
  | 'KNOWLEDGE_GENERAL'        // No tools
  | 'RESEARCH_RECENT'          // Web search + sources
  | 'CRITICAL_DATA_OR_ACTION'; // APIs + evidence required

export interface ModeClassification {
  mode: ResponseMode;
  confidence: number;           // 85-95%
  reasoning: string;            // Explicación de la clasificación
  toolsRequired: string[];      // ['web_search'], ['calendar', 'email'], etc
  evidenceRequired: boolean;    // true solo para MODE_C
}
```

**Pattern Matching:**
- **KNOWLEDGE_PATTERNS**: receta, historia, explica, estrategia, qué es, cómo funciona
- **RESEARCH_PATTERNS**: últimas, hoy, noticia, tendencia, busca, 2025
- **CRITICAL_PATTERNS**: precio hoy, tipo de cambio actual, agenda, cita, envía correo

**Scoring:**
- Critical patterns: **10 puntos** (máxima prioridad)
- Research patterns: **5 puntos**
- Knowledge patterns: **3 puntos**
- Si criticalScore >= 10 → MODE_C
- Si researchScore >= 5 → MODE_B
- Default → MODE_A

---

### 2️⃣ ORCHESTRATOR INTEGRATION (`/src/ai/orchestrator.ts`)

**STEP 4.6: Mode Selection** (nuevo paso en pipeline)
```typescript
const modeClassification = selectResponseMode(lastUserMessage);
console.log mode, confidence, reasoning, tools, evidenceRequired
```

**Context Object:**
```typescript
interface OrchestratorContext {
  // ...existing fields...
  responseMode: ResponseMode;
  modeClassification: ModeClassification;
}
```

**Tool Decision Logic (actualizado):**
```typescript
private async decideAndExecuteTool(
  userMessage: string,
  intent: IntentClassification,
  userId: string,
  modeClassification: ModeClassification  // ← nuevo parámetro
): Promise<...>
```

**Lógica MODE-aware:**
- **MODE_A (KNOWLEDGE_GENERAL)**: Return early sin tools
  ```typescript
  if (modeClassification.mode === 'KNOWLEDGE_GENERAL') {
    return { toolUsed: 'none', toolReason: 'General knowledge query' };
  }
  ```

- **MODE_B (RESEARCH_RECENT)**: Force web_search
  ```typescript
  if (modeClassification.mode === 'RESEARCH_RECENT') {
    intent.tools_required = ['web_search'];
  }
  ```

- **MODE_C (CRITICAL)**: Force tools + validate evidence
  ```typescript
  if (modeClassification.mode === 'CRITICAL_DATA_OR_ACTION') {
    intent.tools_required = modeClassification.toolsRequired;
  }
  // Después de ejecutar action:
  if (modeClassification.evidenceRequired && !actionResult.evidence) {
    return { toolFailed: true, toolError: getNoEvidenceError() };
  }
  ```

---

### 3️⃣ SYSTEM PROMPT UPDATES

**Sección MODE-AWARE añadida al system prompt:**

**MODE A: KNOWLEDGE_GENERAL**
```
🧠 MODO A: CONOCIMIENTO GENERAL
- INSTRUCCIÓN: Responde usando tu conocimiento general de entrenamiento
- NO menciones búsquedas web, herramientas o acciones externas
- NO digas "busqué", "consulté", "verifiqué" - simplemente RESPONDE
- Sé natural, conversacional y directo
- Si necesitas información actual que NO tienes, admítelo honestamente
- Ejemplos: recetas, historia, estrategia, explicaciones, análisis conceptual
```

**MODE B: RESEARCH_RECENT**
```
🔍 MODO B: INVESTIGACIÓN RECIENTE
- INSTRUCCIÓN: DEBES citar las fuentes web proporcionadas abajo
- Menciona de dónde obtuviste la información (ej: "Según [fuente]...")
- Compara múltiples fuentes cuando estén disponibles
- Si la información web es insuficiente, DILO claramente
- NO inventes datos - solo reporta lo que las fuentes dicen
- Ejemplos: noticias, tendencias, precios actuales, eventos recientes
```

**MODE C: CRITICAL_DATA_OR_ACTION**
```
⚡ MODO C: DATOS CRÍTICOS O ACCIÓN
- INSTRUCCIÓN SUPREMA: SOLO confirma acciones si hay evidence.id en el resultado
- SI NO hay evidence.id → Di: "No pude completar [acción]. [Razón específica]"
- NO digas "creé", "agendé", "envié" sin evidencia comprobable
- Para datos financieros/críticos: REQUIERE precisión absoluta o admite limitación
- NO aproximes, NO inventes, NO asumas éxito sin confirmación
- Ejemplos: precios exactos, agenda, correos, operaciones financieras
- CALIDAD VIP: Ejecutivos no toleran imprecisión - mejor admitir limitación que mentir
```

---

## 🧪 CASOS DE USO

### ✅ MODE A: KNOWLEDGE_GENERAL (70-85%)
**User:** "Dame una receta de galletas de chocolate"  
**Sistema:** 
- Classification: `KNOWLEDGE_GENERAL` (95% confidence)
- Tools: `none`
- Response: Responde directamente con conocimiento del modelo, sin mencionar búsquedas

**User:** "Explícame qué es blockchain"  
**Sistema:**
- Classification: `KNOWLEDGE_GENERAL` (90% confidence)
- Tools: `none`
- Response: Explicación conceptual sin tools

---

### ✅ MODE B: RESEARCH_RECENT (10-25%)
**User:** "últimas noticias sobre inteligencia artificial"  
**Sistema:**
- Classification: `RESEARCH_RECENT` (85% confidence)
- Tools: `web_search`
- Response: "Según TechCrunch, [info]... Bloomberg reporta [info]..."

**User:** "tendencias de marketing 2025"  
**Sistema:**
- Classification: `RESEARCH_RECENT` (85% confidence)
- Tools: `web_search`
- Response: Cita fuentes específicas de los resultados

---

### ✅ MODE C: CRITICAL_DATA_OR_ACTION (5-10%)
**User:** "agenda una reunión mañana a las 3pm"  
**Sistema:**
- Classification: `CRITICAL_DATA_OR_ACTION` (95% confidence)
- Tools: `['calendar']`
- Evidence required: `true`
- Response: Solo confirma si `actionResult.evidence.id` existe

**User:** "a cuánto está el dólar hoy en Banorte"  
**Sistema:**
- Classification: `CRITICAL_DATA_OR_ACTION` (95% confidence)
- Tools: `['finance_api']` (cuando se implemente)
- Evidence required: `true`
- Response actual: "No tengo acceso a API de Banorte para datos en tiempo real. Puedo buscar en web pero la precisión puede ser limitada." (honesto)

---

## 📊 MÉTRICAS ESPERADAS

**Pre-implementación:**
- 100% queries → Intenta usar tools
- Web search fallando en contenido JavaScript (Banorte)
- LLM mintiendo sobre acciones sin evidence

**Post-implementación:**
- 70-85% queries → Respuesta directa sin tools (MODE_A)
- 10-25% queries → Web search con fuentes citadas (MODE_B)
- 5-10% queries → Actions con evidence obligatorio (MODE_C)
- 0% mentiras sobre acciones sin evidence.id

---

## 🚀 DEPLOYMENT

### Compilación
```bash
npm run build  # ✅ COMPILADO SIN ERRORES
```

### Deploy a EC2
```bash
# 1. Commit
git add src/services/modeSelector.ts src/ai/orchestrator.ts
git commit -m "feat(P0-CORE): MODE SELECTOR + evidence gating for VIP quality

- Implement 3-mode response classification (KNOWLEDGE/RESEARCH/CRITICAL)
- MODE_A (70-85%): Direct model response, no tools
- MODE_B (10-25%): Web search with cited sources
- MODE_C (5-10%): APIs/Actions with mandatory evidence
- Evidence gating: No claims without evidence.id
- System prompt updates for MODE-aware behavior
- Fixes VIP quality issue: precision over guesswork"

# 2. Push
git push origin main

# 3. Deploy en EC2
ssh ubuntu@tu-ec2
cd /home/ubuntu/AL-E-Core
git pull
npm install
npm run build
pm2 restart aleon-api
pm2 logs aleon-api --lines 100
```

---

## 🔍 MONITORING

### Logs clave
```bash
# Ver MODE classification
pm2 logs aleon-api | grep "STEP 4.6"

# Output esperado:
[ORCH] STEP 4.6: ✓ Mode: KNOWLEDGE_GENERAL, confidence: 90
[ORCH] STEP 4.6: 📊 Reasoning: Pregunta general o conceptual → responder con conocimiento del modelo sin tools
[ORCH] STEP 4.6: 🔧 Tools: [], Evidence required: false
```

### Validación MODE_A (sin tools)
```bash
# User: "receta de galletas"
# Esperado:
[ORCH] 🧠 MODE A: KNOWLEDGE_GENERAL - Using model knowledge, NO tools
[ORCH] ✓ Tool: none
```

### Validación MODE_B (web search)
```bash
# User: "últimas noticias IA"
# Esperado:
[ORCH] 🔍 MODE B: RESEARCH_RECENT - Forcing web_search
[ORCH] ✓ Tool: web_search
```

### Validación MODE_C (evidence required)
```bash
# User: "agenda reunión mañana"
# Esperado:
[ORCH] ⚡ MODE C: CRITICAL_DATA_OR_ACTION - Forcing tools + evidence required
[ORCH] Evidence: {"table":"calendar_events","id":"uuid-xxx"}
```

---

## 🎯 CALIDAD VIP GARANTIZADA

### ✅ Antes vs Después

**ANTES (problema):**
- User: "receta de galletas" → Sistema busca en web innecesariamente
- User: "dólar en Banorte" → Tavily devuelve links sin datos, LLM miente
- User: "agenda reunión" → LLM dice "agendé" sin verificar evidence

**DESPUÉS (solución):**
- User: "receta de galletas" → Respuesta directa, MODE_A, sin tools ✅
- User: "dólar en Banorte" → "No tengo API de Banorte en tiempo real" (honesto) ✅
- User: "agenda reunión" → Solo confirma si `evidence.id` existe ✅

### 🏆 Estándar Ejecutivo
- **PRECISIÓN** > Velocidad
- **HONESTIDAD** > Inventar datos
- **EVIDENCE** > Asumir éxito
- **FUENTES** > "Busqué y encontré"

---

## 📝 PRÓXIMOS PASOS

### P1: Financial APIs (ejecutivos necesitan precios exactos)
- [ ] Integrar Alpha Vantage ($50/mo) para FOREX/stocks
- [ ] Integrar Firecrawl ($20/mo) para scraping dinámico (Banorte)
- [ ] Actualizar MODE_C patterns para detectar queries financieros específicos

### P2: Fine-tuning MODE classification
- [ ] Monitor logs por 1 semana
- [ ] Ajustar patterns si hay false positives/negatives
- [ ] A/B test: current patterns vs fine-tuned

### P3: Frontend indicators
- [ ] Badge visual: "🧠 Conocimiento" / "🔍 Web" / "⚡ Acción"
- [ ] Show MODE classification en debug panel

---

## ✅ CHECKLIST COMPLETADO

- [x] Create `/src/services/modeSelector.ts` (complete)
- [x] Add `selectResponseMode()` function with pattern matching
- [x] Define 3 response modes with scoring system
- [x] Update orchestrator imports
- [x] Extend `OrchestratorContext` interface
- [x] Add STEP 4.6 to orchestration pipeline
- [x] Update `decideAndExecuteTool()` signature
- [x] Implement MODE_A logic (skip tools)
- [x] Implement MODE_B logic (force web_search)
- [x] Implement MODE_C logic (force tools + validate evidence)
- [x] Update context object creation
- [x] Update `buildSystemPrompt()` signature
- [x] Add MODE-aware instructions to system prompt
- [x] Pass `modeClassification` to all updated methods
- [x] Fix compilation errors
- [x] Compile successfully (`npm run build`)
- [x] Document implementation
- [ ] Deploy to EC2
- [ ] Monitor MODE classification accuracy

---

## 📞 CONTACTO

**Owner:** Pablo Garibay  
**Project:** ALEON - AI Executive Assistant (VIP Quality)  
**Priority:** P0 CORE  
**Status:** ✅ Ready for deployment

**Next:** Deploy to EC2 and monitor MODE classification in production logs.

