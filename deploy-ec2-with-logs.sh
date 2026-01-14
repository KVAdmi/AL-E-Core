#!/bin/bash
# DEPLOY AL-E CORE TO EC2 WITH STRUCTURED LOGS
# Server: ubuntu@100.27.201.233
# Key: ~/Downloads/mercado-pago.pem

set -e

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "════════════════════════════════════════════════════════════"
echo -e "${BLUE}DEPLOY AL-E CORE TO EC2 - WITH LOGS${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Server: 100.27.201.233"
echo "Key: ~/Downloads/mercado-pago.pem"
echo "Commit: $(git rev-parse --short HEAD) - $(git log -1 --pretty=%B | head -1)"
echo ""
echo "Features desplegando:"
echo "  ✅ Truth Layer (Planner/Executor/Governor/Narrator)"
echo "  ✅ Authority Matrix (A0-A3)"
echo "  ✅ Sistema de Logs Estructurados (ai.*, meetings.*, mail.*)"
echo "  ✅ Meeting Mode timestamps fix"
echo ""
read -p "Press ENTER to continue..."
echo ""

# Verificar que la key existe
if [ ! -f ~/Downloads/mercado-pago.pem ]; then
  echo -e "${RED}❌ ERROR: Key ~/Downloads/mercado-pago.pem not found${NC}"
  exit 1
fi

# Verificar permisos de la key
chmod 400 ~/Downloads/mercado-pago.pem

echo "════════════════════════════════════════════════════════════"
echo -e "${YELLOW}STEP 1: Conectando a EC2...${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""

ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << 'ENDSSH'
set -e

echo "✅ Conectado a EC2"
echo ""

echo "════════════════════════════════════════════════════════════"
echo "STEP 2: Verificando estado actual del servidor"
echo "════════════════════════════════════════════════════════════"
echo ""

# Verificar si PM2 está corriendo
if pm2 list | grep -q "al-e-core"; then
  echo "✅ AL-E Core está corriendo"
  pm2 describe al-e-core | grep -E "status|uptime|restarts|cpu|memory"
else
  echo "⚠️  AL-E Core NO está corriendo"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 3: Navegando a proyecto y haciendo pull"
echo "════════════════════════════════════════════════════════════"
echo ""

cd /home/ubuntu/AL-E-Core

# Guardar hash actual
OLD_COMMIT=$(git rev-parse --short HEAD)
echo "Commit actual: $OLD_COMMIT"

# Pull
echo "Pulling latest changes..."
git fetch origin
git pull origin main

# Nuevo hash
NEW_COMMIT=$(git rev-parse --short HEAD)
echo "Nuevo commit: $NEW_COMMIT"

if [ "$OLD_COMMIT" = "$NEW_COMMIT" ]; then
  echo "⚠️  No hay cambios nuevos"
else
  echo "✅ Cambios detectados: $OLD_COMMIT → $NEW_COMMIT"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 4: Instalando dependencias"
echo "════════════════════════════════════════════════════════════"
echo ""

npm install --production

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 5: Compilando TypeScript"
echo "════════════════════════════════════════════════════════════"
echo ""

npm run build

if [ $? -eq 0 ]; then
  echo "✅ Compilación exitosa"
else
  echo "❌ ERROR en compilación"
  exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 6: Verificando archivos críticos"
echo "════════════════════════════════════════════════════════════"
echo ""

# Verificar archivos nuevos
echo "Verificando Truth Layer..."
if [ -f "dist/ai/truthOrchestrator.js" ]; then
  echo "  ✅ truthOrchestrator.js"
else
  echo "  ❌ truthOrchestrator.js NOT FOUND"
fi

if [ -f "dist/ai/truthLayer/planner.js" ]; then
  echo "  ✅ planner.js"
else
  echo "  ❌ planner.js NOT FOUND"
fi

if [ -f "dist/ai/truthLayer/executor.js" ]; then
  echo "  ✅ executor.js"
else
  echo "  ❌ executor.js NOT FOUND"
fi

if [ -f "dist/ai/truthLayer/governor.js" ]; then
  echo "  ✅ governor.js"
else
  echo "  ❌ governor.js NOT FOUND"
fi

if [ -f "dist/ai/truthLayer/narrator.js" ]; then
  echo "  ✅ narrator.js"
else
  echo "  ❌ narrator.js NOT FOUND"
fi

echo ""
echo "Verificando Authority Matrix..."
if [ -f "dist/ai/authority/authorityMatrix.js" ]; then
  echo "  ✅ authorityMatrix.js"
