#!/bin/bash

# =====================================================
# CURLS DE PRUEBA PARA AL-E CORE (EC2)
# =====================================================
# 
# Reemplazar {{BACKEND_URL}} con tu URL de EC2
# Ejemplo: https://api.luisatristain.com o http://tu-ip-ec2:4000
#

BACKEND_URL="https://api.luisatristain.com"
USER_ID="test-user"
WORKSPACE_ID="default"

echo "=========================================="
echo "PRUEBAS AL-E CORE - SUPABASE INTEGRATION"
echo "=========================================="
echo ""

# 1. HEALTH CHECK
echo "1️⃣  HEALTH CHECK"
curl -X GET "${BACKEND_URL}/health" \
  -H "Content-Type: application/json"
echo -e "\n"

# 2. PING DEL SISTEMA
echo "2️⃣  PING /api/ai/ping"
curl -X GET "${BACKEND_URL}/api/ai/ping" \
  -H "Content-Type: application/json"
echo -e "\n"

# 3. ENVIAR MENSAJE (CREAR SESIÓN)
echo "3️⃣  POST /api/ai/chat (crear sesión + 2 mensajes)"
SESSION_RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "'"${WORKSPACE_ID}"'",
    "userId": "'"${USER_ID}"'",
    "mode": "universal",
    "messages": [
      {"role": "user", "content": "Hola, soy Patricia. ¿Quién eres tú?"}
    ]
  }')

echo "$SESSION_RESPONSE" | jq '.'
SESSION_ID=$(echo "$SESSION_RESPONSE" | jq -r '.session_id')
echo -e "\n📌 SESSION_ID: $SESSION_ID\n"

# 4. ENVIAR OTRO MENSAJE A LA MISMA SESIÓN
echo "4️⃣  POST /api/ai/chat (con sessionId existente)"
curl -s -X POST "${BACKEND_URL}/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "workspaceId": "'"${WORKSPACE_ID}"'",
    "userId": "'"${USER_ID}"'",
    "mode": "universal",
    "sessionId": "'"${SESSION_ID}"'",
    "messages": [
      {"role": "user", "content": "¿Puedes recordarme después?"}
    ]
  }' | jq '.'
echo -e "\n"

# 5. LISTAR SESIONES
echo "5️⃣  GET /api/sessions (listar todas las sesiones del usuario)"
curl -s -X GET "${BACKEND_URL}/api/sessions?userId=${USER_ID}&workspaceId=${WORKSPACE_ID}" \
  -H "Content-Type: application/json" | jq '.'
echo -e "\n"

# 6. OBTENER MENSAJES DE LA SESIÓN
echo "6️⃣  GET /api/sessions/${SESSION_ID}/messages"
curl -s -X GET "${BACKEND_URL}/api/sessions/${SESSION_ID}/messages?userId=${USER_ID}&workspaceId=${WORKSPACE_ID}" \
  -H "Content-Type: application/json" | jq '.'
echo -e "\n"

# 7. ACTUALIZAR SESIÓN (PIN)
echo "7️⃣  PATCH /api/sessions/${SESSION_ID} (pin sesión)"
curl -s -X PATCH "${BACKEND_URL}/api/sessions/${SESSION_ID}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "'"${USER_ID}"'",
    "workspaceId": "'"${WORKSPACE_ID}"'",
    "pinned": true,
    "title": "Mi primera conversación con AL-E"
  }' | jq '.'
echo -e "\n"

# 8. VERIFICAR EN SUPABASE
echo "=========================================="
echo "✅ PRUEBAS COMPLETADAS"
echo "=========================================="
echo ""
echo "Ahora verifica en Supabase:"
echo "1. public.ae_sessions debe tener al menos 1 fila con session_id=${SESSION_ID}"
echo "2. public.ae_messages debe tener al menos 4 filas (2 turnos user+assistant)"
echo "3. public.ae_requests debe tener logs de los requests"
echo ""
echo "SQL para verificar:"
echo ""
echo "-- Ver sesión creada"
echo "SELECT * FROM public.ae_sessions WHERE id = '${SESSION_ID}';"
echo ""
echo "-- Ver mensajes"
echo "SELECT role, content, created_at FROM public.ae_messages WHERE session_id = '${SESSION_ID}' ORDER BY created_at;"
echo ""
echo "-- Ver requests"
echo "SELECT endpoint, status_code, response_time, tokens_used FROM public.ae_requests WHERE session_id = '${SESSION_ID}';"
echo ""
