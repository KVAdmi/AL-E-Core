#!/bin/bash

# Script para configurar Nginx + Certbot para api.luisatristain.com
# Ejecutar como root en EC2

set -e

echo "🚀 Configurando Nginx y SSL para api.luisatristain.com..."

# 1. Instalar Nginx y Certbot si no están instalados
echo "📦 Instalando dependencias..."
apt update
apt install -y nginx certbot python3-certbot-nginx

# 2. Copiar configuración de Nginx
echo "⚙️  Configurando Nginx..."
cp /path/to/api.luisatristain.com.conf /etc/nginx/sites-available/
ln -sf /etc/nginx/sites-available/api.luisatristain.com.conf /etc/nginx/sites-enabled/

# 3. Verificar configuración de Nginx
echo "🔍 Verificando configuración de Nginx..."
nginx -t

# 4. Reiniciar Nginx
echo "🔄 Reiniciando Nginx..."
systemctl restart nginx
systemctl enable nginx

# 5. Configurar Certbot para SSL automático
echo "🔐 Configurando certificado SSL con Let's Encrypt..."
certbot --nginx -d api.luisatristain.com --non-interactive --agree-tos --email admin@luisatristain.com

# 6. Configurar auto-renovación
echo "⏰ Configurando auto-renovación de certificados..."
systemctl enable certbot.timer
systemctl start certbot.timer

# 7. Verificar estado
echo "✅ Verificando configuración..."
systemctl status nginx
systemctl status certbot.timer

# 8. Reiniciar PM2 con nuevas variables
echo "🔄 Reiniciando AL-E Core con nuevas variables de entorno..."
cd /path/to/AL-E-Core
pm2 restart ale-core --update-env
pm2 save

echo "🎉 ¡Configuración completada!"
echo ""
echo "📝 Para verificar CORS, ejecuta:"
echo "curl -i -X OPTIONS https://api.luisatristain.com/api/ai/chat \\"
echo "  -H \"Origin: https://luisatristain.com\" \\"
echo "  -H \"Access-Control-Request-Method: POST\" \\"
echo "  -H \"Access-Control-Request-Headers: content-type\""
echo ""
echo "🔗 Tu API está ahora disponible en: https://api.luisatristain.com"