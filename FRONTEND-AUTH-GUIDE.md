# 🔐 GUÍA DE AUTENTICACIÓN: Frontend → AL-E Core Backend

## PROBLEMA ACTUAL

El frontend está llamando a rutas que requieren autenticación **SIN enviar el token JWT**, causando errores 401 en:
- ❌ Configuración de Telegram
- ❌ Creación de cuentas de correo
- ❌ Envío de correos
- ❌ Lectura de mensajes
- ❌ Gestión de contactos

---

## ARQUITECTURA DE AUTENTICACIÓN

```
┌─────────────────────────────────────────────────┐
│  FLUJO CORRECTO DE AUTENTICACIÓN                │
├─────────────────────────────────────────────────┤
│                                                 │
│  1. Usuario hace login en Supabase             │
│     → Frontend: supabase.auth.signInWithPassword()
│     → Supabase devuelve: session { access_token }
│                                                 │
│  2. Frontend guarda el token                    │
│     → localStorage.setItem('sb-access-token', token)
│     → O usar: supabase.auth.getSession()        │
│                                                 │
│  3. Frontend incluye token en TODAS las llamadas API
│     → Header: Authorization: Bearer <token>     │
│                                                 │
│  4. Backend valida token con Supabase           │
│     → Middleware: requireAuth()                 │
│     → Si válido: req.user = { id, email }       │
│     → Si inválido: 401 Unauthorized             │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## IMPLEMENTACIÓN CORRECTA EN FRONTEND

### ✅ OPCIÓN 1: Usar Supabase Client (RECOMENDADO)

```typescript
import { createClient } from '@supabase/supabase-js'

// 1. Inicializar cliente Supabase
const supabase = createClient(
  'https://gptwzuqmuvzttajgjrry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDU1NzAsImV4cCI6MjA2ODA4MTU3MH0.AAbVhdrI7LmSPKKRX0JhSkYxVg7VOw-ccizKTOh7pV8'
)

// 2. Login del usuario
async function login(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  })
  
  if (error) throw error
  
  // ✅ Token disponible en: data.session.access_token
  console.log('Token:', data.session.access_token)
  return data.session
}

// 3. Llamar API de AL-E Core con token
async function configureEmailAccount(accountData: any) {
  // 3.1 Obtener token actual
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    throw new Error('Usuario no autenticado')
  }
  
  // 3.2 Hacer llamada con token en header
  const response = await fetch('http://100.27.201.233:3000/api/email-hub/accounts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}` // ← CRÍTICO
    },
    body: JSON.stringify(accountData)
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Error al configurar cuenta')
  }
  
  return response.json()
}

// 4. Configurar Telegram Bot
async function configureTelegramBot(botData: any) {
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    throw new Error('Usuario no autenticado')
  }
  
  const response = await fetch('http://100.27.201.233:3000/api/telegram/bots', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}` // ← CRÍTICO
    },
    body: JSON.stringify(botData)
  })
  
  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.message || 'Error al configurar bot')
  }
  
  return response.json()
}
```

---

### ✅ OPCIÓN 2: Crear un HTTP Client con Token Automático

```typescript
// src/lib/api-client.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

/**
 * Cliente HTTP que incluye automáticamente el token de autenticación
 */
export class ApiClient {
  private baseUrl = 'http://100.27.201.233:3000'
  
  /**
   * Hacer request autenticado
   */
  async request(endpoint: string, options: RequestInit = {}) {
    // 1. Obtener token actual
    const { data: { session } } = await supabase.auth.getSession()
    
    if (!session) {
      throw new Error('Usuario no autenticado. Por favor inicia sesión.')
    }
    
    // 2. Agregar token a headers
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
      ...options.headers
    }
    
    // 3. Hacer request
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers
    })
    
    // 4. Manejar errores
    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      
      if (response.status === 401) {
        throw new Error('Sesión expirada. Por favor inicia sesión nuevamente.')
      }
      
      throw new Error(error.message || `Error ${response.status}`)
    }
    
    return response.json()
  }
  
  // Helpers específicos
  
  async createEmailAccount(data: any) {
    return this.request('/api/email-hub/accounts', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }
  
  async configureTelegramBot(data: any) {
    return this.request('/api/telegram/bots', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }
  
  async sendEmail(data: any) {
    return this.request('/api/mail/send', {
      method: 'POST',
      body: JSON.stringify(data)
    })
  }
  
  async getMessages(accountId: string) {
    return this.request(`/api/mail/messages?accountId=${accountId}`, {
      method: 'GET'
    })
  }
}

// Exportar instancia única
export const api = new ApiClient()
```

