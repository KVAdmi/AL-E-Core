#!/bin/bash

# =====================================================
# TEST END-TO-END: RAG COMPLETO CON BGE-M3
# =====================================================

set -e

EC2_IP="100.27.201.233"
BASE_URL="http://$EC2_IP:3000"

echo "========================================="
echo "TEST RAG END-TO-END"
echo "========================================="
echo ""

# 1. Verificar que Knowledge está disponible
echo "1️⃣ Verificando stats de Knowledge Core..."
curl -s "$BASE_URL/api/knowledge/stats" | jq .
echo ""

# 2. Ingestar documento de prueba (EMAIL-HUB-RESUMEN.md)
echo "2️⃣ Ingesting documento de prueba..."
INGEST_RESULT=$(curl -s -X POST "$BASE_URL/api/knowledge/ingest" \
  -F "sourceType=doc" \
  -F "repo=AL-E-Core" \
  -F "path=EMAIL-HUB-RESUMEN.md" \
  -F "content=$(cat EMAIL-HUB-RESUMEN.md)")

echo "$INGEST_RESULT" | jq .
CHUNKS_COUNT=$(echo "$INGEST_RESULT" | jq '.chunks_count // 0')
echo "✓ Chunks generados: $CHUNKS_COUNT"
echo ""

# 3. Esperar embeddings (el endpoint ya los genera automáticamente)
echo "3️⃣ Esperando generación de embeddings (5s)..."
sleep 5
echo ""

# 4. Buscar en Knowledge Base
echo "4️⃣ Buscando en Knowledge Base: 'cómo funciona el sistema de correos'..."
SEARCH_RESULT=$(curl -s -X POST "$BASE_URL/api/knowledge/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "cómo funciona el sistema de correos con Gmail y Outlook",
    "limit": 3,
    "threshold": 0.6
  }')

echo "$SEARCH_RESULT" | jq .
RESULTS_COUNT=$(echo "$SEARCH_RESULT" | jq '.count // 0')
echo "✓ Resultados encontrados: $RESULTS_COUNT"
echo ""

# 5. Probar chat con RAG (requiere sesión válida)
echo "5️⃣ Probando chat con RAG..."
echo "⚠️  Nota: Chat requiere autenticación. Usar frontend para testing completo."
echo ""

# 6. Verificar stats finales
echo "6️⃣ Stats finales:"
curl -s "$BASE_URL/api/knowledge/stats" | jq .
echo ""

echo "========================================="
echo "✅ TEST COMPLETADO"
echo "========================================="
echo ""
echo "Próximos pasos:"
echo "1. Abrir frontend de AL-E"
echo "2. Hacer pregunta: '¿Cómo funciona el sistema de correos?'"
echo "3. Verificar que respuesta incluye 'sources' con documentación"
echo "4. Confirmar que NO inventa información"
