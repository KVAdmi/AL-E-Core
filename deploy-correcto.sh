#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# DEPLOY CORRECTO A PRODUCCIÓN (EC2)
# ═══════════════════════════════════════════════════════════════
# 
# Este script ejecuta el deploy completo con TODOS los pasos necesarios.
# 
# USO: ./deploy-correcto.sh
# ═══════════════════════════════════════════════════════════════

set -e  # Detener si hay error

echo "═══════════════════════════════════════════════════════════════"
echo "🚀 DEPLOY A PRODUCCIÓN EC2"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Variables
EC2_HOST="ubuntu@100.27.201.233"
EC2_KEY="$HOME/Downloads/mercado-pago.pem"
PROJECT_DIR="AL-E-Core"

# Verificar que estamos en la rama main
echo "📍 Verificando rama actual..."
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "❌ ERROR: Debes estar en la rama 'main' para hacer deploy"
  echo "   Rama actual: $CURRENT_BRANCH"
  exit 1
fi
echo "✅ Rama: main"
echo ""

# Verificar que no hay cambios sin commit
echo "📝 Verificando cambios locales..."
if ! git diff-index --quiet HEAD --; then
  echo "⚠️  ADVERTENCIA: Hay cambios sin commit"
  git status --short
  echo ""
  read -p "¿Continuar de todos modos? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Deploy cancelado"
    exit 1
  fi
fi
echo "✅ Sin cambios pendientes (o confirmado continuar)"
echo ""

# Push a remote (por si hay commits locales)
echo "📤 Haciendo git push..."
if git push origin main; then
  echo "✅ Push exitoso"
else
  echo "⚠️  Push falló (puede ser que no haya commits nuevos)"
fi
echo ""

# Conectar a EC2 y hacer deploy
echo "🔌 Conectando a EC2..."
echo "   Host: $EC2_HOST"
echo ""

ssh -i "$EC2_KEY" "$EC2_HOST" << 'ENDSSH'
  set -e
  
  echo "═══════════════════════════════════════════════════════════════"
  echo "📦 DEPLOY EN EC2"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  
  cd AL-E-Core
  
  # 1. Git pull
  echo "📥 PASO 1/4: Git pull..."
  
  # Stash cambios locales si los hay (por si hay local changes en producción)
  if ! git diff-index --quiet HEAD --; then
    echo "⚠️  Hay cambios locales en EC2, haciendo stash..."
    git stash
  fi
  
  # Pull
  git pull origin main
  echo "✅ Git pull completado"
  echo ""
  
  # 2. Instalar dependencias (por si hay nuevas)
  echo "📦 PASO 2/4: Verificando dependencias..."
  npm install --production
  echo "✅ Dependencias actualizadas"
  echo ""
  
  # 3. COMPILAR TYPESCRIPT (EL PASO MÁS CRÍTICO)
  echo "🔨 PASO 3/4: Compilando TypeScript..."
  echo "   Esto puede tardar 10-30 segundos..."
  npm run build
  echo "✅ Compilación completada"
  echo ""
  
  # Verificar que dist/ se actualizó
  echo "🔍 Verificando archivos compilados..."
  ORCHESTRATOR_DATE=$(stat -c "%y" dist/ai/orchestrator.js)
  echo "   dist/ai/orchestrator.js: $ORCHESTRATOR_DATE"
  
  # 4. Reiniciar PM2
  echo "🔄 PASO 4/4: Reiniciando PM2..."
  pm2 restart all
  echo "✅ PM2 reiniciado"
  echo ""
  
  # Esperar 5s para que los procesos inicien
  echo "⏳ Esperando 5 segundos..."
  sleep 5
  
  # Mostrar estado de PM2
  echo "📊 Estado de procesos PM2:"
  pm2 list
  echo ""
  
  # Mostrar últimas líneas de logs
  echo "📜 Últimas líneas de logs:"
  pm2 logs --lines 20 --nostream
  echo ""
  
  echo "═══════════════════════════════════════════════════════════════"
  echo "✅ DEPLOY COMPLETADO EN EC2"
  echo "═══════════════════════════════════════════════════════════════"
ENDSSH

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "✅ DEPLOY COMPLETO"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "🎯 PRÓXIMOS PASOS:"
echo ""
echo "1. Validar en al-eon.com que los cambios funcionan"
echo "2. Revisar logs en EC2 si hay errores:"
echo "   ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233"
echo "   cd AL-E-Core && pm2 logs"
echo ""
echo "3. Rollback si es necesario:"
echo "   git revert HEAD"
echo "   ./deploy-correcto.sh"
echo ""
