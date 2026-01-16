#!/bin/bash

# Script de pruebas OpenAI Referee
# Ejecutar desde el servidor EC2

echo "==================================================================="
echo "PRUEBA 1: Email normal - NO debe invocar referee"
echo "==================================================================="
echo ""

curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "workspaceId": "default",
    "mode": "universal",
    "messages": [
      {"role": "user", "content": "hola"}
    ]
  }' 2>&1

echo ""
echo ""
echo "==================================================================="
echo "LOGS DE PRUEBA 1:"
echo "==================================================================="
pm2 logs al-e-api --lines 100 --nostream | grep -A 5 -B 5 "OPENAI_REFEREE\|ORCH"

echo ""
echo ""
echo "==================================================================="
echo "PRUEBA 2: Pregunta que puede causar evasión"
echo "==================================================================="
echo ""

curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "workspaceId": "default",
    "mode": "universal",
    "messages": [
      {"role": "user", "content": "dame información detallada sobre mi correo electrónico"}
    ]
  }' 2>&1

echo ""
echo ""
echo "==================================================================="
echo "LOGS DE PRUEBA 2:"
echo "==================================================================="
pm2 logs al-e-api --lines 100 --nostream | grep -A 5 -B 5 "OPENAI_REFEREE\|defensive_response\|ORCH"

echo ""
echo ""
echo "==================================================================="
echo "STATS DEL REFEREE:"
echo "==================================================================="
curl -s http://localhost:3000/_health/referee | python3 -m json.tool

echo ""
echo "==================================================================="
echo "PRUEBAS COMPLETADAS"
echo "==================================================================="
