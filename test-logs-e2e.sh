#!/bin/bash
# TEST-LOGS-E2E.sh - Script de testing para validar logs estructurados

set -e

BASE_URL="${BASE_URL:-http://localhost:8080}"
TOKEN="${SUPABASE_JWT_TOKEN}"

echo "════════════════════════════════════════════════════════════"
echo "TEST E2E - LOGS ESTRUCTURADOS"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Base URL: $BASE_URL"
echo "Token: ${TOKEN:0:20}..."
echo ""

# Colores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# ═══════════════════════════════════════════════════════════════
# TEST 1: TRUTH ORCHESTRATOR - Leer email sin cuentas
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}TEST 1: Truth Orchestrator - Leer emails (sin cuentas)${NC}"
echo "Logs esperados: ai.request.received → ai.intent.detected → ai.authority.resolved → mail.accounts.status → ai.truthgate.verdict (blocked) → ai.response.sent"
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/api/ai/truth-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user_no_accounts",
    "messages": [
      {
        "role": "user",
        "content": "muéstrame mis últimos 5 emails"
      }
    ]
  }')

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

if echo "$RESPONSE" | jq -e '.wasBlocked == true' > /dev/null; then
  echo -e "${GREEN}✅ PASS: Request fue bloqueado correctamente${NC}"
else
  echo -e "${RED}❌ FAIL: Request no fue bloqueado${NC}"
fi

echo ""
echo "────────────────────────────────────────────────────────────"
echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 2: MEETINGS - Live Start
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}TEST 2: Meetings - Live Start${NC}"
echo "Logs esperados: meetings.live.start"
echo ""

HAPPENED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

RESPONSE=$(curl -s -X POST "$BASE_URL/api/meetings/live/start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Test Meeting E2E\",
    \"description\": \"Testing structured logs\",
    \"happened_at\": \"$HAPPENED_AT\"
  }")

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

MEETING_ID=$(echo "$RESPONSE" | jq -r '.meetingId')

if [ "$MEETING_ID" != "null" ] && [ -n "$MEETING_ID" ]; then
  echo -e "${GREEN}✅ PASS: Meeting created: $MEETING_ID${NC}"
else
  echo -e "${RED}❌ FAIL: Meeting not created${NC}"
  exit 1
fi

echo ""
echo "────────────────────────────────────────────────────────────"
echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 3: MEETINGS - Get Result (transcript pending)
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}TEST 3: Meetings - Get Result (transcript pending)${NC}"
echo "Logs esperados: meetings.result.served (status=blocked, reason=transcript_pending)"
echo ""

# Esperar 2 segundos para que el meeting esté en DB
sleep 2

RESPONSE=$(curl -s -X GET "$BASE_URL/api/meetings/$MEETING_ID/result" \
  -H "Authorization: Bearer $TOKEN")

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

if echo "$RESPONSE" | jq -e '.status == "blocked"' > /dev/null; then
  echo -e "${GREEN}✅ PASS: Result bloqueado correctamente (transcript pending)${NC}"
else
  echo -e "${RED}❌ FAIL: Result no fue bloqueado${NC}"
fi

echo ""
echo "────────────────────────────────────────────────────────────"
echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 4: TRUTH ORCHESTRATOR - Confirmación requerida
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}TEST 4: Truth Orchestrator - Send Email (sin confirmación)${NC}"
echo "Logs esperados: ai.authority.resolved (confirmation_required) → ai.truthgate.verdict (blocked)"
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/api/ai/truth-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user",
    "messages": [
      {
        "role": "user",
        "content": "envía un email a test@example.com diciendo hola"
      }
    ]
  }')

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

if echo "$RESPONSE" | jq -e '.wasBlocked == true and .blockReason == "confirmation_required"' > /dev/null; then
  echo -e "${GREEN}✅ PASS: Request bloqueado por falta de confirmación${NC}"
else
  echo -e "${RED}❌ FAIL: Comportamiento inesperado${NC}"
fi

echo ""
echo "────────────────────────────────────────────────────────────"
echo ""

# ═══════════════════════════════════════════════════════════════
# TEST 5: TRUTH ORCHESTRATOR - Web Search (capability test)
# ═══════════════════════════════════════════════════════════════
echo -e "${YELLOW}TEST 5: Truth Orchestrator - Web Search${NC}"
echo "Logs esperados: ai.tools.execute.result (web_search)"
echo ""

RESPONSE=$(curl -s -X POST "$BASE_URL/api/ai/truth-chat" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test_user",
    "messages": [
      {
        "role": "user",
        "content": "busca información sobre TypeScript"
      }
    ]
  }')

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

if echo "$RESPONSE" | jq -e '.wasBlocked == false' > /dev/null; then
  echo -e "${GREEN}✅ PASS: Web search ejecutado${NC}"
else
  echo -e "${YELLOW}⚠️  WARN: Web search bloqueado (verificar capability)${NC}"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo -e "${GREEN}TESTS COMPLETADOS${NC}"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "Para ver los logs estructurados:"
echo "1. Logs del servidor (desarrollo): Buscar eventos JSON en console"
echo "2. Logs en producción: Configurar agregador (CloudWatch, Datadog, etc.)"
echo ""
echo "Eventos críticos para validar:"
echo "  - ai.request.received"
echo "  - ai.intent.detected"
echo "  - ai.authority.resolved"
echo "  - ai.tools.execute.result"
echo "  - ai.truthgate.verdict"
echo "  - ai.response.sent"
echo "  - meetings.live.start"
echo "  - meetings.result.served"
echo ""
