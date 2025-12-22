# 🔍 VALIDACIÓN TÉCNICA REQUERIDA EN EC2

## ⚠️ IMPORTANTE: EVIDENCIA OBLIGATORIA

**NO aceptamos "ya está desplegado" sin outputs reales de estos comandos.**

---

## 1️⃣ VERIFICAR QUÉ COMMIT ESTÁ CORRIENDO

```bash
cd /home/ubuntu/AL-E-Core
git rev-parse --short HEAD
git log -1 --oneline
```

**Output esperado:** Debe mostrar el commit más reciente con los cambios de guardado en Supabase.

**Ejemplo:**
```
abc1234
abc1234 feat: guardado garantizado en Supabase + endpoints sessions + CORS
```

---

## 2️⃣ VERIFICAR CONFIGURACIÓN REAL DE PM2

```bash
pm2 describe al-e-core | egrep -i "script|cwd|env|ALE_ALLOWED_ORIGINS" -A 2
```

**Debe mostrar:**
- `cwd`: Directorio donde está corriendo (debe ser `/home/ubuntu/AL-E-Core` o similar)
- `script`: Archivo que está ejecutando (debe ser `dist/index.js` o `npm start`)
- Variables de entorno cargadas

---

## 3️⃣ VERIFICAR VARIABLES DE ENTORNO EN EL PROCESO

```bash
pm2 env al-e-core | egrep -i "ALE_ALLOWED_ORIGINS|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY"
```

**Output esperado:**
```
ALE_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3003,...
SUPABASE_URL=https://gptwzuqmuvzttajgjrry.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
```

**CRÍTICO:** `ALE_ALLOWED_ORIGINS` DEBE incluir `http://localhost:3001`

---

## 4️⃣ PROBAR CORS PREFLIGHT (LO QUE FALLA EN EL NAVEGADOR)

```bash
curl -i -X OPTIONS https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

**Output REQUERIDO (status 200 o 204):**
```
HTTP/2 200
access-control-allow-origin: http://localhost:3001
access-control-allow-methods: GET, POST, OPTIONS
access-control-allow-headers: Content-Type, Authorization
access-control-allow-credentials: true
```

**❌ Si devuelve 403 o no tiene estos headers → CORS NO ESTÁ CONFIGURADO**

---

## 5️⃣ PROBAR POST CON ORIGIN (SEGUNDO REQUEST)

```bash
curl -i -X POST https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId":"default","userId":"debug","mode":"universal","messages":[{"role":"user","content":"ping"}]}'
```

**Output REQUERIDO:**
```
HTTP/2 200
access-control-allow-origin: http://localhost:3001
access-control-allow-credentials: true
content-type: application/json

{"answer":"...","session_id":"uuid-aqui","memories_to_add":[]}
```

**❌ Si no tiene `access-control-allow-origin` o devuelve error → CORS ROTO**

---

## 6️⃣ VERIFICAR LOGS DEL BACKEND

```bash
pm2 logs al-e-core --lines 50 | tail -20
```

**Debe mostrar:**
```
[CORS] Orígenes permitidos: [ 'http://localhost:3000', 'http://localhost:3001', ... ]
[DEBUG] chatRouter (v2) montado en /api/ai
[DEBUG] sessionsRouter montado en /api/sessions
AL-E Core listening on port 4000
```

**Si NO muestra esto → el código viejo sigue corriendo.**

---

## 🚀 PROCEDIMIENTO DE DEPLOY CORRECTO

### Paso 1: Identificar directorio correcto

```bash
pm2 describe al-e-core | grep "cwd"
```

**Copiar la ruta exacta que aparezca.**

### Paso 2: Ir a ese directorio

```bash
cd /ruta/exacta/del/cwd
# Ejemplo: cd /home/ubuntu/AL-E-Core
```

### Paso 3: Verificar que estás en el repo correcto

```bash
git remote -v
```

**Debe mostrar:** `origin  https://github.com/KVAdmi/AL-E-Core.git`

### Paso 4: Pull de cambios

```bash
git pull origin main
```

### Paso 5: Verificar que .env tenga las variables

```bash
cat .env | egrep "SUPABASE_SERVICE_ROLE_KEY|ALE_ALLOWED_ORIGINS"
```

**Si falta `SUPABASE_SERVICE_ROLE_KEY` o `localhost:3001` en `ALE_ALLOWED_ORIGINS`:**

```bash
nano .env
# Agregar/corregir:
# SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
# ALE_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,...
# Guardar: Ctrl+O, Enter, Ctrl+X
```

### Paso 6: Instalar dependencias (usa npm ci, no npm install)

```bash
npm ci
```

**`npm ci` es más confiable que `npm install` en producción.**

### Paso 7: Compilar TypeScript

