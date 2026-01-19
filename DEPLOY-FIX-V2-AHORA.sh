#!/bin/bash
# DEPLOY FIX CRÍTICO: Endpoint /chat/v2
# Fecha: 18 enero 2026
# Fix: Una línea en truthChat.ts para soportar /v2

set -e  # Exit on error

echo "🚀 DEPLOY FIX CRÍTICO - ENDPOINT /chat/v2"
echo "=========================================="
echo ""

# Conectar a EC2
echo "📡 Conectando a EC2..."
ssh ubuntu@100.27.201.233 << 'ENDSSH'

# Ir a directorio del proyecto
cd /home/ubuntu/ale-core
echo "📂 Directorio actual: $(pwd)"
echo ""

# Mostrar commit actual (antes)
echo "📊 ANTES DEL PULL:"
echo "Commit actual: $(git rev-parse --short HEAD)"
git log -1 --oneline
echo ""

# Pull del fix
echo "⬇️  Descargando fix desde GitHub..."
git pull origin main
echo ""

# Mostrar commit nuevo (después)
echo "📊 DESPUÉS DEL PULL:"
echo "Commit nuevo: $(git rev-parse --short HEAD)"
git log -1 --oneline
echo ""

# Build
echo "🔨 Compilando TypeScript..."
npm run build
echo ""

# Restart PM2
echo "🔄 Reiniciando proceso PM2..."
pm2 restart ale-core
echo ""

# Esperar 3 segundos para que inicie
sleep 3

# Status PM2
echo "✅ STATUS PM2:"
pm2 status
echo ""

# Logs recientes
echo "📋 LOGS RECIENTES (últimas 30 líneas):"
pm2 logs ale-core --lines 30 --nostream
echo ""

# Verificar que esté escuchando
echo "🔍 VERIFICANDO PUERTO 3000:"
netstat -tuln | grep 3000 || echo "❌ Puerto 3000 no encontrado"
echo ""

echo "=========================================="
echo "✅ DEPLOY COMPLETADO"
echo "=========================================="
echo ""
echo "Commit desplegado: $(git rev-parse --short HEAD)"
echo "Fecha: $(date)"
echo ""
echo "🧪 SIGUIENTE PASO: Validar endpoint con curl"

ENDSSH

echo ""
echo "🎯 TESTS DE VALIDACIÓN:"
echo ""
echo "# Test 1: Endpoint responde (sin JWT)"
echo "curl -X POST https://api.al-eon.com/api/ai/chat/v2 \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"message\": \"test\", \"sessionId\": null, \"workspaceId\": \"core\"}'"
echo ""
echo "# Test 2: Con JWT (reemplazar TOKEN)"
echo "curl -X POST https://api.al-eon.com/api/ai/chat/v2 \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -H 'Authorization: Bearer YOUR_JWT_TOKEN' \\"
echo "  -d '{\"message\": \"Hola\", \"sessionId\": null, \"workspaceId\": \"core\"}'"
echo ""
echo "✅ FIN DEL DEPLOY"