**Uso en componentes:**

```typescript
import { api } from '@/lib/api-client'

// En tu componente de configuración de correo
async function handleConfigureEmail(formData: any) {
  try {
    const result = await api.createEmailAccount({
      from_email: formData.email,
      imap_host: formData.imapHost,
      imap_port: formData.imapPort,
      smtp_host: formData.smtpHost,
      smtp_port: formData.smtpPort,
      imap_user: formData.email,
      imap_pass: formData.password, // Se encripta en backend
      smtp_user: formData.email,
      smtp_pass: formData.password
    })
    
    console.log('✅ Cuenta configurada:', result)
  } catch (error) {
    console.error('❌ Error:', error.message)
    // Mostrar error en UI
  }
}
```

---

## RUTAS QUE REQUIEREN AUTENTICACIÓN

### 📧 Email System

```typescript
POST   /api/mail/send                    // Enviar correo
POST   /api/mail/accounts/:id/sync       // Sincronizar cuenta
GET    /api/mail/messages                // Listar mensajes
GET    /api/mail/messages/:id            // Ver mensaje específico

POST   /api/email-hub/accounts           // Crear cuenta
POST   /api/email-hub/accounts/:id/test  // Probar conexión
POST   /api/email-hub/accounts/:id/sync  // Sincronizar IMAP

GET    /api/contacts                     // Listar contactos
POST   /api/contacts                     // Crear contacto
POST   /api/contacts/import-vcard        // Importar vCard
PUT    /api/contacts/:id                 // Actualizar contacto
DELETE /api/contacts/:id                 // Eliminar contacto
```

### 💬 Telegram

```typescript
POST   /api/telegram/bots                // Configurar bot
GET    /api/telegram/bots                // Listar bots
POST   /api/telegram/send                // Enviar mensaje
```

### 🧠 Memory & Context

```typescript
POST   /api/memory/save                  // Guardar memoria
GET    /api/memory/context               // Obtener contexto
DELETE /api/memory/:id                   // Eliminar memoria
```

### 🔧 Runtime Capabilities

```typescript
GET    /api/runtime-capabilities         // Ver capacidades disponibles
```

---

## RUTAS QUE NO REQUIEREN AUTH (públicas)

```typescript
POST   /api/chat              // Chat (usa optionalAuth)
GET    /api/health            // Health check
GET    /api/health/status     // Status detallado
```

---

## ERRORES COMUNES Y SOLUCIONES

### ❌ Error: "Autenticación requerida"

**Causa:** Frontend NO está enviando token o está enviando token inválido.

**Solución:**
```typescript
// ✅ CORRECTO
const { data: { session } } = await supabase.auth.getSession()

fetch(url, {
  headers: {
    'Authorization': `Bearer ${session.access_token}` // ← Incluir siempre
  }
})

// ❌ INCORRECTO
fetch(url, {
  headers: {
    'Content-Type': 'application/json'
    // Sin Authorization header
  }
})
```

---

### ❌ Error: "Token inválido o expirado"

**Causa:** Token expiró (duración: 1 hora por defecto en Supabase).

**Solución:**
```typescript
// 1. Intentar refrescar el token automáticamente
const { data, error } = await supabase.auth.refreshSession()

if (error) {
  // 2. Si falla refresh, redirigir a login
  window.location.href = '/login'
}

// 3. Usar nuevo token
const newToken = data.session.access_token
```

---

### ❌ Error: "Usuario no autenticado"

**Causa:** Usuario NO hizo login o sesión fue cerrada.

**Solución:**
```typescript
// Verificar si hay sesión ANTES de hacer llamadas
const { data: { session } } = await supabase.auth.getSession()

if (!session) {
  // Redirigir a login
  router.push('/login')
  return
}

// Continuar con llamadas API
```

---

## EJEMPLO COMPLETO: Componente de Configuración de Correo

