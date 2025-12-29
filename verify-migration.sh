#!/bin/bash

# =====================================================
# VERIFICACIÓN POST-MIGRACIÓN - AL-E CORE
# =====================================================
# Script para verificar que la migración está completa
# =====================================================

echo "🔍 Verificando migración P0..."
echo ""

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar que archivos de Google fueron eliminados
echo "1️⃣  Verificando eliminación de Google..."
if [ ! -f "src/api/oauth.ts" ] && [ ! -f "src/services/gmailService.ts" ] && [ ! -f "src/services/calendarService.ts" ]; then
    echo -e "${GREEN}✓ Archivos de Google eliminados${NC}"
else
    echo -e "${RED}✗ FALLO: Archivos de Google aún existen${NC}"
    exit 1
fi

# Verificar que nuevos archivos existen
echo ""
echo "2️⃣  Verificando nuevos archivos..."

FILES=(
    "migrations/011_email_system.sql"
    "migrations/012_calendar_internal.sql"
    "migrations/013_telegram_bots.sql"
    "src/utils/encryption.ts"
    "src/api/email.ts"
    "src/api/mail.ts"
    "src/api/calendar.ts"
    "src/api/telegram.ts"
    "src/workers/notificationWorker.ts"
)

ALL_EXIST=true
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}✓ $file${NC}"
    else
        echo -e "${RED}✗ $file FALTA${NC}"
        ALL_EXIST=false
    fi
done

if [ "$ALL_EXIST" = false ]; then
    echo -e "${RED}✗ FALLO: Algunos archivos no existen${NC}"
    exit 1
fi

# Verificar compilación
echo ""
echo "3️⃣  Verificando compilación TypeScript..."
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Compilación exitosa${NC}"
else
    echo -e "${RED}✗ FALLO: Error de compilación${NC}"
    exit 1
fi

# Verificar package.json (dependencias)
echo ""
echo "4️⃣  Verificando dependencias..."
if grep -q "nodemailer" package.json && grep -q "node-telegram-bot-api" package.json; then
    echo -e "${GREEN}✓ Dependencias instaladas${NC}"
else
    echo -e "${RED}✗ FALLO: Faltan dependencias${NC}"
    exit 1
fi

# Verificar ENCRYPTION_KEY en .env
echo ""
echo "5️⃣  Verificando .env..."
if [ -f ".env" ]; then
    if grep -q "ENCRYPTION_KEY=" .env; then
        echo -e "${GREEN}✓ ENCRYPTION_KEY presente en .env${NC}"
    else
        echo -e "${YELLOW}⚠️  ENCRYPTION_KEY no encontrada en .env${NC}"
        echo "   Genera una con:"
        echo "   node -e \"console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))\""
    fi
    
    # Verificar feature flags
    if grep -q "ENABLE_GOOGLE=false" .env; then
        echo -e "${GREEN}✓ ENABLE_GOOGLE=false configurado${NC}"
    else
        echo -e "${YELLOW}⚠️  Agrega ENABLE_GOOGLE=false a .env${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Archivo .env no existe${NC}"
fi

# Summary
echo ""
echo "================================"
echo -e "${GREEN}✅ MIGRACIÓN P0 VERIFICADA${NC}"
echo "================================"
echo ""
echo "Próximos pasos:"
echo "1. Ejecutar migraciones en Supabase"
echo "2. Agregar ENCRYPTION_KEY a .env (si no existe)"
echo "3. Deploy a producción"
echo "4. Verificar /_health/full"
echo ""
