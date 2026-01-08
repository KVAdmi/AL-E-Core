# RUNBOOK DE PRODUCCIÓN - KUNNA Integration Deploy

**Fecha**: 2026-01-07  
**Objetivo**: Deploy completo de KUNNA integration en AL-E Core (EC2 + PM2)  
**Duración estimada**: 15-20 minutos

---

## 📋 PRE-REQUISITOS

Antes de comenzar, tener listo:

1. **Acceso SSH a EC2**: `ssh ubuntu@<EC2_IP>`
2. **Tokens generados**: `SERVICE_TOKEN_KUNNA` (mínimo 32 caracteres)
3. **Supabase SQL Editor abierto**: https://supabase.com/dashboard/project/<PROJECT_ID>/sql
4. **Terminal local con repo clonado**: AL-E Core

---

## 🚀 PASO 1: GENERAR TOKEN DE PRODUCCIÓN

```bash
# En tu máquina local, generar token seguro:
openssl rand -hex 32

# Copiar output, será tu SERVICE_TOKEN_KUNNA
# Ejemplo output: a3f9c8e7d1b2... (64 caracteres)
```

**Guardar este token en un lugar seguro** (1Password, Bitwarden, etc.)

---

## 🗄️ PASO 2: APLICAR MIGRATION 025 EN SUPABASE

### 2.1 Abrir Supabase SQL Editor

1. Ir a: https://supabase.com/dashboard/project/<PROJECT_ID>/sql
2. Click en "New query"

### 2.2 Copiar SQL de migración

```bash
# En tu máquina local:
cat migrations/025_kunna_events_decisions.sql
```

### 2.3 Pegar en Supabase SQL Editor

- Copiar TODO el contenido del archivo
- Pegar en SQL Editor
- Verificar que se vea:
  - `CREATE TABLE IF NOT EXISTS ae_events`
  - `CREATE TABLE IF NOT EXISTS ae_decisions`
  - Índices y comentarios

### 2.4 Ejecutar migración

- Click en botón "Run" (o `Cmd+Enter` / `Ctrl+Enter`)
- Esperar mensaje: "Success. No rows returned"

### 2.5 Verificar tablas creadas

```sql
-- En Supabase SQL Editor, ejecutar:
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('ae_events', 'ae_decisions');
```

**Resultado esperado:**
```
table_name
----------
ae_events
ae_decisions
```

✅ **CHECKPOINT**: Tablas `ae_events` y `ae_decisions` existen.

---

## 🖥️ PASO 3: CONFIGURAR EC2

### 3.1 SSH a EC2

```bash
ssh ubuntu@<EC2_IP>
```

### 3.2 Navegar al proyecto

```bash
cd /home/ubuntu/AL-E\ Core

# O si el path es diferente, buscar:
pm2 list
# Ver el "cwd" de al-e-core
```

### 3.3 Backup del .env actual

```bash
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
```

### 3.4 Editar .env

```bash
nano .env
```

**Agregar al final del archivo:**

```bash
# ============================================
# CORS Configuration
# ============================================
ALE_ALLOWED_ORIGINS=https://al-eon.com,https://kunna.help,http://localhost:3000

# ============================================
# MULTI-APP SERVICE TOKENS
# ============================================
SERVICE_TOKEN_KUNNA=<PEGAR_TOKEN_GENERADO_EN_PASO_1>
SERVICE_TOKEN_ALEON=<GENERAR_OTRO_TOKEN_SI_ES_NECESARIO>
```

**Guardar y salir:**
- `Ctrl+O` (guardar)
- `Enter` (confirmar)
- `Ctrl+X` (salir)

### 3.5 Verificar .env

```bash
# Verificar que las variables estén presentes:
grep "SERVICE_TOKEN_KUNNA" .env
grep "ALE_ALLOWED_ORIGINS" .env

# NO debe mostrar "kunna_secret_token_here", debe mostrar tu token real
```

✅ **CHECKPOINT**: Variables de entorno configuradas.

