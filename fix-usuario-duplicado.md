# 🔴 ERROR: No puedo crear usuario nuevo

## Problema

```
Error al registrarse
Database error saving new user
```

## Causa

El email **`p.garibay@infinitykode.com`** ya existe en Supabase Auth.

Cuando intentas crear una cuenta nueva con el mismo email, Supabase rechaza la operación.

---

## ✅ Solución

### Opción 1: Usar el usuario existente (RECOMENDADO)

**Si ya tienes cuenta, simplemente inicia sesión:**

1. Click en "¿Ya tienes cuenta? Inicia sesión"
2. Usa las credenciales existentes
3. Listo ✅

---

### Opción 2: Crear con un email diferente

Si quieres crear una cuenta totalmente nueva:

```
Email: patricia.garibay@otro-dominio.com
Contraseña: (nueva contraseña)
```

---

### Opción 3: Borrar el usuario existente (SOLO SI ES NECESARIO)

⚠️ **CUIDADO:** Esto borrará TODOS los datos asociados al usuario.

**Pasos en Supabase Dashboard:**

1. Ir a https://supabase.com/dashboard/project/gptwzuqmuvzttajgjrry
2. Authentication → Users
3. Buscar `p.garibay@infinitykode.com`
4. Click en los 3 puntos → "Delete user"
5. Confirmar

**Luego podrás crear el usuario de nuevo.**

---

## 🔍 Verificar si el usuario existe

Puedes ejecutar esto en **Supabase SQL Editor**:

```sql
-- Ver usuarios en auth.users
SELECT id, email, created_at, confirmed_at, last_sign_in_at
FROM auth.users
WHERE email = 'p.garibay@infinitykode.com';

-- Ver datos del usuario en ae_user_profiles
SELECT *
FROM ae_user_profiles
WHERE user_email = 'p.garibay@infinitykode.com';
```

---

## 📋 Checklist

- [ ] Verificar si el usuario ya existe en Supabase Auth
- [ ] **Opción A:** Iniciar sesión con credenciales existentes
- [ ] **Opción B:** Crear cuenta con email diferente
- [ ] **Opción C:** Borrar usuario existente y recrear

---

## 🎯 Recomendación

Si el objetivo es **probar el sistema**, usa **Opción 1** (iniciar sesión).

Si el objetivo es **crear un usuario nuevo para otra persona**, usa **Opción 2** (email diferente).

Solo usa **Opción 3** si estás segura de querer borrar todos los datos del usuario existente.
