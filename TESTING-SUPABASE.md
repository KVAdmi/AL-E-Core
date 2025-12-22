# 🧪 PRUEBAS DE INTEGRACIÓN SUPABASE - AL-E CORE

## ⚙️ Configuración

Define tu backend URL según tu entorno:

```bash
# Local
export BACKEND_URL="http://localhost:4000"

# Producción (la URL que uses en tu infra)
export BACKEND_URL="https://tu-dominio-backend.com"
```

**IMPORTANTE:** AL-E CORE no asume dominios. La URL la define cada plataforma cliente.

## 📋 Ejemplos CURL

### 1. Health Check

```bash
curl -X GET "${BACKEND_URL}/health"
```

**Respuesta esperada:**
```json
{
  "status": "ok",
  "service": "al-e-core",
  "timestamp": "2025-12-21T..."
}
```

---

### 2. Ping del Sistema AI

```bash
curl -X GET "${BACKEND_URL}/api/ai/ping"
```

**Respuesta esperada:**
```json
{
  "status": "AL-E CORE ONLINE",
  "timestamp": "2025-12-21T...",
  "version": "2.0-SUPABASE-GUARANTEED"
}
```

---

### 3. 💬 POST /api/ai/chat - Crear sesión y enviar mensaje

```bash
curl -X POST "${BACKEND_URL}/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "userId": "test-user",
    "mode": "universal",
    "messages": [
      {"role": "user", "content": "Hola, soy Patricia. ¿Quién eres tú?"}
    ]
  }'
```

**Respuesta esperada:**
```json
{
  "answer": "Hola Patricia, soy AL-E...",
  "session_id": "uuid-aqui",
  "memories_to_add": []
}
```

**⚠️ CRÍTICO:** Guarda el `session_id` para los siguientes requests.

**Lo que debe pasar en Supabase:**
- ✅ Nueva fila en `ae_sessions` con:
  - `id` = session_id
  - `user_id_old` = "test-user"
  - `workspace_id` = "default"
  - `total_messages` = 2
  - `last_message_at` = ahora
  
- ✅ 2 filas en `ae_messages`:
  - 1 con `role='user'` y `content='Hola, soy Patricia...'`
  - 1 con `role='assistant'` y la respuesta

- ✅ 1 fila en `ae_requests` con:
  - `endpoint` = "/api/ai/chat"
  - `status_code` = 200
  - `tokens_used` > 0

---

### 4. 💬 POST /api/ai/chat - Continuar conversación existente

```bash
curl -X POST "${BACKEND_URL}/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "default",
    "userId": "test-user",
    "mode": "universal",
    "sessionId": "PEGA-AQUI-EL-SESSION-ID-DEL-PASO-3",
    "messages": [
      {"role": "user", "content": "¿Recuerdas cómo me llamo?"}
    ]
  }'
```

**Lo que debe pasar:**
- ✅ NO crea nueva sesión
- ✅ Actualiza la sesión existente: `total_messages` = 4
- ✅ Agrega 2 mensajes más a `ae_messages`

---

### 5. 📋 GET /api/sessions - Listar sesiones del usuario

```bash
curl -X GET "${BACKEND_URL}/api/sessions?userId=test-user&workspaceId=default"
```

**Respuesta esperada:**
```json
[
  {
    "id": "uuid",
    "title": "Hola, soy Patricia. ¿Quién eres tú?...",
    "updated_at": "2025-12-21T...",
    "last_message_at": "2025-12-21T...",
    "total_messages": 4,
    "pinned": false,
    "archived": false,
    "mode": "universal",
    "workspace_id": "default",
    "assistant_id": "al-e"
  }
]
```

---

### 6. 💬 GET /api/sessions/:id/messages - Obtener mensajes

```bash
curl -X GET "${BACKEND_URL}/api/sessions/PEGA-SESSION-ID/messages?userId=test-user&workspaceId=default"
```

**Respuesta esperada:**
```json
[
  {
    "id": "msg-uuid-1",
    "role": "user",
    "content": "Hola, soy Patricia. ¿Quién eres tú?",
    "created_at": "2025-12-21T...",
    "tokens": 15,
    "cost": 0.0001,
    "metadata": {...}
  },
  {
    "id": "msg-uuid-2",
    "role": "assistant",
    "content": "Hola Patricia, soy AL-E...",
    "created_at": "2025-12-21T...",
    "tokens": 50,
    "cost": 0.0003,
    "metadata": {...}
  },
  ...
]
```

