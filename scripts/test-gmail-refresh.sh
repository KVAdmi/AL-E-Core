#!/bin/bash

# 🧪 Test de refresh token OAuth (Gmail)
# Simula un token expirado y verifica que se renueve automáticamente

echo "=========================================="
echo "🧪 TEST: OAuth Refresh Token (Gmail)"
echo "=========================================="
echo ""

# Configuración (REEMPLAZAR con tus valores)
SUPABASE_URL="YOUR_SUPABASE_URL"
SUPABASE_KEY="YOUR_SUPABASE_SERVICE_ROLE_KEY"
USER_ID="YOUR_USER_ID"

echo "1️⃣ Verificando estado actual del token..."
CURRENT_TOKEN=$(curl -s "$SUPABASE_URL/rest/v1/user_integrations?select=expires_at&user_id=eq.$USER_ID&integration_type=eq.gmail" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  | jq -r '.[0].expires_at')

echo "Token expira en: $CURRENT_TOKEN"

EXPIRES_AT=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${CURRENT_TOKEN:0:19}" +%s 2>/dev/null || echo "0")
NOW=$(date +%s)

if [ "$EXPIRES_AT" -gt "$NOW" ]; then
  DIFF=$((EXPIRES_AT - NOW))
  echo "✅ Token válido por $((DIFF / 60)) minutos más"
else
  echo "⚠️ Token expirado o expirará pronto"
fi

echo ""
echo "2️⃣ Haciendo request a AL-E Core para forzar refresh..."

# Generar JWT de prueba (usando el user_id correcto)
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFhNmU1MjA0LTdmZjUtNDdmYy04MTRiLWI1MmU1YzZhZjVkNiIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTYwMDAwMDAwMH0.fake" \
  -d '{
    "message": "Revisa mi correo de Gmail",
    "sessionId": "test-refresh-token-001",
    "workspaceId": "core",
    "mode": "universal"
  }' \
  -s | jq .

echo ""
echo "3️⃣ Verificando si el token se renovó..."
sleep 2

NEW_TOKEN=$(curl -s "$SUPABASE_URL/rest/v1/user_integrations?select=expires_at,updated_at&user_id=eq.$USER_ID&integration_type=eq.gmail" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  | jq -r '.[0]')

echo "Estado del token después del request:"
echo "$NEW_TOKEN" | jq .

echo ""
echo "=========================================="
echo "✅ TEST COMPLETADO"
echo "=========================================="
echo ""
echo "📋 Revisa los logs de PM2 para ver el refresh:"
echo "   ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 'pm2 logs ale-core --lines 50 | grep GMAIL'"
echo ""
