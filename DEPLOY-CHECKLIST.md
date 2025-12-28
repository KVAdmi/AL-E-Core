# 🚀 CHECKLIST DE DEPLOY A EC2

## ✅ PRE-DEPLOY (Local - YA COMPLETADO)

- [x] Código compila sin errores (`npm run build`)
- [x] Variables de entorno configuradas en `.env`
- [x] CORS incluye orígenes necesarios
- [x] Endpoints implementados y probados
- [x] Documentación creada
- [x] Script de validación ejecutado (`./validate.sh`)

---

## 🚀 DEPLOY A EC2

### 1️⃣ Conectar a EC2

```bash
ssh ubuntu@tu-ec2-ip
# O el usuario que uses
```

### 2️⃣ Navegar al proyecto

```bash
cd /home/ubuntu/AL-E-Core
# O la ruta donde esté tu repo
```

### 3️⃣ Backup del .env actual (IMPORTANTE)

```bash
cp .env .env.backup-$(date +%Y%m%d-%H%M%S)
```

### 4️⃣ Pull de cambios

```bash
git pull origin main
```

### 5️⃣ Verificar/actualizar .env en EC2

```bash
nano .env
```

**Verificar que estas variables estén presentes:**

```bash
SUPABASE_URL=https://gptwzuqmuvzttajgjrry.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
OPENAI_API_KEY=sk-proj-...
ALE_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3003,https://al-eon.com,https://www.al-eon.com,https://chat.al-eon.com
PORT=4000
ASSISTANT_ID=al-e
DEFAULT_WORKSPACE_ID=default
DEFAULT_MODE=universal
```

**CRÍTICO:** Agregar `http://localhost:3001` a `ALE_ALLOWED_ORIGINS` si no está.

Guardar: `Ctrl+O`, Enter, `Ctrl+X`

### 6️⃣ Instalar dependencias nuevas (si las hay)

```bash
npm install
```

### 7️⃣ Compilar TypeScript

```bash
npm run build
```

**Verificar que no haya errores.**

### 8️⃣ Verificar archivos compilados

```bash
ls -la dist/api/chat.js
ls -la dist/api/sessions.js
ls -la dist/utils/helpers.js
```

**Deben existir todos.**

### 9️⃣ Reiniciar PM2

```bash
pm2 restart al-e-core
```

O si es la primera vez:

```bash
pm2 start npm --name al-e-core -- start
pm2 save
```

### 🔟 Ver logs en tiempo real

```bash
pm2 logs al-e-core --lines 50
```

**Buscar:**
```
[CORS] Orígenes permitidos: [ ... ]
[DEBUG] chatRouter (v2) montado en /api/ai
[DEBUG] sessionsRouter montado en /api/sessions
AL-E Core listening on port 4000
```

---

## 🧪 VALIDACIÓN POST-DEPLOY

### 1. Health check

```bash
curl https://api.al-entity.com/health
```

**Debe responder:**
```json
{"status":"ok","service":"al-e-core","timestamp":"..."}
```

### 2. Ping del sistema AI

```bash
curl https://api.al-entity.com/api/ai/ping
```

**Debe responder:**
```json
{"status":"AL-E CORE ONLINE","timestamp":"...","version":"2.0-SUPABASE-GUARANTEED"}
```

### 3. Prueba de chat (crear sesión)

```bash
curl -X POST "https://api.al-entity.com/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-deploy",
    "messages": [
      {"role": "user", "content": "Test de deploy"}
    ]
  }'
```

**Debe responder con:**
```json
{
  "answer": "...",
  "session_id": "uuid-aqui",
  "memories_to_add": []
}
```

**IMPORTANTE:** Guardar el `session_id` para la siguiente prueba.

### 4. Verificar en Supabase

Ir a Supabase Dashboard → SQL Editor:

