#!/bin/bash

# GUÍA EJECUTIVA: Configurar SPF/DKIM en Hostinger
# Copiar y pegar estos registros en el DNS

echo "=========================================="
echo "REGISTROS DNS PARA INFINITYKODE.COM"
echo "=========================================="
echo ""
echo "⚡ ACCIÓN INMEDIATA:"
echo "1. Entrar a: https://hpanel.hostinger.com"
echo "2. Ir a: Dominios → infinitykode.com → DNS Zone Editor"
echo "3. Agregar los siguientes registros:"
echo ""

echo "=========================================="
echo "REGISTRO 1: SPF (CRÍTICO)"
echo "=========================================="
cat << 'EOF'
Tipo: TXT
Nombre: @ (o dejar vacío)
Valor: v=spf1 include:_spf.hostinger.com ~all
TTL: 14400
EOF
echo ""

echo "=========================================="
echo "REGISTRO 2: DKIM (CRÍTICO)"
echo "=========================================="
echo "🔔 IMPORTANTE: Primero habilitar DKIM en Hostinger"
echo ""
echo "PASOS:"
echo "1. En Hostinger Panel: Email Accounts"
echo "2. Seleccionar dominio: infinitykode.com"
echo "3. Click en 'Email Authentication'"
echo "4. Habilitar DKIM"
echo "5. Copiar el registro TXT generado"
echo "6. Agregarlo en DNS Zone Editor"
echo ""
echo "Formato esperado:"
cat << 'EOF'
Tipo: TXT
Nombre: default._domainkey (o el que Hostinger indique)
Valor: v=DKIM1; k=rsa; p=[CLAVE_PÚBLICA_LARGA]
TTL: 14400
EOF
echo ""

echo "=========================================="
echo "REGISTRO 3: DMARC (RECOMENDADO)"
echo "=========================================="
cat << 'EOF'
Tipo: TXT
Nombre: _dmarc
Valor: v=DMARC1; p=none; rua=mailto:p.garibay@infinitykode.com
TTL: 14400
EOF
echo ""

echo "=========================================="
echo "VERIFICACIÓN POST-CONFIGURACIÓN"
echo "=========================================="
echo ""
echo "Esperar 4-6 horas y ejecutar:"
echo ""
echo "  ./check-dns-authentication.sh"
echo ""
echo "Resultado esperado:"
echo "  ✅ SPF configurado"
echo "  ✅ DKIM configurado"
echo "  ✅ DMARC configurado"
echo ""

echo "=========================================="
echo "TEST FINAL"
echo "=========================================="
echo ""
echo "Enviar correo de prueba:"
echo ""
cat << 'EOF'
POST http://100.27.201.233:3000/api/mail/send
Content-Type: application/json

{
  "accountId": "7a285444-6799-4187-8037-52826cf5c29f",
  "to": ["kodigovivo@gmail.com"],
  "subject": "Test SPF/DKIM - infinitykode.com",
  "body": "Este correo debe llegar sin error 550-5.7.26",
  "userId": "[USER_ID]"
}
EOF
echo ""
echo "Gmail debe aceptar sin errores ✅"
echo ""

echo "=========================================="
echo "ALTERNATIVA TEMPORAL (SI URGE HOY)"
echo "=========================================="
echo ""
echo "Usar Gmail SMTP mientras DNS propaga:"
echo ""
echo "1. Crear App Password en Gmail:"
echo "   https://myaccount.google.com/apppasswords"
echo ""
echo "2. Actualizar cuenta en Supabase:"
cat << 'EOF'
UPDATE email_accounts
SET 
  smtp_host = 'smtp.gmail.com',
  smtp_port = 587,
  smtp_secure = true,
  smtp_user = 'kodigovivo@gmail.com',
  smtp_pass_enc = '[APP_PASSWORD_ENCRIPTADA]',
  from_email = 'kodigovivo@gmail.com'
WHERE from_email = 'p.garibay@infinitykode.com';
EOF
echo ""
echo "✅ Gmail siempre tiene SPF/DKIM configurado"
echo "📧 Funciona inmediatamente"
echo "⚠️ Límite: 500 correos/día"
echo ""

echo "=========================================="
echo "NEXT STEPS"
echo "=========================================="
echo ""
echo "[ ] 1. Configurar SPF en Hostinger DNS (5 min)"
echo "[ ] 2. Habilitar DKIM en Hostinger Email (5 min)"
echo "[ ] 3. Agregar DKIM en Hostinger DNS (5 min)"
echo "[ ] 4. Agregar DMARC en Hostinger DNS (5 min)"
echo "[ ] 5. Esperar propagación (4-48 hrs)"
echo "[ ] 6. Verificar con check-dns-authentication.sh"
echo "[ ] 7. Test envío real a Gmail"
echo "[ ] 8. Revisar headers Authentication-Results"
echo ""
echo "=========================================="
