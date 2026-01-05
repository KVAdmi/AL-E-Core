#!/bin/bash

# Test directo del endpoint GET /api/email/accounts
# Simula la llamada que debería hacer el frontend

SERVER="https://100.27.201.233"
USER_ID="a56e5204-7ff5-47fc-814b-b52e5c6af5d6"  # Tu user_id de Supabase

echo "🧪 Testing GET /api/email/accounts endpoint..."
echo ""
echo "URL: $SERVER/api/email/accounts?ownerUserId=$USER_ID"
echo ""

curl -k -X GET \
  "$SERVER/api/email/accounts?ownerUserId=$USER_ID" \
  -H "Content-Type: application/json" \
  -v

echo ""
echo ""
echo "✅ Test completado"
