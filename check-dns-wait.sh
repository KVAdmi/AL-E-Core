#!/bin/bash
echo "Esperando propagación DNS (TTL: 3600s = 1 hora)..."
echo "Ejecuta este script cada 30 minutos para verificar:"
echo ""
echo "  ./check-dns-authentication.sh"
echo ""
echo "Cuando veas ✅ en SPF y DKIM, prueba envío real:"
echo ""
cat << 'TESTMAIL'
curl -X POST http://100.27.201.233:3000/api/mail/send \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "7a285444-6799-4187-8037-52826cf5c29f",
    "to": ["kodigovivo@gmail.com"],
    "subject": "✅ Test SPF/DKIM - infinitykode.com",
    "body": "Si recibes este correo, SPF/DKIM están configurados correctamente ✅",
    "userId": "4dd025c0-19c7-490a-a50c-a55e7867a8f3"
  }'
TESTMAIL
echo ""
echo "Gmail debe aceptar sin error 550-5.7.26 ✅"
