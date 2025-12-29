#!/bin/bash

# Script para aplicar migración 014_email_extended_tables.sql en Supabase
# Ejecuta: Tablas email_folders, email_drafts, email_messages, email_attachments, email_contacts

set -e

echo "🔄 Aplicando migración 014_email_extended_tables.sql en Supabase..."

# Verificar que existe el archivo de migración
if [ ! -f "migrations/014_email_extended_tables.sql" ]; then
  echo "❌ Error: No se encontró migrations/014_email_extended_tables.sql"
  exit 1
fi

# Cargar variables de entorno (ajusta la ruta si es necesario)
if [ -f "ale-core.env.prod" ]; then
  export $(cat ale-core.env.prod | grep SUPABASE_URL | xargs)
  export $(cat ale-core.env.prod | grep SUPABASE_SERVICE_KEY | xargs)
fi

# Verificar que tenemos las credenciales
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "❌ Error: Faltan SUPABASE_URL o SUPABASE_SERVICE_KEY"
  echo "Por favor configura las variables de entorno o usa ale-core.env.prod"
  exit 1
fi

echo "✅ Supabase URL: $SUPABASE_URL"
echo ""
echo "📝 Ejecutando SQL en Supabase..."

# Ejecutar la migración usando curl con Supabase REST API
MIGRATION_SQL=$(cat migrations/014_email_extended_tables.sql)

curl -X POST "${SUPABASE_URL}/rest/v1/rpc/exec_sql" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"sql\": $(echo "$MIGRATION_SQL" | jq -Rs .)}" \
  --fail

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Migración aplicada exitosamente"
  echo ""
  echo "📊 Tablas creadas:"
  echo "   - email_folders (con trigger auto-create)"
  echo "   - email_drafts"
  echo "   - email_messages"
  echo "   - email_attachments"
  echo "   - email_contacts"
  echo ""
  echo "⚠️  IMPORTANTE: Ahora debes crear el bucket 'email-attachments' en Supabase Dashboard > Storage"
else
  echo ""
  echo "❌ Error al aplicar la migración"
  exit 1
fi