---

## 📦 PASO 4: DEPLOY DEL CÓDIGO

### 4.1 Pull cambios desde GitHub

```bash
git status
# Debe mostrar: "Your branch is up to date with 'origin/main'"

git pull origin main
```

**Resultado esperado:**
```
remote: Enumerating objects...
Unpacking objects: 100%...
From github.com:KVAdmi/AL-E-Core
 * branch            main       -> FETCH_HEAD
Updating cdc6293..XXXXXX
```

### 4.2 Instalar dependencias (si hay nuevas)

```bash
npm ci
```

### 4.3 Build TypeScript

```bash
npm run build
```

**Resultado esperado:**
```
> al-e-core@1.0.0 build
> tsc

# Sin errores
```

Si hay errores de compilación, **DETENER** y reportar.

✅ **CHECKPOINT**: Build exitoso sin errores TypeScript.

---

## 🔄 PASO 5: RESTART PM2

### 5.1 Restart del proceso

```bash
pm2 restart al-e-core
```

**Resultado esperado:**
```
[PM2] Applying action restartProcessId on app [al-e-core](ids: [ 0 ])
[PM2] [al-e-core](0) ✓
```

### 5.2 Verificar status

```bash
pm2 status
```

**Resultado esperado:**
```
┌─────┬───────────────┬─────────┬─────────┬─────────┬──────────┐
│ id  │ name          │ status  │ restart │ uptime  │ cpu      │
├─────┼───────────────┼─────────┼─────────┼─────────┼──────────┤
│ 0   │ al-e-core     │ online  │ X       │ Xs      │ 0%       │
└─────┴───────────────┴─────────┴─────────┴─────────┴──────────┘
```

**Status debe ser `online`.**

### 5.3 Revisar logs de startup

```bash
pm2 logs al-e-core --lines 50
```

**Buscar en logs:**

✅ `[AL-E CORE] Servidor iniciado en puerto 4000`  
✅ `[DEBUG] eventsRouter (KUNNA multi-app) montado en /api/events`  
✅ `[DEBUG] decideRouter (KUNNA rule engine) montado en /api/decide`  
✅ `[CORS] Orígenes permitidos: [ 'https://al-eon.com', 'https://kunna.help', ... ]`

**Si hay errores:**

```bash
# Ver logs completos:
pm2 logs al-e-core --err --lines 200

# Si dice "MODULE_NOT_FOUND":
npm ci
pm2 restart al-e-core

# Si dice "PORT already in use":
pm2 stop al-e-core
pm2 start al-e-core

# Si dice "Cannot find module":
npm run build
pm2 restart al-e-core
```

✅ **CHECKPOINT**: PM2 online, logs muestran routers KUNNA cargados.

---

## ✅ PASO 6: VERIFICACIÓN BÁSICA

### 6.1 Health Check

```bash
curl http://localhost:4000/health
```

**Resultado esperado:**
```json
{
  "status": "ok",
  "service": "al-e-core",
  "timestamp": "2026-01-07T...",
  "uptime": 123.456
}
```

### 6.2 Test POST /api/events (sin auth - debe fallar)

```bash
curl -X POST http://localhost:4000/api/events \
  -H "Content-Type: application/json" \
  -d '{"user_id":"test","event_type":"checkin_manual","timestamp":"2026-01-07T12:00:00Z"}'
```

**Resultado esperado (400 o 401):**
```json
{
  "error": "Missing X-App-Id header"
}
```

✅ Esto es correcto, confirma que el auth middleware funciona.

### 6.3 Test POST /api/events (con auth válido)

```bash
# Reemplazar <TU_TOKEN> con el SERVICE_TOKEN_KUNNA real
curl -X POST http://localhost:4000/api/events \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: 00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer <TU_TOKEN>" \
  -d '{
    "user_id": "11111111-1111-1111-1111-111111111111",
    "event_type": "checkin_manual",
    "timestamp": "2026-01-07T12:00:00Z",
    "metadata": {"source": "deploy_test"}
  }'
```