```typescript
'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export default function EmailSetupPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    try {
      // 1. Verificar autenticación
      const { data: { session } } = await supabase.auth.getSession()
      
      if (!session) {
        setError('Por favor inicia sesión primero')
        return
      }
      
      // 2. Obtener datos del formulario
      const formData = new FormData(e.currentTarget)
      const email = formData.get('email') as string
      const password = formData.get('password') as string
      const imapHost = formData.get('imap_host') as string
      const smtpHost = formData.get('smtp_host') as string
      
      // 3. Llamar API con token
      const response = await fetch('http://100.27.201.233:3000/api/email-hub/accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}` // ← CRÍTICO
        },
        body: JSON.stringify({
          from_email: email,
          imap_host: imapHost,
          imap_port: 993,
          imap_secure: true,
          imap_user: email,
          imap_pass: password,
          smtp_host: smtpHost,
          smtp_port: 587,
          smtp_secure: true,
          smtp_user: email,
          smtp_pass: password
        })
      })
      
      // 4. Manejar respuesta
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || 'Error al configurar cuenta')
      }
      
      const result = await response.json()
      console.log('✅ Cuenta configurada:', result)
      
      // 5. Mostrar éxito
      alert('¡Cuenta de correo configurada exitosamente!')
      
    } catch (err: any) {
      console.error('❌ Error:', err)
      setError(err.message || 'Error desconocido')
    } finally {
      setLoading(false)
    }
  }
  
  return (
    <div>
      <h1>Configurar Cuenta de Correo</h1>
      
      {error && (
        <div className="error-message">{error}</div>
      )}
      
      <form onSubmit={handleSubmit}>
        <input type="email" name="email" required />
        <input type="password" name="password" required />
        <input type="text" name="imap_host" required />
        <input type="text" name="smtp_host" required />
        
        <button type="submit" disabled={loading}>
          {loading ? 'Configurando...' : 'Configurar'}
        </button>
      </form>
    </div>
  )
}
```

---

## CHECKLIST PARA EL FRONTEND

- [ ] 1. Inicializar Supabase client con SUPABASE_URL y SUPABASE_ANON_KEY
- [ ] 2. Implementar login con `supabase.auth.signInWithPassword()`
- [ ] 3. Guardar sesión después del login
- [ ] 4. Crear función helper `getAuthToken()` que retorna `session.access_token`
- [ ] 5. Incluir `Authorization: Bearer <token>` en TODAS las llamadas API
- [ ] 6. Verificar sesión ANTES de llamar APIs protegidas
- [ ] 7. Manejar errores 401 → redirigir a login
- [ ] 8. Implementar refresh de token automático
- [ ] 9. Mostrar mensajes de error claros al usuario
- [ ] 10. Agregar loading states en formularios

---

## VARIABLES DE ENTORNO NECESARIAS

```env
# Frontend .env.local

NEXT_PUBLIC_SUPABASE_URL=https://gptwzuqmuvzttajgjrry.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdwdHd6dXFtdXZ6dHRhamdqcnJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI1MDU1NzAsImV4cCI6MjA2ODA4MTU3MH0.AAbVhdrI7LmSPKKRX0JhSkYxVg7VOw-ccizKTOh7pV8
NEXT_PUBLIC_API_URL=http://100.27.201.233:3000
```

---

## TESTING

```typescript
// Test manual de autenticación

async function testAuth() {
  // 1. Login
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'test@example.com',
    password: 'password123'
  })
  
  if (error) {
    console.error('❌ Login failed:', error.message)
    return
  }
  
  console.log('✅ Login success, token:', data.session.access_token)
  
  // 2. Test API call
  const response = await fetch('http://100.27.201.233:3000/api/runtime-capabilities', {
    headers: {
      'Authorization': `Bearer ${data.session.access_token}`
    }
  })
  
  if (response.ok) {
    const result = await response.json()
    console.log('✅ API call success:', result)
  } else {
    console.error('❌ API call failed:', response.status)
  }
}
```

---

## RESUMEN EJECUTIVO

**PROBLEMA:**
Frontend NO está enviando tokens JWT en las llamadas API.

**SOLUCIÓN:**
1. Inicializar Supabase client en frontend
2. Hacer login con `supabase.auth.signInWithPassword()`
3. Obtener token con `supabase.auth.getSession()`
4. Incluir `Authorization: Bearer <token>` en TODAS las llamadas
5. Manejar errores 401 → redirigir a login

**ARQUITECTURA:**
```
Frontend → Login Supabase → Obtener token → 
Incluir en header → Backend valida → Success ✅
```

**NEXT STEPS:**
1. Implementar ApiClient helper (copiar código de arriba)
2. Actualizar todos los componentes que llaman API
3. Agregar manejo de errores 401
4. Probar flujo completo login → configurar email/telegram
