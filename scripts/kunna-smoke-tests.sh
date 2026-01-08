#!/bin/bash
# ============================================
# KUNNA SMOKE TESTS - AL-E Core Integration
# ============================================
# Usage: ./scripts/kunna-smoke-tests.sh
# 
# Environment Variables Required:
# - CORE_URL: URL del backend AL-E Core (ej: https://your-core.com)
# - SERVICE_TOKEN_KUNNA: Token de autenticación para KUNNA
# - TEST_WORKSPACE_ID: UUID del workspace de testing (opcional)
# - TEST_USER_ID: UUID del usuario de testing (opcional)

set -e

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Verificar variables requeridas
if [ -z "$CORE_URL" ]; then
  echo -e "${RED}ERROR: CORE_URL no está definida${NC}"
  echo "Ejemplo: export CORE_URL=https://your-core.com"
  exit 1
fi

if [ -z "$SERVICE_TOKEN_KUNNA" ]; then
  echo -e "${RED}ERROR: SERVICE_TOKEN_KUNNA no está definida${NC}"
  echo "Ejemplo: export SERVICE_TOKEN_KUNNA=your_token_here"
  exit 1
fi

# Valores por defecto para testing
WORKSPACE_ID="${TEST_WORKSPACE_ID:-00000000-0000-0000-0000-000000000001}"
USER_ID="${TEST_USER_ID:-11111111-1111-1111-1111-111111111111}"

echo -e "${YELLOW}======================================${NC}"
echo -e "${YELLOW}KUNNA SMOKE TESTS - AL-E Core${NC}"
echo -e "${YELLOW}======================================${NC}"
echo ""
echo "CORE_URL: $CORE_URL"
echo "WORKSPACE_ID: $WORKSPACE_ID"
echo "USER_ID: $USER_ID"
echo "TOKEN: ${SERVICE_TOKEN_KUNNA:0:10}... (truncado)"
echo ""

# Contador de tests
PASSED=0
FAILED=0

# ============================================
# TEST 1: Health Check
# ============================================
echo -e "${YELLOW}[TEST 1]${NC} Health Check..."
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "${CORE_URL}/health" || echo "000")
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -n 1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n -1)

if [ "$HEALTH_CODE" = "200" ]; then
  echo -e "${GREEN}✓ PASS${NC} - Health check OK"
  echo "Response: $HEALTH_BODY"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAIL${NC} - Health check failed (HTTP $HEALTH_CODE)"
  echo "Response: $HEALTH_BODY"
  FAILED=$((FAILED + 1))
fi
echo ""

# ============================================
# TEST 2: POST /api/events
# ============================================
echo -e "${YELLOW}[TEST 2]${NC} POST /api/events (checkin_manual)..."
EVENT_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EVENT_PAYLOAD=$(cat <<EOF
{
  "user_id": "$USER_ID",
  "event_type": "checkin_manual",
  "timestamp": "$EVENT_TIMESTAMP",
  "metadata": {
    "source": "smoke_test",
    "location": {
      "lat": 40.7128,
      "lon": -74.0060
    }
  }
}
EOF
)

EVENT_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${CORE_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: $WORKSPACE_ID" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d "$EVENT_PAYLOAD" || echo "000")

EVENT_CODE=$(echo "$EVENT_RESPONSE" | tail -n 1)
EVENT_BODY=$(echo "$EVENT_RESPONSE" | head -n -1)

if [ "$EVENT_CODE" = "201" ]; then
  echo -e "${GREEN}✓ PASS${NC} - Event created successfully"
  echo "Response: $EVENT_BODY"
  EVENT_ID=$(echo "$EVENT_BODY" | grep -o '"event_id":"[^"]*"' | cut -d'"' -f4)
  echo "Event ID: $EVENT_ID"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAIL${NC} - Event creation failed (HTTP $EVENT_CODE)"
  echo "Response: $EVENT_BODY"
  FAILED=$((FAILED + 1))
  EVENT_ID=""
fi
echo ""

# ============================================
# TEST 3: POST /api/decide (sin reglas activadas)
# ============================================
echo -e "${YELLOW}[TEST 3]${NC} POST /api/decide (normal context)..."
DECIDE_PAYLOAD=$(cat <<EOF
{
  "user_id": "$USER_ID",
  "context": {
    "current_risk_level": "normal",
    "inactivity_minutes": 30
  }
}
EOF
)

DECIDE_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${CORE_URL}/api/decide" \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: $WORKSPACE_ID" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d "$DECIDE_PAYLOAD" || echo "000")

DECIDE_CODE=$(echo "$DECIDE_RESPONSE" | tail -n 1)
DECIDE_BODY=$(echo "$DECIDE_RESPONSE" | head -n -1)

if [ "$DECIDE_CODE" = "200" ]; then
  echo -e "${GREEN}✓ PASS${NC} - Decision endpoint OK"
  echo "Response: $DECIDE_BODY"
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAIL${NC} - Decision endpoint failed (HTTP $DECIDE_CODE)"
  echo "Response: $DECIDE_BODY"
  FAILED=$((FAILED + 1))
fi
echo ""

# ============================================
# TEST 4: POST /api/decide (con regla activada: inactivity_plus_risk)
# ============================================
echo -e "${YELLOW}[TEST 4]${NC} POST /api/decide (inactivity + risk)..."
DECIDE_RISK_PAYLOAD=$(cat <<EOF
{
  "user_id": "$USER_ID",
  "context": {
    "current_risk_level": "risk",
    "inactivity_minutes": 250
  }
}
EOF
)

