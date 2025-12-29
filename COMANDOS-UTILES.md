# 🛠️ COMANDOS ÚTILES - POST-MIGRACIÓN

## 📦 Instalación de Dependencias

```bash
npm install
```

## 🔨 Build

```bash
npm run build
```

## 🚀 Deploy Local (Dev)

```bash
npm run dev
```

## 🌐 Deploy Producción (EC2 + PM2)

```bash
# Opción 1: Script automático
./deploy-aleon.sh

# Opción 2: Manual
npm run build
pm2 restart al-e-core

# Opción 3: Primera vez
pm2 start dist/index.js --name al-e-core
pm2 save
```

## 🗄️ Migraciones DB (Supabase)

```bash
# Conectar a Supabase
export DATABASE_URL="postgresql://..."

# Ejecutar migraciones en orden
psql $DATABASE_URL -f migrations/011_email_system.sql
psql $DATABASE_URL -f migrations/012_calendar_internal.sql
psql $DATABASE_URL -f migrations/013_telegram_bots.sql

# O desde Supabase SQL Editor (recomendado):
# Copiar y pegar contenido de cada .sql en orden
```

## 🔐 Generar ENCRYPTION_KEY

```bash
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"

# Ejemplo de salida:
# ENCRYPTION_KEY=c6d853d4d2252127003a8e847b1a83bf0b3206118b819fa7a45a0ec42f608ff1
```

## ✅ Verificación

```bash
# Verificar migración completa
./verify-migration.sh

# Verificar compilación
npm run build

# Health check local
curl http://localhost:4000/health

# Health check full
curl http://localhost:4000/_health/full
```

## 🧪 Testing API (Local)

### Email Account
```bash
curl -X POST http://localhost:4000/api/email/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-123",
    "providerLabel": "Gmail SMTP",
    "fromName": "Patricia",
    "fromEmail": "patricia@example.com",
    "smtpHost": "smtp.gmail.com",
    "smtpPort": 587,
    "smtpSecure": false,
    "smtpUser": "patricia@example.com",
    "smtpPass": "your-app-password"
  }'
```

### Test Conexión SMTP
```bash
curl -X POST http://localhost:4000/api/email/accounts/<ACCOUNT_ID>/test
```

### Enviar Email
```bash
curl -X POST http://localhost:4000/api/mail/send \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-123",
    "accountId": "<ACCOUNT_ID>",
    "to": ["destinatario@example.com"],
    "subject": "Test desde AL-E",
    "text": "Este es un email de prueba"
  }'
```

### Crear Evento Calendario
```bash
curl -X POST http://localhost:4000/api/calendar/events \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-123",
    "title": "Reunión de prueba",
    "description": "Testing calendario interno",
    "startAt": "2025-12-30T15:00:00Z",
    "endAt": "2025-12-30T16:00:00Z",
    "timezone": "America/Mexico_City"
  }'
```

### Listar Eventos
```bash
curl "http://localhost:4000/api/calendar/events?ownerUserId=test-user-123"
```

### Conectar Bot Telegram
```bash
curl -X POST http://localhost:4000/api/telegram/bots/connect \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-123",
    "botUsername": "@mi_bot_test",
    "botToken": "123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
  }'
```

### Enviar Mensaje Telegram
```bash
curl -X POST http://localhost:4000/api/telegram/send \
  -H "Content-Type: application/json" \
  -d '{
    "ownerUserId": "test-user-123",
    "chatId": 123456789,
    "text": "Hola desde AL-E 👋"
  }'
```

## 📊 Logs

```bash
# Logs en tiempo real (PM2)
pm2 logs al-e-core

# Logs específicos
pm2 logs al-e-core --lines 100

# Monitoreo
pm2 monit
```

## 🔄 Restart Services

```bash
# Restart PM2
pm2 restart al-e-core

# Restart con rebuild
npm run build && pm2 restart al-e-core

# Restart Nginx (si es necesario)
sudo systemctl restart nginx
```

## 🗑️ Rollback (si es necesario)

```bash
# Revertir migraciones (CUIDADO - solo en emergencia)
# Nota: Crear rollback scripts manualmente si es necesario

# Volver a versión anterior
git checkout <commit-anterior>
npm install
npm run build
pm2 restart al-e-core
```

## 🔍 Debug

```bash
# Ver estado PM2
pm2 status

# Ver info de proceso
pm2 info al-e-core

# Ver variables de entorno
pm2 env al-e-core

# Verificar puerto en uso
lsof -i :4000

# Ver procesos Node
ps aux | grep node
```

## 🧹 Cleanup

```bash
# Limpiar node_modules y reinstalar
rm -rf node_modules package-lock.json
npm install

# Limpiar build
rm -rf dist
npm run build

# Limpiar logs PM2
pm2 flush
```

## 📝 Variables de Entorno Importantes

```bash
# Verificar .env
cat .env | grep -E "ENCRYPTION_KEY|ENABLE_"

# Agregar variables faltantes
echo "ENCRYPTION_KEY=<key-aqui>" >> .env
echo "ENABLE_GOOGLE=false" >> .env
echo "ENABLE_OCR=true" >> .env
echo "ENABLE_TELEGRAM=true" >> .env
echo "ENABLE_IMAP=true" >> .env
```

## 🔐 Telegram Bot - Configuración Webhook

```bash
# Verificar webhook configurado
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"

# Setear webhook manualmente (ya se hace automático en /bots/connect)
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -d "url=https://api.al-eon.com/api/telegram/webhook/<BOT_ID>/<SECRET>"

# Eliminar webhook (solo si es necesario)
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/deleteWebhook"
```

## 📧 Gmail App Password (para testing SMTP)

1. Ir a: https://myaccount.google.com/apppasswords
2. Crear nueva contraseña de aplicación
3. Seleccionar "Correo" y "Otro"
4. Copiar password generado (16 caracteres sin espacios)
5. Usar en `smtpPass` al crear cuenta

## 🎯 Quick Start Completo

```bash
# 1. Clonar y preparar
cd /Users/pg/Documents/AL-E\ Core
npm install

# 2. Generar ENCRYPTION_KEY
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"

# 3. Agregar a .env
# ENCRYPTION_KEY=<resultado-anterior>
# ENABLE_GOOGLE=false
# ENABLE_OCR=true
# ENABLE_TELEGRAM=true
# ENABLE_IMAP=true

# 4. Build
npm run build

# 5. Ejecutar migraciones en Supabase (desde SQL Editor)
# - migrations/011_email_system.sql
# - migrations/012_calendar_internal.sql
# - migrations/013_telegram_bots.sql

# 6. Iniciar
npm run dev

# 7. Verificar
curl http://localhost:4000/_health/full
```

## ✅ Checklist Pre-Deploy

```bash
# 1. Verificación local
./verify-migration.sh

# 2. Compilación
npm run build

# 3. Variables de entorno
grep -q "ENCRYPTION_KEY" .env && echo "✓ ENCRYPTION_KEY presente" || echo "✗ Falta ENCRYPTION_KEY"

# 4. Migraciones ejecutadas
# Verificar en Supabase que existen tablas:
# - email_accounts
# - calendar_events
# - telegram_bots

# 5. Health check
curl http://localhost:4000/_health/full

# 6. Deploy
./deploy-aleon.sh
```

---

**📚 Más info:** Ver `MIGRACION-COMPLETADA-HOY.md` y `RESUMEN-EJECUTIVO-P0.md`
