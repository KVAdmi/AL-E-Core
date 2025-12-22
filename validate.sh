#!/bin/bash

# 🔍 VALIDACIÓN COMPLETA DE AL-E CORE
# Este script verifica que todo esté listo para deploy

echo "======================================"
echo "🔍 VALIDACIÓN AL-E CORE"
echo "======================================"
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# 1. Variables de entorno
echo "📋 1. VALIDANDO VARIABLES DE ENTORNO..."
if [ ! -f .env ]; then
    echo -e "${RED}❌ ERROR: .env no existe${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ .env existe${NC}"
    
    # Verificar variables críticas
    for VAR in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY OPENAI_API_KEY ALE_ALLOWED_ORIGINS; do
        if grep -q "^${VAR}=" .env; then
            VALUE=$(grep "^${VAR}=" .env | cut -d '=' -f 2 | head -c 30)
            echo -e "${GREEN}✅ ${VAR}${NC}: ${VALUE}..."
        else
            echo -e "${RED}❌ FALTA: ${VAR}${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    done
fi
echo ""

# 2. Dependencias
echo "📦 2. VALIDANDO DEPENDENCIAS..."
if [ ! -d node_modules ]; then
    echo -e "${RED}❌ ERROR: node_modules no existe. Ejecuta: npm install${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ node_modules existe${NC}"
    
    # Verificar paquetes críticos
    for PKG in express "@supabase/supabase-js" openai uuid; do
        if [ -d "node_modules/${PKG}" ] || [ -d "node_modules/@supabase" ]; then
            echo -e "${GREEN}✅ ${PKG}${NC}"
        else
            echo -e "${YELLOW}⚠️  ${PKG} podría no estar instalado${NC}"
        fi
    done
fi
echo ""

# 3. Compilación TypeScript
echo "🔨 3. VALIDANDO COMPILACIÓN..."
if npm run build > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Compilación TypeScript exitosa${NC}"
else
    echo -e "${RED}❌ ERROR: Compilación TypeScript falló${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [ ! -d dist ]; then
    echo -e "${RED}❌ ERROR: dist/ no existe${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ dist/ existe${NC}"
    
    # Verificar archivos críticos
    for FILE in dist/index.js dist/api/chat.js dist/api/sessions.js dist/config/env.js dist/utils/helpers.js; do
        if [ -f "$FILE" ]; then
            echo -e "${GREEN}✅ ${FILE}${NC}"
        else
            echo -e "${RED}❌ FALTA: ${FILE}${NC}"
            ERRORS=$((ERRORS + 1))
        fi
    done
fi
echo ""

# 4. Archivos de configuración
echo "⚙️  4. VALIDANDO CONFIGURACIÓN..."
for FILE in package.json tsconfig.json; do
    if [ -f "$FILE" ]; then
        echo -e "${GREEN}✅ ${FILE}${NC}"
    else
        echo -e "${RED}❌ FALTA: ${FILE}${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo ""

# 5. Estructura de carpetas
echo "📁 5. VALIDANDO ESTRUCTURA..."
for DIR in src src/api src/config src/utils src/db; do
    if [ -d "$DIR" ]; then
        echo -e "${GREEN}✅ ${DIR}/${NC}"
    else
        echo -e "${RED}❌ FALTA: ${DIR}/${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo ""

# 6. Archivos fuente críticos
echo "📄 6. VALIDANDO ARCHIVOS FUENTE..."
for FILE in src/index.ts src/api/chat.ts src/api/sessions.ts src/config/env.ts src/utils/helpers.ts src/db/supabase.ts; do
    if [ -f "$FILE" ]; then
        echo -e "${GREEN}✅ ${FILE}${NC}"
    else
        echo -e "${RED}❌ FALTA: ${FILE}${NC}"
        ERRORS=$((ERRORS + 1))
    fi
done
echo ""

# 7. CORS Origins
echo "🌐 7. VALIDANDO CORS..."
ORIGINS=$(grep "^ALE_ALLOWED_ORIGINS=" .env | cut -d '=' -f 2)
if [ -z "$ORIGINS" ]; then
    echo -e "${RED}❌ ALE_ALLOWED_ORIGINS está vacío${NC}"
    ERRORS=$((ERRORS + 1))
else
    echo -e "${GREEN}✅ CORS configurado:${NC}"
    IFS=',' read -ra ORIGIN_ARRAY <<< "$ORIGINS"
    for ORIGIN in "${ORIGIN_ARRAY[@]}"; do
        echo "   - $ORIGIN"
    done
fi
echo ""

# 8. Puerto
echo "🔌 8. VALIDANDO PUERTO..."
PORT=$(grep "^PORT=" .env | cut -d '=' -f 2 | head -1)
if [ -z "$PORT" ]; then
    echo -e "${YELLOW}⚠️  PORT no definido, usará default (3000)${NC}"
else
    echo -e "${GREEN}✅ Puerto configurado: ${PORT}${NC}"
fi
echo ""

# 9. Documentación
echo "📚 9. VALIDANDO DOCUMENTACIÓN..."
for FILE in INTEGRACION-ALEON.md TESTING-SUPABASE.md IMPLEMENTACION-COMPLETADA.md; do
    if [ -f "$FILE" ]; then
        echo -e "${GREEN}✅ ${FILE}${NC}"
    else
        echo -e "${YELLOW}⚠️  Falta: ${FILE}${NC}"
    fi
done
echo ""

# RESUMEN FINAL
echo "======================================"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ VALIDACIÓN EXITOSA${NC}"
    echo -e "${GREEN}✅ Sistema listo para deploy${NC}"
    echo ""
    echo "📋 PRÓXIMOS PASOS:"
    echo "1. git add ."
    echo "2. git commit -m 'feat: guardado garantizado en Supabase'"
    echo "3. git push origin main"
    echo "4. En EC2:"
    echo "   - git pull"
    echo "   - npm install"
    echo "   - npm run build"
    echo "   - pm2 restart al-e-core"
    echo "5. Verificar logs: pm2 logs al-e-core"
    exit 0
else
    echo -e "${RED}❌ VALIDACIÓN FALLÓ${NC}"
    echo -e "${RED}Errores encontrados: ${ERRORS}${NC}"
    echo ""
    echo "Por favor corrige los errores antes de deploy."
    exit 1
fi
