#!/bin/bash

# Aplica migración meeting_transcriptions a Supabase
# Requiere: curl + SUPABASE_SERVICE_ROLE_KEY

set -e

SUPABASE_URL="https://gptwzuqmuvzttajgjrry.supabase.co"
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjUwNTU3MCwiZXhwIjoyMDY4MDgxNTcwfQ.IKpBhVtP2aP28iTr_0EKUfblpmpvF2R2UT5RcSpwowY"

echo "📊 Aplicando migración meeting_transcriptions..."

SQL=$(cat supabase-migration-meeting-transcriptions.sql)

curl -X POST "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
  -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo "$SQL" | jq -Rs .)}"

echo ""
echo "✅ Migración aplicada (verificar en Supabase Dashboard)"
