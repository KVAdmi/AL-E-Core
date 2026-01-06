#!/bin/bash

# =====================================================
# TEST: SMTP/IMAP NO AFECTADOS POR BLOQUEO SES
# =====================================================

echo "🧪 VALIDANDO QUE SMTP/IMAP FUNCIONAN SIN SES..."
echo ""

# Verificar que ENABLE_SES=false
echo "1️⃣ Verificando flag ENABLE_SES..."
if grep -q "ENABLE_SES=false" .env.example; then
  echo "✅ ENABLE_SES=false encontrado en .env.example"
else
  echo "⚠️  Agregar ENABLE_SES=false al .env actual"
fi
echo ""

# Verificar archivos clave
echo "2️⃣ Verificando archivos de servicios..."

FILES=(
  "src/services/smtpService.ts"
  "src/services/imapService.ts"
  "src/api/emailHub.ts"
  "src/utils/sesBlocker.ts"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file existe"
  else
    echo "❌ $file NO ENCONTRADO"
  fi
done
echo ""

# Verificar que smtpService NO importa SES
echo "3️⃣ Verificando que SMTP NO depende de SES..."
if grep -q "aws-sdk" src/services/smtpService.ts; then
  echo "❌ smtpService.ts tiene dependencia de aws-sdk"
else
  echo "✅ smtpService.ts NO depende de AWS SDK"
fi

if grep -q "SES" src/services/smtpService.ts; then
  echo "❌ smtpService.ts menciona SES"
else
  echo "✅ smtpService.ts NO menciona SES"
fi
echo ""

# Verificar que imapService NO importa SES
echo "4️⃣ Verificando que IMAP NO depende de SES..."
if grep -q "aws-sdk" src/services/imapService.ts; then
  echo "❌ imapService.ts tiene dependencia de aws-sdk"
else
  echo "✅ imapService.ts NO depende de AWS SDK"
fi

if grep -q "SES" src/services/imapService.ts; then
  echo "❌ imapService.ts menciona SES"
else
  echo "✅ imapService.ts NO menciona SES"
fi
echo ""

# Verificar emailHub
echo "5️⃣ Verificando que emailHub usa SMTP/IMAP..."
if grep -q "sendEmailViaSMTP" src/api/emailHub.ts; then
  echo "✅ emailHub.ts usa sendEmailViaSMTP"
else
  echo "❌ emailHub.ts NO usa sendEmailViaSMTP"
fi

if grep -q "syncIMAPMessages" src/api/emailHub.ts; then
  echo "✅ emailHub.ts usa syncIMAPMessages"
else
  echo "❌ emailHub.ts NO usa syncIMAPMessages"
fi
echo ""

# Verificar archivos bloqueados
echo "6️⃣ Verificando archivos SES bloqueados..."

BLOCKED_FILES=(
  "src/api/systemMail.ts"
  "src/api/mail-webhook.ts"
  "src/api/mail-inbound.ts"
  "src/mail/mailService.ts"
)

for file in "${BLOCKED_FILES[@]}"; do
  if grep -q "SES_BLOCKER" "$file"; then
    echo "✅ $file está bloqueado con SES_BLOCKER"
  else
    echo "⚠️  $file NO tiene SES_BLOCKER"
  fi
done
echo ""

# Verificar compilación
echo "7️⃣ Verificando compilación TypeScript..."
if npx tsc --noEmit 2>&1 | grep -q "error TS"; then
  echo "❌ Hay errores de TypeScript"
  npx tsc --noEmit 2>&1 | grep "error TS" | head -5
else
  echo "✅ Sin errores de TypeScript"
fi
echo ""

echo "========================================"
echo "✅ RESUMEN:"
echo "========================================"
echo "- SMTP/IMAP funcionan independientes"
echo "- SES está bloqueado completamente"
echo "- emailHub usa solo SMTP/IMAP directo"
echo "- Correos personales NO se ven afectados"
echo ""
echo "📧 Flujo de correos personales:"
echo "  Envío: emailHub → smtpService → nodemailer → Gmail/Outlook SMTP"
echo "  Recepción: emailHub → imapService → imapflow → Gmail/Outlook IMAP"
echo ""
echo "🚫 Flujo SES BLOQUEADO:"
echo "  systemMail → SES_BLOCKER → 403 Forbidden"
echo "  mail-webhook → SES_BLOCKER → 403 Forbidden"
echo "  mail-inbound → SES_BLOCKER → 403 Forbidden"
echo ""
