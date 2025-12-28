#!/bin/bash
# Script de deployment para modo AL-EON

set -e  # Exit on error

echo "🚀 Iniciando deployment de AL-E Core con modo 'aleon'"
echo "=================================================="

# 1. Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
  echo "❌ Error: No se encuentra package.json. Ejecuta este script desde la raíz del proyecto."
  exit 1
fi

# 2. Instalar dependencias
echo ""
echo "📦 Instalando dependencias..."
npm install

# 3. Build
echo ""
echo "🔨 Compilando TypeScript..."
npm run build

# 4. Verificar que el build fue exitoso
if [ ! -d "dist" ]; then
  echo "❌ Error: No se generó el directorio dist/"
  exit 1
fi

echo ""
echo "✅ Build completado exitosamente"
echo ""
echo "📋 SIGUIENTE PASO (ejecutar en EC2):"
echo "=================================================="
echo ""
echo "1. Commit y push:"
echo "   git add ."
echo "   git commit -m 'feat: implementar modo aleon con parámetros optimizados'"
echo "   git push origin main"
echo ""
echo "2. En EC2 (SSH):"
echo "   cd /ruta/al-e-core"
echo "   git pull origin main"
echo "   npm install"
echo "   npm run build"
echo "   pm2 restart ale-core --update-env"
echo ""
echo "3. Verificar:"
echo "   pm2 logs ale-core --lines 50"
echo "   curl -X POST https://api.al-eon.com/api/ai/chat \\\" 
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"userId\":\"test\",\"mode\":\"aleon\",\"messages\":[{\"role\":\"user\",\"content\":\"Hola\"}]}'"
echo ""
echo "=================================================="
