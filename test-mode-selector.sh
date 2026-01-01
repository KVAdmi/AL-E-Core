#!/bin/bash

# ═══════════════════════════════════════════════════════════════
# TEST MODE SELECTOR - Validar 3 modos en producción
# ═══════════════════════════════════════════════════════════════

API_URL="https://api.al-eon.com/api/ai/chat"
# Reemplaza con tu token JWT real:
TOKEN="YOUR_JWT_TOKEN_HERE"

echo "🧪 Testing MODE SELECTOR in production..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test 1: MODE_A - KNOWLEDGE_GENERAL (receta)
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 1: MODE_A - KNOWLEDGE_GENERAL${NC}"
echo -e "${BLUE}Query: 'Dame una receta de galletas de chocolate'${NC}"
echo -e "${BLUE}Expected: Mode=KNOWLEDGE_GENERAL, tools=none${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Dame una receta de galletas de chocolate"
      }
    ]
  }' | jq '.context | {mode: .responseMode, toolUsed: .toolUsed, reasoning: .modeClassification.reasoning}'

echo ""
echo ""

# Test 2: MODE_B - RESEARCH_RECENT (noticias)
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 2: MODE_B - RESEARCH_RECENT${NC}"
echo -e "${BLUE}Query: 'últimas noticias sobre inteligencia artificial'${NC}"
echo -e "${BLUE}Expected: Mode=RESEARCH_RECENT, tools=web_search${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "últimas noticias sobre inteligencia artificial"
      }
    ]
  }' | jq '.context | {mode: .responseMode, toolUsed: .toolUsed, webResults: .webResultsCount, reasoning: .modeClassification.reasoning}'

echo ""
echo ""

# Test 3: MODE_C - CRITICAL_DATA_OR_ACTION (agenda)
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}TEST 3: MODE_C - CRITICAL_DATA_OR_ACTION${NC}"
echo -e "${BLUE}Query: 'agenda una reunión mañana a las 10am'${NC}"
echo -e "${BLUE}Expected: Mode=CRITICAL_DATA_OR_ACTION, tools=calendar, evidenceRequired=true${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

curl -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "agenda una reunión mañana a las 10am"
      }
    ]
  }' | jq '.context | {mode: .responseMode, toolUsed: .toolUsed, evidenceRequired: .modeClassification.evidenceRequired, reasoning: .modeClassification.reasoning}'

echo ""
echo ""

echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ MODE SELECTOR TESTS COMPLETED${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo ""
echo "📊 Monitor live logs on EC2:"
echo "  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233"
echo "  pm2 logs al-e-core | grep 'STEP 4.6'"
echo ""
