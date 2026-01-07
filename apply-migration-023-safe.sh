#!/bin/bash

# Script para aplicar migración 023 via psql directo a Supabase
# Uso: ./apply-migration-023-safe.sh

set -e

echo "🚀 Aplicando migración 023 a Supabase..."

# Obtener credenciales de .env
source .env

if [ -z "$SUPABASE_DB_URL" ]; then
  echo "❌ Error: SUPABASE_DB_URL no está definida en .env"
  echo "Formato esperado: postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres"
  exit 1
fi

echo "📝 Ejecutando SQL..."

psql "$SUPABASE_DB_URL" -f migrations/023_meetings_module_ALTER_ONLY.sql

if [ $? -eq 0 ]; then
  echo "✅ Migración 023 aplicada exitosamente"
  echo ""
  echo "📋 Próximos pasos:"
  echo "1. Descomentar happened_at en src/api/meetings.ts"
  echo "2. npm run build"
  echo "3. Deploy a producción"
else
  echo "❌ Error aplicando migración"
  exit 1
fi
