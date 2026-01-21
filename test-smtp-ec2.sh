#!/bin/bash
# Test SMTP REAL en EC2 con JWT válido

JWT="eyJhbGciOiJIUzI1NiIsImtpZCI6IlVJZ3V1VUZSMkZmZGdhVU4iLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL2dwdHd6dXFtdXZ6dHRhamdqcnJ5LnN1cGFiYXNlLmNvL2F1dGgvdjEiLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjoxNzY5MDM3NTIyLCJpYXQiOjE3NjkwMzM5MjIsImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJwaG9uZSI6IiIsImFwcF9tZXRhZGF0YSI6eyJwcm92aWRlciI6ImVtYWlsIiwicHJvdmlkZXJzIjpbImVtYWlsIl19LCJ1c2VyX21ldGFkYXRhIjp7ImVtYWlsIjoicC5nYXJpYmF5QGluZmluaXR5a29kZS5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGhvbmVfdmVyaWZpZWQiOmZhbHNlLCJzdWIiOiI1NmJjMzQ0OC02YWYwLTQ0NjgtOTliOS03ODc3OWJmODRhZTgifSwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJhYWwiOiJhYWwxIiwiYW1yIjpbeyJtZXRob2QiOiJvdHAiLCJ0aW1lc3RhbXAiOjE3NjkwMzM5MjJ9XSwic2Vzc2lvbl9pZCI6IjViNjQ2ODllLTdmM2MtNGFmOC05NDczLTAwN2U0YWVlMDM4YSIsImlzX2Fub255bW91cyI6ZmFsc2V9.eSXcIJ7Yee82zRv14oJQ5rtpBcTedu5RrbgOTPARbrU"

echo "🚀 TEST PASO 1: EMAIL SMTP REAL CON JWT"
echo "========================================"
echo ""

ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 << ENDSSH

cd AL-E-Core

# Obtener accountId de la base de datos
ACCOUNT_DATA=\$(curl -s 'https://gptwzuqmuvzttajgjrry.supabase.co/rest/v1/email_accounts?is_active=eq.true&limit=1&select=id,from_email' \
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDU1NzAsImV4cCI6MjA2ODA4MTU3MH0.AAbVhdrI7LmSPKKRX0JhSkYxVg7VOw-ccizKTOh7pV8" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDU1NzAsImV4cCI6MjA2ODA4MTU3MH0.AAbVhdrI7LmSPKKRX0JhSkYxVg7VOw-ccizKTOh7pV8")

ACCOUNT_ID=\$(echo "\$ACCOUNT_DATA" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
EMAIL=\$(echo "\$ACCOUNT_DATA" | grep -o '"from_email":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "✅ Cuenta: \$EMAIL"
echo "✅ Account ID: \$ACCOUNT_ID"
echo ""
echo "📤 Enviando email de prueba..."
echo "════════════════════════════════════════"

# Enviar email con JWT
RESULT=\$(curl -s -w "\n%{http_code}" http://localhost:3000/api/mail/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT" \
  -d "{
    \"accountId\": \"\$ACCOUNT_ID\",
    \"to\": \"\$EMAIL\",
    \"subject\": \"✅ SMTP TEST REAL - \$(date -Iseconds)\",
    \"body\": \"Email de prueba con nodemailer + SMTP. Enviado: \$(date)\"
  }")

HTTP_CODE=\$(echo "\$RESULT" | tail -1)
RESPONSE=\$(echo "\$RESULT" | head -n -1)

echo "════════════════════════════════════════"

if [ "\$HTTP_CODE" = "200" ]; then
  echo ""
  echo "✅ SMTP VERIFY OK"
  echo "✅ MESSAGE ACCEPTED"
  echo ""
  echo "\$RESPONSE" | grep -o '"messageId":"[^"]*"' | cut -d'"' -f4 | sed 's/^/📬 Message ID: /'
  echo ""
  echo "🎯 PASO 1 COMPLETO"
  echo "   Revisa inbox: \$EMAIL"
else
  echo "❌ Error HTTP \$HTTP_CODE"
  echo "\$RESPONSE"
  exit 1
fi

ENDSSH
