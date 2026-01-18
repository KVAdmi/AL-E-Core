# 🔍 Validación Telegram Frontend - Instrucciones

**Fecha:** 17 de enero de 2026  
**Estado Backend:** ✅ Bot @Patty_ALE_bot activo en DB  
**Problema:** Frontend NO muestra el bot registrado

---

## 📋 Paso 1: Validar Query desde DevTools

Abre el navegador en tu frontend (`http://localhost:5173` o producción) y ejecuta esto en la **consola de DevTools**:

```javascript
// 1️⃣ Verificar token JWT
const token = localStorage.getItem('supabase.auth.token');
if (!token) {
  console.error('❌ NO HAY TOKEN - Usuario no autenticado');
} else {
  const parsed = JSON.parse(token);
  console.log('✅ Token encontrado:', {
    userId: parsed.user?.id,
    email: parsed.user?.email,
    expira: new Date(parsed.expires_at * 1000)
  });
}

// 2️⃣ Probar endpoint de bots
const response = await fetch('https://api.al-eon.com/api/telegram/bots', {
  method: 'GET',
  headers: {
    'Authorization': `Bearer ${JSON.parse(token).access_token}`,
    'Content-Type': 'application/json'
  }
});

const result = await response.json();
console.log('📡 Response /api/telegram/bots:', result);

// ESPERADO: { ok: true, bots: [{ id, bot_username: "Patty_ALE_bot", ... }] }
```

---

## 📋 Paso 2: Auditar Código Frontend

### 2.1 Verificar `telegramService.js`

Ve a: `/src/services/telegramService.js`

**Buscar función que obtiene lista de bots:**
```javascript
// ¿Está usando el endpoint correcto?
// Debe ser: GET /api/telegram/bots
// Con header: Authorization: Bearer <JWT>
```

**Checklist:**
- [ ] ¿Usa `aleCoreClient.get('/api/telegram/bots')`?
- [ ] ¿Devuelve `response.data.bots` correctamente?
- [ ] ¿Maneja errores con try/catch?

---

### 2.2 Verificar `TelegramPage.jsx`

Ve a: `/src/pages/TelegramPage.jsx`

**Buscar el useEffect que carga bots:**
```javascript
useEffect(() => {
  const loadBots = async () => {
    // ¿Llama a telegramService?
    // ¿Guarda resultado en state?
  };
  loadBots();
}, []);
```

**Checklist:**
- [ ] ¿Llama al service correcto al montar?
- [ ] ¿Guarda resultado en `const [bots, setBots] = useState([])`?
- [ ] ¿Renderiza la lista con `.map()`?
- [ ] ¿Muestra loader mientras carga?
- [ ] ¿Muestra mensaje de error si falla?

---

### 2.3 Verificar Renderizado

**Buscar el JSX que muestra la lista:**
```jsx
{bots.length === 0 ? (
  <div>No hay bots registrados</div>
) : (
  bots.map(bot => (
    <div key={bot.id}>
      <span>@{bot.bot_username}</span>
      <Badge>{bot.is_active ? 'Activo' : 'Inactivo'}</Badge>
    </div>
  ))
)}
```

**Checklist:**
- [ ] ¿Hay fallback para `bots.length === 0`?
- [ ] ¿Usa `bot.bot_username` correcto (no `bot.username`)?
- [ ] ¿Key única con `bot.id`?

---

## 🐛 Problemas Comunes

### Problema 1: Query devuelve array vacío `[]`
**Causa:** El `owner_user_id` del bot en DB no coincide con el `userId` del JWT.

**Fix:** Ejecutar en Supabase SQL Editor:
```sql
-- Ver qué userId tiene el token
SELECT auth.uid() AS current_user_id;

-- Ver qué userId tiene el bot
SELECT id, owner_user_id, bot_username 
FROM telegram_bots 
WHERE bot_username = 'Patty_ALE_bot';

-- Si no coinciden, actualizar:
UPDATE telegram_bots 
SET owner_user_id = (SELECT auth.uid())
WHERE bot_username = 'Patty_ALE_bot';
```

---

### Problema 2: Error 401 Unauthorized
**Causa:** Token JWT expirado o header Authorization incorrecto.

**Fix:** Verificar en DevTools:
```javascript
const token = JSON.parse(localStorage.getItem('supabase.auth.token'));
console.log('Expira:', new Date(token.expires_at * 1000));
// Si expiró, hacer logout/login
```

---

### Problema 3: Frontend no hace la query
**Causa:** `useEffect` no se ejecuta o tiene dependencia incorrecta.

**Fix en `TelegramPage.jsx`:**
```javascript
useEffect(() => {
  console.log('🔄 LOADING BOTS...');
  loadBots();
}, []); // ← Debe estar vacío [] para ejecutar al montar
```

---

## ✅ Resultado Esperado

Después de ejecutar el script de DevTools, deberías ver:
```javascript
✅ Token encontrado: { userId: "56bc3448-...", email: "..." }
📡 Response /api/telegram/bots: {
  ok: true,
  bots: [
    {
      id: "uuid-aqui",
      bot_username: "Patty_ALE_bot",
      is_active: true,
      webhook_url: "https://api.al-eon.com/api/telegram/webhook/..."
    }
  ]
}
```

Y en la UI del frontend debería aparecer:
```
🤖 Bots de Telegram
┌──────────────────────────┐
│ @Patty_ALE_bot    [Activo] │
└──────────────────────────┘
```

---

## 📤 Reportar Resultados

Después de ejecutar el Paso 1 (DevTools), copia el output completo y mándalo.

Formato:
```
RESULTADO VALIDACIÓN TELEGRAM:
1. Token JWT: [OK/ERROR]
2. API Response: [copiar JSON completo]
3. Errores en consola: [copiar si hay]
```

Entonces te diré exactamente qué archivos modificar en el frontend.
