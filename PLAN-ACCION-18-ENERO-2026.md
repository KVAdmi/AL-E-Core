# 🚀 PLAN DE ACCIÓN - REPARACIÓN AL-E CORE

**Fecha:** 18 de enero de 2026  
**Estado:** PRODUCCIÓN ROTA - P0  
**Documento base:** `DIAGNOSTICO-CRITICO-18-ENERO-2026.md`

---

## 📋 CHECKLIST DE EJECUCIÓN

### FASE 1: OBTENER EVIDENCIA (15 min)

- [ ] **1.1. Ejecutar script de validación**
  ```bash
  cd "/Users/pg/Documents/AL-E Core"
  bash validar-produccion.sh
  ```

- [ ] **1.2. Revisar commit local vs producción**
  ```bash
  git log -1 --format='%H %ai %s'
  # Comparar con el output de validar-produccion.sh sección 1
  ```

- [ ] **1.3. Verificar qué endpoint atiende requests**
  - Buscar en logs: `[TRUTH CHAT]` → truthChat.ts está activo ✅
  - Buscar en logs: `[CHAT]` → chat.ts está activo ❌ (no debería)
  - Buscar en logs: `[SIMPLE ORCH]` → simpleOrchestrator está activo ✅

- [ ] **1.4. Confirmar PM2 status**
  - Status debe ser: `online`
  - Restarts debe ser: bajo (< 10)
  - Uptime debe ser: > 1 hora

**RESULTADO ESPERADO:** Commit hash, endpoint activo, estado del proceso

---

### FASE 2: VALIDAR CONFIGURACIÓN (15 min)

- [ ] **2.1. Verificar variables de entorno en EC2**
  ```bash
  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233
  cd AL-E-Core
  cat .env | grep -E 'GROQ_API_KEY|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|OPENAI_ROLE'
  ```

  **Esperado:**
  - `GROQ_API_KEY=gsk_...` ✅
  - `SUPABASE_URL=https://ewfzjhpqxnzfghyqoqnw.supabase.co` ✅
  - `SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...` ✅
  - `OPENAI_ROLE=referee` ✅

- [ ] **2.2. Validar tablas en Supabase**
  - Ir a: https://supabase.com/dashboard/project/ewfzjhpqxnzfghyqoqnw
  - Table Editor → verificar existen:
    - `assistant_memories` ✅
    - `user_profiles` ✅
    - `user_memories` ✅
    - `ae_sessions` ✅
    - `ae_messages` ✅

- [ ] **2.3. Validar buckets en Supabase Storage**
  - Storage → verificar existen:
    - `meetings-audio` ✅
    - Bucket para attachments (verificar cuál nombre)

**RESULTADO ESPERADO:** Todas las variables y tablas configuradas correctamente

---

### FASE 3: TEST CANÓNICO CON LOGS (30 min)

- [ ] **3.1. Preparar terminal con logs en tiempo real**
  ```bash
  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233
  pm2 logs al-e-core --lines 0
  # Dejar esta terminal abierta monitoreando
  ```

- [ ] **3.2. TEST 1: Hora/fecha (sin web_search)**
  
  **Request:**
  ```bash
  curl -X POST https://api.al-eon.com/api/ai/chat \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "TEST-UUID-12345",
      "messages": [{"role": "user", "content": "¿Qué hora es en México?"}]
    }'
  ```

  **Verificar en logs:**
  - [ ] `[TRUTH CHAT] P0: Responding with server time (MX) - no tools` ✅
  - [ ] NO aparece `web_search` ✅
  - [ ] Response incluye hora de México ✅