```sql
-- Ver sesión creada
SELECT * FROM public.ae_sessions 
WHERE user_id_old = 'test-deploy'
ORDER BY created_at DESC 
LIMIT 1;

-- Ver mensajes (usar el session_id de la query anterior)
SELECT role, content, created_at 
FROM public.ae_messages 
WHERE session_id = 'PEGA-EL-UUID-AQUI'
ORDER BY created_at;
```

**Debe mostrar:**
- 1 sesión en `ae_sessions`
- 2 mensajes en `ae_messages` (user + assistant)

### 5. Probar desde AL-EON (localhost:3001)

En tu frontend local:

```javascript
fetch('https://api.al-entity.com/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    userId: 'test-aleon',
    messages: [{ role: 'user', content: 'Hola desde AL-EON' }]
  })
})
.then(r => r.json())
.then(console.log);
```

**Verificar en Network tab del navegador que NO haya error CORS.**

### 6. Verificar logs del backend

```bash
pm2 logs al-e-core --lines 0
```

Dejar corriendo y hacer el request desde AL-EON. Deberías ver:

```
[CORS] Verificando origin: http://localhost:3001
[CORS] Origin en lista permitida - PERMITIDO: http://localhost:3001
[CHAT] ==================== NUEVA SOLICITUD ====================
[CHAT] userId: test-aleon
[DB] ✓ Mensaje user guardado: ...
[OPENAI] Enviando request...
[OPENAI] ✓ Respuesta recibida
[DB] ✓ Mensaje assistant guardado: ...
[DB] ✓ Sesión actualizada: +2 mensajes
[CHAT] ✓ Completado en ...ms
```

---

## 🐛 TROUBLESHOOTING

### Error: "Cannot find module"

```bash
# Reinstalar dependencias
rm -rf node_modules package-lock.json
npm install
npm run build
pm2 restart al-e-core
```

### Error: "Port 4000 already in use"

```bash
# Ver qué proceso está usando el puerto
lsof -i :4000

# Si es PM2:
pm2 delete al-e-core
pm2 start npm --name al-e-core -- start
```

### Error CORS persiste

```bash
# Verificar que el .env se cargó correctamente
pm2 env al-e-core | grep ORIGINS

# Si no aparece:
pm2 delete al-e-core
pm2 start npm --name al-e-core -- start
```

### Base de datos no guarda

```bash
# Ver logs específicos de DB
pm2 logs al-e-core | grep "\[DB\]"

# Verificar variables de Supabase
pm2 env al-e-core | grep SUPABASE
```

---

## ✅ CRITERIOS DE ÉXITO

- [ ] Health check responde OK
- [ ] Ping responde con versión 2.0
- [ ] Chat crea sesión y devuelve session_id
- [ ] Supabase muestra sesión en `ae_sessions`
- [ ] Supabase muestra 2 mensajes en `ae_messages`
- [ ] Frontend (AL-EON) puede conectarse sin error CORS
- [ ] Logs muestran `[DB] ✓ Mensaje ... guardado`
- [ ] No hay errores en `pm2 logs`

---

## 📊 MONITOREO CONTINUO

```bash
# Ver estado de PM2
pm2 status

# Ver logs en tiempo real
pm2 logs al-e-core

# Ver métricas
pm2 monit

# Ver logs de las últimas 24h
pm2 logs al-e-core --lines 1000 | grep ERROR
```

---

## 🔄 ROLLBACK (Si algo sale mal)

```bash
# Volver al commit anterior
git reset --hard HEAD~1

# Recompilar
npm run build

# Restaurar .env backup
cp .env.backup-XXXXXX .env

# Reiniciar
pm2 restart al-e-core
```

---

## 📞 VERIFICACIÓN FINAL

Una vez todo funcione:

1. Enviar mensaje desde AL-EON
2. Verificar que aparezca en Supabase
3. Cerrar y reabrir AL-EON
4. Verificar que el historial persista
5. Crear nueva conversación (botón "Nuevo Chat")
6. Verificar que cree nueva sesión en Supabase

**Si todo esto funciona → DEPLOY EXITOSO ✅**
