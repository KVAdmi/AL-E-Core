#!/bin/bash

# 🔍 Script de diagnóstico para problema de memoria AL-E
# Ejecutar en EC2: ./scripts/diagnose-memory.sh

echo "=========================================="
echo "🔍 AL-E CORE: DIAGNÓSTICO DE MEMORIA"
echo "=========================================="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Verificar variables de entorno
echo "1️⃣ Verificando variables de entorno..."
if [ -z "$SUPABASE_URL" ]; then
  echo -e "${RED}❌ SUPABASE_URL no configurada${NC}"
else
  echo -e "${GREEN}✅ SUPABASE_URL: $SUPABASE_URL${NC}"
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo -e "${RED}❌ SUPABASE_SERVICE_ROLE_KEY no configurada${NC}"
else
  echo -e "${GREEN}✅ SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY:0:20}...${NC}"
fi

echo ""

# 2. Verificar que el servicio esté corriendo
echo "2️⃣ Verificando proceso de AL-E Core..."
PM2_STATUS=$(pm2 list | grep "al-e-core" || echo "NOT_FOUND")

if [[ "$PM2_STATUS" == *"online"* ]]; then
  echo -e "${GREEN}✅ AL-E Core está corriendo (PM2)${NC}"
else
  echo -e "${RED}❌ AL-E Core NO está corriendo${NC}"
fi

echo ""

# 3. Verificar logs recientes (últimos 50 líneas)
echo "3️⃣ Verificando logs recientes (últimas 20 líneas)..."
echo "---"
pm2 logs al-e-core --lines 20 --nostream 2>/dev/null || echo "No se pudieron leer logs de PM2"
echo "---"

echo ""

# 4. Test de conectividad a Supabase
echo "4️⃣ Test de conectividad a Supabase..."

# Extraer solo el dominio de SUPABASE_URL
SUPABASE_DOMAIN=$(echo $SUPABASE_URL | sed 's|https\?://||' | sed 's|/.*||')

if [ -n "$SUPABASE_DOMAIN" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$SUPABASE_URL/rest/v1/" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  
  if [ "$HTTP_CODE" == "200" ]; then
    echo -e "${GREEN}✅ Supabase responde correctamente (HTTP $HTTP_CODE)${NC}"
  else
    echo -e "${RED}❌ Supabase error (HTTP $HTTP_CODE)${NC}"
  fi
else
  echo -e "${RED}❌ SUPABASE_URL inválida${NC}"
fi

echo ""

# 5. Verificar tabla ae_sessions
echo "5️⃣ Verificando tabla ae_sessions..."
SESSIONS_COUNT=$(curl -s "$SUPABASE_URL/rest/v1/ae_sessions?select=count" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq -r '.[0].count // 0')

echo "Total de sesiones en BD: $SESSIONS_COUNT"

if [ "$SESSIONS_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✅ ae_sessions tiene registros${NC}"
else
  echo -e "${YELLOW}⚠️ ae_sessions está vacía${NC}"
fi

echo ""

# 6. Verificar tabla ae_messages
echo "6️⃣ Verificando tabla ae_messages..."
MESSAGES_COUNT=$(curl -s "$SUPABASE_URL/rest/v1/ae_messages?select=count" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq -r '.[0].count // 0')

echo "Total de mensajes en BD: $MESSAGES_COUNT"

if [ "$MESSAGES_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✅ ae_messages tiene registros${NC}"
  
  # Mostrar últimos 3 mensajes
  echo ""
  echo "Últimos 3 mensajes guardados:"
  curl -s "$SUPABASE_URL/rest/v1/ae_messages?select=session_id,role,content&order=created_at.desc&limit=3" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    | jq -r '.[] | "- [\(.role)] \(.content[0:60])..."'
else
  echo -e "${YELLOW}⚠️ ae_messages está vacía - NO se están guardando conversaciones${NC}"
fi

echo ""

# 7. Verificar políticas RLS
echo "7️⃣ Verificando políticas RLS (Row Level Security)..."
echo "ℹ️ Si ae_messages tiene datos pero no se recuperan en chat, puede ser un problema de RLS."
echo "   Ejecuta en Supabase SQL Editor:"
echo ""
echo "   -- Verificar políticas de ae_messages"
echo "   SELECT * FROM pg_policies WHERE tablename = 'ae_messages';"
echo ""

# 8. Verificar tabla user_integrations (OAuth)
echo "8️⃣ Verificando integraciones OAuth (Gmail)..."
OAUTH_COUNT=$(curl -s "$SUPABASE_URL/rest/v1/user_integrations?select=count&integration_type=in.(gmail,google,google-gmail)" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  | jq -r '.[0].count // 0')

echo "Usuarios con Gmail conectado: $OAUTH_COUNT"

if [ "$OAUTH_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✅ Hay usuarios con Gmail conectado${NC}"
  
  # Verificar si tienen tokens válidos
  OAUTH_WITH_TOKENS=$(curl -s "$SUPABASE_URL/rest/v1/user_integrations?select=access_token&integration_type=in.(gmail,google,google-gmail)&access_token=not.is.null" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    | jq -r '. | length')
  
  echo "Usuarios con tokens válidos: $OAUTH_WITH_TOKENS"
  
  if [ "$OAUTH_WITH_TOKENS" -lt "$OAUTH_COUNT" ]; then
    echo -e "${YELLOW}⚠️ Algunos usuarios tienen Gmail conectado pero SIN tokens (access_token NULL)${NC}"
  fi
else
  echo -e "${YELLOW}⚠️ No hay usuarios con Gmail conectado${NC}"
fi

echo ""

# 9. Test de endpoint /api/ai/ping
echo "9️⃣ Test de endpoint /api/ai/ping..."
PING_RESPONSE=$(curl -s http://localhost:3000/api/ai/ping)

if [[ "$PING_RESPONSE" == *"AL-E CORE ONLINE"* ]]; then
  echo -e "${GREEN}✅ API responde correctamente${NC}"
  echo "Respuesta: $PING_RESPONSE"
else
  echo -e "${RED}❌ API no responde o está caída${NC}"
fi

echo ""
echo "=========================================="
echo "🎯 DIAGNÓSTICO COMPLETADO"
echo "=========================================="
echo ""
echo "📋 RESUMEN:"
echo "- Si ae_messages está vacía: El backend NO está guardando conversaciones"
echo "- Si ae_messages tiene datos pero NO se recuperan: Problema de RLS en Supabase"
echo "- Si usuarios con Gmail tienen access_token NULL: OAuth está roto"
echo ""
echo "📝 Revisa los logs de PM2:"
echo "   pm2 logs al-e-core --lines 100"
echo ""
