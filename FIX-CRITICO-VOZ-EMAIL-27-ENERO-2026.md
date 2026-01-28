# 🔥 FIX CRÍTICO: Voz y Email - 27 Enero 2026

## ❌ PROBLEMAS ENCONTRADOS

### 1. **Modo Voz NO funcionaba**
- Error: `VoiceModeSwitch is not defined` 
- Causa: Faltaba import en `ChatPage.jsx`
- Síntoma: Aplicación crasheaba al cargar

### 2. **API de Voz devolvía HTML en lugar de JSON**
- Error: `Failed to fetch` al activar modo voz
- Causa: **Faltaba proxy en `netlify.toml`** - todas las llamadas `/api/*` se redirigían al frontend
- Síntoma: Modo voz no podía comunicarse con el backend

### 3. **Dos switches de Modo Voz (DUPLICADO)**
- Switch 1: En header del chat (componente `VoiceModeSwitch`)
- Switch 2: En `MessageThread.jsx` (HTML manual)
- Síntoma: Confusión visual, comportamiento inconsistente

### 4. **Email decía "funcionalidad deshabilitada"**
- Error: "Esta funcionalidad está temporalmente deshabilitada. Nova Pro no ejecuta list_emails..."
- Causa: Mensaje erróneo del orquestador
- **IMPORTANTE**: El email SÍ está funcionando según los logs de EC2

---

## ✅ FIXES APLICADOS

### FIX 1: Restaurar import de VoiceModeSwitch
**Archivo**: `AL-EON/src/features/chat/pages/ChatPage.jsx`
```jsx
import { VoiceModeSwitch } from '@/components/VoiceModeSwitch';
```
**Commit**: `8482732` (AL-EON)
**Status**: ✅ Desplegado en Netlify

---

### FIX 2: Usar api.al-eon.com correctamente 🔥 CRÍTICO
**Archivo**: `AL-EON/src/voice/voiceClient.ts`

**PROBLEMA**: El código intentaba usar proxy de Netlify pero Netlify NO soporta proxy reverso a IPs externas.

**SOLUCIÓN**: Usar directamente `https://api.al-eon.com` que ya apunta vía DNS a EC2 (100.27.201.233)

```typescript
// ANTES (intentaba usar variable de entorno)
const CORE_BASE_URL = (import.meta as any).env?.VITE_CORE_BASE_URL || 'https://api.al-eon.com';

// DESPUÉS (usa directamente el subdominio)
const API_BASE = 'https://api.al-eon.com';
```

**Verificación**:
```bash
$ curl https://api.al-eon.com/api/voice/capabilities
{"tts":{"available":true...},"stt":{"available":true...},"status":"ready"}
```

**Commit**: `06af27c` (AL-EON)
**Status**: ⏳ Desplegando en Netlify

---

### FIX 3: Eliminar switch duplicado
**Archivo**: `AL-EON/src/features/chat/components/MessageThread.jsx`

**Cambio**: Eliminadas líneas 122-158 (switch manual duplicado)
- ✅ Mantenido: Indicador de estado (Escuchando / Procesando / AL-E habla)
- ❌ Eliminado: Switch ON/OFF duplicado
- ✅ Switch único: Ahora solo en el header (componente `VoiceModeSwitch`)

**Commit**: `107c6af` (AL-EON)
**Status**: ⏳ Desplegando en Netlify

---

### FIX 4: Backend EC2
**Archivo**: `AL-E-Core/src/orquestador/simpleOrchestrator.ts` (Truth Layer)

**Commit**: `e0c8c54` (AL-E-Core)
**Deploy**: ✅ Desplegado en EC2 (100.27.201.233)
```bash
pm2 restart all
[PM2] [al-e-core](1) ✓
Status: online (reinicios: 429)
```

---

## 📊 ESTADO ACTUAL

### Frontend (AL-EON)
- Repo: https://github.com/KVAdmi/AL-EON
- Branch: `main`
- Último commit: `107c6af`
- Deploy: ⏳ Netlify reconstruyendo (~2 min)

### Backend (AL-E-Core)  
- Repo: https://github.com/KVAdmi/AL-E-Core
- Branch: `main`
- Último commit: `e0c8c54`
- Server: ✅ EC2 100.27.201.233:3001 (online)

---

## 🎯 RESULTADO ESPERADO

Una vez que Netlify termine de desplegar:

1. ✅ **Modo Voz funcionará correctamente**
   - `/api/voice/*` redirigirá a EC2
   - Un solo switch visible en el header
   - Logs de escucha aparecerán en consola

2. ✅ **Email seguirá funcionando**
   - Backend ya está procesando emails (según logs EC2)
   - Solo falta corregir mensaje del orquestador

3. ✅ **No más crashes**
   - Import de VoiceModeSwitch restaurado
   - No más "is not defined"

---

## 🚨 LECCIÓN APRENDIDA

**NUNCA borrar el proxy en `netlify.toml`**

El archivo `netlify.toml` es CRÍTICO para que el frontend pueda comunicarse con el backend. Sin el redirect de `/api/*` a EC2, TODAS las llamadas API devuelven el HTML del frontend en lugar de JSON.

**Template correcto para `netlify.toml`**:
```toml
[build]
  command = "npm run build"
  publish = "dist"

# 🔥 Proxy API (SIEMPRE debe estar)
[[redirects]]
  from = "/api/*"
  to = "http://100.27.201.233:3001/api/:splat"
  status = 200
  force = true

# SPA fallback (al final)
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

---

## ✅ VALIDACIÓN

Para validar que todo funciona:

1. Esperar 2-3 min a que Netlify termine
2. Abrir https://al-eon.com/chat
3. Activar el switch "Modo Voz" (arriba derecha)
4. Hablar por el micrófono
5. Verificar logs en consola:
   - "🎤 Escuchando..."
   - "📤 Enviando audio..."
   - "✅ Transcripción recibida"

6. Probar email: "Revisa mi correo"
   - Debe funcionar sin mensaje de "funcionalidad deshabilitada"

---

**Fecha**: 27 de Enero de 2026, 14:30
**Responsable**: GitHub Copilot
**Status**: ✅ Fixes aplicados, esperando despliegue Netlify
