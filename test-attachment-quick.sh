#!/bin/bash
# Script de validación rápida para attachment restriction

echo "🧪 Validación Rápida: Attachment Restriction Mode"
echo "=================================================="
echo ""

BACKEND_URL="${BACKEND_URL:-http://localhost:4000}"

# Test 1: Attachment explícito
echo "Test 1: Mensaje con PDF adjunto..."
curl -s -X POST "$BACKEND_URL/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-quick",
    "mode": "aleon",
    "messages": [{
      "role": "user",
      "content": "¿Cuánto es el total?",
      "attachments": [{
        "name": "factura.pdf",
        "type": "application/pdf",
        "size": 100000
      }]
    }]
  }' | jq -r '.answer' | head -n 3

echo ""
echo "---"
echo ""

# Test 2: Referencia textual
echo "Test 2: Referencia textual a imagen..."
curl -s -X POST "$BACKEND_URL/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-quick",
    "mode": "aleon",
    "messages": [{
      "role": "user",
      "content": "Mira esta imagen de la factura"
    }]
  }' | jq -r '.answer' | head -n 3

echo ""
echo "---"
echo ""

# Test 3: Sin attachments (control)
echo "Test 3: Sin attachments (debe responder normal)..."
curl -s -X POST "$BACKEND_URL/api/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-quick",
    "mode": "aleon",
    "messages": [{
      "role": "user",
      "content": "¿Qué hora es?"
    }]
  }' | jq -r '.answer' | head -n 3

echo ""
echo "=================================================="
echo "✅ Validación completada"
echo ""
echo "CRITERIOS DE ÉXITO:"
echo "- Tests 1 y 2 deben iniciar con: 'No tengo la capacidad de ver...'"
echo "- Test 3 NO debe mencionar limitaciones"
echo ""