**Resultado esperado (201):**
```json
{
  "success": true,
  "event_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "app_id": "kunna",
  "workspace_id": "00000000-0000-0000-0000-000000000001"
}
```

✅ **CHECKPOINT**: Endpoint POST /api/events funciona.

### 6.4 Test POST /api/decide

```bash
curl -X POST http://localhost:4000/api/decide \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: 00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer <TU_TOKEN>" \
  -d '{
    "user_id": "11111111-1111-1111-1111-111111111111",
    "context": {
      "current_risk_level": "normal",
      "inactivity_minutes": 30
    }
  }'
```

**Resultado esperado (200):**
```json
{
  "success": true,
  "actions": [],
  "decision_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "workspace_id": "00000000-0000-0000-0000-000000000001",
  "app_id": "kunna"
}
```

✅ **CHECKPOINT**: Endpoint POST /api/decide funciona.

---

## 🧪 PASO 7: SMOKE TESTS AUTOMATIZADOS (Opcional pero recomendado)

### 7.1 Copiar script a EC2

```bash
# En tu máquina local:
scp scripts/kunna-smoke-tests.sh ubuntu@<EC2_IP>:/home/ubuntu/
```

### 7.2 Ejecutar smoke tests en EC2

```bash
# En EC2:
cd /home/ubuntu
chmod +x kunna-smoke-tests.sh

export CORE_URL=http://localhost:4000
export SERVICE_TOKEN_KUNNA=<TU_TOKEN>
export TEST_WORKSPACE_ID=00000000-0000-0000-0000-000000000001
export TEST_USER_ID=11111111-1111-1111-1111-111111111111

./kunna-smoke-tests.sh
```

**Resultado esperado:**
```
======================================
KUNNA SMOKE TESTS - AL-E Core
======================================

[TEST 1] Health Check...
✓ PASS - Health check OK

[TEST 2] POST /api/events (checkin_manual)...
✓ PASS - Event created successfully

[TEST 3] POST /api/decide (normal context)...
✓ PASS - Decision endpoint OK

...

======================================
RESUMEN DE TESTS
======================================
PASSED: 6
FAILED: 0

✓ TODOS LOS TESTS PASARON
```

✅ **CHECKPOINT**: Smoke tests pasaron.

---

## 🌐 PASO 8: VERIFICACIÓN DESDE INTERNET (CORS)

### 8.1 Test desde kunna.help (frontend)

**En el frontend de KUNNA (Netlify), ejecutar:**

```javascript
// En browser console de https://kunna.help
fetch('https://<TU_CORE_URL>/api/events', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-App-Id': 'kunna',
    'X-Workspace-Id': '00000000-0000-0000-0000-000000000001',
    'Authorization': 'Bearer <TOKEN>'
  },
  body: JSON.stringify({
    user_id: '11111111-1111-1111-1111-111111111111',
    event_type: 'checkin_manual',
    timestamp: new Date().toISOString(),
    metadata: { source: 'frontend_test' }
  })
})
.then(r => r.json())
.then(console.log)
.catch(console.error)
```

**Resultado esperado:**
```json
{
  "success": true,
  "event_id": "...",
  "app_id": "kunna",
  "workspace_id": "..."
}
```

**Si falla con CORS error:**

```bash
# En EC2, verificar .env:
grep ALE_ALLOWED_ORIGINS .env

# Debe incluir: https://kunna.help

# Si no está, agregar y restart:
nano .env
pm2 restart al-e-core
```

✅ **CHECKPOINT**: CORS funciona desde kunna.help.

---

## 📊 PASO 9: VERIFICAR BASE DE DATOS

### 9.1 Ir a Supabase Table Editor

https://supabase.com/dashboard/project/<PROJECT_ID>/editor

### 9.2 Verificar tabla `ae_events`

- Debe tener registros de los tests
- Columnas: `id`, `workspace_id`, `app_id`, `user_id`, `event_type`, `timestamp`, `metadata`, `created_at`