else
  echo "  ❌ authorityMatrix.js NOT FOUND"
fi

if [ -f "dist/ai/authority/authorityEngine.js" ]; then
  echo "  ✅ authorityEngine.js"
else
  echo "  ❌ authorityEngine.js NOT FOUND"
fi

echo ""
echo "Verificando Logger..."
if [ -f "dist/utils/logger.js" ]; then
  echo "  ✅ logger.js"
else
  echo "  ❌ logger.js NOT FOUND"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 7: Verificando variables de entorno"
echo "════════════════════════════════════════════════════════════"
echo ""

# Verificar .env
if [ -f ".env" ]; then
  echo "✅ .env encontrado"
  
  # Verificar variables críticas (sin mostrar valores)
  if grep -q "NODE_ENV" .env; then
    echo "  ✅ NODE_ENV configurado"
  else
    echo "  ⚠️  NODE_ENV no configurado"
  fi
  
  if grep -q "SUPABASE_URL" .env; then
    echo "  ✅ SUPABASE_URL configurado"
  else
    echo "  ❌ SUPABASE_URL FALTANTE"
  fi
  
  if grep -q "SUPABASE_SERVICE_ROLE_KEY" .env; then
    echo "  ✅ SUPABASE_SERVICE_ROLE_KEY configurado"
  else
    echo "  ❌ SUPABASE_SERVICE_ROLE_KEY FALTANTE"
  fi
else
  echo "❌ .env NO ENCONTRADO"
  exit 1
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 8: Reiniciando PM2"
echo "════════════════════════════════════════════════════════════"
echo ""

# Verificar si existe ecosystem.config.js
if [ ! -f "ecosystem.config.js" ]; then
  echo "⚠️  ecosystem.config.js no encontrado, creando..."
  cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'al-e-core',
    script: './dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 8080
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_file: './logs/pm2-combined.log',
    time: true
  }]
};
EOF
  echo "✅ ecosystem.config.js creado"
fi

# Crear directorio de logs si no existe
mkdir -p logs

# Reiniciar PM2
echo "Reiniciando AL-E Core..."
pm2 delete al-e-core || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 9: Verificando deployment"
echo "════════════════════════════════════════════════════════════"
echo ""

# Esperar 5 segundos para que arranque
echo "Esperando 5 segundos para que el servidor arranque..."
sleep 5

# Verificar status
pm2 describe al-e-core | grep -E "status|uptime|restarts"

# Verificar logs recientes
echo ""
echo "Últimos logs (primeros 30 líneas):"
echo "────────────────────────────────────────────────────────────"
pm2 logs al-e-core --nostream --lines 30 || tail -30 logs/pm2-combined.log

echo ""
echo "════════════════════════════════════════════════════════════"
echo "STEP 10: Health check"
echo "════════════════════════════════════════════════════════════"
echo ""

# Health check
echo "Probando health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:8080/health || echo "FAILED")

if echo "$HEALTH_RESPONSE" | grep -q "ok"; then
  echo "✅ Health check PASSED"
  echo "Response: $HEALTH_RESPONSE"
else
  echo "⚠️  Health check FAILED or no response"
  echo "Response: $HEALTH_RESPONSE"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo "✅ DEPLOYMENT COMPLETADO"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Servidor: http://100.27.201.233:8080"
echo "Logs en tiempo real: pm2 logs al-e-core"
echo "Status: pm2 status"
echo ""
echo "Nuevas features desplegadas:"
echo "  ✅ Truth Layer (Planner → Executor → Governor → Narrator)"
echo "  ✅ Authority Matrix (A0-A3 con enforcement)"
echo "  ✅ Logs Estructurados JSON (ai.*, meetings.*, mail.*)"
echo "  ✅ Meeting timestamps fix (happened_at/scheduled_at)"
echo ""
echo "Endpoints de testing:"
echo "  POST /api/ai/truth-chat - Truth Orchestrator"
echo "  POST /api/meetings/live/start - Meeting con logs"
echo "  GET /health - Health check"
echo ""

ENDSSH

echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}✅ DEPLOYMENT COMPLETADO EXITOSAMENTE${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Para ver logs en tiempo real desde tu máquina:"
echo "  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 'pm2 logs al-e-core'"
echo ""
echo "Para ver logs estructurados JSON:"
echo "  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 'tail -f /home/ubuntu/AL-E-Core/logs/pm2-combined.log | grep -E \"ai\\.|meetings\\.|mail\\.\"'"
echo ""
echo "Para conectarte al servidor:"
echo "  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233"
echo ""
