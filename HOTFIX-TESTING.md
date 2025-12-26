# HOTFIX: Identity Injection - Testing Plan

## 🎯 Objetivo
Eliminar respuestas genéricas tipo "no tengo capacidad de recordar" para usuarios autenticados.

## 📦 Cambios (Mínimos)
- Base: `6b7884e` (producción estable)
- Commit: `5776ea7`
- Files: 4 modificados, 1 nuevo (userProfile.ts)
- Lines: +130, -5

## ✅ Pre-requisitos

### 1. Verificar tabla user_profiles
```sql
-- En Supabase SQL Editor
SELECT user_id, display_name, role, email 
FROM user_profiles 
WHERE email = 'tu-email@luisatristain.com';
```

**Si no existe tu perfil**:
```sql
-- Obtener user_id de auth
SELECT id FROM auth.users WHERE email = 'tu-email@luisatristain.com';

-- Insertar perfil
INSERT INTO user_profiles (user_id, email, display_name, role)
VALUES ('<USER_ID_AQUI>', 'tu-email@luisatristain.com', 'Patto', 'founder');
```

### 2. Obtener JWT
- Abrir AL-EON en navegador
- DevTools → Network → /api/ai/chat
- Copiar: `Authorization: Bearer eyJhbGc...`

---

## 🧪 Test 1: Local (Opcional pero recomendado)

```bash
cd "/Users/pg/Documents/AL-E Core"
npm run build
node dist/index.js
```

En otra terminal:
```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Authorization: Bearer <TU_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"¿Sabes quién soy?"}],"mode":"aleon"}' \
  | jq .answer
```

**Logs esperados**:
```
[AUTH] ✓ User authenticated: <uuid> <email>
[IDENTITY] hasAuthHeader=true, user_uuid=<uuid>, identity_injected=true, identity_source=db
[PROVIDER] ✓ Identity injected: Patto
```

**Respuesta esperada**:
```
"Sí, eres Patto, founder..."
```

---

## 🚀 Deploy a Producción

### Paso 1: Merge a main
```bash
git checkout main
git merge hotfix/identity-injection
git push origin main
```

### Paso 2: Deploy en EC2
```bash
ssh -i ~/Downloads/mercado-pago.pem ubuntu@13.220.60.13

cd /home/ubuntu/AL-E-Core
git pull origin main
npm run build
pm2 restart al-e-core
pm2 logs al-e-core --lines 100
```

### Paso 3: Test en Producción
```bash
curl -X POST https://api.al-eon.com/api/ai/chat \
  -H "Authorization: Bearer <TU_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"¿Sabes quién soy?"}],"mode":"aleon"}' \
  | jq .
```

### Paso 4: Verificar logs en EC2
```bash
pm2 logs al-e-core --lines 50 | grep -E "IDENTITY|PROVIDER"
```

**Buscar**:
```
[IDENTITY] hasAuthHeader=true, identity_injected=true, identity_source=db
[PROVIDER] ✓ Identity injected: Patto
```

---

## ✅ Criterios de Aceptación

1. ✅ Usuario autenticado pregunta "¿sabes quién soy?"
2. ✅ Respuesta menciona nombre (Patto) y/o rol (founder)
3. ✅ NO aparece texto tipo "no tengo capacidad de recordar"
4. ✅ Logs confirman `identity_injected=true` y `identity_source=db`
5. ✅ NO hay errores en compilación ni runtime

---

## 🔄 Rollback (Si es necesario)

```bash
ssh -i ~/Downloads/mercado-pago.pem ubuntu@13.220.60.13
cd /home/ubuntu/AL-E-Core
git checkout 6b7884e
npm run build
pm2 restart al-e-core
```

---

## 📊 Diff Summary

```diff
+ src/services/userProfile.ts (67 lines)
  - getUserIdentity() - Query user_profiles
  - buildIdentityBlock() - NO PII

+ src/ai/IAssistantProvider.ts
  - UserIdentity interface
  - userIdentity? in AssistantRequest

+ src/ai/providers/OpenAIAssistantProvider.ts
  - Identity injection logic
  - Logs: [PROVIDER] ✓ Identity injected

+ src/api/chat.ts
  - Import getUserIdentity
  - Call before AssistantRequest
  - Logs: [IDENTITY] ...
```

---

**Status**: ✅ Ready for merge and deploy
**Date**: 25 dic 2025
**Commit**: `5776ea7`
