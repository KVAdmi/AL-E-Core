# 🔐 ALERTA DE SEGURIDAD - AL-E Core

## ⚠️ Keys Detectadas en .env (Requieren Rotación)

Las siguientes API keys están expuestas en el archivo `.env` y fueron commiteadas al historial de Git:

### 🔑 Keys que DEBES rotar manualmente:

1. **OpenAI API Key** 
   - Key actual: `sk-proj-LazaL6_bByt_...` (primeros caracteres)
   - 🔗 Rotar en: https://platform.openai.com/api-keys
   - ⚡ Acción: Crear nueva key → Actualizar .env → Revocar la antigua

2. **Supabase Service Role Key**
   - Key actual: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (primeros caracteres)
   - 🔗 Rotar en: https://supabase.com/dashboard/project/settings/api
   - ⚡ Acción: Regenerar Service Role Key → Actualizar .env

3. **Supabase Database Password**
   - Password actual: `zoSxb4HJXu4hGTfm` (en connection string)
   - 🔗 Cambiar en: Supabase Dashboard → Settings → Database
   - ⚡ Acción: Cambiar password → Actualizar ALE_DB_URL

## ✅ Medidas de Protección Implementadas

- ✅ `.gitignore` creado - `.env` no se committeará más
- ✅ `.env.example` seguro para referencia
- ✅ Scripts de emergencia disponibles (no ejecutados por seguridad)

## 🛠️ Pasos Seguros para Rotar Keys

### Paso 1: Rotar OpenAI Key
```bash
# 1. Ve a https://platform.openai.com/api-keys
# 2. Crea nueva key
# 3. Actualiza .env con la nueva key
# 4. Revoca la key antigua
```

### Paso 2: Rotar Supabase Keys
```bash
# 1. Ve a tu proyecto Supabase → Settings → API
# 2. Regenera Service Role Key
# 3. Actualiza .env con la nueva key
```

### Paso 3: Actualizar en Producción
```bash
# En EC2:
cd /path/to/AL-E-Core
# Actualiza .env con las nuevas keys
pm2 restart al-e-core --update-env
```

## 📝 Estado Actual

- 🟢 **Local**: Protegido contra futuros commits
- 🟠 **Git History**: .env en historial (2 commits) - Keys expuestas
- 🟠 **GitHub**: Si está público, las keys son visibles

## ⚡ Prioridad ALTA

1. **Rotar OpenAI key** (costo por uso no autorizado)
2. **Rotar Supabase keys** (acceso completo a BD)
3. **Actualizar .env local**
4. **Actualizar .env en producción**

---
*Archivo generado automáticamente para protección de seguridad*