#!/bin/bash

# Test CRUD completo para Calendar API
# Requiere: JWT token válido de Supabase

echo "🧪 Testing Calendar API CRUD (Transactional)"
echo ""

# Configuración
API_URL="http://localhost:3111/api/calendar/events"

# Verificar si se proporcionó un token
if [ -z "$1" ]; then
  echo "❌ Error: Se requiere un JWT token"
  echo ""
  echo "Uso: $0 <JWT_TOKEN>"
  exit 1
fi

JWT_TOKEN="$1"

echo "📍 Base URL: $API_URL"
echo "🔑 Token: ${JWT_TOKEN:0:50}..."
echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 1: POST /api/calendar/events - Crear evento
# ═══════════════════════════════════════════════════════════════
echo "══════════════════════════════════════════════════════════════"
echo "Test 1: POST /api/calendar/events (Crear evento)"
echo "══════════════════════════════════════════════════════════════"
echo ""

# Fecha de mañana a las 3pm
TOMORROW=$(date -u -v+1d +"%Y-%m-%dT15:00:00Z")
TOMORROW_END=$(date -u -v+1d +"%Y-%m-%dT16:00:00Z")

CREATE_PAYLOAD=$(cat <<EOF
{
  "title": "Test Event - Calendar CRUD",
  "description": "Evento de prueba creado por script",
  "start_at": "$TOMORROW",
  "end_at": "$TOMORROW_END",
  "timezone": "America/Mexico_City",
  "location": "Oficina Virtual",
  "notification_minutes": 60
}
EOF
)

echo "Request Body:"
echo "$CREATE_PAYLOAD" | jq '.'
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$CREATE_PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""
echo "Response Body:"
echo "$BODY" | jq '.'
echo ""

# Extraer eventId para usar en siguientes tests
EVENT_ID=$(echo "$BODY" | jq -r '.evidence.id // empty')

if [ "$HTTP_CODE" = "201" ] && [ -n "$EVENT_ID" ] && [ "$EVENT_ID" != "null" ]; then
  echo "✅ Test 1 PASSED: Evento creado con ID: $EVENT_ID"
else
  echo "❌ Test 1 FAILED: Expected 201 with eventId, got $HTTP_CODE"
  exit 1
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 2: GET /api/calendar/events - Listar eventos
# ═══════════════════════════════════════════════════════════════
echo "══════════════════════════════════════════════════════════════"
echo "Test 2: GET /api/calendar/events (Listar eventos)"
echo "══════════════════════════════════════════════════════════════"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""
echo "Response Body (first 500 chars):"
echo "$BODY" | jq '.' | head -20
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Test 2 PASSED: Eventos listados correctamente"
else
  echo "❌ Test 2 FAILED: Expected 200, got $HTTP_CODE"
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 3: GET /api/calendar/events/:id - Obtener evento específico
# ═══════════════════════════════════════════════════════════════
echo "══════════════════════════════════════════════════════════════"
echo "Test 3: GET /api/calendar/events/:id (Obtener evento)"
echo "══════════════════════════════════════════════════════════════"
echo ""

if [ -z "$EVENT_ID" ] || [ "$EVENT_ID" = "null" ]; then
  echo "⚠️  Test 3 SKIPPED: No EVENT_ID disponible"
else
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL/$EVENT_ID" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "HTTP Status: $HTTP_CODE"
  echo ""
  echo "Response Body:"
  echo "$BODY" | jq '.'
  echo ""

  if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Test 3 PASSED: Evento obtenido correctamente"
  else
    echo "❌ Test 3 FAILED: Expected 200, got $HTTP_CODE"
  fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 4: PATCH /api/calendar/events/:id - Actualizar evento
# ═══════════════════════════════════════════════════════════════
echo "══════════════════════════════════════════════════════════════"
echo "Test 4: PATCH /api/calendar/events/:id (Actualizar evento)"
echo "══════════════════════════════════════════════════════════════"
echo ""

if [ -z "$EVENT_ID" ] || [ "$EVENT_ID" = "null" ]; then
  echo "⚠️  Test 4 SKIPPED: No EVENT_ID disponible"
else
  UPDATE_PAYLOAD=$(cat <<EOF
{
  "title": "Test Event - UPDATED",
  "description": "Evento actualizado por script",
  "location": "Oficina Física"
}
EOF
)

  echo "Request Body:"
  echo "$UPDATE_PAYLOAD" | jq '.'
  echo ""

  RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$API_URL/$EVENT_ID" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$UPDATE_PAYLOAD")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "HTTP Status: $HTTP_CODE"
  echo ""
  echo "Response Body:"
  echo "$BODY" | jq '.'
  echo ""

  if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Test 4 PASSED: Evento actualizado correctamente"
  else
    echo "❌ Test 4 FAILED: Expected 200, got $HTTP_CODE"
  fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 5: DELETE /api/calendar/events/:id - Cancelar evento
# ═══════════════════════════════════════════════════════════════
echo "══════════════════════════════════════════════════════════════"
echo "Test 5: DELETE /api/calendar/events/:id (Cancelar evento)"
echo "══════════════════════════════════════════════════════════════"
echo ""

if [ -z "$EVENT_ID" ] || [ "$EVENT_ID" = "null" ]; then
  echo "⚠️  Test 5 SKIPPED: No EVENT_ID disponible"
else
  RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_URL/$EVENT_ID" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Content-Type: application/json")

  HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "HTTP Status: $HTTP_CODE"
  echo ""
  echo "Response Body:"
  echo "$BODY" | jq '.'
  echo ""

  if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Test 5 PASSED: Evento cancelado correctamente"
  else
    echo "❌ Test 5 FAILED: Expected 200, got $HTTP_CODE"
  fi
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "🎯 Tests CRUD completados"
echo "══════════════════════════════════════════════════════════════"
