#!/bin/bash

# Test para el endpoint /api/runtime-capabilities
# Requiere: JWT token válido de Supabase

echo "🧪 Testing /api/runtime-capabilities endpoint..."
echo ""

# Configuración
API_URL="http://localhost:3111/api/runtime-capabilities"

# Verificar si se proporcionó un token
if [ -z "$1" ]; then
  echo "❌ Error: Se requiere un JWT token"
  echo ""
  echo "Uso: $0 <JWT_TOKEN>"
  echo ""
  echo "Ejemplo:"
  echo "  $0 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  exit 1
fi

JWT_TOKEN="$1"

echo "📍 Endpoint: $API_URL"
echo "🔑 Token: ${JWT_TOKEN:0:50}..."
echo ""

# Test 1: Request con autenticación válida
echo "══════════════════════════════════════════════════════════════"
echo "Test 1: GET con autenticación válida"
echo "══════════════════════════════════════════════════════════════"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Test 1 PASSED: Autenticación válida exitosa"
else
  echo "❌ Test 1 FAILED: Expected 200, got $HTTP_CODE"
fi

echo ""

# Test 2: Request sin autenticación
echo "══════════════════════════════════════════════════════════════"
echo "Test 2: GET sin autenticación (debe fallar con 401)"
echo "══════════════════════════════════════════════════════════════"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "401" ]; then
  echo "✅ Test 2 PASSED: Sin autenticación rechazado correctamente"
else
  echo "❌ Test 2 FAILED: Expected 401, got $HTTP_CODE"
fi

echo ""

# Test 3: Request con token inválido
echo "══════════════════════════════════════════════════════════════"
echo "Test 3: GET con token inválido (debe fallar con 401)"
echo "══════════════════════════════════════════════════════════════"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$API_URL" \
  -H "Authorization: Bearer invalid_token_123" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo ""
echo "Response Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "401" ]; then
  echo "✅ Test 3 PASSED: Token inválido rechazado correctamente"
else
  echo "❌ Test 3 FAILED: Expected 401, got $HTTP_CODE"
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "🎯 Tests completados"
echo "══════════════════════════════════════════════════════════════"
