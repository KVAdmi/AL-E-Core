#!/bin/bash

# =====================================================
# DEPLOY MEETINGS DIARIZACIÓN A EC2
# =====================================================
# Ejecuta setup Python + migración Supabase + deploy código

set -e

EC2_HOST="ubuntu@100.27.201.233"
REPO_DIR="AL-E-Core"

echo "📡 [1/5] Conectando a EC2..."

# Setup Python environment
echo "🐍 [2/5] Instalando dependencias Python en EC2..."
ssh $EC2_HOST << 'ENDSSH'
cd ~/AL-E-Core
bash setup-meetings-python.sh
ENDSSH

# Aplicar migración Supabase
echo "🗄️  [3/5] Aplicando migración Supabase..."
echo "MANUAL: Ejecutar supabase-migration-meeting-transcriptions.sql en Supabase Dashboard"
echo "Presiona ENTER cuando hayas aplicado la migración..."
read -r

# Deploy código
echo "🚀 [4/5] Deploying código a EC2..."
ssh $EC2_HOST << 'ENDSSH'
cd ~/AL-E-Core
git pull origin main
npm install
npm run build
pm2 restart al-e-core
pm2 logs al-e-core --lines 50
ENDSSH

echo "✅ [5/5] Deploy completado"
echo ""
echo "⚠️  RECORDATORIO FINAL:"
echo "1. Configurar HF_TOKEN en .env del EC2"
echo "2. Reiniciar PM2 después de agregar token: pm2 restart al-e-core"
echo ""
echo "Test endpoint: POST /api/meetings/transcribe"
