#!/bin/bash

# Script de prueba completo de tools con logs
# Este script ejecuta múltiples tests y captura logs del servidor

API_URL="http://100.27.201.233:3000"
USER_ID="0af1f827-b4e4-4c2d-96dc-b2cd7a1c0bfa"  # Tu user ID

echo "=============================================="
echo "🧪 PRUEBA COMPLETA DE TOOLS - AL-E CORE"
echo "=============================================="
echo ""

# Función para hacer request y mostrar logs
test_tool() {
  local test_name="$1"
  local message="$2"
  
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📝 TEST: $test_name"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "💬 Mensaje: \"$message\""
  echo ""
  
  # Hacer request
  echo "🔄 Enviando request..."
  response=$(curl -s -X POST "$API_URL/api/ai/chat/v2" \
    -H "Content-Type: application/json" \
    -d "{
      \"message\": \"$message\",
      \"userId\": \"$USER_ID\",
      \"mode\": \"assistant\"
    }")
  
  echo "📤 RESPUESTA DEL API:"
  echo "$response" | jq -C '.' 2>/dev/null || echo "$response"
  echo ""
  
  # Esperar y obtener logs del servidor
  echo "📋 LOGS DEL SERVIDOR (últimos 50 líneas):"
  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 \
    "pm2 logs al-e-core --lines 50 --nostream" 2>/dev/null | \
    grep -E "TOOL ROUTER|EMAIL TOOL|list_emails|read_email|web_search|get_news|calendar|Error|success|CHAT" | \
    tail -30
  
  echo ""
  echo "⏸️  Esperando 3 segundos..."
  sleep 3
  echo ""
}

# ═══════════════════════════════════════════════════════════════
# PRUEBAS
# ═══════════════════════════════════════════════════════════════

# TEST 1: Listar correos
test_tool "EMAIL - Listar correos" "revisa mi correo pls"

# TEST 2: Búsqueda web
test_tool "WEB SEARCH - Cotización bolsa" "cuál es el precio de las acciones de Tesla hoy?"

# TEST 3: Noticias
test_tool "NEWS - Últimas noticias" "dame las últimas noticias de tecnología"

# TEST 4: Crear evento calendario
test_tool "CALENDAR - Agendar reunión" "agenda una reunión con el equipo mañana a las 3pm"

# TEST 5: Listar eventos
test_tool "CALENDAR - Ver agenda" "qué tengo en mi agenda hoy?"

echo "=============================================="
echo "✅ PRUEBAS COMPLETADAS"
echo "=============================================="
