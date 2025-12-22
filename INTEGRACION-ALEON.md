# 🎯 INTEGRACIÓN AL-EON ↔ AL-E CORE

## 📐 ARQUITECTURA CORRECTA

```
┌─────────────────────────────────────────────────┐
│  FRONTEND (AL-EON)                              │
│  - Define su backend URL vía env var           │
│  - Gestiona userId                              │
│  - Guarda/envía sessionId                       │
└─────────────────┬───────────────────────────────┘
                  │
                  │ HTTP POST/GET
                  │ (dominio configurable)
                  ▼
┌─────────────────────────────────────────────────┐
│  BACKEND (AL-E CORE)                            │
│  - Endpoints relativos agnósticos               │
│  - No conoce dominios de cliente                │
│  - Guarda todo en Supabase                      │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  SUPABASE                                        │
│  - ae_sessions                                   │
│  - ae_messages                                   │
│  - ae_requests                                   │
└──────────────────────────────────────────────────┘
```

---

## ⚙️ CONFIGURACIÓN POR PLATAFORMA

### AL-EON (Frontend)

```bash
# .env.local o .env.production
VITE_ALE_CORE_URL=https://tu-backend.dominio.com
# O para local:
VITE_ALE_CORE_URL=http://localhost:4000
```

### AL-E CORE (Backend)

```bash
# .env - Solo configuración de infraestructura
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
OPENAI_API_KEY=...

# CORS: allowlist de dominios frontend
ALE_ALLOWED_ORIGINS=https://aleon.dominio.com,https://otro.dominio.com

# Opcional
ASSISTANT_ID=al-e
DEFAULT_WORKSPACE_ID=default
DEFAULT_MODE=universal
```

**✅ NO hay URLs de frontend hardcodeadas**  
**✅ NO hay lógica condicional por dominio**  
**✅ Cada cliente define su propia URL de backend**

---

## 💻 CÓDIGO FRONTEND (AL-EON)

### 1. Configurar cliente API

```typescript
// lib/ale-core-client.ts
const BACKEND_URL = import.meta.env.VITE_ALE_CORE_URL;

if (!BACKEND_URL) {
  throw new Error('VITE_ALE_CORE_URL no está configurado');
}

export const aleCoreClient = {
  async chat(params: {
    userId: string;
    sessionId?: string | null;
    messages: Array<{ role: string; content: string }>;
    workspaceId?: string;
    mode?: string;
  }) {
    const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: params.userId,
        sessionId: params.sessionId || null,
        messages: params.messages,
        workspaceId: params.workspaceId || 'default',
        mode: params.mode || 'universal',
      }),
    });

    if (!response.ok) {
      throw new Error(`Chat failed: ${response.statusText}`);
    }

    return response.json();
  },

  async getSessions(userId: string, workspaceId = 'default') {
    const response = await fetch(
      `${BACKEND_URL}/api/sessions?userId=${userId}&workspaceId=${workspaceId}`
    );
    return response.json();
  },

  async getMessages(sessionId: string, userId: string, workspaceId = 'default') {
    const response = await fetch(
      `${BACKEND_URL}/api/sessions/${sessionId}/messages?userId=${userId}&workspaceId=${workspaceId}`
    );
    return response.json();
  },

  async updateSession(
    sessionId: string,
    userId: string,
    updates: { pinned?: boolean; archived?: boolean; title?: string }
  ) {
    const response = await fetch(`${BACKEND_URL}/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, ...updates }),
    });
    return response.json();
  },
};
```

### 2. Hook de React para chat

```typescript
// hooks/useChat.ts
import { useState, useEffect } from 'react';
import { aleCoreClient } from '@/lib/ale-core-client';

