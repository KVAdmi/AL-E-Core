# 🚨 INSTRUCCIONES URGENTES PARA FRONTEND - CALENDAR RLS

**Fecha:** 11 de Enero de 2026  
**De:** AL-E Core (Backend)  
**Para:** AL-EON Frontend Team  
**Asunto:** SQLs de Calendar RLS ya están aplicados en Supabase

---

## ✅ CONFIRMACIÓN: SQLs APLICADOS EN SUPABASE

Frontend reporta que **YA EJECUTARON** los scripts SQL de diagnóstico/fix de Calendar RLS.

---

## 📋 LO QUE DEBEN HACER AHORA

### 1️⃣ **VALIDAR QUE EL PROBLEMA SE RESOLVIÓ**

Pidan al usuario que tenía el problema que:

```typescript
// 1. Intente crear un evento de calendario
const response = await fetch('/api/calendar/events', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    title: "Test Event",
    start_time: "2026-01-12T10:00:00Z",
    end_time: "2026-01-12T11:00:00Z",
    event_type: "meeting"
  })
});

const result = await response.json();
console.log('[TEST CALENDAR]', result);
```

**Resultado esperado:**
```json
{
  "success": true,
  "event": {
    "id": "uuid",
    "title": "Test Event",
    "owner_user_id": "uuid-del-usuario"
  }
}
```

**Si FALLA:**
```json
{
  "error": "RLS_POLICY_VIOLATION",
  "message": "new row violates row-level security policy"
}
```

---

### 2️⃣ **SI TODAVÍA FALLA → REPORTAR ESTOS DATOS**

Necesitamos del usuario problema:

```typescript
// Copien esto y ejecuten en su consola del navegador
const diagnostico = {
  userId: localStorage.getItem('userId'), // o donde guarden el ID
  token: localStorage.getItem('supabase.auth.token'), // JWT
  timestamp: new Date().toISOString(),
  
  // Intenten crear evento y capturen la respuesta completa
  errorCompleto: {
    status: response.status,
    statusText: response.statusText,
    body: await response.json()
  }
};

console.log('DIAGNOSTICO CALENDAR:', JSON.stringify(diagnostico, null, 2));
```

**Envíennos ese output completo.**

---

### 3️⃣ **VERIFICAR QUE ESTÁN ENVIANDO owner_user_id**

⚠️ **CRÍTICO:** Revisen su código de creación de eventos.

**❌ INCORRECTO (causaría RLS violation):**
```typescript
// NO envíen owner_user_id undefined/null
const body = {
  title: "Meeting",
  start_time: "...",
  end_time: "..."
  // ❌ Falta owner_user_id
};
```

**✅ CORRECTO:**
```typescript
// SÍ envíen owner_user_id con el userId del usuario logueado
const userId = getCurrentUserId(); // Su método para obtener userId

const body = {
  title: "Meeting",
  start_time: "...",
  end_time: "...",
  owner_user_id: userId  // ✅ DEBE estar presente
};
```

---

### 4️⃣ **REVISAR SU MÉTODO getCurrentUserId()**

El problema puede estar aquí:

```typescript
// ❌ MAL - puede retornar undefined
function getCurrentUserId() {
  return localStorage.getItem('userId'); // Si no existe → undefined
}

// ✅ BIEN - valida antes de usar
function getCurrentUserId() {
  const userId = localStorage.getItem('userId');
  if (!userId) {
    throw new Error('Usuario no autenticado');
  }
  return userId;
}
```

---

### 5️⃣ **VERIFICAR TOKEN JWT VÁLIDO**

Las policies de RLS usan `auth.uid()` que viene del JWT.

```typescript
// Agreguen esto ANTES de crear evento
const session = supabase.auth.getSession();
console.log('[AUTH CHECK]', {
  hasSession: !!session,
  userId: session?.user?.id,
  expiresAt: session?.expires_at
});

if (!session?.user?.id) {
  console.error('⚠️ NO HAY SESIÓN ACTIVA - Solicitar re-login');
  // Redirigir a login
}
```

---

### 6️⃣ **SI TODO FALLA → ESCALAMIENTO A CORE**

Envíennos:

```markdown
## Reporte de Error Calendar RLS

**Usuario problema:** `user@email.com` o `userId: uuid`
**Fecha/hora:** `2026-01-11 19:45:00`
**Navegador:** Chrome/Firefox/Safari + versión

### Datos enviados:
\`\`\`json
{
  "title": "...",
  "start_time": "...",
  "end_time": "...",
  "owner_user_id": "..."
}
\`\`\`

### Respuesta recibida:
\`\`\`json
{
  "error": "...",
  "message": "..."
}
\`\`\`

### Session check:
\`\`\`json
{
  "hasSession": true/false,
  "userId": "...",
  "expiresAt": "..."
}
\`\`\`

### Logs de consola:
\`\`\`
(copien los logs de la consola del navegador)
\`\`\`
```

---

## 🎯 RESUMEN EJECUTIVO

| Paso | Acción | Responsable | Tiempo |
|------|--------|-------------|--------|
| 1 | Validar creación de evento funciona | Frontend QA | 5 min |
| 2 | Si falla, recolectar diagnóstico | Frontend Dev | 10 min |
| 3 | Verificar owner_user_id se envía | Frontend Dev | 5 min |
| 4 | Revisar getCurrentUserId() | Frontend Dev | 5 min |
| 5 | Validar JWT activo | Frontend Dev | 5 min |
| 6 | Si persiste, escalar a Core | Frontend Lead | 2 min |

**Total:** 30 minutos máximo para diagnóstico completo.

---

## ✅ CONFIRMACIÓN DE RECEPCIÓN

**Frontend debe responder:**

```
✅ Recibido INSTRUCCIONES-FRONTEND-CALENDAR-RLS.md
✅ SQLs ya aplicados confirmado
✅ Iniciando validación con usuario problema
✅ ETA de reporte: [hora estimada]
```

---

## 📞 CONTACTO

- **Dudas técnicas:** Escalar a Core con datos completos
- **Validación exitosa:** Confirmar "Calendar RLS resuelto ✅"
- **Validación fallida:** Enviar reporte completo paso 6

---

**NOTA FINAL:** Si el usuario problema puede crear eventos ahora → **¡PROBLEMA RESUELTO!** Solo confirmen.

Si todavía falla → Necesitamos los datos del paso 6 para diagnóstico profundo en Supabase.

---

**Core Backend**  
11 de Enero de 2026  
commit: 26f1e6c
