# 🔐 CREDENCIALES SSH EC2 - AL-E CORE PRODUCCIÓN

## COMANDO SSH CORRECTO (USA ESTE SIEMPRE)

```bash
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233
```

## DATOS CLAVE

- **Llave SSH**: `~/Downloads/mercado-pago.pem`
- **Usuario**: `ubuntu` (NO ec2-user)
- **IP**: `100.27.201.233`
- **Path proyecto**: `/home/ubuntu/AL-E-Core`
- **PM2 process**: `ale-core` (ID: 7)

## DEPLOYMENT COMPLETO

```bash
# 1. Conectar a EC2
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233

# 2. Una vez dentro:
cd /home/ubuntu/AL-E-Core
git pull origin main
npm install  # Solo si hay nuevas dependencias
npm run build
pm2 restart ale-core

# 3. Ver logs
pm2 logs ale-core --lines 50
```

## DEPLOY EN UN SOLO COMANDO (desde local)

```bash
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233 "cd /home/ubuntu/AL-E-Core && git pull origin main && npm run build && pm2 restart ale-core && pm2 logs ale-core --lines 30 --nostream"
```

## ERRORES COMUNES

### ❌ Permission denied (publickey)
**Causa**: Llave incorrecta o usuario incorrecto
**Solución**: Usa `ubuntu@` NO `ec2-user@`, y llave `mercado-pago.pem`

### ❌ ~/.ssh/al-e-core-ec2.pem not found
**Causa**: Buscando llave en lugar equivocado
**Solución**: La llave está en `~/Downloads/mercado-pago.pem`

### ❌ ~/.ssh/ale-core.pem not found
**Causa**: Nombre de llave incorrecto
**Solución**: La llave se llama `mercado-pago.pem`, no `ale-core.pem`

## VERIFICACIÓN RÁPIDA

```bash
# Ver que el servidor esté corriendo
curl http://100.27.201.233:3000/api/health

# Debería responder:
# {"status":"ok","timestamp":"..."}
```

## NOTA IMPORTANTE

**ESTE ES EL COMANDO CORRECTO. NO USAR OTRO.**

Si en el futuro te equivocas, REVISA ESTE ARCHIVO PRIMERO.
