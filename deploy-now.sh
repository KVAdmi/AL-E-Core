#!/bin/bash
set -e

echo "🚀 DEPLOYMENT AL-E CORE - 7 commits"
echo "====================================="

ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'
cd AL-E-Core
echo "📥 Git pull..."
git pull
echo "📦 npm install..."
npm install
echo "🔨 npm build..."
npm run build
echo "🔄 PM2 restart..."
pm2 restart al-e-core
echo "📋 PM2 logs (últimas 50 líneas)..."
pm2 logs al-e-core --lines 50 --nostream
echo "✅ DEPLOYMENT COMPLETADO"
ENDSSH