---

### 7. ✏️ PATCH /api/sessions/:id - Actualizar sesión (pin/archive/title)

```bash
curl -X PATCH "${BACKEND_URL}/api/sessions/PEGA-SESSION-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "workspaceId": "default",
    "pinned": true,
    "title": "Mi primera conversación con AL-E"
  }'
```

**Respuesta esperada:**
```json
{
  "id": "uuid",
  "title": "Mi primera conversación con AL-E",
  "pinned": true,
  "updated_at": "2025-12-21T...",
  ...
}
```

---

### 8. 🗑️ DELETE /api/sessions/:id - Soft delete (archivar)

```bash
curl -X DELETE "${BACKEND_URL}/api/sessions/PEGA-SESSION-ID" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "workspaceId": "default"
  }'
```

**Respuesta esperada:**
```json
{
  "success": true
}
```

**⚠️ NOTA:** No elimina la sesión, solo marca `archived=true`.

---

## 🔍 Verificación en Supabase

### Ver sesión creada
```sql
SELECT * FROM public.ae_sessions 
WHERE user_id_old = 'test-user' 
ORDER BY created_at DESC 
LIMIT 5;
```

### Ver mensajes de una sesión
```sql
SELECT 
  role, 
  content, 
  tokens,
  cost,
  created_at 
FROM public.ae_messages 
WHERE session_id = 'PEGA-SESSION-ID'
ORDER BY created_at ASC;
```

### Ver requests/logs
```sql
SELECT 
  endpoint,
  method,
  status_code,
  response_time,
  tokens_used,
  cost,
  created_at
FROM public.ae_requests 
WHERE session_id = 'PEGA-SESSION-ID'
ORDER BY created_at DESC;
```

### Verificar totales
```sql
SELECT 
  s.id,
  s.title,
  s.total_messages,
  s.total_tokens,
  s.estimated_cost,
  COUNT(m.id) as messages_count
FROM public.ae_sessions s
LEFT JOIN public.ae_messages m ON m.session_id = s.id
WHERE s.user_id_old = 'test-user'
GROUP BY s.id
ORDER BY s.last_message_at DESC;
```

---

## ✅ DEFINICIÓN DE ÉXITO

Después de ejecutar los curls 3 y 4:

1. ✅ `ae_sessions` tiene 1 fila con:
   - `user_id_old = 'test-user'`
   - `total_messages >= 4`
   - `last_message_at` actualizado

2. ✅ `ae_messages` tiene al menos 4 filas (2 turnos) con mismo `session_id`

3. ✅ `GET /api/sessions` devuelve la sesión

4. ✅ `GET /api/sessions/:id/messages` devuelve los mensajes en orden

5. ✅ Frontend puede renderizar el historial completo

---

## 🚀 Script Automático

Para ejecutar todas las pruebas de golpe:

```bash
./test-supabase-integration.sh
```

Este script:
- Crea una sesión
- Envía 2 mensajes
- Lista sesiones
- Lee mensajes
- Actualiza la sesión (pin)
- Muestra comandos SQL para verificar

---

## 🐛 Troubleshooting

### "Session not found" en GET /api/sessions/:id/messages
- Verifica que el `session_id` sea correcto
- Verifica que `userId` y `workspaceId` coincidan con los de la sesión

### "No data in ae_messages"
- Revisa los logs del backend: `pm2 logs al-e-core`
- Verifica que OpenAI responda correctamente
- Chequea que no haya errores de Supabase en los logs

### "CORS error" desde frontend
- Verifica `ALE_ALLOWED_ORIGINS` en `.env` del backend
- Asegúrate de que incluya tu dominio de frontend

---

## 📝 Notas

- El backend NUNCA debe fallar el chat si Supabase falla (solo loggea el error)
- user_id_old almacena el userId string actual
- user_id_uuid queda null hasta implementar auth real
- Los errores de DB se loggean con `[DB]` en consola
- Los errores de OpenAI se loggean con `[OPENAI]` en consola