```bash
npm run build
```

**Verificar que no haya errores.**

### Paso 8: Verificar archivos compilados

```bash
ls -la dist/api/chat.js
ls -la dist/api/sessions.js
ls -la dist/utils/helpers.js
```

**Todos deben existir y tener fecha/hora reciente.**

### Paso 9: Reiniciar PM2

```bash
pm2 restart al-e-core
```

### Paso 10: Ver logs en tiempo real

```bash
pm2 logs al-e-core --lines 50
```

**Buscar:**
```
[CORS] Orígenes permitidos: [ ... 'http://localhost:3001' ... ]
[DEBUG] chatRouter (v2) montado en /api/ai
```

---

## ✅ CRITERIOS DE ÉXITO

Después del deploy, **TODOS** estos deben pasar:

- [ ] `git log -1` muestra commit reciente con cambios
- [ ] `pm2 env` muestra `ALE_ALLOWED_ORIGINS` con `localhost:3001`
- [ ] `pm2 env` muestra `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `curl OPTIONS` devuelve 200/204 con headers CORS
- [ ] `curl POST` devuelve 200 con `access-control-allow-origin`
- [ ] `pm2 logs` muestra "chatRouter (v2) montado"
- [ ] `pm2 logs` muestra CORS con `localhost:3001` en lista

**SI ALGUNO FALLA → EL DEPLOY NO ESTÁ COMPLETO**

---

## 🐛 DIAGNÓSTICO DE PROBLEMAS COMUNES

### Problema: "git pull" pero logs no cambian

**Causa:** PM2 está corriendo desde otro directorio

**Solución:**
```bash
pm2 describe al-e-core | grep cwd
# Ir al directorio correcto mostrado
cd /ruta/correcta
git pull
npm run build
pm2 restart al-e-core
```

---

### Problema: Variables de entorno no se cargan

**Causa:** PM2 no está leyendo el .env

**Solución:**
```bash
# Opción 1: Reinicio completo
pm2 delete al-e-core
pm2 start npm --name al-e-core -- start

# Opción 2: Usar ecosystem.config.js
pm2 restart ecosystem.config.js --update-env
```

---

### Problema: CORS sigue fallando después del deploy

**Causa:** Código viejo en caché de Node o PM2

**Solución:**
```bash
# Limpiar completamente
pm2 delete al-e-core
rm -rf node_modules dist
npm ci
npm run build
pm2 start npm --name al-e-core -- start
pm2 save
```

---

### Problema: dist/ no se actualiza

**Causa:** Error en compilación que pasó desapercibido

**Solución:**
```bash
# Compilar viendo todos los errores
npm run build 2>&1 | tee build.log
cat build.log

# Si hay errores, corregir y recompilar
```

---

## 📋 CHECKLIST DE VALIDACIÓN POST-DEPLOY

Ejecutar estos comandos en orden y **pegar los outputs**:

```bash
# 1. Commit actual
cd /home/ubuntu/AL-E-Core && git log -1 --oneline

# 2. Variables de entorno
pm2 env al-e-core | egrep "ALE_ALLOWED_ORIGINS|SUPABASE_SERVICE_ROLE_KEY"

# 3. Test CORS preflight
curl -i -X OPTIONS https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" 2>&1 | head -20

# 4. Test POST con Origin
curl -i -X POST https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","messages":[{"role":"user","content":"test"}]}' 2>&1 | head -20

# 5. Logs recientes
pm2 logs al-e-core --lines 20 --nostream
```

---

## ⚠️ IMPORTANTE PARA AL-EON (FRONTEND)

### ❌ NO HACER ESTO:

- **NO usar proxy local** como solución final para CORS
- **NO cambiar la URL del backend** a un proxy intermedio
- **NO hardcodear `localhost` en producción**

### ✅ SOLUCIÓN CORRECTA:

El CORS se configura en **AL-E CORE (backend)**, no en AL-EON.

**Frontend debe:**
1. Usar `VITE_ALE_CORE_URL=https://api.al-entity.com`
2. Hacer fetch directo a esa URL
3. Confiar en que el backend maneje CORS correctamente

**Un proxy local es útil SOLO para desarrollo rápido, pero la solución real es el allowlist en el backend.**

---

## 📞 SOPORTE

Si después de seguir estos pasos algo falla:

1. Pegar los outputs de los comandos de validación
2. Pegar los logs completos: `pm2 logs al-e-core --lines 100`
3. Pegar el error exacto del navegador (DevTools → Console)
4. Pegar el Network tab del navegador mostrando el preflight OPTIONS

**Con esa información podemos diagnosticar exactamente qué está mal.**

---

**NO ACEPTAR "ya está" SIN ESTOS OUTPUTS. LA EVIDENCIA ES OBLIGATORIA.**
