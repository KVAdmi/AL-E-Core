#!/bin/bash

# Test endpoint de reuniones con transcripción
# Ejecutar: bash test-meetings-transcribe.sh

set -e

HOST="https://al-e-core.netlify.app"
# HOST="http://localhost:3001"

# JWT token (reemplazar con token real de usuario)
JWT_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzM3NjE4MjM4LCJpYXQiOjE3Mzc2MTQ2MzgsImlzcyI6Imh0dHBzOi8vZ3B0d3p1cW11dnp0dGFqZ2pycnkuc3VwYWJhc2UuY28vYXV0aC92MSIsInN1YiI6IjAzZTg5NTU4LTZjNDMtNDc4ZC1iMmEyLWFkNzYyNWJmMGI4OSIsImVtYWlsIjoicGdhcmliYXlAZ21haWwuY29tIiwicGhvbmUiOiIiLCJhcHBfbWV0YWRhdGEiOnsicHJvdmlkZXIiOiJlbWFpbCIsInByb3ZpZGVycyI6WyJlbWFpbCJdfSwidXNlcl9tZXRhZGF0YSI6e30sInJvbGUiOiJhdXRoZW50aWNhdGVkIiwiYWFsIjoiYWFsMSIsImFtciI6W3sibWV0aG9kIjoicGFzc3dvcmQiLCJ0aW1lc3RhbXAiOjE3MzczMjI2NDl9XSwic2Vzc2lvbl9pZCI6IjQ5OGI3OTFiLTZkZjItNDZmZi05YmUxLWY5YmFhMzYwOThhMiIsImlzX2Fub255bW91cyI6ZmFsc2V9.YourTokenHere"

echo "🎙️ [1/3] Creando audio de prueba..."

# Crear audio de prueba con síntesis de voz (requiere espeak o similar)
# Alternativa: usar audio existente
AUDIO_FILE="/tmp/test-meeting.wav"

if command -v say > /dev/null; then
    # macOS
    say "Hola buenos días. Esta es una reunión de prueba." -o "$AUDIO_FILE" --data-format=LEI16@16000
elif command -v espeak > /dev/null; then
    # Linux
    espeak -v es "Hola buenos días. Esta es una reunión de prueba." -w "$AUDIO_FILE"
else
    echo "⚠️  No se encontró say ni espeak. Usa un archivo de audio existente."
    echo "Descarga audio de prueba o crea uno manualmente."
    exit 1
fi

echo "✅ Audio creado: $AUDIO_FILE"

echo ""
echo "🚀 [2/3] Enviando a /api/meetings/transcribe..."

RESPONSE=$(curl -s -X POST "$HOST/api/meetings/transcribe" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -F "audio=@$AUDIO_FILE")

echo "$RESPONSE" | jq '.'

MEETING_ID=$(echo "$RESPONSE" | jq -r '.id // empty')

if [ -z "$MEETING_ID" ]; then
    echo "❌ Error: No se obtuvo meeting ID"
    echo "Response: $RESPONSE"
    exit 1
fi

echo ""
echo "✅ Meeting ID: $MEETING_ID"

echo ""
echo "📋 [3/3] Listando reuniones..."

curl -s -X GET "$HOST/api/meetings/list" \
  -H "Authorization: Bearer $JWT_TOKEN" | jq '.'

echo ""
echo "🎉 Test completado"
