#!/bin/bash
# Test PASO 2: CALENDARIO list_events

JWT="eyJhbGciOiJIUzI1NiIsImtpZCI6IlVJZ3V1VUZSMkZmZGdhVU4iLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2dwdHd6dXFtdXZ6dHRhamdqcnJ5LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY5MDM3NTIyLCJpYXQiOjE3NjkwMzM5MjIsImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJvdHAiLCJ0aW1lc3RhbXAiOjE3NjkwMzM5MjJ9XSwic2Vzc2lvbl9pZCI6IjViNjQ2ODllLTdmM2MtNGFmOC05NDczLTAwN2U0YWVlMDM4YSIsImlzX2Fub255bW91cyI6ZmFsc2V9.eSXcIJ7Yee82zRv14oJQ5rtpBcTedu5RrbgOTPARbrU"

echo "🚀 TEST PASO 2: CALENDARIO list_events"
echo "========================================"
echo ""
echo "📝 Prompt: 'Confírmame mi agenda de esta semana'"
echo ""

ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << ENDSSH

cd AL-E-Core

# Crear archivo temporal para capturar logs
LOGFILE="/tmp/paso2-calendario-\$(date +%s).log"

# Hacer request al chat y capturar logs del PM2
echo "📤 Enviando prompt al chat..."
echo "════════════════════════════════════════"

# Iniciar captura de logs en background
pm2 logs al-e-core --lines 0 --raw > "\$LOGFILE" 2>&1 &
LOGPID=\$!
sleep 1

# Enviar prompt
RESULT=\$(curl -s -w "\n%{http_code}" http://localhost:3000/api/ai/chat/v2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d '{
    "message": "Confírmame mi agenda de esta semana",
    "sessionId": "test-paso2-'"\$(date +%s)"'",
    "mode": "al-eon"
  }')

# Esperar procesamiento
sleep 5

# Detener captura de logs
kill \$LOGPID 2>/dev/null || true

HTTP_CODE=\$(echo "\$RESULT" | tail -1)
RESPONSE=\$(echo "\$RESULT" | head -n -1)

echo "════════════════════════════════════════"
echo ""

if [ "\$HTTP_CODE" = "200" ]; then
  echo "✅ Chat respondió correctamente"
  echo ""
  
  # Buscar evidencia de list_events en logs
  echo "🔍 Verificando logs..."
  echo ""
  
  if grep -q "list_events" "\$LOGFILE"; then
    echo "✅ toolUse: list_events - ENCONTRADO"
    
    # Mostrar fragmento relevante
    echo ""
    echo "📋 Fragmento de logs:"
    echo "---"
    grep -A 5 -B 2 "list_events" "\$LOGFILE" | head -20
    echo "---"
    echo ""
    
    # Verificar si hay eventos en la respuesta
    if echo "\$RESPONSE" | grep -q "evento"; then
      echo "✅ Respuesta con eventos reales"
    elif echo "\$RESPONSE" | grep -q "agenda"; then
      echo "✅ Respuesta menciona agenda"
    else
      echo "⚠️  Respuesta sin eventos específicos (puede ser normal si agenda vacía)"
    fi
    
    echo ""
    echo "🎯 PASO 2 COMPLETO"
    echo "   Tool list_events ejecutado correctamente"
    
  else
    echo "❌ list_events NO encontrado en logs"
    echo ""
    echo "Respuesta del chat:"
    echo "\$RESPONSE" | head -200
    exit 1
  fi
  
else
  echo "❌ Error HTTP \$HTTP_CODE"
  echo "\$RESPONSE"
  exit 1
fi

# Cleanup
rm -f "\$LOGFILE"

ENDSSH