- [ ] **3.3. TEST 2: Memoria (userId válido)**
  
  **Setup:** Obtener un userId REAL de la tabla `user_profiles`
  ```sql
  SELECT user_id, preferred_name FROM user_profiles LIMIT 1;
  ```

  **Request 1:**
  ```bash
  curl -X POST https://api.al-eon.com/api/ai/chat \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "[UUID-REAL]",
      "messages": [{"role": "user", "content": "Me llamo Patto"}]
    }'
  ```

  **Verificar en logs:**
  - [ ] `[SIMPLE ORCH] 🧠 Cargando memoria del usuario...` ✅
  - [ ] `[SIMPLE ORCH] 🧠 Memorias cargadas: X` ✅
  - [ ] `[SIMPLE ORCH] 💾 Guardando memoria...` ✅

  **Request 2 (después de 5 segundos):**
  ```bash
  curl -X POST https://api.al-eon.com/api/ai/chat \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "[UUID-REAL]",
      "messages": [{"role": "user", "content": "¿Cómo me llamo?"}]
    }'
  ```

  **Verificar:**
  - [ ] Response incluye "Patto" ✅
  - [ ] Logs muestran memoria cargada con el nombre ✅

- [ ] **3.4. TEST 3: Attachments**
  
  **Request con attachment de Supabase Storage:**
  ```bash
  curl -X POST https://api.al-eon.com/api/ai/chat \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "[UUID-REAL]",
      "messages": [{"role": "user", "content": "Resume este documento"}],
      "attachments": [{
        "bucket": "meetings-audio",
        "path": "meetings/test/test.pdf",
        "name": "test.pdf",
        "type": "application/pdf"
      }]
    }'
  ```

  **Verificar en logs:**
  - [ ] `[TRUTH CHAT] P0: Attachments received, forcing analyze_document` ✅
  - [ ] `[TOOL] analyze_document executed` ✅
  - [ ] Response NO dice "no veo tu documento" ✅

- [ ] **3.5. TEST 4: Web search**
  
  **Request:**
  ```bash
  curl -X POST https://api.al-eon.com/api/ai/chat \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "[UUID-REAL]",
      "messages": [{"role": "user", "content": "¿A qué se dedica Tesla?"}]
    }'
  ```

  **Verificar en logs:**
  - [ ] `[TOOL] web_search executed` ✅
  - [ ] Response incluye info actualizada de Tesla ✅
  - [ ] NO inventa info sin evidencia ✅

- [ ] **3.6. TEST 5: Email tools**
  
  **Request:**
  ```bash
  curl -X POST https://api.al-eon.com/api/ai/chat \
    -H "Content-Type: application/json" \
    -d '{
      "userId": "[UUID-REAL]",
      "messages": [{"role": "user", "content": "Revisa mis correos"}]
    }'
  ```

  **Verificar en logs:**
  - [ ] `[TOOL] list_emails executed` ✅
  - [ ] Response lista correos reales (si hay) ✅
  - [ ] NO dice "revisé correos" si el tool falló ✅

**RESULTADO ESPERADO:** Todos los tests pasan con evidencia en logs

---

### FASE 4: DIAGNOSTICAR PROBLEMAS ENCONTRADOS

**SI TODOS LOS TESTS PASAN:**
→ El problema NO está en backend, está en **frontend** (revisar qué endpoint llama)

**SI MEMORIA NO FUNCIONA:**
- [ ] Verificar userId es UUID válido (no `guest`, no string random)
- [ ] Verificar tabla `assistant_memories` existe y tiene registros
- [ ] Verificar permisos de Supabase (service role key tiene acceso)

**SI TOOLS NO EJECUTAN:**
- [ ] Verificar `GROQ_API_KEY` configurada
- [ ] Verificar logs de errores en tool execution
- [ ] Verificar que Groq no esté rate-limited

**SI ATTACHMENTS NO FUNCIONAN:**
- [ ] Verificar bucket existe en Supabase Storage
- [ ] Verificar signed URL se genera correctamente
- [ ] Verificar `analyze_document` tool no falla

**SI WEB_SEARCH NO FUNCIONA:**
- [ ] Verificar `TAVILY_API_KEY` configurada
- [ ] Verificar Tavily no esté rate-limited
- [ ] Verificar logs de web_search tool

---

### FASE 5: APLICAR FIXES

#### FIX A: Código desactualizado en EC2

```bash
# En EC2
cd AL-E-Core
git pull origin main
npm install
npm run build
pm2 restart al-e-core
pm2 logs al-e-core --lines 50
```

