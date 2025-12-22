# 🔧 FIX COMPATIBILIDAD AL-EON → Implementado

## ✅ Cambios Realizados

### 1️⃣ **MODE: Alias + Validación Estricta**

**Problema:** Core usaba `mode: 'aleon'` pero frontend enviaba `mode: 'universal'`

**Fix:**
```typescript
// src/api/chat.ts
const allowedModes = new Set(['universal', 'legal', 'medico', 'seguros', 'contabilidad']);

// Alias legacy: "aleon" → "universal"
if (mode === 'aleon') {
  mode = 'universal';
}

if (!allowedModes.has(mode)) {
  return res.status(400).json({
    error: 'INVALID_MODE',
    message: `Modo inválido: ${mode}. Modos válidos: ${Array.from(allowedModes).join(', ')}`
  });
}
```

**Resultado:**
- ✅ `mode: 'universal'` → Funciona
- ✅ `mode: 'aleon'` → Se mapea a `universal` (alias legacy)
- ✅ `mode: 'legal'` → Funciona
- ❌ `mode: 'invalid'` → Error 400 con mensaje claro

---

### 2️⃣ **ATTACHMENTS: Soporta ambos nombres**

**Problema:** Frontend enviaba `files`, Core esperaba `attachments`

**Fix:**
```typescript
// src/api/chat.ts
const attachmentsRaw = (req.body.attachments ?? req.body.files ?? []) as any[];
const safeAttachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];

console.log(`[CHAT] Attachments: ${safeAttachments.length}`);
```

**Resultado:**
- ✅ Acepta `attachments: [...]`
- ✅ Acepta `files: [...]`
- ✅ Si no hay, funciona sin romper

---

### 3️⃣ **ENDPOINT /health Mejorado**

**Antes:**
```json
{ "status": "ok" }
```

**Ahora:**
```json
{
  "status": "ok",
  "service": "al-e-core",
  "timestamp": "2025-12-22T...",
  "uptime": 12345.67,
  "memory": {
    "used": 128,
    "total": 256
  }
}
```

**URL:** `GET http://localhost:4000/health`

**Uso desde AL-EON:**
```typescript
// Antes de enviar mensaje, verificar que Core esté vivo
const health = await fetch(`${BACKEND_URL}/health`);
if (!health.ok) {
  toast.error('Backend no disponible');
  return;
}
```

---

### 4️⃣ **CORS: AL-EON + Localhost + Netlify**

**Fix:**
```typescript
// src/index.ts
const allowedOrigins = [
  'https://al-eon.com',
  'http://localhost:3000',
  'http://localhost:3001'
];

const netlifyRegex = /^https:\/\/.+\.netlify\.app$/;

// En CORS handler
if (allowedOrigins.includes(origin) || netlifyRegex.test(origin)) {
  return callback(null, true);
}
```

**Orígenes permitidos:**
- ✅ `https://al-eon.com`
- ✅ `http://localhost:3000`
- ✅ `http://localhost:3001`
- ✅ `https://cualquier-cosa.netlify.app` (wildcard)
- ❌ Cualquier otro dominio → CORS error

**Métodos permitidos:**
- GET, POST, OPTIONS, PATCH, DELETE

---

### 5️⃣ **DEFAULT_MODE actualizado**

**Antes:**
```bash
DEFAULT_MODE=aleon
```

**Ahora:**
```bash
DEFAULT_MODE=universal
```

**En `.env.example` y `src/config/env.ts`**

---

## 📋 Variables de Entorno Actualizadas

```bash
# .env
PORT=4000
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh...

ASSISTANT_ID=al-e
DEFAULT_WORKSPACE_ID=default
DEFAULT_MODE=universal

ALE_ALLOWED_ORIGINS=https://al-eon.com,http://localhost:3000,http://localhost:3001
```

---

## 🚀 Deployment

```bash
# 1. Build local (ya hecho)
npm run build  # ✅ 0 errores

# 2. Commit y push
git add .
git commit -m "fix: compatibilidad con AL-EON (mode alias, attachments, CORS, /health)"
git push origin main

# 3. En EC2
cd /ruta/al-e-core
git pull origin main
npm install
npm run build

# 4. Actualizar .env en EC2
nano .env
# Cambiar: DEFAULT_MODE=universal
# Verificar: ALE_ALLOWED_ORIGINS incluye al-eon.com

# 5. Restart PM2
pm2 restart ale-core --update-env
pm2 logs ale-core --lines 50
```

---

## ✅ Testing

### Test 1: Health Check
```bash
curl http://localhost:4000/health
```

**Esperado:**
```json
{
  "status": "ok",
  "service": "al-e-core",
  "timestamp": "2025-12-22T...",
  "uptime": 123.45,
  "memory": { "used": 128, "total": 256 }
}
```

---

### Test 2: Mode Alias
```bash
curl -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test",
    "mode": "aleon",
    "messages": [{"role": "user", "content": "Hola"}]
  }'
```

**Esperado:** Respuesta exitosa (mode mapeado a 'universal')

---

### Test 3: Attachments con 'files'
```bash
curl -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test",
    "messages": [{"role": "user", "content": "Analiza"}],
    "files": [{"name": "doc.pdf", "type": "application/pdf", "url": "..."}]
  }'
```

**Esperado:** Respuesta exitosa (files procesados como attachments)

---

### Test 4: CORS
```bash
curl -i -X OPTIONS http://localhost:4000/api/ai/chat \
  -H "Origin: https://al-eon.com" \
  -H "Access-Control-Request-Method: POST"
```

**Esperado:**
```
HTTP/1.1 200 OK
Access-Control-Allow-Origin: https://al-eon.com
Access-Control-Allow-Methods: GET, POST, OPTIONS, PATCH, DELETE
```

---

## 📊 Checklist de Validación

- [x] Build exitoso (0 errores)
- [x] Mode 'aleon' mapea a 'universal'
- [x] Mode 'universal' funciona directo
- [x] Attachments acepta 'attachments' y 'files'
- [x] /health retorna uptime + memory
- [x] CORS incluye al-eon.com
- [x] CORS incluye localhost:3000/3001
- [x] CORS soporta Netlify (*.netlify.app)
- [x] DEFAULT_MODE=universal
- [x] .env.example actualizado
- [ ] Testing en EC2 **PENDIENTE**
- [ ] Validación con AL-EON frontend **PENDIENTE**

---

**Fecha:** 22 de diciembre de 2025  
**Status:** ✅ Listo para deployment
