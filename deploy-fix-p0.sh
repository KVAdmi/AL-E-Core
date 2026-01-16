#!/bin/bash

echo "🚀 Desplegando fix P0 crítico a EC2..."

# Build local
echo "📦 Building locally..."
npm run build

# Copiar dist a EC2
echo "📤 Copiando archivos a EC2..."
scp -i ~/Downloads/mercado-pago.pem -r dist ubuntu@100.27.201.233:~/AL-E-Core/

# Restart PM2
echo "🔄 Reiniciando PM2..."
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 "pm2 restart al-e-api"

echo "✅ Deploy completado!"
echo ""
echo "📊 Verificando status..."
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 "pm2 status"
