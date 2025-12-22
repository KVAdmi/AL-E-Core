#!/bin/bash

# 🔍 SCRIPT DE VALIDACIÓN PARA EC2
# Ejecutar en el servidor EC2 para validar deploy

echo "======================================"
echo "🔍 VALIDACIÓN AL-E CORE EN EC2"
echo "======================================"
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

# 1. Verificar directorio PM2
echo "1️⃣  VERIFICANDO DIRECTORIO DE PM2..."
echo "------------------------------------"
PM2_CWD=$(pm2 describe al-e-core 2>/dev/null | grep "cwd" | awk '{print $3}')

if [ -z "$PM2_CWD" ]; then
    echo -e "${RED}❌ ERROR: PM2 process 'al-e-core' no encontrado${NC}"
    echo "Ejecutar: pm2 list"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ PM2 corriendo desde: ${PM2_CWD}${NC}"
    cd "$PM2_CWD" || exit 1
fi
echo ""

# 2. Verificar commit actual
echo "2️⃣  VERIFICANDO COMMIT ACTUAL..."
echo "------------------------------------"
COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
if [ -z "$COMMIT" ]; then
    echo -e "${RED}❌ ERROR: No es un repositorio git${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ Commit actual: ${COMMIT}${NC}"
    git log -1 --oneline
fi
echo ""

# 3. Verificar variables de entorno en PM2
echo "3️⃣  VERIFICANDO VARIABLES DE ENTORNO..."
echo "------------------------------------"

# ALE_ALLOWED_ORIGINS
ORIGINS=$(pm2 env al-e-core 2>/dev/null | grep "ALE_ALLOWED_ORIGINS=" | cut -d '=' -f 2-)
if [ -z "$ORIGINS" ]; then
    echo -e "${RED}❌ ALE_ALLOWED_ORIGINS NO configurado${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ ALE_ALLOWED_ORIGINS configurado${NC}"
    if echo "$ORIGINS" | grep -q "localhost:3001"; then
        echo -e "${GREEN}   ✓ Incluye localhost:3001${NC}"
    else
        echo -e "${RED}   ✗ NO incluye localhost:3001${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    echo "   Orígenes: $ORIGINS"
fi

# SUPABASE_SERVICE_ROLE_KEY
SUPABASE_KEY=$(pm2 env al-e-core 2>/dev/null | grep "SUPABASE_SERVICE_ROLE_KEY=" | cut -d '=' -f 2 | head -c 30)
if [ -z "$SUPABASE_KEY" ]; then
    echo -e "${RED}❌ SUPABASE_SERVICE_ROLE_KEY NO configurado${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_KEY}...${NC}"
fi

# SUPABASE_URL
SUPABASE_URL=$(pm2 env al-e-core 2>/dev/null | grep "SUPABASE_URL=" | cut -d '=' -f 2)
if [ -z "$SUPABASE_URL" ]; then
    echo -e "${RED}❌ SUPABASE_URL NO configurado${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ SUPABASE_URL: ${SUPABASE_URL}${NC}"
fi

echo ""

# 4. Test CORS Preflight (OPTIONS)
echo "4️⃣  PROBANDO CORS PREFLIGHT (OPTIONS)..."
echo "------------------------------------"
PREFLIGHT_RESPONSE=$(curl -i -s -X OPTIONS https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type")

echo "$PREFLIGHT_RESPONSE" | head -15

if echo "$PREFLIGHT_RESPONSE" | grep -qi "access-control-allow-origin.*localhost:3001"; then
    echo -e "${GREEN}✅ CORS Preflight OK${NC}"
else
    echo -e "${RED}❌ CORS Preflight FALLÓ - No permite localhost:3001${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# 5. Test POST con Origin
echo "5️⃣  PROBANDO POST CON ORIGIN..."
echo "------------------------------------"
POST_RESPONSE=$(curl -i -s -X POST https://api.al-entity.com/api/ai/chat \
  -H "Origin: http://localhost:3001" \
  -H "Content-Type: application/json" \
  -d '{"userId":"test-ec2","messages":[{"role":"user","content":"test"}]}')

echo "$POST_RESPONSE" | head -20

if echo "$POST_RESPONSE" | grep -qi "access-control-allow-origin"; then
    echo -e "${GREEN}✅ POST responde con CORS headers${NC}"
else
    echo -e "${RED}❌ POST NO tiene CORS headers${NC}"
    ERRORS=$((ERRORS + 1))
fi

if echo "$POST_RESPONSE" | grep -qi '"answer"'; then
    echo -e "${GREEN}✅ POST devuelve respuesta JSON correcta${NC}"
else
    echo -e "${RED}❌ POST NO devuelve JSON válido${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# 6. Verificar logs recientes
echo "6️⃣  VERIFICANDO LOGS RECIENTES..."
echo "------------------------------------"
LOGS=$(pm2 logs al-e-core --lines 20 --nostream 2>/dev/null)

if echo "$LOGS" | grep -qi "chatRouter.*montado"; then
    echo -e "${GREEN}✅ chatRouter (v2) detectado en logs${NC}"
else
    echo -e "${YELLOW}⚠️  chatRouter (v2) NO detectado - podría ser código viejo${NC}"
fi

if echo "$LOGS" | grep -qi "CORS.*permitidos"; then
    echo -e "${GREEN}✅ Configuración CORS detectada en logs${NC}"
    echo "$LOGS" | grep "CORS" | tail -1
else
    echo -e "${YELLOW}⚠️  No se ve configuración CORS en logs recientes${NC}"
fi
echo ""

# 7. Verificar archivos compilados
echo "7️⃣  VERIFICANDO ARCHIVOS COMPILADOS..."
echo "------------------------------------"
if [ -f "dist/api/chat.js" ]; then
    CHAT_DATE=$(stat -c %y "dist/api/chat.js" 2>/dev/null || stat -f "%Sm" "dist/api/chat.js" 2>/dev/null)
    echo -e "${GREEN}✅ dist/api/chat.js (${CHAT_DATE})${NC}"
else
    echo -e "${RED}❌ dist/api/chat.js NO EXISTE${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [ -f "dist/api/sessions.js" ]; then
    echo -e "${GREEN}✅ dist/api/sessions.js${NC}"
else
    echo -e "${RED}❌ dist/api/sessions.js NO EXISTE${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [ -f "dist/utils/helpers.js" ]; then
    echo -e "${GREEN}✅ dist/utils/helpers.js${NC}"
else
    echo -e "${RED}❌ dist/utils/helpers.js NO EXISTE${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# RESUMEN FINAL
echo "======================================"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ VALIDACIÓN EXITOSA${NC}"
    echo -e "${GREEN}✅ Sistema está correctamente desplegado${NC}"
    echo ""
    echo "✅ Commit actual deployado"
    echo "✅ Variables de entorno configuradas"
    echo "✅ CORS funcionando para localhost:3001"
    echo "✅ Backend responde correctamente"
    exit 0
else
    echo -e "${RED}❌ VALIDACIÓN FALLÓ${NC}"
    echo -e "${RED}Errores encontrados: ${ERRORS}${NC}"
    echo ""
    echo "🔧 PARA CORREGIR, EJECUTAR:"
    echo "   cd $PM2_CWD"
    echo "   git pull origin main"
    echo "   nano .env  # Verificar ALE_ALLOWED_ORIGINS y SUPABASE_SERVICE_ROLE_KEY"
    echo "   npm ci"
    echo "   npm run build"
    echo "   pm2 restart al-e-core"
    echo "   pm2 logs al-e-core --lines 50"
    exit 1
fi
