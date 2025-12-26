# Memory API - Testing Guide

## 🎯 Objetivo
Endpoints seguros para guardar y leer memorias explícitas (acuerdos/decisiones/hechos).

## 🔒 Seguridad
- **requireAuth**: JWT obligatorio para todos los endpoints
- **owner_user_uuid**: Siempre desde `req.user.id` (NUNCA del body)
- **Scope user**: Solo memorias del usuario autenticado
- **Scope project**: Memorias compartidas del proyecto

## 📊 Modelo de Datos

```typescript
{
  workspace_id: 'al-eon',
  user_id: '<owner_uuid>', // legacy
  mode: 'universal',
  type: 'agreement' | 'decision' | 'fact' | 'preference',
  summary: 'contenido de la memoria',
  importance: 1-5,
  source: 'manual',
  metadata: {
    scope: 'user' | 'project',
    scope_id: '<user_uuid>' | 'kunna',
    owner_user_uuid: '<uuid>',
    workspace_id: 'al-eon'
  }
}
```

## 🧪 Tests (Producción)

### Setup
```bash
# Obtener JWT desde DevTools → Network → Authorization header
export JWT="<tu_jwt_aqui>"
```

### Test 1: Guardar Acuerdo de Proyecto
```bash
curl -s -X POST https://api.al-eon.com/api/memory/save \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "al-eon",
    "scope": "project",
    "scope_id": "kunna",
    "type": "agreement",
    "content": "Validar con Copilot de Kunna el estado del flujo",
    "importance": 4
  }' | jq .
```

**Esperado**:
```json
{
  "success": true,
  "memory": {
    "id": "<uuid>",
    "scope": "project",
    "scope_id": "kunna",
    "type": "agreement",
    "content": "Validar con Copilot de Kunna el estado del flujo",
    "importance": 4,
    "created_at": "2025-12-25T..."
  }
}
```

### Test 2: Consultar Memorias de Proyecto
```bash
curl -s "https://api.al-eon.com/api/memory/context?scope=project&scope_id=kunna&limit=10" \
  -H "Authorization: Bearer $JWT" | jq .
```

**Esperado**:
```json
{
  "memories": [
    {
      "id": "<uuid>",
      "type": "agreement",
      "content": "Validar con Copilot de Kunna el estado del flujo",
      "importance": 4,
      "created_at": "...",
      "scope": "project",
      "scope_id": "kunna"
    }
  ]
}
```

### Test 3: Guardar Preferencia de Usuario
```bash
curl -s -X POST https://api.al-eon.com/api/memory/save \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "al-eon",
    "scope": "user",
    "type": "preference",
    "content": "Prefiero respuestas técnicas y directas, sin rodeos",
    "importance": 3
  }' | jq .
```

### Test 4: Consultar Memorias de Usuario
```bash
curl -s "https://api.al-eon.com/api/memory/context?scope=user&limit=10" \
  -H "Authorization: Bearer $JWT" | jq .
```

### Test 5: Eliminar Memoria
```bash
curl -s -X DELETE "https://api.al-eon.com/api/memory/<memory_id>" \
  -H "Authorization: Bearer $JWT" | jq .
```

## 🔍 Verificar Logs en EC2

```bash
ssh -i ~/Downloads/mercado-pago.pem ubuntu@13.220.60.13
pm2 logs ale-core --lines 50 | grep -E "MEMORY"
```

**Logs esperados**:
```
[MEMORY] memory_save { scope: project, scope_id: kunna, type: agreement, importance: 4, workspace_id: al-eon, owner_user_uuid: <uuid> }
[MEMORY] memory_context { scope: project, scope_id: kunna, returned_count: 1, workspace_id: al-eon, owner_user_uuid: <uuid> }
```

## ❌ Tests de Seguridad

### Test: Sin JWT (debe fallar con 401)
```bash
curl -s -X POST https://api.al-eon.com/api/memory/save \
  -H "Content-Type: application/json" \
  -d '{"scope":"project","scope_id":"kunna","type":"agreement","content":"test"}' | jq .
```

**Esperado**: `401 Unauthorized`

### Test: user_id en body (debe ignorarse)
```bash
curl -s -X POST https://api.al-eon.com/api/memory/save \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "user",
    "user_id": "otro_usuario_uuid",
    "type": "fact",
    "content": "Intentando hackear"
  }' | jq .
```

**Esperado**: Se guarda con `owner_user_uuid` del JWT (NO del body)

## ✅ Criterios de Aceptación

1. ✅ POST /api/memory/save funciona con JWT
2. ✅ GET /api/memory/context devuelve memorias correctas
3. ✅ DELETE elimina solo si eres owner
4. ✅ Sin JWT → 401
5. ✅ owner_user_uuid siempre desde JWT (no body)
6. ✅ Logs [MEMORY] aparecen sin PII
7. ✅ Scope user ignora scope_id del body

## 📝 Próximo Paso

**NO IMPLEMENTADO EN ESTE PR**:
- Inyección de memorias en `/api/ai/chat`
- Ese será el siguiente PR después de validar que estos endpoints funcionan

---

**Fecha**: 25 dic 2025  
**Commit**: Pendiente  
**Deploy**: Pendiente validación local → producción
