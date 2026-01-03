# 📦 DEPENDENCIAS REQUERIDAS - EMAIL HUB UNIVERSAL

## Instalar dependencias nuevas

```bash
cd "/Users/pg/Documents/AL-E Core"

# Instalar imapflow (reemplazo moderno de node-imap)
npm install imapflow

# Instalar tipos de mailparser
npm install --save-dev @types/mailparser
```

## Verificar instalación

```bash
npm list imapflow
npm list mailparser
npm list nodemailer
```

## Compilar y verificar

```bash
npm run build
```

Si hay errores de tipos, ejecuta:

```bash
npm install --save-dev @types/node
```

## Notas

- **imapflow**: Librería moderna para IMAP (mejor que node-imap)
- **mailparser**: Ya está instalado, solo falta @types/mailparser
- **nodemailer**: Ya está instalado con tipos
