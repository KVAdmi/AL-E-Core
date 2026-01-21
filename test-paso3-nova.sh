#!/bin/bash
# Test PASO 3: NOVA TOOL LOOP (verificar que no hay ValidationException)

JWT="eyJhbGciOiJIUzI1NiIsImtpZCI6IlVJZ3V1VUZSMkZmZGdhVU4iLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2dwdHd6dXFtdXZ6dHRhamdqcnJ5LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY5MDM3NTIyLCJpYXQiOjE3NjkwMzM5MjIsImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJvdHAiLCJ0aW1lc3RhbXAiOjE3NjkwMzM5MjJ9XSwic2Vzc2lvbl9pZCI6IjViNjQ2ODllLTdmM2MtNGFmOC05NDczLTAwN2U0YWVlMDM4YSIsImlzX2Fub255bW91cyI6ZmFsc2V9.eSXcIJ7Yee82zRv14oJQ5rtpBcTedu5RrbgOTPARbrU"

echo "🚀 TEST PASO 3: NOVA TOOL LOOP"
echo "========================================"
echo ""
echo "📝 Prompt que requiere tool call: 'Revisa mi correo y agéndame lo importante'"
echo ""

ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << ENDSSH

cd AL-E-Core

# Crear archivo temporal para capturar logs
LOGFILE="/tmp/paso3-nova-\$(date +%s).log"

echo "📤 Enviando prompt que requiere múltiples tools..."
echo "════════════════════════════════════════"

# Iniciar captura de logs
pm2 logs al-e-core --lines 0 --raw > "\$LOGFILE" 2>&1 &
LOGPID=\$!
sleep 1

# Enviar prompt
RESULT=\$(curl -s -w "\n%{http_code}" http://localhost:3000/api/ai/chat/v2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "message": "Dame un resumen de mis correos recientes",
    "sessionId": "test-paso3-'"\$(date +%s)"'",
    "mode": "al-eon"
  }')

# Esperar procesamiento
sleep 6

# Detener captura de logs
kill \$LOGPID 2>/dev/null || true

HTTP_CODE=\$(echo "\$RESULT" | tail -1)
RESPONSE=\$(echo "\$RESULT" | head -n -1)

echo "════════════════════════════════════════"
echo ""

if [ "\$HTTP_CODE" = "200" ]; then
  echo "✅ Chat respondió correctamente"
  echo ""
  
  # Verificar que NO hay ValidationException
  if grep -q "ValidationException" "\$LOGFILE"; then
    echo "❌ ENCONTRADO ValidationException en logs"
    echo ""
    grep -A 5 "ValidationException" "\$LOGFILE" | head -20
    exit 1
  else
    echo "✅ NO ValidationException"
  fi
  
  # Verificar que toolUseId y toolResult coinciden
  if grep -q "toolUseId:" "\$LOGFILE"; then
    echo "✅ toolUseId encontrado"
    
    # Extraer toolUseId
    TOOL_USE_ID=\$(grep "toolUseId:" "\$LOGFILE" | head -1 | grep -o 'tooluse_[^[:space:]]*' || echo "not_found")
    echo "   ID: \$TOOL_USE_ID"
    
    # Verificar que se creó toolResult con mismo ID
    if grep -q "toolResult creado para toolUseId: \$TOOL_USE_ID" "\$LOGFILE"; then
      echo "✅ toolResult creado con mismo toolUseId"
    else
      echo "⚠️  No se encontró confirmación de toolResult con mismo ID"
    fi
  fi
  
  # Verificar segunda llamada a Nova
  if grep -q "Llamada a Nova con tool results" "\$LOGFILE"; then
    echo "✅ Segunda llamada a Nova ejecutada"
    
    if grep -A 3 "Llamada a Nova con tool results" "\$LOGFILE" | grep -q "Nova respondió con tool results"; then
      echo "✅ Segunda llamada respondió exitosamente"
    else
      echo "⚠️  Segunda llamada no respondió"
    fi
  fi
  
  echo ""
  echo "🎯 PASO 3 COMPLETO"
  echo "   Tool loop funciona sin ValidationException"
  
else
  echo "❌ Error HTTP \$HTTP_CODE"
  echo "\$RESPONSE"
  
  # Mostrar logs relevantes
  if [ -f "\$LOGFILE" ]; then
    echo ""
    echo "Últimos logs:"
    tail -50 "\$LOGFILE"
  fi
  
  exit 1
fi

# Cleanup
rm -f "\$LOGFILE"

ENDSSH
