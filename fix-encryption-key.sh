#!/bin/bash

# =====================================================
# FIX ENCRYPTION_KEY EN SERVIDOR EC2
# =====================================================

set -e

SERVER="ubuntu@100.27.201.233"
REMOTE_DIR="/home/ubuntu/AL-E-Core"
ENCRYPTION_KEY="595f971bc7788ceab6b76be268ebe6567d9af6718569432e198c0176e4812d89"
SSH_KEY="$HOME/Downloads/mercado-pago.pem"

echo "🔐 Agregando ENCRYPTION_KEY al servidor EC2..."

ssh -i $SSH_KEY $SERVER << 'ENDSSH'
cd /home/ubuntu/AL-E-Core

# Backup del .env actual
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Verificar si ENCRYPTION_KEY ya existe
if grep -q "^ENCRYPTION_KEY=" .env; then
  echo "⚠️  ENCRYPTION_KEY ya existe, actualizando..."
  sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=595f971bc7788ceab6b76be268ebe6567d9af6718569432e198c0176e4812d89/" .env
else
  echo "➕ Agregando ENCRYPTION_KEY al .env..."
  # Buscar EMAIL_FROM_NAME y agregar después
  if grep -q "^EMAIL_FROM_NAME=" .env; then
    sed -i "/^EMAIL_FROM_NAME=/a\\
\\
# === ENCRYPTION KEYS ===\\
# ENCRYPTION_KEY: Para sistema de email antiguo (src/api/email.ts)\\
ENCRYPTION_KEY=595f971bc7788ceab6b76be268ebe6567d9af6718569432e198c0176e4812d89" .env
  else
    # Si no existe EMAIL_FROM_NAME, agregar al final
    echo "" >> .env
    echo "# === ENCRYPTION KEYS ===" >> .env
    echo "# ENCRYPTION_KEY: Para sistema de email antiguo (src/api/email.ts)" >> .env
    echo "ENCRYPTION_KEY=595f971bc7788ceab6b76be268ebe6567d9af6718569432e198c0176e4812d89" >> .env
  fi
fi

echo "✅ ENCRYPTION_KEY configurado"

# Verificar
echo ""
echo "📋 Verificando .env:"
grep "ENCRYPTION_KEY=" .env | head -1

echo ""
echo "🔄 Reiniciando PM2..."
pm2 restart al-e-core

echo ""
echo "📊 Estado del servidor:"
pm2 list

echo ""
echo "✅ Proceso completado"
ENDSSH

echo ""
echo "🎉 ENCRYPTION_KEY agregado exitosamente al servidor EC2"
echo ""
echo "📋 Próximos pasos:"
echo "  1. Verificar que no haya errores: ssh ubuntu@100.27.201.233 'pm2 logs al-e-core --lines 50'"
echo "  2. Probar endpoint desde frontend"
echo ""
