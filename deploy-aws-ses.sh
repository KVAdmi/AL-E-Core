#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# DEPLOY AWS SES TO EC2
# Habilita envío de emails con AWS SES
# ═══════════════════════════════════════════════════════════════

echo "🚀 Deploying AWS SES configuration to EC2..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# EC2 Connection
EC2_USER="ubuntu"
EC2_HOST="100.27.201.233"
EC2_KEY="~/Downloads/mercado-pago.pem"
EC2_PATH="/home/ubuntu/AL-E-Core"

echo "📋 INSTRUCCIONES:"
echo "1. Este script actualizará el código en EC2"
echo "2. Luego DEBERÁS agregar manualmente las credenciales de AWS SES al .env del servidor"
echo "3. Finalmente reiniciará el servidor con las nuevas capacidades"
echo ""
read -p "¿Continuar? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelado."
    exit 1
fi

# Step 1: Pull código actualizado
echo -e "${YELLOW}📥 Step 1/4: Pulling latest code...${NC}"
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "cd $EC2_PATH && git pull origin main"
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Git pull failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Code updated${NC}"
echo ""

# Step 2: Build
echo -e "${YELLOW}🔨 Step 2/4: Building...${NC}"
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "cd $EC2_PATH && npm run build"
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build successful${NC}"
echo ""

# Step 3: Agregar credenciales AWS SES
echo -e "${YELLOW}📝 Step 3/4: Adding AWS SES credentials to .env${NC}"
echo ""
echo -e "${RED}⚠️  ACCIÓN REQUERIDA:${NC}"
echo "Conecta a EC2 y edita el archivo .env:"
echo ""
echo "  ssh -i $EC2_KEY $EC2_USER@$EC2_HOST"
echo "  cd $EC2_PATH"
echo "  nano .env"
echo ""
echo "Agrega estas líneas al final del archivo .env:"
echo ""
echo "# === AWS SES SMTP (us-east-1) ==="
echo "SMTP_PROVIDER=aws_ses"
echo "SMTP_HOST=email-smtp.us-east-1.amazonaws.com"
echo "SMTP_PORT=587"
echo "SMTP_SECURE=false"
echo "SMTP_USER=[TU_SMTP_USERNAME]"
echo "SMTP_PASS=[TU_SMTP_PASSWORD]"
echo "EMAIL_FROM_DEFAULT=notificaciones@al-eon.com"
echo "EMAIL_FROM_NAME=AL-E"
echo ""
echo "Guarda (Ctrl+O) y sal (Ctrl+X)"
echo ""
read -p "¿Ya agregaste las credenciales en el .env del servidor? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}❌ Deployment incompleto. Agrega las credenciales y vuelve a ejecutar el script.${NC}"
    exit 1
fi

# Step 4: Restart PM2
echo -e "${YELLOW}🔄 Step 4/4: Restarting server...${NC}"
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "cd $EC2_PATH && pm2 restart al-e-core --update-env"
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ PM2 restart failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Server restarted${NC}"
echo ""

# Show logs
echo -e "${YELLOW}📊 Showing recent logs...${NC}"
echo ""
ssh -i $EC2_KEY $EC2_USER@$EC2_HOST "pm2 logs al-e-core --lines 30 --nostream"

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ AWS SES DEPLOYMENT COMPLETED${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📋 Verification:"
echo "1. Test email sending via frontend"
echo "2. Check logs: pm2 logs al-e-core | grep MAIL"
echo "3. Verify runtime-capabilities.json shows mail.send: true"
echo ""
echo "🧪 Test command:"
echo "  curl -X POST https://api.al-eon.com/api/runtime-capabilities | jq '.capabilities.\"mail.send\"'"
echo ""
