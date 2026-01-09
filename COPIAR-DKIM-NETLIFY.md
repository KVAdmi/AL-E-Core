# 🚀 PASO A PASO - COPIAR DKIM DE HOSTINGER A NETLIFY

## 📋 LO QUE NECESITAS HACER AHORA:

### PASO 1: Obtener el registro DKIM completo de Hostinger

1. En la pantalla que tienes abierta (DKIM personalizado)
2. **Click en la fila** que dice: `hostingermail__domainkey` | `Verificado`
3. Hostinger te mostrará una ventana/panel con 3 valores:
   - **Nombre:** (algo como `hostingermail._domainkey`)
   - **Tipo:** TXT
   - **Valor:** (un texto LARGO que empieza con `v=DKIM1; k=rsa; p=MIGfMA0...`)

4. **COPIA COMPLETO** el valor del campo "Valor" (todo el texto, aunque sea muy largo)

---

### PASO 2: Ir a Netlify DNS

1. Abre una nueva pestaña: https://app.netlify.com
2. Ve a tu sitio
3. **Domain management** → **DNS records**
4. Click **"Add new record"**

---

### PASO 3: Agregar registro SPF en Netlify

**Primero agrega SPF:**

```
Type: TXT
Name: @ (o déjalo vacío si no acepta @)
Value: v=spf1 include:_spf.hostinger.com ~all
TTL: 3600
```

Click **Save**

---

### PASO 4: Agregar registro DKIM en Netlify

**Ahora agrega DKIM:**

```
Type: TXT
Name: hostingermail._domainkey
(el nombre exacto que viste en Hostinger, SIN el dominio al final)

Value: [PEGA AQUÍ EL VALOR LARGO QUE COPIASTE DE HOSTINGER]
(Debe empezar con: v=DKIM1; k=rsa; p=...)

TTL: 3600
```

Click **Save**

---

### PASO 5: Verificar en Terminal (DESPUÉS DE 1 HORA)

Abre Terminal y ejecuta:

```bash
# Verificar SPF
dig TXT vitacard365.com +short

# Debe mostrar:
# "v=spf1 include:_spf.hostinger.com ~all"
```

```bash
# Verificar DKIM
dig TXT hostingermail._domainkey.vitacard365.com +short

# Debe mostrar:
# "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3..."
```

---

### PASO 6: Probar envío de correo (DESPUÉS DE 1-4 HORAS)

1. Ve a tu aplicación AL-E
2. Envía un correo de prueba a tu Gmail
3. Revisa Gmail → Abrir correo → Menú (3 puntos) → "Mostrar original"
4. Verifica que diga:
   ```
   SPF: PASS
   DKIM: PASS
   ```

---

## ⚠️ IMPORTANTE:

**EL REGISTRO DEBE QUEDAR ASÍ EN NETLIFY:**

```
Tipo: TXT
Nombre: hostingermail._domainkey
Valor: v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC... (LARGO)
```

**NO PONGAS** el dominio completo en el nombre. Por ejemplo:
- ❌ INCORRECTO: `hostingermail._domainkey.vitacard365.com`
- ✅ CORRECTO: `hostingermail._domainkey`

Netlify automáticamente agrega el dominio al final.

---

## 🕐 TIEMPO DE ESPERA:

Después de agregar los registros en Netlify:
- **Mínimo:** 1 hora
- **Normal:** 2-4 horas
- **Máximo:** 24 horas (raro)

**Mientras esperas**, puedes continuar trabajando en tu app. Los correos simplemente serán rechazados hasta que el DNS se propague.

---

## ✅ AVÍSAME:

1. ✅ Cuando copies el valor DKIM completo de Hostinger
2. ✅ Cuando agregues los 2 registros (SPF + DKIM) en Netlify
3. ⏳ Después de 1 hora, verificamos con `dig`
4. 🧪 Después de verificar, probamos enviar correo

---

## 🆘 SI NO ENCUENTRAS EL VALOR DKIM:

Si al hacer click en la fila no se abre nada:
1. Busca un botón "Ver detalles" o "View"
2. O busca "Registros DNS" o "DNS Records" en el menú lateral
3. O toma screenshot de lo que veas y te ayudo