export function useChat(userId: string) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Cargar sessionId del localStorage al montar
  useEffect(() => {
    const stored = localStorage.getItem(`chat_session_${userId}`);
    if (stored) {
      setSessionId(stored);
      // Opcional: cargar historial de mensajes
      loadMessages(stored);
    }
  }, [userId]);

  const loadMessages = async (sid: string) => {
    try {
      const data = await aleCoreClient.getMessages(sid, userId);
      setMessages(data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const sendMessage = async (content: string) => {
    setLoading(true);
    
    // Agregar mensaje del usuario localmente (optimistic update)
    const userMsg = { role: 'user', content, created_at: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    try {
      const response = await aleCoreClient.chat({
        userId,
        sessionId,
        messages: [{ role: 'user', content }],
      });

      // Guardar session_id si es nuevo
      if (response.session_id && !sessionId) {
        setSessionId(response.session_id);
        localStorage.setItem(`chat_session_${userId}`, response.session_id);
      }

      // Agregar respuesta del assistant
      const assistantMsg = {
        role: 'assistant',
        content: response.answer,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      return response;
    } catch (error) {
      console.error('Error sending message:', error);
      // Remover mensaje optimista si falló
      setMessages(prev => prev.slice(0, -1));
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const startNewChat = () => {
    setSessionId(null);
    setMessages([]);
    localStorage.removeItem(`chat_session_${userId}`);
  };

  return {
    messages,
    sendMessage,
    startNewChat,
    sessionId,
    loading,
  };
}
```

### 3. Componente de UI

```typescript
// components/Chat.tsx
import { useChat } from '@/hooks/useChat';

export function Chat({ userId }: { userId: string }) {
  const { messages, sendMessage, startNewChat, loading } = useChat(userId);
  const [input, setInput] = useState('');

  const handleSend = async () => {
    if (!input.trim()) return;
    
    await sendMessage(input);
    setInput('');
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <button onClick={startNewChat}>Nueva Conversación</button>
      </div>

      <div className="messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
      </div>

      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          disabled={loading}
        />
        <button onClick={handleSend} disabled={loading}>
          Enviar
        </button>
      </div>
    </div>
  );
}
```

---

## 🔑 CONCEPTOS CLAVE

### userId
- String único que identifica al usuario
- Puede ser email, username, UUID, etc.
- **El frontend lo gestiona** (desde auth, localStorage, etc.)
- Se envía en CADA request a AL-E CORE

### sessionId
- UUID que identifica una conversación específica
- **Lo crea el backend** en el primer mensaje
- **El frontend lo guarda** (localStorage/state)
- Se envía en mensajes subsiguientes de la misma conversación
- `null` o ausente = nueva conversación

### workspaceId
- Namespace para organizar sesiones
- Por defecto: `"default"`
- Útil para multi-tenant o áreas diferentes

### Flujo de datos:

```
Primera vez:
AL-EON → {userId, messages} → AL-E CORE
AL-E CORE → Crea sesión → {answer, session_id}
AL-EON → Guarda session_id en localStorage

Mensajes siguientes:
AL-EON → {userId, sessionId, messages} → AL-E CORE
AL-E CORE → Usa sesión existente → {answer, session_id}
```

---

## ✅ CHECKLIST DE INTEGRACIÓN

### Backend (AL-E CORE)
- [x] Endpoints expuestos como rutas relativas
- [x] No construye URLs de cliente
- [x] CORS configurado por allowlist
- [x] Guarda automáticamente en Supabase
- [x] Maneja errores sin romper chat

### Frontend (AL-EON)
- [ ] Variable `VITE_ALE_CORE_URL` configurada
- [ ] Cliente API implementado (`aleCoreClient`)
- [ ] Hook `useChat` o similar para gestión de estado
- [ ] Guardar `sessionId` en localStorage/state
- [ ] Enviar `userId` en cada request
- [ ] Botón "Nueva conversación" limpia sessionId

---

## 🐛 DEBUGGING

### 1. Verificar conectividad

```typescript
// En consola del navegador (AL-EON)
fetch('http://localhost:4000/api/ai/ping')
  .then(r => r.json())
  .then(console.log);

// Debe responder: {status: "AL-E CORE ONLINE", ...}
```

### 2. Ver requests en Network tab

- Abrir DevTools → Network
- Filtrar por `/api/ai/chat`
- Ver Request Payload:
  ```json
  {
    "userId": "debe-estar-presente",
    "messages": [...],
    "sessionId": "uuid-o-null"
  }
  ```
- Ver Response:
  ```json
  {
    "answer": "...",
    "session_id": "uuid",
    "memories_to_add": []
  }
  ```

### 3. Logs del backend

```bash
# Si usas PM2
pm2 logs al-e-core --lines 50

# Buscar:
# [CHAT] userId: ...
# [DB] ✓ Mensaje user guardado: ...
# [DB] ✓ Mensaje assistant guardado: ...
```

### 4. Verificar en Supabase

```sql
-- Ver sesiones del usuario
SELECT id, title, total_messages, last_message_at 
FROM ae_sessions 
WHERE user_id_old = 'tu-user-id'
ORDER BY created_at DESC;

-- Ver mensajes de una sesión
SELECT role, content, created_at 
FROM ae_messages 
WHERE session_id = 'session-uuid'
ORDER BY created_at;
```

---

## 🚨 ERRORES COMUNES

### "userId es requerido"
→ Frontend no está enviando `userId` en el body

### "Session not found"
→ El `sessionId` es inválido o no coincide con el userId

### CORS error
→ Agregar dominio de frontend a `ALE_ALLOWED_ORIGINS` en backend

### Sesión nueva en cada mensaje
→ Frontend no está guardando/enviando el `sessionId` devuelto

---

## 📚 RECURSOS

- **Backend endpoints:** Ver `src/api/chat.ts` y `src/api/sessions.ts`
- **Pruebas manuales:** Ver `TESTING-SUPABASE.md`
- **Variables de entorno:** Ver `src/config/env.ts`

---

**PRINCIPIO CLAVE:** AL-E CORE es agnóstico al dominio. Las URLs las define cada plataforma cliente.