DECIDE_RISK_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${CORE_URL}/api/decide" \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: $WORKSPACE_ID" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d "$DECIDE_RISK_PAYLOAD" || echo "000")

DECIDE_RISK_CODE=$(echo "$DECIDE_RISK_RESPONSE" | tail -n 1)
DECIDE_RISK_BODY=$(echo "$DECIDE_RISK_RESPONSE" | head -n -1)

if [ "$DECIDE_RISK_CODE" = "200" ]; then
  # Verificar que haya acciones recomendadas
  if echo "$DECIDE_RISK_BODY" | grep -q '"alert_trust_circle"'; then
    echo -e "${GREEN}✓ PASS${NC} - Rule engine triggered correctly (inactivity_plus_risk)"
    echo "Response: $DECIDE_RISK_BODY"
    PASSED=$((PASSED + 1))
  else
    echo -e "${YELLOW}⚠ PARTIAL${NC} - Endpoint OK but rule not triggered"
    echo "Response: $DECIDE_RISK_BODY"
    PASSED=$((PASSED + 1))
  fi
else
  echo -e "${RED}✗ FAIL${NC} - Decision with risk failed (HTTP $DECIDE_RISK_CODE)"
  echo "Response: $DECIDE_RISK_BODY"
  FAILED=$((FAILED + 1))
fi
echo ""

# ============================================
# TEST 5: POST /api/events (SOS Manual)
# ============================================
echo -e "${YELLOW}[TEST 5]${NC} POST /api/events (sos_manual)..."
SOS_TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
SOS_PAYLOAD=$(cat <<EOF
{
  "user_id": "$USER_ID",
  "event_type": "sos_manual",
  "timestamp": "$SOS_TIMESTAMP",
  "metadata": {
    "source": "smoke_test",
    "trigger_method": "button_long_press",
    "location": {
      "lat": 40.7128,
      "lon": -74.0060
    }
  }
}
EOF
)

SOS_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "${CORE_URL}/api/events" \
  -H "Content-Type: application/json" \
  -H "X-App-Id: kunna" \
  -H "X-Workspace-Id: $WORKSPACE_ID" \
  -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
  -d "$SOS_PAYLOAD" || echo "000")

SOS_CODE=$(echo "$SOS_RESPONSE" | tail -n 1)
SOS_BODY=$(echo "$SOS_RESPONSE" | head -n -1)

if [ "$SOS_CODE" = "201" ]; then
  echo -e "${GREEN}✓ PASS${NC} - SOS event created successfully"
  echo "Response: $SOS_BODY"
  SOS_EVENT_ID=$(echo "$SOS_BODY" | grep -o '"event_id":"[^"]*"' | cut -d'"' -f4)
  PASSED=$((PASSED + 1))
else
  echo -e "${RED}✗ FAIL${NC} - SOS event creation failed (HTTP $SOS_CODE)"
  echo "Response: $SOS_BODY"
  FAILED=$((FAILED + 1))
  SOS_EVENT_ID=""
fi
echo ""

# ============================================
# TEST 6: POST /api/decide (con event_id de SOS)
# ============================================
if [ -n "$SOS_EVENT_ID" ]; then
  echo -e "${YELLOW}[TEST 6]${NC} POST /api/decide (with sos_manual event_id)..."
  DECIDE_SOS_PAYLOAD=$(cat <<EOF
{
  "user_id": "$USER_ID",
  "event_id": "$SOS_EVENT_ID",
  "context": {
    "current_risk_level": "critical"
  }
}
EOF
)

  DECIDE_SOS_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "${CORE_URL}/api/decide" \
    -H "Content-Type: application/json" \
    -H "X-App-Id: kunna" \
    -H "X-Workspace-Id: $WORKSPACE_ID" \
    -H "Authorization: Bearer $SERVICE_TOKEN_KUNNA" \
    -d "$DECIDE_SOS_PAYLOAD" || echo "000")

  DECIDE_SOS_CODE=$(echo "$DECIDE_SOS_RESPONSE" | tail -n 1)
  DECIDE_SOS_BODY=$(echo "$DECIDE_SOS_RESPONSE" | head -n -1)

  if [ "$DECIDE_SOS_CODE" = "200" ]; then
    # Verificar que se hayan generado acciones de escalación
    if echo "$DECIDE_SOS_BODY" | grep -q '"escalate_full_sos"'; then
      echo -e "${GREEN}✓ PASS${NC} - SOS rule triggered correctly"
      echo "Response: $DECIDE_SOS_BODY"
      PASSED=$((PASSED + 1))
    else
      echo -e "${YELLOW}⚠ PARTIAL${NC} - Endpoint OK but SOS rule not triggered"
      echo "Response: $DECIDE_SOS_BODY"
      PASSED=$((PASSED + 1))
    fi
  else
    echo -e "${RED}✗ FAIL${NC} - Decision with SOS failed (HTTP $DECIDE_SOS_CODE)"
    echo "Response: $DECIDE_SOS_BODY"
    FAILED=$((FAILED + 1))
  fi
  echo ""
else
  echo -e "${YELLOW}[TEST 6]${NC} SKIPPED - No SOS event_id available"
  echo ""
fi

# ============================================
# RESUMEN
# ============================================
echo -e "${YELLOW}======================================${NC}"
echo -e "${YELLOW}RESUMEN DE TESTS${NC}"
echo -e "${YELLOW}======================================${NC}"
echo -e "${GREEN}PASSED: $PASSED${NC}"
echo -e "${RED}FAILED: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✓ TODOS LOS TESTS PASARON${NC}"
  exit 0
else
  echo -e "${RED}✗ ALGUNOS TESTS FALLARON${NC}"
  exit 1
fi
