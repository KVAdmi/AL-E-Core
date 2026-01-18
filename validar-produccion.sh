#!/bin/bash
# ============================================
# SCRIPT DE VALIDACIÓN DE PRODUCCIÓN
# ============================================
# Conecta a EC2 y obtiene evidencia dura del estado real
# Uso: bash validar-produccion.sh

echo "=================================="
echo "🔍 VALIDACIÓN DE PRODUCCIÓN AL-E"
echo "=================================="
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SSH_KEY="$HOME/Downloads/mercado-pago.pem"
SSH_HOST="ubuntu@100.27.201.233"
REPO_PATH="/home/ubuntu/AL-E-Core"

echo "1️⃣ VALIDANDO COMMIT DEPLOYADO..."
echo "-----------------------------------"
ssh -i "$SSH_KEY" "$SSH_HOST" "cd $REPO_PATH && git log -1 --format='Hash: %H%nFecha: %ai%nMensaje: %s'"
echo ""

echo "2️⃣ VALIDANDO PROCESO PM2..."
echo "-----------------------------------"
ssh -i "$SSH_KEY" "$SSH_HOST" "pm2 describe al-e-core | grep -E 'name|script|cwd|status|uptime|restarts'"
echo ""

echo "3️⃣ VALIDANDO VARIABLES DE ENTORNO CRÍTICAS..."
echo "-----------------------------------"
ssh -i "$SSH_KEY" "$SSH_HOST" "cd $REPO_PATH && cat .env | grep -E 'GROQ_API_KEY|SUPABASE_URL|OPENAI_ROLE|NODE_ENV' | sed 's/=.*/=***HIDDEN***/'"
echo ""

echo "4️⃣ OBTENIENDO LOGS RECIENTES (últimos 100)..."
echo "-----------------------------------"
ssh -i "$SSH_KEY" "$SSH_HOST" "pm2 logs al-e-core --lines 100 --nostream" > /tmp/ale-logs-$(date +%Y%m%d-%H%M%S).txt
echo -e "${GREEN}✓ Logs guardados en /tmp/ale-logs-*.txt${NC}"
echo ""

echo "5️⃣ BUSCANDO REQUESTS REALES EN LOGS..."
echo "-----------------------------------"
echo "Buscando [CHAT] o [TRUTH CHAT] o [SIMPLE ORCH]..."
ssh -i "$SSH_KEY" "$SSH_HOST" "pm2 logs al-e-core --lines 200 --nostream | grep -E '\[CHAT\]|\[TRUTH CHAT\]|\[SIMPLE ORCH\]' | tail -20"
echo ""

echo "6️⃣ VALIDANDO ENDPOINTS ACTIVOS..."
echo "-----------------------------------"
echo "Buscando POST requests a /api/ai/chat..."
ssh -i "$SSH_KEY" "$SSH_HOST" "pm2 logs al-e-core --lines 200 --nostream | grep -E 'POST.*/(api/ai|chat)' | tail -10"
echo ""

echo "7️⃣ VERIFICANDO ERRORES RECIENTES..."
echo "-----------------------------------"
ssh -i "$SSH_KEY" "$SSH_HOST" "pm2 logs al-e-core --lines 100 --nostream --err | tail -20"
echo ""

echo "=================================="
echo "✅ VALIDACIÓN COMPLETADA"
echo "=================================="
echo ""
echo "📊 RESUMEN:"
echo "- Commit hash: Ver sección 1"
echo "- PM2 status: Ver sección 2"
echo "- Logs completos: /tmp/ale-logs-*.txt"
echo ""
echo "🔧 PRÓXIMOS PASOS:"
echo "1. Revisar commit hash vs local (git log -1)"
echo "2. Verificar que PM2 status = 'online'"
echo "3. Buscar errores en sección 7"
echo "4. Confirmar qué endpoint maneja requests (sección 5-6)"
echo ""
