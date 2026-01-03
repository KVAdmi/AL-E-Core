#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# P0 VALIDATION TEST - AWS SES MAIL.SEND
# NO NEGOCIABLE: Debe pasar TODOS los criterios
# ═══════════════════════════════════════════════════════════════

echo "🧪 P0 VALIDATION TEST - AWS SES"
echo "══════════════════════════════════════════════════════════════="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_URL="https://api.al-eon.com/api/mail/send"
# Reemplaza con tu JWT token real:
TOKEN="YOUR_JWT_TOKEN_HERE"

# Test email data
TO_EMAIL="tu-email@gmail.com"  # ⚠️ REEMPLAZA CON TU EMAIL REAL
SUBJECT="Prueba SES AL-E - P0 Validation"
BODY="Correo de prueba – evidencia técnica\n\nTimestamp: $(date '+%Y-%m-%d %H:%M:%S')\nTest ID: P0-$(date +%s)"

echo -e "${BLUE}📧 Datos del test:${NC}"
echo "  URL: $API_URL"
echo "  To: $TO_EMAIL"
echo "  Subject: $SUBJECT"
echo ""

# Verificar que se configuró el email
if [ "$TO_EMAIL" == "tu-email@gmail.com" ]; then
    echo -e "${RED}❌ ERROR: Debes configurar TO_EMAIL con tu email real${NC}"
    echo ""
    echo "Edita el script y reemplaza:"
    echo "  TO_EMAIL=\"tu-email@gmail.com\""
    echo "Con tu email real"
    exit 1
fi

# Verificar que se configuró el token
if [ "$TOKEN" == "YOUR_JWT_TOKEN_HERE" ]; then
    echo -e "${RED}❌ ERROR: Debes configurar TOKEN con tu JWT real${NC}"
    echo ""
    echo "Obtén tu token desde el frontend y reemplaza:"
    echo "  TOKEN=\"YOUR_JWT_TOKEN_HERE\""
    exit 1
fi

echo -e "${YELLOW}🚀 Enviando correo de prueba...${NC}"
echo ""

# Enviar email
RESPONSE=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"to\": \"$TO_EMAIL\",
    \"subject\": \"$SUBJECT\",
    \"body\": \"$BODY\"
  }")

echo -e "${BLUE}📥 Respuesta del servidor:${NC}"
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
echo ""

# Extraer valores de la respuesta
SUCCESS=$(echo "$RESPONSE" | grep -o '"success":\s*true' | wc -l)
MESSAGE_ID=$(echo "$RESPONSE" | grep -o '"provider_message_id":\s*"[^"]*"' | cut -d'"' -f4)
AUDIT_ID=$(echo "$RESPONSE" | grep -o '"id":\s*"[^"]*"' | cut -d'"' -f4)

echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}📊 CRITERIOS P0 (NO NEGOCIABLES):${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Criterion 1: success=true
if [ "$SUCCESS" -eq 1 ]; then
    echo -e "✅ 1. Endpoint responde success=true"
else
    echo -e "${RED}❌ 1. Endpoint NO respondió success=true${NC}"
fi

# Criterion 2: provider_message_id presente
if [ ! -z "$MESSAGE_ID" ]; then
    echo -e "✅ 2. provider_message_id presente: $MESSAGE_ID"
else
    echo -e "${RED}❌ 2. provider_message_id NO presente${NC}"
fi

# Criterion 3: Audit log ID presente
if [ ! -z "$AUDIT_ID" ]; then
    echo -e "✅ 3. Registro en DB (audit_id): $AUDIT_ID"
else
    echo -e "${RED}❌ 3. NO hay evidencia de registro en DB${NC}"
fi

echo ""
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}📋 PASOS MANUALES REQUERIDOS:${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "✅ 4. VERIFICA EN TU INBOX:"
echo "     - Abre tu correo ($TO_EMAIL)"
echo "     - Busca el correo con subject: \"$SUBJECT\""
echo "     - Revisa Inbox, Promociones, Spam"
echo ""
echo "✅ 5. VERIFICA EN SUPABASE:"
echo "     - Tabla: email_audit_log"
echo "     - Busca ID: $AUDIT_ID"
echo "     - Verifica campos:"
echo "       * to = $TO_EMAIL"
echo "       * from = notificaciones@al-eon.com"
echo "       * provider = aws_ses"
echo "       * provider_message_id = $MESSAGE_ID"
echo "       * status = sent"
echo ""

# Final verdict
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
if [ "$SUCCESS" -eq 1 ] && [ ! -z "$MESSAGE_ID" ] && [ ! -z "$AUDIT_ID" ]; then
    echo -e "${GREEN}🎉 TEST AUTOMATIZADO: PASSED${NC}"
    echo -e "${GREEN}✅ Backend cumple con criterios P0${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  VALIDACIÓN FINAL (Manual):${NC}"
    echo "  - Verifica que el correo llegó a tu inbox"
    echo "  - Verifica registro en Supabase email_audit_log"
    echo "  - Si ambos están ✅ → mail.send OFICIALMENTE LIVE"
else
    echo -e "${RED}❌ TEST AUTOMATIZADO: FAILED${NC}"
    echo -e "${RED}Backend NO cumple con criterios P0${NC}"
    echo ""
    echo "NO AVANZAR hasta que todos los criterios estén ✅"
fi
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""
