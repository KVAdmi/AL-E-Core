# 📋 INSTRUCCIONES HOSTINGER - PASO A PASO

**Fecha:** 9 de enero de 2026  
**Tiempo estimado:** 15 minutos + 1-4 horas propagación DNS  
**Dominios a configurar:** infinitykode.com, vitacard365.com

---

## 🎯 OBJETIVO

Cambiar de **Gmail SMTP** (que rechaza correos) a **Hostinger SMTP** + configurar SPF/DKIM para que Gmail acepte los correos.

---

## 📝 PASO 1: ENTRAR A HOSTINGER

1. Ve a: https://hpanel.hostinger.com
2. Inicia sesión con tu cuenta de Hostinger
3. En el panel principal, busca tus dominios

---

## 📧 PASO 2: VERIFICAR CUENTAS DE CORREO

### Para infinitykode.com:

1. En Hostinger Panel → **Correos** (o "Emails")
2. Selecciona el dominio: **infinitykode.com**
3. Busca o crea la cuenta: **p.garibay@infinitykode.com**
4. Si NO existe, créala:
   - Click "Crear cuenta de correo"
   - Usuario: `p.garibay`
   - Contraseña: **[Anótala, la necesitarás]**
   - Click "Crear"

5. **ANOTA LA CONTRASEÑA** de `p.garibay@infinitykode.com`

### Para vitacard365.com:

1. En Hostinger Panel → **Correos**
2. Selecciona el dominio: **vitacard365.com**
3. Busca o crea la cuenta que usas para enviar correos
4. **ANOTA LA CONTRASEÑA**

---

## 🔐 PASO 3: CONFIGURAR SPF (Sender Policy Framework)

### Para infinitykode.com:

1. En Hostinger Panel → **Dominios** → **infinitykode.com**
2. Click en **Zona DNS** (o "DNS Zone Editor")
3. Busca si ya existe un registro TXT con "spf"
   - Si existe y dice algo como `v=spf1 include:_spf.google.com`, **REEMPLÁZALO**
   - Si NO existe, agrégalo nuevo

4. **Agregar/Editar registro SPF:**
   ```
   Tipo: TXT
   Nombre: @ 
   (o déjalo en blanco, o escribe "infinitykode.com")
   
   Valor: v=spf1 include:_spf.hostinger.com ~all
   
   TTL: 14400 (o déjalo en default)
   ```

5. Click **Guardar** o **Add Record**

### Para vitacard365.com:

**MISMO PROCESO:**
1. Hostinger Panel → **Dominios** → **vitacard365.com**
2. Zona DNS
3. Agregar/Editar registro TXT:
   ```
   Tipo: TXT
   Nombre: @
   Valor: v=spf1 include:_spf.hostinger.com ~all
   TTL: 14400
   ```

---

## 🔏 PASO 4: CONFIGURAR DKIM (DomainKeys Identified Mail)

### Para infinitykode.com:

1. En Hostinger Panel → **Correos** → **infinitykode.com**
2. Busca la opción **DKIM** o **"Autenticación de correo"**
3. Click en **Habilitar DKIM** (o "Enable DKIM")
4. Hostinger te mostrará un registro TXT, algo como:
   ```
   Nombre: default._domainkey
   Valor: v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GN...
   ```

5. **COPIA TODO EL VALOR** (el que empieza con `v=DKIM1; k=rsa; p=...`)

6. Ve a **Dominios** → **infinitykode.com** → **Zona DNS**
7. Agregar nuevo registro:
   ```
   Tipo: TXT
   Nombre: default._domainkey
   Valor: [PEGA EL VALOR QUE COPIASTE DE HOSTINGER]
   TTL: 14400
   ```

8. Click **Guardar**

### Para vitacard365.com:

**MISMO PROCESO:**
1. Correos → vitacard365.com → DKIM → Habilitar
2. Copiar el valor del registro DKIM
3. Dominios → vitacard365.com → Zona DNS
4. Agregar registro TXT:
   ```
   Tipo: TXT
   Nombre: default._domainkey
   Valor: [VALOR COPIADO DE HOSTINGER]
   TTL: 14400
   ```

---

## ⏱️ PASO 5: ESPERAR PROPAGACIÓN DNS

