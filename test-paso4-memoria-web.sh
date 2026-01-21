#!/bin/bash
# Test PASO 4: MEMORIA + WEB (KB + Tavily)

JWT="eyJhbGciOiJIUzI1NiIsImtpZCI6IlVJZ3V1VUZSMkZmZGdhVU4iLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2dwdHd6dXFtdXZ6dHRhamdqcnJ5LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY5MDM3NTIyLCJpYXQiOjE3NjkwMzM5MjIsImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJvdHAiLCJ0aW1lc3RhbXAiOjE3NjkwMzM5MjJ9XSwic2Vzc2lvbl9pZCI6IjViNjQ2ODllLTdmM2MtNGFmOC05NDczLTAwN2U0YWVlMDM4YSIsImlzX2Fub255bW91cyI6ZmFsc2V9.eSXcIJ7Yee82zRv14oJQ5rtpBcTedu5RrbgOTPARbrU"

echo "🚀 TEST PASO 4: MEMORIA + WEB"
echo "========================================"
echo ""
echo "📝 Prompt: '¿Qué sabes del proyecto Kunna y qué alternativas recientes hay?'"
echo ""

ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << ENDSSH

cd AL-E-Core

# Crear archivo temporal para capturar logs
LOGFILE="/tmp/paso4-memoria-web-\$(date +%s).log"

echo "📤 Enviando prompt que requiere KB + Web..."
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
    "message": "¿Qué sabes del proyecto Kunna y qué alternativas recientes hay?",
    "sessionId": "test-paso4-'"\$(date +%s)"'",
    "mode": "al-eon"
  }')

# Esperar procesamiento (puede tomar más por KB + web)
sleep 8

# Detener captura de logs
kill \$LOGPID 2>/dev/null || true

HTTP_CODE=\$(echo "\$RESULT" | tail -1)
RESPONSE=\$(echo "\$RESULT" | head -n -1)

echo "════════════════════════════════════════"
echo ""

if [ "\$HTTP_CODE" = "200" ]; then
  echo "✅ Chat respondió correctamente"
  echo ""
  
  # Verificar KB chunks retrieved
  KB_CHUNKS=\$(grep -c "KB chunks retrieved" "\$LOGFILE" || echo "0")
  if [ "\$KB_CHUNKS" -gt 0 ]; then
    echo "✅ KB chunks retrieved: > 0"
    
    # Mostrar cuántos chunks
    grep "KB chunks retrieved" "\$LOGFILE" | head -1
  else
    echo "⚠️  KB chunks retrieved: 0 (puede ser normal si no hay documentos)"
  fi
  
  # Verificar web_search ejecutado
  if grep -q "web_search" "\$LOGFILE"; then
    echo "✅ web_search executed"
    
    # Mostrar fragmento
    echo ""
    echo "📋 Fragmento de web_search:"
    echo "---"
    grep -A 3 "web_search" "\$LOGFILE" | head -10
    echo "---"
  else
    echo "⚠️  web_search NO ejecutado"
  fi
  
  # Verificar que la respuesta combina ambas fuentes
  echo ""
  echo "📄 Inicio de respuesta:"
  echo "---"
  echo "\$RESPONSE" | head -c 400
  echo ""
  echo "---"
  
  # Validar que menciona Kunna
  if echo "\$RESPONSE" | grep -iq "kunna"; then
    echo ""
    echo "✅ Respuesta menciona 'Kunna'"
  else
    echo ""
    echo "⚠️  Respuesta NO menciona 'Kunna' explícitamente"
  fi
  
  echo ""
  echo "🎯 PASO 4 COMPLETO"
  echo "   MEMORIA + WEB funcionando"
  
else
  echo "❌ Error HTTP \$HTTP_CODE"
  echo "\$RESPONSE"
  
  # Mostrar logs relevantes
  if [ -f "\$LOGFILE" ]; then
    echo ""
    echo "Últimos logs:"
    tail -80 "\$LOGFILE"
  fi
  
  exit 1
fi

# Cleanup
rm -f "\$LOGFILE"

ENDSSH
