#!/bin/bash

# =====================================================
# APLICAR MIGRACIÓN 018 A SUPABASE
# =====================================================
# Agrega columna 'provider' a email_accounts
# Necesario para que funcione el endpoint POST /api/email/accounts
# =====================================================

set -e

SERVER="ubuntu@100.27.201.233"
SSH_KEY="$HOME/Downloads/mercado-pago.pem"
REMOTE_DIR="/home/ubuntu/AL-E-Core"

echo "🔄 Aplicando migración 018 a Supabase..."
echo ""

ssh -i $SSH_KEY $SERVER << 'ENDSSH'
cd /home/ubuntu/AL-E-Core

echo "📋 Leyendo credenciales de Supabase..."

# Leer SUPABASE_URL y SUPABASE_SERVICE_KEY del .env
SUPABASE_URL=$(grep "^SUPABASE_URL=" .env | cut -d '=' -f2)
SUPABASE_SERVICE_KEY=$(grep "^SUPABASE_SERVICE_KEY=" .env | cut -d '=' -f2)

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "❌ Error: No se encontraron credenciales de Supabase en .env"
  exit 1
fi

echo "✅ Credenciales encontradas"
echo ""
echo "🚀 Ejecutando migración 018_ses_inbound_system.sql..."

# Usar curl para ejecutar la migración vía Supabase REST API
# Nota: Esto requiere acceso directo a PostgreSQL, pero no tenemos psql instalado
# Alternativa: usar la API de Supabase Management

echo ""
echo "⚠️  IMPORTANTE: Esta migración debe ejecutarse manualmente desde Supabase Dashboard:"
echo ""
echo "1. Ir a: https://supabase.com/dashboard/project/YOUR_PROJECT/sql-editor"
echo "2. Copiar el contenido de migrations/018_ses_inbound_system.sql"
echo "3. Ejecutar la migración"
echo ""
echo "📄 Contenido de la migración:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cat migrations/018_ses_inbound_system.sql | head -60
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔗 Archivo completo en el servidor: $REMOTE_DIR/migrations/018_ses_inbound_system.sql"
echo ""

ENDSSH

echo ""
echo "📋 Instrucciones para aplicar la migración:"
echo ""
echo "OPCIÓN 1: Desde Supabase Dashboard (recomendado)"
echo "  1. Ir a https://supabase.com/dashboard"
echo "  2. Seleccionar proyecto AL-E Core"
echo "  3. SQL Editor → New query"
echo "  4. Copiar contenido de migrations/018_ses_inbound_system.sql"
echo "  5. Ejecutar (RUN)"
echo ""
echo "OPCIÓN 2: Desde terminal local (si tienes psql)"
echo "  psql postgresql://[CONNECTION_STRING] < migrations/018_ses_inbound_system.sql"
echo ""
echo "✅ Una vez ejecutada, el error 'provider column not found' desaparecerá"
echo ""
