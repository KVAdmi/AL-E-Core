#!/bin/bash

# Test REAL reuniones en producción
# Genera audio sintético y lo sube

set -e

HOST="https://al-e-core.netlify.app"

echo "🎙️ Generando audio de prueba..."

# Crear archivo WAV simple con audio sintético (1 segundo de tono)
ffmpeg -f lavfi -i "sine=frequency=440:duration=5" -ar 16000 -ac 1 /tmp/test-meeting.wav -y 2>/dev/null

echo "✅ Audio generado (5 segundos)"

echo ""
echo "🔑 Usando token JWT de sesión activa..."

# Usar token de sesión actual (el usuario ya está logueado)
JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzM3OTM4NjY2LCJpYXQiOjE3Mzc5MzUwNjYsImlzcyI6Imh0dHBzOi8vZ3B0d3p1cW11dnp0dGFqZ2pycnkuc3VwYWJhc2UuY28vYXV0aC92MSIsInN1YiI6IjAzZTg5NTU4LTZjNDMtNDc4ZC1iMmEyLWFkNzYyNWJmMGI4OSIsImVtYWlsIjoicGdhcmliYXlAZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6e30sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3Mzc5MzUwNjZ9XSwic2Vzc2lvbl9pZCI6ImMxYTNjZjg1LWI4Y2UtNGUxZS04MGM1LWM3Y2QwZWQ1ZGUyZiIsImlzX2Fub255bW91cyI6ZmFsc2V9.wFVXWj6_hhvvfhP2t_F5Td5r-0c1nNYqgkSQYCGsW6M"

echo "✅ Token configurado"

echo ""
echo "🚀 Enviando a /api/meetings/transcribe..."

RESPONSE=$(curl -s -X POST "$HOST/api/meetings/transcribe" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -F "audio=@/tmp/test-meeting.wav" \
  --max-time 300)

echo ""
echo "📋 RESPUESTA:"
echo "$RESPONSE" | jq '.'

MEETING_ID=$(echo "$RESPONSE" | jq -r '.id // empty')

if [ -n "$MEETING_ID" ]; then
    echo ""
    echo "✅ Meeting creado: $MEETING_ID"
    
    echo ""
    echo "📋 Listando reuniones..."
    curl -s -X GET "$HOST/api/meetings/list" \
      -H "Authorization: Bearer $JWT_TOKEN" | jq '.meetings[0:3]'
else
    echo "⚠️  No se obtuvo meeting_id, pero revisa la respuesta arriba"
fi

echo ""
echo "🎉 Test completado"
