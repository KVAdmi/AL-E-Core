#!/bin/bash

# =====================================================
# SETUP EMAIL HUB UNIVERSAL - GENERAR CLAVE CIFRADO
# =====================================================

echo "📧 Email Hub Universal - Setup"
echo "================================"
echo ""
echo "Generando clave de cifrado AES-256-GCM..."
echo ""

# Generar clave de 32 bytes (256 bits) en formato hex
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

echo "✅ Clave generada:"
echo ""
echo "EMAIL_CRED_ENC_KEY=$KEY"
echo ""
echo "⚠️  IMPORTANTE:"
echo "1. Agrega esta variable a tu archivo .env"
echo "2. NUNCA cambies esta clave después de crear cuentas"
echo "3. NUNCA la compartas ni la incluyas en control de versiones"
echo "4. Haz backup de esta clave en un lugar seguro"
echo ""
echo "📋 Pasos siguientes:"
echo "1. Agregar EMAIL_CRED_ENC_KEY al .env"
echo "2. Reiniciar servidor: npm run build && npm start"
echo "3. Verificar logs: tail -f /var/log/al-e-core/output.log"
echo "4. Crear primera cuenta: POST /api/email/accounts"
echo ""
echo "🎉 Setup completado!"
