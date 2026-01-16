#!/bin/bash

# ========================================
# DEPLOY AL-E BACKEND A EC2
# ========================================
# Ejecutar: bash deploy-to-ec2-now.sh

echo "🚀 DESPLEGANDO AL-E BACKEND A EC2..."
echo ""

ssh ubuntu@100.27.201.233 << 'EOF'
cd al-e-api

echo "📥 1. Pulling latest code..."
git pull origin main

echo ""
echo "🔨 2. Building TypeScript..."
npm run build

echo ""
echo "🔄 3. Restarting PM2..."
pm2 restart al-e-api --update-env

echo ""
echo "✅ 4. Verificando status..."
pm2 status

echo ""
echo "📋 5. Últimos logs (30 líneas):"
pm2 logs al-e-api --lines 30 --nostream

echo ""
echo "🎯 6. Test rápido del endpoint:"
curl -s http://localhost:3000/_health/ai | python3 -m json.tool

EOF

echo ""
echo "✅ DEPLOY COMPLETADO"
echo ""
echo "🧪 TESTS DE VALIDACIÓN:"
echo ""
echo "1. Health check:"
echo "   curl http://100.27.201.233:3000/_health/ai"
echo ""
echo "2. Referee check:"
echo "   curl http://100.27.201.233:3000/_health/referee"
echo ""
echo "3. Test chat (reemplaza USER_ID):"
echo "   curl -X POST http://100.27.201.233:3000/api/ai/chat \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"messages\":[{\"role\":\"user\",\"content\":\"hola\"}],\"userId\":\"USER_ID\"}'"
echo ""
