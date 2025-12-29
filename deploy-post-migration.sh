#!/bin/bash

# =====================================================
# DEPLOY SCRIPT - AL-E CORE (POST-MIGRACIÓN P0)
# =====================================================
# Script para ejecutar deployment completo en EC2
# Incluye: migraciones DB, env check, build, restart
# =====================================================

set -e  # Exit on error

echo "🚀 INICIANDO DEPLOY POST-MIGRACIÓN P0..."
echo ""

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# =====================================================
# 1. PRE-FLIGHT CHECKS
# =====================================================

echo -e "${BLUE}1️⃣  PRE-FLIGHT CHECKS${NC}"
echo ""

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo -e "${RED}✗ Error: No se encuentra package.json${NC}"
    echo "Ejecuta este script desde el directorio raíz del proyecto"
    exit 1
fi

# Verificar .env
if [ ! -f ".env" ]; then
    echo -e "${RED}✗ Error: Archivo .env no existe${NC}"
    exit 1
fi

# Verificar ENCRYPTION_KEY
if ! grep -q "ENCRYPTION_KEY=" .env; then
    echo -e "${RED}✗ Error: ENCRYPTION_KEY no encontrada en .env${NC}"
    echo ""
    echo "Genera una con:"
    echo "node -e \"console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))\""
    echo ""
    echo "Y agrégala a .env"
    exit 1
fi

echo -e "${GREEN}✓ .env existe y tiene ENCRYPTION_KEY${NC}"

# Verificar archivos de migración
MIGRATIONS=(
    "migrations/011_email_system.sql"
    "migrations/012_calendar_internal.sql"
    "migrations/013_telegram_bots.sql"
)

for migration in "${MIGRATIONS[@]}"; do
    if [ ! -f "$migration" ]; then
        echo -e "${RED}✗ Error: $migration no existe${NC}"
        exit 1
    fi
done

echo -e "${GREEN}✓ Migraciones SQL presentes${NC}"

# Verificar Node y npm
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Error: Node.js no instalado${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ Error: npm no instalado${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js y npm instalados${NC}"
echo ""

# =====================================================
# 2. DEPENDENCIES
# =====================================================

echo -e "${BLUE}2️⃣  INSTALANDO DEPENDENCIAS${NC}"
echo ""

npm install

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Dependencias instaladas${NC}"
else
    echo -e "${RED}✗ Error instalando dependencias${NC}"
    exit 1
fi

echo ""

# =====================================================
# 3. BUILD
# =====================================================

echo -e "${BLUE}3️⃣  COMPILANDO TYPESCRIPT${NC}"
echo ""

npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Compilación exitosa${NC}"
else
    echo -e "${RED}✗ Error en compilación${NC}"
    exit 1
fi

echo ""

# =====================================================
# 4. MIGRACIONES DB
# =====================================================

echo -e "${BLUE}4️⃣  MIGRACIONES DE BASE DE DATOS${NC}"
echo ""

# Verificar si psql está disponible
if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}⚠️  psql no instalado - Migraciones DB deben ejecutarse manualmente${NC}"
    echo ""
    echo "Opciones:"
    echo "1. Instalar PostgreSQL client: brew install postgresql (macOS)"
    echo "2. Ejecutar desde Supabase SQL Editor (RECOMENDADO)"
    echo ""
    echo "Copiar y pegar en orden:"
    echo "  - migrations/011_email_system.sql"
    echo "  - migrations/012_calendar_internal.sql"
    echo "  - migrations/013_telegram_bots.sql"
    echo ""
    
    read -p "¿Ya ejecutaste las migraciones en Supabase? (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        echo -e "${RED}✗ Ejecuta las migraciones antes de continuar${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✓ Migraciones confirmadas por usuario${NC}"
else
    # Si psql está disponible, intentar ejecutar migraciones
    if [ -n "$DATABASE_URL" ]; then
        echo "Ejecutando migraciones..."
        
        for migration in "${MIGRATIONS[@]}"; do
            echo "  - $(basename $migration)"
            psql "$DATABASE_URL" -f "$migration" > /dev/null 2>&1
            
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}    ✓ $(basename $migration)${NC}"
            else
                echo -e "${YELLOW}    ⚠️  $(basename $migration) (puede ya existir)${NC}"
            fi
        done
        
        echo -e "${GREEN}✓ Migraciones ejecutadas${NC}"
    else
        echo -e "${YELLOW}⚠️  DATABASE_URL no definida - usar Supabase SQL Editor${NC}"
    fi
fi

echo ""

# =====================================================
# 5. PM2 RESTART
# =====================================================

echo -e "${BLUE}5️⃣  REINICIANDO SERVICIO${NC}"
echo ""

if command -v pm2 &> /dev/null; then
    # Verificar si el proceso existe
    if pm2 list | grep -q "al-e-core"; then
        echo "Reiniciando al-e-core..."
        pm2 restart al-e-core
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Servicio reiniciado${NC}"
        else
            echo -e "${RED}✗ Error reiniciando servicio${NC}"
            exit 1
        fi
    else
        echo "Iniciando al-e-core por primera vez..."
        pm2 start dist/index.js --name al-e-core
        pm2 save
        
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✓ Servicio iniciado${NC}"
        else
            echo -e "${RED}✗ Error iniciando servicio${NC}"
            exit 1
        fi
    fi
else
    echo -e "${YELLOW}⚠️  PM2 no instalado - inicia manualmente con: node dist/index.js${NC}"
fi

echo ""

# =====================================================
# 6. HEALTH CHECK
# =====================================================

echo -e "${BLUE}6️⃣  VERIFICACIÓN DE SALUD${NC}"
echo ""

# Esperar 3 segundos para que el servicio inicie
sleep 3

# Verificar puerto (ajustar según tu configuración)
PORT=${PORT:-4000}

if curl -s http://localhost:$PORT/health > /dev/null; then
    echo -e "${GREEN}✓ Servicio respondiendo en puerto $PORT${NC}"
    
    # Verificar health completo
    echo ""
    echo "Verificando /_health/full..."
    curl -s http://localhost:$PORT/_health/full | jq '.' 2>/dev/null || curl -s http://localhost:$PORT/_health/full
    
else
    echo -e "${RED}✗ Servicio no responde en puerto $PORT${NC}"
    echo ""
    echo "Verifica logs con: pm2 logs al-e-core"
    exit 1
fi

echo ""

# =====================================================
# 7. SUMMARY
# =====================================================

echo ""
echo "================================"
echo -e "${GREEN}✅ DEPLOY COMPLETADO${NC}"
echo "================================"
echo ""
echo "Servicios activos:"
echo "  - API: http://localhost:$PORT"
echo "  - Health: http://localhost:$PORT/_health/full"
echo ""
echo "Nuevos endpoints disponibles:"
echo "  - POST /api/email/accounts"
echo "  - POST /api/mail/send"
echo "  - POST /api/calendar/events"
echo "  - POST /api/telegram/bots/connect"
echo "  - POST /api/telegram/webhook/:botId/:secret"
echo ""
echo "Próximos pasos:"
echo "  1. Verificar /_health/full en producción"
echo "  2. Test manual con cuenta SMTP real"
echo "  3. Conectar bot de Telegram"
echo "  4. Validar notificaciones"
echo ""
echo "Logs en tiempo real:"
echo "  pm2 logs al-e-core"
echo ""
echo -e "${GREEN}🚀 AL-E CORE READY${NC}"
echo ""
