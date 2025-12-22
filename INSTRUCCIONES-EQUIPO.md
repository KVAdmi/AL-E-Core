# 📋 INSTRUCCIONES PARA EL EQUIPO DE INFRAESTRUCTURA

## 🎯 OBJETIVO

Desplegar código actualizado de AL-E Core en EC2 que incluye:
- Guardado garantizado en Supabase
- CORS configurado para `localhost:3001`
- Nuevos endpoints de sesiones

---

## ⚡ COMANDO RÁPIDO (Solo si están seguros del setup)

```bash
# SSH a EC2
ssh ubuntu@tu-ec2

# Ejecutar script de validación
curl -sS https://raw.githubusercontent.com/KVAdmi/AL-E-Core/main/validate-ec2.sh | bash

# O si ya tienen el código:
cd /home/ubuntu/AL-E-Core
./validate-ec2.sh
```

**Si el script pasa → Ya está desplegado correctamente ✅**

**Si el script falla → Seguir procedimiento manual abajo ⬇️**

---

## 🔧 PROCEDIMIENTO MANUAL COMPLETO

### 1. Conectar a EC2

```bash
ssh ubuntu@tu-ec2-ip
```

### 2. Identificar directorio correcto de PM2

```bash
pm2 describe al-e-core | grep cwd
```

**Copiar la ruta que aparezca** (ejemplo: `/home/ubuntu/AL-E-Core`)

### 3. Ir al directorio

```bash
cd /ruta/del/cwd  # Usar la ruta del paso anterior
```

### 4. Backup del .env

```bash
cp .env .env.backup-$(date +%Y%m%d-%H%M%S)
```

### 5. Pull de cambios

```bash
git pull origin main
```

### 6. Verificar/Editar .env

```bash
cat .env | grep -E "SUPABASE_SERVICE_ROLE_KEY|ALE_ALLOWED_ORIGINS"
```

**Debe tener:**
```bash
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
ALE_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3003,...
```

**Si falta algo:**
```bash
nano .env
# Agregar/corregir las variables
# Guardar: Ctrl+O, Enter, Ctrl+X
```

### 7. Instalar y compilar

```bash
npm ci
npm run build
```

**Verificar que no haya errores.**

### 8. Reiniciar PM2

```bash
pm2 restart al-e-core
```

### 9. Verificar logs

```bash
pm2 logs al-e-core --lines 50
```

**Debe mostrar:**
```
[CORS] Orígenes permitidos: [ ... 'http://localhost:3001' ... ]
[DEBUG] chatRouter (v2) montado en /api/ai
AL-E Core listening on port 4000
```

---

## ✅ PRUEBAS DE VALIDACIÓN OBLIGATORIAS

### Test 1: Health check

```bash
curl https://api.al-entity.com/health
```

**Debe responder:** `{"status":"ok",...}`

### Test 2: CORS Preflight

```bash
curl -i -X OPTIONS https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

**Debe incluir en headers:**
```
access-control-allow-origin: http://localhost:3001
access-control-allow-methods: GET, POST, OPTIONS
```

### Test 3: POST con Origin

```bash
curl -i -X POST https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","messages":[{"role":"user","content":"test"}]}'
```

**Debe incluir:**
```
access-control-allow-origin: http://localhost:3001
```

**Y devolver JSON:**
```json
{"answer":"...","session_id":"...","memories_to_add":[]}
```

---

## 📸 EVIDENCIA REQUERIDA

**Pegar outputs de estos comandos:**

```bash
# 1. Commit deployado
git log -1 --oneline

# 2. Variables en PM2
pm2 env al-e-core | egrep "ALE_ALLOWED_ORIGINS|SUPABASE_SERVICE_ROLE_KEY"

# 3. Test CORS (primeras 15 líneas)
curl -i -X OPTIONS https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | head -15

# 4. Test POST (primeras 20 líneas)
curl -i -X POST https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test","messages":[{"role":"user","content":"test"}]}' | head -20

# 5. Logs recientes
pm2 logs al-e-core --lines 20 --nostream
```

---

## 🚨 TROUBLESHOOTING

### Problema: git pull falla con "uncommitted changes"

```bash
git stash
git pull origin main
git stash pop
# O si no importan los cambios locales:
git reset --hard HEAD
git pull origin main
```

### Problema: Variables no se cargan en PM2

```bash
pm2 delete al-e-core
pm2 start npm --name al-e-core -- start
pm2 save
```

### Problema: CORS sigue fallando

```bash
# Limpiar completamente
pm2 delete al-e-core
rm -rf node_modules dist
npm ci
npm run build
pm2 start npm --name al-e-core -- start
pm2 save
```

### Problema: dist/ no se actualiza

```bash
rm -rf dist
npm run build
ls -la dist/api/chat.js  # Verificar fecha reciente
pm2 restart al-e-core
```

---

## 📋 CHECKLIST FINAL

- [ ] SSH a EC2 exitoso
- [ ] Directorio PM2 identificado
- [ ] git pull ejecutado sin errores
- [ ] .env tiene `SUPABASE_SERVICE_ROLE_KEY`
- [ ] .env tiene `localhost:3001` en `ALE_ALLOWED_ORIGINS`
- [ ] `npm ci` sin errores
- [ ] `npm run build` sin errores
- [ ] PM2 reiniciado
- [ ] Health check responde OK
- [ ] Test CORS preflight pasa (200 con headers)
- [ ] Test POST pasa (200 con JSON y headers)
- [ ] Logs muestran "chatRouter (v2)"
- [ ] Logs muestran CORS con localhost:3001

---

## 💡 NOTAS IMPORTANTES

1. **NO aceptar "ya está" sin evidencia**
   - Necesitamos los outputs reales de los comandos
   - No suposiciones o capturas viejas

2. **PM2 debe leer el .env actualizado**
   - Si cambias .env, debes reiniciar PM2
   - Verificar con `pm2 env al-e-core`

3. **dist/ debe recompilarse**
   - Si cambiaste código TypeScript, debes ejecutar `npm run build`
   - Verificar fecha de `dist/api/chat.js`

4. **CORS se configura en backend**
   - No usar proxy en frontend como solución final
   - La lista de orígenes vive en `ALE_ALLOWED_ORIGINS`

---

## 📞 CONTACTO

Si después de seguir esto algo falla:

1. Ejecutar `./validate-ec2.sh` y pegar output completo
2. Pegar logs: `pm2 logs al-e-core --lines 100`
3. Pegar error específico del navegador (Console + Network tab)

**Con esa información podemos diagnosticar el problema exacto.**

---

**TIEMPO ESTIMADO:** 10-15 minutos

**PRIORIDAD:** Alta (bloquea desarrollo de AL-EON)

**DOCUMENTACIÓN COMPLETA:** Ver `VALIDACION-EC2-REQUERIDA.md`