**NO PUEDES SALTAR ESTE PASO**

1. Después de guardar SPF y DKIM, espera **mínimo 1 hora**, máximo 4 horas
2. Los cambios DNS tardan en propagarse por internet
3. Mientras esperas, continúa con el PASO 6

---

## 💾 PASO 6: ACTUALIZAR SUPABASE (MIENTRAS ESPERAS DNS)

1. Ve a: https://supabase.com/dashboard
2. Entra a tu proyecto AL-E
3. Click en **Table Editor** (lado izquierdo)
4. Selecciona la tabla: **email_accounts**

### Para la cuenta de infinitykode.com:

5. Busca la fila donde `from_email = 'p.garibay@infinitykode.com'`
6. Click en la fila para editarla
7. **CAMBIA ESTOS CAMPOS:**
   ```
   smtp_host: smtp.hostinger.com
   smtp_port: 465
   smtp_secure: true
   smtp_user: p.garibay@infinitykode.com
   ```

8. Para `smtp_pass_enc` necesitas **CIFRAR LA CONTRASEÑA**:
   - Ve a: https://al-eon.com/admin (o donde tengas herramienta de cifrado)
   - O déjame saber y te ayudo a cifrarla
   - O temporalmente usa la contraseña en texto plano y lo ciframos después (NO recomendado)

9. Click **Save** o **Update**

### Para otras cuentas (si las hay):

10. Repite el proceso para `vitacard365.com` u otras cuentas

---

## 🧪 PASO 7: VERIFICAR DNS (DESPUÉS DE 1-4 HORAS)

**Abre Terminal en tu Mac:**

```bash
# Verificar SPF de infinitykode.com
dig TXT infinitykode.com +short

# Debe mostrar algo como:
# "v=spf1 include:_spf.hostinger.com ~all"
```

```bash
# Verificar DKIM de infinitykode.com
dig TXT default._domainkey.infinitykode.com +short

# Debe mostrar algo como:
# "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3..."
```

```bash
# Verificar SPF de vitacard365.com
dig TXT vitacard365.com +short
```

```bash
# Verificar DKIM de vitacard365.com
dig TXT default._domainkey.vitacard365.com +short
```

**SI NO APARECE NADA:**
- Espera más tiempo (hasta 24 horas en casos raros)
- Verifica que guardaste correctamente en Zona DNS
- Verifica que el nombre del registro sea exacto: `@` para SPF y `default._domainkey` para DKIM

---

## ✅ PASO 8: PROBAR ENVÍO DE CORREO

1. Ve a: https://al-eon.com/correo
2. Click "Nuevo correo"
3. Envía un correo de prueba **a tu Gmail personal**
4. Espera 30 segundos
5. Revisa tu Gmail

**SI LLEGA EL CORREO:**
1. ✅ Abre el correo
2. Click en los 3 puntitos (arriba derecha)
3. Click "Mostrar original" o "Show original"
4. Verifica que diga:
   ```
   SPF: PASS
   DKIM: PASS
   ```

**SI NO LLEGA O SIGUE RECHAZANDO:**
- Verifica que pasaron 1-4 horas desde configurar DNS
- Verifica que los registros DNS aparecen con `dig` (PASO 7)
- Verifica que actualizaste Supabase con credenciales de Hostinger (PASO 6)
- Mira logs del backend:
  ```bash
  ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233
  pm2 logs al-e-core --lines 50 | grep "SMTP"
  ```

---

## 🔧 PASO 9: CIFRAR CONTRASEÑA DE HOSTINGER (SEGURIDAD)

**Si pusiste la contraseña en texto plano en Supabase**, necesitas cifrarla:

### Opción A: Usar el backend

```bash
# Conectar a servidor
ssh -i ~/Downloads/mercado-pago.pem ubuntu@100.27.201.233

# Entrar a la carpeta del proyecto
cd /home/ubuntu/AL-E-Core

# Ejecutar script de cifrado (si existe)
node -e "
const { encryptCredential } = require('./dist/utils/emailEncryption');
const password = 'TU_PASSWORD_HOSTINGER_AQUI';
console.log('Password cifrado:', encryptCredential(password));
"
```

### Opción B: Crear endpoint temporal