#### FIX B: Variables de entorno faltantes

```bash
# En EC2
cd AL-E-Core
nano .env
# Agregar/corregir variables faltantes
pm2 restart al-e-core
```

#### FIX C: Tablas de Supabase faltantes

```bash
# Ejecutar migraciones en Supabase Dashboard SQL Editor
# O desde local:
cd "/Users/pg/Documents/AL-E Core"
# Subir migrations a Supabase
```

#### FIX D: Frontend llamando endpoint incorrecto

**Revisar en frontend AL-EON:**
```bash
# Buscar en código frontend qué endpoint llama
grep -r "api/ai/chat" ~/Documents/al-eon/src/
```

**Esperado:**
- Frontend debe llamar a: `https://api.al-eon.com/api/ai/chat` ✅
- NO debe llamar a: `/api/ai/chat/v2` o `/api/ai/legacy/chat` ❌

---

### FASE 6: VALIDACIÓN FINAL (15 min)

- [ ] **6.1. Re-ejecutar todos los tests canónicos**
  - TEST 1: Hora/fecha ✅
  - TEST 2: Memoria ✅
  - TEST 3: Attachments ✅
  - TEST 4: Web search ✅
  - TEST 5: Email tools ✅

- [ ] **6.2. Test desde frontend real**
  - Abrir https://al-eon.com
  - Login con usuario real
  - Probar:
    - [ ] "¿Qué hora es?" ✅
    - [ ] "Me llamo [nombre]" → refresh → "¿Cómo me llamo?" ✅
    - [ ] Adjuntar PDF → "Resume esto" ✅
    - [ ] "¿A qué se dedica [empresa]?" ✅
    - [ ] "Revisa mis correos" ✅

- [ ] **6.3. Generar reporte final**
  ```bash
  cd "/Users/pg/Documents/AL-E Core"
  # Crear documento: VALIDACION-FINAL-18-ENERO-2026.md
  # Con: tests ejecutados, resultados, commit hash final
  ```

**RESULTADO ESPERADO:** Todos los tests pasan en producción desde frontend real

---

## 📝 TEMPLATE DE REPORTE

```markdown
# REPORTE DE VALIDACIÓN - [FECHA]

## COMMIT DEPLOYADO
Hash: [hash]
Fecha: [fecha]
Mensaje: [mensaje]

## PM2 STATUS
- Status: online/error
- Uptime: [tiempo]
- Restarts: [número]

## TESTS EJECUTADOS

### Test 1: Hora/fecha
- Status: ✅/❌
- Logs: [extracto]
- Response: [extracto]

### Test 2: Memoria
- Status: ✅/❌
- Logs: [extracto]
- Response: [extracto]

[... más tests ...]

## PROBLEMAS ENCONTRADOS
1. [Problema 1]
2. [Problema 2]

## FIXES APLICADOS
1. [Fix 1]
2. [Fix 2]

## CONCLUSIÓN
[Estado final: FUNCIONANDO / PARCIALMENTE FUNCIONAL / ROTO]
```

---

## 🔄 FLUJO DE ESCALACIÓN

**Si después de FASE 5 sigue sin funcionar:**

1. **Escalar a revisión completa de arquitectura**
   - Considerar migrar a `chat.ts` con Orchestrator completo
   - Agregar RAG a simpleOrchestrator
   - Implementar logging más robusto

2. **Escalar a revisión de frontend**
   - Verificar que frontend envía userId correcto (UUID)
   - Verificar que frontend envía attachments en formato correcto
   - Verificar que frontend maneja responses correctamente

3. **Escalar a revisión de infraestructura**
   - Verificar EC2 tiene recursos suficientes (RAM, CPU)
   - Verificar Supabase no está rate-limited
   - Verificar Groq no está bloqueado

---

**FIN DEL PLAN DE ACCIÓN**

**Documento creado por:** GitHub Copilot  
**Para:** Patricia (Usuario AL-E Core)  
**Fecha:** 18 de enero de 2026