### 9.3 Verificar tabla `ae_decisions`

- Debe tener registros de las decisiones
- Columnas: `id`, `workspace_id`, `app_id`, `user_id`, `event_id`, `actions`, `created_at`

✅ **CHECKPOINT**: Datos guardándose correctamente en DB.

---

## 🎯 CHECKLIST FINAL

Marcar cada item antes de cerrar deploy:

- [ ] Migration 025 aplicada en Supabase
- [ ] Tablas `ae_events` y `ae_decisions` creadas
- [ ] Variables `SERVICE_TOKEN_KUNNA` y `ALE_ALLOWED_ORIGINS` en .env de EC2
- [ ] Git pull ejecutado en EC2
- [ ] npm ci y npm run build sin errores
- [ ] PM2 status = `online`
- [ ] Logs muestran routers KUNNA cargados
- [ ] Health check responde 200
- [ ] POST /api/events responde 201 con token válido
- [ ] POST /api/decide responde 200 con token válido
- [ ] Smoke tests pasaron (opcional pero recomendado)
- [ ] CORS funciona desde kunna.help
- [ ] Datos aparecen en Supabase Table Editor

---

## 🚨 TROUBLESHOOTING

### Error: "Cannot find module"

```bash
cd /home/ubuntu/AL-E\ Core
rm -rf node_modules
npm ci
npm run build
pm2 restart al-e-core
```

### Error: "Missing X-App-Id header"

**Causa**: Frontend no está enviando headers correctos.

**Solución**:
- Verificar en frontend que se envíen: `X-App-Id`, `X-Workspace-Id`, `Authorization`
- Verificar en Core logs: `[CORS] Origin BLOQUEADO` → agregar origin a `ALE_ALLOWED_ORIGINS`

### Error: "Unauthorized" (401)

**Causa**: Token incorrecto o no coincide.

**Verificar**:
```bash
# En EC2:
grep SERVICE_TOKEN_KUNNA .env

# Debe coincidir con el token que usa el frontend
```

### Error: "Invalid event_type" (400)

**Causa**: Tipo de evento no está en lista permitida.

**Lista válida**:
- `checkin_manual`, `checkin_auto`, `checkin_failed`
- `location_update`, `route_started`, `route_completed`
- `anomaly_detected`, `risk_level_changed`
- `sos_manual`, `sos_auto`, `safe_confirmation`

### Error: CORS "blocked by CORS policy"

**Verificar**:
```bash
# En EC2:
pm2 logs al-e-core | grep CORS

# Debe mostrar:
# [CORS] Orígenes permitidos: [ ..., 'https://kunna.help', ... ]
```

**Si no aparece kunna.help**:
```bash
nano .env
# Agregar a ALE_ALLOWED_ORIGINS: https://kunna.help
pm2 restart al-e-core
```

### Error: "relation ae_events does not exist"

**Causa**: Migration 025 no aplicada.

**Solución**: Volver a Paso 2 y ejecutar migration completa en Supabase.

---

## 📞 CONTACTO DE EMERGENCIA

Si algo falla y no puedes resolverlo:

1. **NO borrar nada** en producción
2. **Hacer rollback**: `git checkout <commit_anterior>` y `pm2 restart`
3. **Capturar logs**: `pm2 logs al-e-core --lines 500 > debug.log`
4. **Contactar**: Backend team

---

## ✅ DEPLOY COMPLETADO

Si llegaste aquí y todos los checkpoints pasaron:

🎉 **KUNNA Integration está en PRODUCCIÓN**

- AL-E Core recibe eventos de KUNNA
- Rule engine determinístico funcionando
- CORS configurado para kunna.help
- Base de datos guardando eventos y decisiones

**Siguiente paso**: Integrar en frontend de KUNNA.

---

**Duración real**: _____ minutos  
**Deployed by**: _________  
**Fecha**: 2026-01-07  
**Commit**: `cdc6293` (o más reciente)
