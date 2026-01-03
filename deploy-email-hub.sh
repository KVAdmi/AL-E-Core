#!/bin/bash

# =====================================================
# DEPLOY EMAIL HUB UNIVERSAL TO PRODUCTION
# =====================================================

set -e

echo "🚀 Desplegando Email Hub Universal..."
echo "====================================="
echo ""

# 1. Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
  echo "❌ Error: Ejecuta este script desde el directorio raíz de AL-E Core"
  exit 1
fi

# 2. Verificar que EMAIL_CRED_ENC_KEY esté configurado
if [ -z "$EMAIL_CRED_ENC_KEY" ]; then
  echo "⚠️  EMAIL_CRED_ENC_KEY no está en .env"
  echo "Ejecuta: ./setup-email-hub.sh"
  exit 1
fi

echo "✅ EMAIL_CRED_ENC_KEY configurado"
echo ""

# 3. Instalar dependencias
echo "📦 Instalando dependencias..."
npm install
echo "✅ Dependencias instaladas"
echo ""

# 4. Compilar TypeScript
echo "🔨 Compilando TypeScript..."
npm run build

if [ $? -ne 0 ]; then
  echo "❌ Error en compilación"
  exit 1
fi

echo "✅ Compilación exitosa"
echo ""

# 5. Verificar archivos críticos
echo "🔍 Verificando archivos..."

REQUIRED_FILES=(
  "dist/api/emailHub.js"
  "dist/services/imapService.js"
  "dist/services/smtpService.js"
  "dist/utils/emailEncryption.js"
  "dist/workers/emailSyncWorker.js"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "❌ Archivo faltante: $file"
    exit 1
  fi
done

echo "✅ Todos los archivos presentes"
echo ""

# 6. Test rápido de módulos
echo "🧪 Verificando módulos..."
node -e "
  try {
    require('./dist/utils/emailEncryption');
    console.log('✅ emailEncryption OK');
  } catch(e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  }
"
echo ""

# 7. Información de deployment
echo "📊 Estado del deployment:"
echo "------------------------"
echo "Email Hub endpoints: 9"
echo "Sync worker: Cada 5 minutos"
echo "Cifrado: AES-256-GCM"
echo "Tablas DB: email_accounts, email_messages, email_folders, email_sync_log"
echo ""

# 8. Instrucciones finales
echo "✅ Build completado exitosamente!"
echo ""
echo "📋 Próximos pasos:"
echo "1. Copiar dist/ al servidor de producción"
echo "2. Asegurarse que EMAIL_CRED_ENC_KEY esté en .env del servidor"
echo "3. Reiniciar PM2: pm2 restart al-e-core"
echo "4. Verificar logs: pm2 logs al-e-core"
echo ""
echo "🔗 Endpoints disponibles en:"
echo "   https://api.al-eon.com/api/email/accounts"
echo "   https://api.al-eon.com/api/email/send"
echo ""
echo "📖 Documentación completa en:"
echo "   EMAIL-HUB-UNIVERSAL.md"
echo "   EMAIL-HUB-PROVIDERS.md"
echo ""
echo "🎉 Listo para producción!"
