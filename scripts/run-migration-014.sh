#!/bin/bash

# Script para ejecutar migración 014 en Supabase
# Tablas extendidas de Email: folders, drafts, messages, attachments, contacts

set -e

echo "=========================================="
echo "MIGRACIÓN 014: Email Extended Tables"
echo "=========================================="

# Leer URL de Supabase desde .env
if [ -f "../ale-core.env.prod" ]; then
  export $(grep -v '^#' ../ale-core.env.prod | xargs)
fi

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "❌ Error: SUPABASE_URL o SUPABASE_SERVICE_KEY no configurados"
  exit 1
fi

echo "✓ URL: $SUPABASE_URL"
echo ""
echo "Ejecutando migración..."
echo ""

# Ejecutar migración usando psql a través de la API REST de Supabase
# Nota: Supabase recomienda usar el Dashboard para migraciones complejas con triggers

echo "⚠️  IMPORTANTE: Esta migración debe ejecutarse en Supabase Dashboard"
echo ""
echo "1. Abre: $SUPABASE_URL"
echo "2. Ve a: SQL Editor"
echo "3. Pega el contenido de: migrations/014_email_extended_tables.sql"
echo "4. Ejecuta el script"
echo ""
echo "Contenido de la migración:"
echo "----------------------------------------"
cat ../migrations/014_email_extended_tables.sql
echo "----------------------------------------"
echo ""
echo "✅ Copia el SQL de arriba y ejecútalo en Supabase Dashboard"
