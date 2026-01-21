#!/bin/bash
# TEST: Validar IAM Role en EC2 después de attach

echo "═══════════════════════════════════════"
echo "🔍 VALIDANDO IAM ROLE EN EC2"
echo "═══════════════════════════════════════"

# Obtener token IMDSv2
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

if [ -z "$TOKEN" ]; then
  echo "❌ No se pudo obtener token IMDS"
  exit 1
fi

echo "✅ Token IMDSv2 obtenido"

# Obtener IAM Role
ROLE=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/)

if [ -z "$ROLE" ] || [ "$ROLE" == "404 - Not Found" ]; then
  echo "❌ NO HAY IAM ROLE ASIGNADO A LA EC2"
  echo ""
  echo "ACCIÓN REQUERIDA:"
  echo "1. Ir a EC2 Console"
  echo "2. Seleccionar instancia"
  echo "3. Actions → Security → Modify IAM role"
  echo "4. Seleccionar: AL-E-Core-EC2-Role"
  exit 1
fi

echo "✅ IAM Role detectado: $ROLE"

# Obtener credenciales
CREDS=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/iam/security-credentials/$ROLE)

echo ""
echo "📋 CREDENCIALES:"
echo "$CREDS" | jq -r '.Code, .Type, .AccessKeyId[0:20] + "..."'

echo ""
echo "✅ DIAGNÓSTICO COMPLETO"
