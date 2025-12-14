#!/bin/bash

# Script de emergencia para limpiar .env del historial de Git
echo "🚨 EMERGENCIA: Limpiando .env del historial de Git..."

# 1. Remover .env del historial completo
echo "📝 Removiendo .env del historial de Git..."
git filter-branch --index-filter 'git rm --cached --ignore-unmatch .env' --prune-empty --tag-name-filter cat -- --all

# 2. Forzar garbage collection
echo "🗑️  Limpiando referencias..."
git for-each-ref --format='delete %(refname)' refs/original | git update-ref --stdin
git reflog expire --expire=now --all
git gc --prune=now

# 3. Si hay remote, FORZAR push para sobrescribir historial
echo "⚠️  CUIDADO: Esto sobrescribirá el historial remoto"
echo "Si estás seguro, ejecuta manualmente:"
echo "git push origin --force --all"
echo "git push origin --force --tags"

echo "✅ .env removido del historial local"
echo ""
echo "🔐 IMPORTANTE: Ahora debes rotar TODAS las API keys inmediatamente:"
echo "1. OpenAI: https://platform.openai.com/api-keys"  
echo "2. Supabase: https://supabase.com/dashboard/project/settings/api"
echo "3. Cambiar password de PostgreSQL si es posible"