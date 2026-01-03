#!/bin/bash

# =====================================================
# DEPLOY EMAIL HUB UNIVERSAL TO EC2 PRODUCTION
# =====================================================
# 
# Ejecutar DESDE TU MAC:
# ./deploy-to-ec2.sh
# 
# O ejecutar EN EL SERVIDOR después de subir archivos:
# ./deploy-on-ec2.sh
# =====================================================

set -e

echo "🚀 Desplegando Email Hub Universal a EC2..."
echo "============================================="
echo ""

# Variables
EC2_HOST="ubuntu@100.27.201.233"
EC2_KEY="~/Downloads/mercado-pago.pem"
REMOTE_DIR="/home/ubuntu/AL-E-Core"

# 1. Build local
echo "📦 Compilando localmente..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Error en compilación local"
  exit 1
fi

echo "✅ Build exitoso"
echo ""

# 2. Crear tarball con archivos esenciales
echo "📦 Empaquetando archivos..."
tar -czf email-hub-deploy.tar.gz \
  dist/ \
  package.json \
  package-lock.json \
  .env \
  EMAIL-HUB-UNIVERSAL.md \
  EMAIL-HUB-PROVIDERS.md

echo "✅ Archivos empaquetados"
echo ""

# 3. Subir a EC2
echo "⬆️  Subiendo archivos a EC2..."
scp -i "$EC2_KEY" email-hub-deploy.tar.gz "$EC2_HOST:$REMOTE_DIR/"

if [ $? -ne 0 ]; then
  echo "❌ Error al subir archivos"
  exit 1
fi

echo "✅ Archivos subidos"
echo ""

# 4. Ejecutar comandos en EC2
echo "🔧 Ejecutando deployment en EC2..."
ssh -i "$EC2_KEY" "$EC2_HOST" << 'ENDSSH'
  set -e
  
  echo "📍 Entrando al directorio..."
  cd /home/ubuntu/AL-E-Core
  
  echo "📦 Extrayendo archivos..."
  tar -xzf email-hub-deploy.tar.gz
  rm email-hub-deploy.tar.gz
  
  echo "📦 Instalando dependencias nuevas..."
  npm install imapflow @types/mailparser --save
  
  echo "✅ Dependencias instaladas"
  
  echo "🔍 Verificando EMAIL_CRED_ENC_KEY..."
  if ! grep -q "EMAIL_CRED_ENC_KEY" .env; then
    echo "⚠️  EMAIL_CRED_ENC_KEY no encontrado en .env"
    echo "Generando clave..."
    NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    echo "" >> .env
    echo "# Email Hub Universal - Cifrado" >> .env
    echo "EMAIL_CRED_ENC_KEY=$NEW_KEY" >> .env
    echo "✅ Clave generada y agregada a .env"
  else
    echo "✅ EMAIL_CRED_ENC_KEY ya existe"
  fi
  
  echo "🔄 Reiniciando PM2..."
  pm2 restart al-e-core || pm2 start dist/index.js --name al-e-core
  
  echo "💾 Guardando configuración PM2..."
  pm2 save
  
  echo "📊 Estado de PM2:"
  pm2 status
  
  echo ""
  echo "✅ Deployment completado!"
  echo ""
  echo "📋 Verificar logs:"
  echo "   pm2 logs al-e-core --lines 50"
  echo ""
  echo "🧪 Test endpoints:"
  echo "   curl https://api.al-eon.com/_health"
  echo "   curl https://api.al-eon.com/api/email/accounts -H 'Authorization: Bearer TOKEN'"
  echo ""
ENDSSH

if [ $? -ne 0 ]; then
  echo "❌ Error durante deployment en EC2"
  exit 1
fi

# 5. Limpiar tarball local
rm email-hub-deploy.tar.gz

echo ""
echo "🎉 ¡Deployment completado exitosamente!"
echo ""
echo "🔗 Endpoints disponibles:"
echo "   https://api.al-eon.com/api/email/accounts"
echo "   https://api.al-eon.com/api/email/send"
echo ""
echo "📊 Ver logs en tiempo real:"
echo "   ssh -i $EC2_KEY $EC2_HOST"
echo "   pm2 logs al-e-core"
echo ""
echo "✅ Email Hub Universal está corriendo en producción!"
