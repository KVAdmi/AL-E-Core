#!/bin/bash

echo "=========================================="
echo "DNS AUDIT: infinitykode.com"
echo "Diagnóstico SPF/DKIM/DMARC"
echo "=========================================="
echo ""

# SPF Check
echo "1️⃣ SPF RECORD:"
echo "---"
dig TXT infinitykode.com +short | grep "v=spf1" || echo "❌ NO SPF RECORD FOUND"
echo ""

# DKIM Check (intentar varios selectores comunes)
echo "2️⃣ DKIM RECORDS:"
echo "---"
echo "Selector: default._domainkey"
dig TXT default._domainkey.infinitykode.com +short | grep "v=DKIM1" || echo "❌ NO DKIM (default)"

echo ""
echo "Selector: mail._domainkey"
dig TXT mail._domainkey.infinitykode.com +short | grep "v=DKIM1" || echo "❌ NO DKIM (mail)"

echo ""
echo "Selector: dkim._domainkey"
dig TXT dkim._domainkey.infinitykode.com +short | grep "v=DKIM1" || echo "❌ NO DKIM (dkim)"

echo ""
echo "Selector: k1._domainkey"
dig TXT k1._domainkey.infinitykode.com +short | grep "v=DKIM1" || echo "❌ NO DKIM (k1)"

echo ""

# DMARC Check
echo "3️⃣ DMARC RECORD:"
echo "---"
dig TXT _dmarc.infinitykode.com +short | grep "v=DMARC1" || echo "❌ NO DMARC RECORD FOUND"
echo ""

# MX Records (para referencia)
echo "4️⃣ MX RECORDS:"
echo "---"
dig MX infinitykode.com +short
echo ""

# IP del servidor SMTP actual
echo "5️⃣ SMTP SERVER IP:"
echo "---"
echo "Resolviendo imap.hostinger.com..."
dig A imap.hostinger.com +short
echo ""

# Verificar con DNS de Google (propagación mundial)
echo "6️⃣ VERIFICACIÓN GLOBAL (Google DNS 8.8.8.8):"
echo "---"
echo "SPF:"
dig @8.8.8.8 TXT infinitykode.com +short | grep "v=spf1" || echo "❌ NO PROPAGADO"
echo ""

echo "=========================================="
echo "RESUMEN:"
echo "=========================================="
echo ""

# Contadores
SPF=$(dig TXT infinitykode.com +short | grep -c "v=spf1")
DKIM_DEFAULT=$(dig TXT default._domainkey.infinitykode.com +short | grep -c "v=DKIM1")
DKIM_MAIL=$(dig TXT mail._domainkey.infinitykode.com +short | grep -c "v=DKIM1")
DMARC=$(dig TXT _dmarc.infinitykode.com +short | grep -c "v=DMARC1")

if [ "$SPF" -eq 1 ]; then
  echo "✅ SPF configurado"
else
  echo "❌ SPF faltante (CRÍTICO)"
fi

if [ "$DKIM_DEFAULT" -eq 1 ] || [ "$DKIM_MAIL" -eq 1 ]; then
  echo "✅ DKIM configurado"
else
  echo "❌ DKIM faltante (CRÍTICO)"
fi

if [ "$DMARC" -eq 1 ]; then
  echo "✅ DMARC configurado"
else
  echo "⚠️ DMARC faltante (recomendado)"
fi

echo ""
if [ "$SPF" -eq 0 ] || ([ "$DKIM_DEFAULT" -eq 0 ] && [ "$DKIM_MAIL" -eq 0 ]); then
  echo "🔴 ESTADO: Gmail BLOQUEARÁ correos salientes"
  echo "📋 ACCIÓN: Configurar SPF/DKIM en Hostinger DNS"
  echo "📖 GUÍA: Ver FIX-SPF-DKIM-INFINITYKODE.md"
else
  echo "✅ ESTADO: Configuración completa"
fi

echo ""
echo "=========================================="
