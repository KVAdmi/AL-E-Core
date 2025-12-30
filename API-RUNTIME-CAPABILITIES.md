# Runtime Capabilities API - Documentación

## 🎯 Objetivo

Endpoint que expone las capacidades REALES del sistema AL-E Core para que AL-EON (frontend) pueda habilitar/deshabilitar features dinámicamente.

## 📍 Endpoint

```
GET /api/runtime-capabilities
```

## 🔐 Autenticación

**REQUIERE** JWT token de Supabase en el header `Authorization`:

```
Authorization: Bearer <JWT_TOKEN>
```

## 📤 Response Exitoso

**Status Code:** `200 OK`

```json
{
  "mail.send": true,
  "mail.inbox": false,
  "calendar.create": true,
  "calendar.list": true,
  "calendar.update": true,
  "calendar.delete": true,
  "documents.read": false,
  "web.search": true,
  "telegram": false
}
```

## ❌ Response con Error

### Sin autenticación / Token inválido

**Status Code:** `401 Unauthorized`

```json
{
  "error": "UNAUTHORIZED",
  "message": "Autenticación requerida",
  "detail": "No se proporcionó token de autorización"
}
```

### Error interno del servidor

**Status Code:** `500 Internal Server Error`

```json
{
  "success": false,
  "userMessage": "Error al cargar las capacidades del sistema. Por favor, intenta más tarde."
}
```

## 🔧 Implementación Técnica

### Archivo Fuente

El endpoint lee el archivo `CONTRACTS/runtime-capabilities.json` que contiene la configuración autoritativa de capacidades del sistema.

**Ubicación:** `/Users/pg/Documents/AL-E Core/CONTRACTS/runtime-capabilities.json`

### Código

**Archivo:** `src/api/runtime-capabilities.ts`

```typescript
import express from 'express';
import { requireAuth } from '../middleware/auth';
import fs from 'fs';
import path from 'path';

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const capabilitiesPath = path.join(__dirname, '../../CONTRACTS/runtime-capabilities.json');
    const fileContent = fs.readFileSync(capabilitiesPath, 'utf-8');
    const capabilities = JSON.parse(fileContent);
    
    res.json(capabilities);
  } catch (error) {
    res.status(500).json({
      success: false,
      userMessage: 'Error al cargar las capacidades del sistema. Por favor, intenta más tarde.'
    });
  }
});

export default router;
```

## 🧪 Testing

### Script de Test

Ubicación: `scripts/test-runtime-capabilities.sh`

```bash
./scripts/test-runtime-capabilities.sh <JWT_TOKEN>
```

### Ejemplo con curl

```bash
# Con autenticación (exitoso)
curl -X GET http://localhost:3111/api/runtime-capabilities \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"

# Sin autenticación (falla con 401)
curl -X GET http://localhost:3111/api/runtime-capabilities \
  -H "Content-Type: application/json"
```

## 🎨 Uso en AL-EON (Frontend)

### Ejemplo de Integración

```typescript
// Fetch capabilities al cargar la app
async function loadCapabilities() {
  try {
    const response = await fetch('https://api.al-eon.com/api/runtime-capabilities', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to load capabilities');
    }
    
    const capabilities = await response.json();
    
    // Habilitar/deshabilitar features
    if (capabilities['mail.send']) {
      enableEmailSendFeature();
    }
    
    if (capabilities['mail.inbox']) {
      enableEmailInboxFeature();
    } else {
      hideEmailInboxButton(); // inbox NO disponible
    }
    
    if (capabilities['calendar.create']) {
      enableCalendarFeatures();
    }
    
  } catch (error) {
    console.error('Error loading capabilities:', error);
    // Mostrar mensaje de error al usuario
    showErrorToUser('No se pudieron cargar las capacidades del sistema.');
  }
}
```

### Manejo de Errores

```typescript
async function loadCapabilities() {
  try {
    const response = await fetch('https://api.al-eon.com/api/runtime-capabilities', {
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    // Si hay error (success: false)
    if (data.success === false && data.userMessage) {
      // Mostrar mensaje AL USUARIO tal cual
      alert(data.userMessage);
      return;
    }
    
    // Si OK, procesar capabilities
    setCapabilities(data);
    
  } catch (error) {
    console.error('Error:', error);
    alert('Error de conexión. Por favor, intenta más tarde.');
  }
}
```

## 📋 Capacidades Disponibles

### Estado Actual (30 dic 2025)

| Capacidad | Estado | Descripción |
|-----------|--------|-------------|
| `mail.send` | ✅ true | Envío de correos vía Gmail OAuth |
| `mail.inbox` | ❌ false | Lectura de inbox (NO disponible) |
| `calendar.create` | ✅ true | Crear eventos en Google Calendar |
| `calendar.list` | ✅ true | Listar eventos de calendario |
| `calendar.update` | ✅ true | Actualizar eventos existentes |
| `calendar.delete` | ✅ true | Eliminar eventos |
| `documents.read` | ❌ false | Lectura de documentos (NO disponible) |
| `web.search` | ✅ true | Búsqueda web con Tavily |
| `telegram` | ❌ false | Integración Telegram (NO disponible) |

## 🚨 Reglas Críticas

1. **NO MODIFICAR** el archivo `runtime-capabilities.json` sin aprobación del equipo core
2. **SIEMPRE** usar este endpoint para verificar capacidades en el frontend
3. **NUNCA** asumir que una capacidad está disponible sin verificar
4. Si una capacidad es `false`, **NO MOSTRAR** la opción al usuario
5. El mensaje `userMessage` en errores **DEBE** mostrarse al usuario tal cual

## 🔄 Flujo de Actualización

1. Desarrollador actualiza `CONTRACTS/runtime-capabilities.json`
2. Frontend hace request a `/api/runtime-capabilities`
3. Backend lee el archivo actualizado y devuelve valores actuales
4. Frontend habilita/deshabilita features según valores recibidos

**No requiere restart del servidor** - los cambios en el archivo JSON se reflejan inmediatamente.

## 📞 Soporte

Para problemas o dudas sobre este endpoint:
- Verificar logs del servidor: `[RUNTIME-CAP]`
- Revisar el archivo `CONTRACTS/runtime-capabilities.json`
- Contactar al equipo de AL-E Core

---

**Última actualización:** 30 de diciembre de 2025
**Versión:** 1.0.0
**Autor:** AL-E Core Team