Te puedo crear un endpoint `/api/encrypt-password` que cifre la contraseña y luego lo borras.

---

## 📊 RESUMEN DE CONFIGURACIÓN HOSTINGER

### Datos de conexión SMTP de Hostinger:

```
Host: smtp.hostinger.com
Puerto: 465 (SSL) o 587 (TLS)
Seguridad: SSL (usar 465)
Usuario: tu-email@tudominio.com (ej: p.garibay@infinitykode.com)
Contraseña: [La que configuraste en Hostinger]
```

### Datos de conexión IMAP de Hostinger (para recibir):

```
Host: imap.hostinger.com
Puerto: 993 (SSL) o 143 (STARTTLS)
Seguridad: SSL (usar 993)
Usuario: tu-email@tudominio.com
Contraseña: [La misma que SMTP]
```

---

## ❓ PREGUNTAS FRECUENTES

### ¿Por qué no usar Gmail SMTP?
Porque Gmail solo te deja enviar correos con TU dirección de Gmail. Si intentas enviar desde `p.garibay@infinitykode.com`, Gmail lo reescribe a `kodigovivo@gmail.com` y luego lo rechazan.

### ¿Cuánto tarda la propagación DNS?
- Mínimo: 1 hora
- Normal: 2-4 horas
- Máximo: 24-48 horas (raro)

### ¿Qué pasa si me equivoco en el registro DNS?
- Simplemente edítalo de nuevo en Hostinger
- Espera otra hora para que se propague el cambio

### ¿Puedo seguir recibiendo correos mientras configuro?
- Sí, los correos entrantes NO se afectan
- Solo afecta el ENVÍO de correos

### ¿Necesito hacer esto para cada dominio?
- Sí, cada dominio necesita su propio SPF y DKIM
- infinitykode.com → SPF + DKIM
- vitacard365.com → SPF + DKIM

---

## 🆘 SI ALGO SALE MAL

### Error: "Registro SPF no se guarda"
- Verifica que el nombre sea `@` o el dominio completo
- Algunos paneles requieren el dominio completo: `infinitykode.com`
- Contacta soporte de Hostinger si no funciona

### Error: "No encuentro la opción DKIM"
- Busca "Email Authentication" o "Autenticación"
- Puede estar en: Correos → [Dominio] → Configuración
- Contacta soporte de Hostinger para que lo habiliten

### Error: "No puedo editar Supabase"
- Necesitas permisos de administrador en el proyecto
- O dame acceso y lo actualizo yo

### Error: "Sigo sin poder enviar correos"
1. Verifica DNS con `dig` (PASO 7)
2. Verifica que actualizaste Supabase (PASO 6)
3. Espera 4 horas completas desde el cambio DNS
4. Mira logs del backend con `pm2 logs`
5. Si nada funciona, avísame con los logs

---

## ✅ CHECKLIST FINAL

**Antes de terminar, verifica:**

- [ ] ✅ Cuentas de correo creadas en Hostinger (p.garibay@infinitykode.com)
- [ ] ✅ Contraseñas anotadas en lugar seguro
- [ ] ✅ Registro SPF agregado en DNS de infinitykode.com
- [ ] ✅ Registro SPF agregado en DNS de vitacard365.com
- [ ] ✅ DKIM habilitado en Hostinger para infinitykode.com
- [ ] ✅ Registro DKIM agregado en DNS de infinitykode.com
- [ ] ✅ DKIM habilitado en Hostinger para vitacard365.com
- [ ] ✅ Registro DKIM agregado en DNS de vitacard365.com
- [ ] ⏳ Esperado 1-4 horas para propagación DNS
- [ ] ✅ Verificado con `dig` que aparecen los registros
- [ ] ✅ Actualizado Supabase con smtp.hostinger.com
- [ ] ✅ Contraseña cifrada en Supabase (seguridad)
- [ ] ✅ Probado envío de correo a Gmail
- [ ] ✅ Verificado que llega con SPF: PASS y DKIM: PASS

---

**Tiempo estimado total:**
- Configuración: 15 minutos
- Propagación DNS: 1-4 horas
- Pruebas: 5 minutos

**AVÍSAME cuando termines cada paso para verificar que todo esté correcto.**
