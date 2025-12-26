# Testing Plan: Identity Injection Fix

## 📋 Resumen de Cambios

Branch: `fix/security-session-ownership`
Commits:
- `06e0da7` - Security guardrails + context protection
- `abb1770` - CRITICAL identity injection fix
- `fee2251` - Remove PII from prompts, use user_profiles table

---

## 🔒 Problema Resuelto

**BUG**: Con JWT válido, AL-E respondía "No tengo la capacidad de saber quién eres..."

**CAUSA**: El provider usaba system prompt estático sin inyectar información del usuario

**SOLUCIÓN**:
1. ✅ Created `userProfileService.ts` - Consulta `user_profiles` por `user_id`
2. ✅ Removed PII - NO email, NO UUID en prompts
3. ✅ Identity injection - Inyecta `display_name` y `role` desde DB
4. ✅ Fallback logic - "Usuario autenticado" si no hay perfil

---

## 🧪 Testing Obligatorio

### Prerequisitos

1. **Base de datos**: Verificar que existe perfil en `user_profiles`
```sql
-- Conectar a Supabase SQL Editor
SELECT user_id, display_name, role, email 
FROM user_profiles 
LIMIT 10;
```

Si no hay registros, crear uno de prueba:
```sql
-- Obtener tu user_id de auth.users
SELECT id, email FROM auth.users WHERE email = 'tu-email@ejemplo.com';

-- Insertar perfil
INSERT INTO user_profiles (user_id, email, display_name, role)
VALUES 
  ('UUID_DE_TU_USER', 'tu-email@ejemplo.com', 'Patto', 'founder');
```

2. **JWT Token**: Obtener desde DevTools del frontend
   - Abrir AL-EON en navegador
   - DevTools → Network tab
   - Hacer una pregunta
   - Buscar request `/api/ai/chat`
   - Copiar header: `Authorization: Bearer eyJhbGc...`

---

### Test 1: Verificar Identidad Inyectada

```bash
# Comando curl con JWT real
curl -X POST https://api.al-eon.com/api/ai/chat \
  -H "Authorization: Bearer <TU_JWT_AQUI>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "¿Sabes quién soy?"}],
    "mode": "aleon"
  }' | jq .
```

**Resultado Esperado**:
```json
{
  "answer": "Sí, eres Patto, founder de AL-EON...",
  "session_id": "...",
  "memories_to_add": []
}
```

**Resultado INCORRECTO** (el que se debe prevenir):
```json
{
  "answer": "No tengo la capacidad de saber quién eres...",
  ...
}
```

---

### Test 2: Verificar Logs en EC2

```bash
# SSH al servidor
ssh ubuntu@13.220.60.13

# Ver logs de PM2
pm2 logs al-e-core --lines 100 | grep -E "AUTH|PROVIDER|USER PROFILE|REQUEST CONTEXT"
```

**Logs Esperados**:

```
[AUTH] ✓ User authenticated: <uuid> <email>
[USER PROFILE] ✓ Profile loaded: Patto
[PROVIDER] ✓ Identity injected: name=Patto, role=founder
[REQUEST CONTEXT] {
  hasAuthHeader: true,
  user_uuid: <uuid>,
  identity_injected: true,
  memory_mode: auth-minimal
}
[REQUEST COMPLETE] { input_tokens: ..., output_tokens: ... }
```

**Logs INCORRECTOS** (indicarían bug):
```
[USER PROFILE] ⚠️ No profile found
[PROVIDER] ⚠️ No userId provided - guest mode
identity_injected: false
memory_mode: guest-minimal
```

---

### Test 3: Usuario sin Perfil (Fallback)

```bash
# Usar JWT de usuario que NO tiene entrada en user_profiles
curl -X POST https://api.al-eon.com/api/ai/chat \
  -H "Authorization: Bearer <JWT_SIN_PERFIL>" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hola"}],
    "mode": "aleon"
  }' | jq .answer
```

**Resultado Esperado**:
- Respuesta NO debe incluir "no tengo capacidad de recordar"
- Debe responder normalmente como asistente

**Logs Esperados**:
```
[USER PROFILE] ⚠️ No profile found
[PROVIDER] ✓ Identity injected (authenticated user without profile): userId=<uuid>
```

---

### Test 4: Usuario Guest (Sin JWT)

```bash
# Request sin Authorization header
curl -X POST https://api.al-eon.com/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hola"}],
    "mode": "aleon"
  }' | jq .
```

**Resultado Esperado**:
- Respuesta exitosa
- Sin identidad inyectada (OK para guest)

**Logs Esperados**:
```
[AUTH] No token provided - continuing as guest
[PROVIDER] ⚠️ No userId provided - guest mode
memory_mode: guest-minimal
```

---

## ✅ Criterios de Aceptación

Para aprobar el merge, TODOS estos deben cumplirse:

1. ✅ Test 1: Respuesta reconoce identidad ("Patto", "founder")
2. ✅ Test 2: Logs confirman `identity_injected: true` y `memory_mode: auth-*`
3. ✅ Test 3: Fallback funciona (usuario autenticado sin perfil)
4. ✅ Test 4: Guest mode sigue funcionando
5. ✅ NO aparece PII (email/UUID) en logs de provider
6. ✅ NO aparecen frases tipo "no tengo capacidad de recordar" con JWT

---

## 📊 Diff Resumen

### Archivos Nuevos:
- `src/services/userProfileService.ts` (134 líneas)

### Archivos Modificados:
- `src/ai/IAssistantProvider.ts` (+7 líneas: UserIdentity interface)
- `src/ai/providers/OpenAIAssistantProvider.ts` (~30 líneas cambiadas)
- `src/api/chat.ts` (+15 líneas: getUserIdentity call)
- `src/ai/prompts/aleon.ts` (+6 líneas: memory handling)
- `src/utils/contextGuard.ts` (NUEVO: 125 líneas)

### Cambios Clave:
```typescript
// ANTES (❌ exponía PII):
const identityBlock = `User ID: ${request.userId}, Email: ${request.userEmail}`;

// DESPUÉS (✅ solo datos seguros):
const identity = await getUserIdentity(userId); // DB query
const identityBlock = buildIdentityBlock(identity); // "Nombre: Patto, Rol: founder"
```

---

## 🚨 IMPORTANTE

**NO HACER DEPLOY SIN**:
1. Verificar que tabla `user_profiles` existe en producción
2. Confirmar que tu usuario tiene entrada en `user_profiles`
3. Ejecutar los 4 tests y validar logs
4. Adjuntar evidencia de logs en PR (screenshot o texto)

**ROLLBACK PLAN**:
Si hay problemas en producción:
```bash
cd /var/www/al-e-core
git fetch origin main
git checkout main
npm run build
pm2 restart al-e-core
```

---

## 📝 Comandos de Deploy (Cuando esté aprobado)

```bash
# 1. SSH al servidor
ssh ubuntu@13.220.60.13

# 2. Navegar al repo
cd /var/www/al-e-core

# 3. Fetch latest
git fetch origin

# 4. Merge PR branch (después de aprobación)
git checkout main
git merge origin/fix/security-session-ownership

# 5. Rebuild
npm run build

# 6. Restart PM2
pm2 restart al-e-core

# 7. Verificar logs
pm2 logs al-e-core --lines 50
```

---

**Fecha de Testing**: 25 de diciembre de 2025
**Tester**: Patto
**Status**: Pendiente validación con JWT real
