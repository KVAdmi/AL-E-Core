# 🎯 FRONTEND - CAMBIOS REQUERIDOS PARA AL-E OPERATIVA

**Fecha:** 16 de enero de 2026  
**Backend Status:** ✅ LISTO PARA DEPLOYMENT (commit pendiente)  
**API Endpoint:** `POST http://100.27.201.233:3000/api/ai/chat`

---

## 🚨 ACTUALIZACIÓN CRÍTICA: SCHEMA ALINEADO (16/01/2026)

### ⚠️ CAMBIOS EN BACKEND QUE AFECTAN FRONTEND:

Backend ahora usa **`user_profiles`** en vez de `user_settings` para personalización:

**Campos que Frontend debe usar:**
```typescript
// TABLA: user_profiles
interface UserProfile {
  preferred_name: string;    // ← Nickname del usuario
  assistant_name: string;    // ← Nombre del asistente (default: "AL-E")
  tone_pref: string;         // ← Tono/estilo (default: "barrio")
  display_name: string;      // ← Nombre público
  email: string;
  timezone: string;          // ← Default: "America/Mexico_City"
  preferred_language: string; // ← Default: "es"
  theme: 'light' | 'dark' | 'system';
  avatar_url?: string;
  assistant_avatar_url?: string;
  user_avatar_url?: string;
}
```

**Migración SQL ejecutada:**
- ✅ `migrations/999_fix_user_profiles_backend_alignment.sql`
- ✅ Valida que existan: `preferred_name`, `assistant_name`, `tone_pref`
- ✅ Crea perfiles para usuarios sin perfil

**Frontend debe ejecutar esta migración ANTES de desplegar cambios P0**

---

## ✅ BACKEND YA ESTÁ LISTO

### Cambios aplicados:
1. ✅ System prompt anti-mentiras
2. ✅ Validación post-respuesta obligatoria
3. ✅ Email tools con validación de cuentas
4. ✅ Metadata estructurada en respuesta JSON
5. ✅ OpenAI Referee activo
6. ✅ **FIX CRÍTICO:** user_profiles alignment (user_settings → user_profiles)

---

## 📦 NUEVO FORMATO DE RESPUESTA

### ANTES:
```json
{
  "answer": "Revisé tu correo...",
  "toolsUsed": ["list_emails"],
  "executionTime": 1240
}
```

### AHORA:
```json
{
  "answer": "Revisé tu correo.\n**Cuenta:** usuario@gmail.com\n**Correos:** 3\n**Fuente:** email_messages\n\n1. Juan - Propuesta\n2. María - Reunión",
  "toolsUsed": ["list_emails"],
  "executionTime": 1240,
  "metadata": {
    "request_id": "req-1737052800000",
    "timestamp": "2026-01-16T20:00:00.000Z",
    "model": "groq/llama-3.3-70b-versatile",
    "tools_executed": 1,
    "source": "SimpleOrchestrator"
  },
  "debug": {
    "tools_detail": [
      {
        "name": "list_emails",
        "status": "executed",
        "timestamp": "2026-01-16T20:00:00.000Z"
      }
    ]
  }
}
```

---

## 🎨 CAMBIOS REQUERIDOS EN FRONTEND

### CAMBIO 1: MOSTRAR BADGES DE TOOLS (P0 - CRÍTICO)

**Dónde:** Componente de mensaje de AL-E

**Implementación:**
```tsx
import { Badge } from '@/components/ui/badge'
import { CheckCircle } from 'lucide-react'

function AIMessage({ message }) {
  return (
    <div className="ai-message">
      {/* Texto de la respuesta */}
      <div className="prose">
        {message.answer}
      </div>
      
      {/* 🔥 NUEVO: Badges de tools ejecutados */}
      {message.toolsUsed && message.toolsUsed.length > 0 && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {message.toolsUsed.map((tool: string) => (
            <Badge 
              key={tool} 
              variant="outline" 
              className="text-xs bg-green-50 border-green-200"
            >
              <CheckCircle className="w-3 h-3 mr-1 text-green-600" />
              {tool.replace('_', ' ')}
            </Badge>
          ))}
        </div>
      )}
      
      {/* 🔥 NUEVO: Metadata (modelo + latencia) */}
      {message.metadata && (
        <div className="text-xs text-muted-foreground mt-1">
          {message.metadata.model?.replace('groq/', '')} • {message.executionTime}ms
        </div>
      )}
    </div>
  )
}
```

**Resultado visual:**
```
┌─────────────────────────────────────┐
│ AL-E                                │
│                                     │
│ Revisé tu correo.                   │
│ **Cuenta:** usuario@gmail.com       │
│ **Correos:** 3                      │
│ **Fuente:** email_messages          │
│                                     │
│ [✓ list_emails]                    │ ← BADGE VERDE
│ llama-3.3-70b-versatile • 1240ms   │ ← METADATA
└─────────────────────────────────────┘
```

---

### CAMBIO 2: MANEJO DE ERRORES DIFERENCIADO (P0 - CRÍTICO)

**Dónde:** Handler de errores en el chat

**Problema:** Actualmente todos los errores se muestran igual

**Solución:** Diferenciar errores de configuración vs errores técnicos

```tsx
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle, XCircle, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

function ChatErrorHandler({ error }) {
  // Error: Sin cuentas de correo configuradas
  if (error.message?.includes('NO_EMAIL_ACCOUNTS')) {
    return (
      <Alert variant="warning" className="bg-amber-50 border-amber-200">
        <Settings className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-900">Sin cuentas de correo</AlertTitle>
        <AlertDescription className="text-amber-700">
          Para usar esta función, configura una cuenta en Email Hub.
          <Button 
            variant="link" 
            className="text-amber-600 underline p-0 h-auto ml-1"
            onClick={() => navigate('/settings/email')}
          >
            Configurar ahora →
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  
  // Error: Cuentas inactivas
  if (error.message?.includes('NO_ACTIVE_ACCOUNTS')) {
    return (
      <Alert variant="warning" className="bg-amber-50 border-amber-200">
        <AlertCircle className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-900">Cuentas inactivas</AlertTitle>
        <AlertDescription className="text-amber-700">
          Tienes cuentas configuradas pero ninguna está activa. 
          Reactívalas en configuración.
        </AlertDescription>
      </Alert>
    )
  }
  
  // Error: Database o técnico
  if (error.message?.includes('DATABASE_ERROR') || 
      error.message?.includes('ERROR_CHECKING_ACCOUNTS')) {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Error técnico</AlertTitle>
        <AlertDescription>
          No pude conectar con el servidor. Por favor, intenta nuevamente.
          {error.details && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer">Ver detalles técnicos</summary>
              <pre className="mt-1 p-2 bg-red-950/10 rounded">
                {error.details}
              </pre>
            </details>
          )}
        </AlertDescription>
      </Alert>
    )
  }
  
  // Error genérico
  return (
    <Alert variant="destructive">
      <XCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        {error.message || 'Ocurrió un error inesperado'}
      </AlertDescription>
    </Alert>
  )
}
```

---

### CAMBIO 3: DEBUG MODE (P1 - OPCIONAL)

**Dónde:** Settings o Developer Tools

**Implementación:**
```tsx
import { useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { Code } from 'lucide-react'

function ChatSettings() {
  const [debugMode, setDebugMode] = useState(false)
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">Modo Debug</h4>
          <p className="text-xs text-muted-foreground">
            Muestra logs técnicos de cada respuesta
          </p>
        </div>
        <Switch checked={debugMode} onCheckedChange={setDebugMode} />
      </div>
    </div>
  )
}

function AIMessage({ message, debugMode }) {
  return (
    <div className="ai-message">
      {/* ... respuesta normal ... */}
      
      {/* 🔥 DEBUG INFO (solo si debugMode está activo) */}
      {debugMode && message.debug && (
        <Collapsible className="mt-2">
          <CollapsibleTrigger className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <Code className="w-3 h-3" />
            Ver logs técnicos
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
              {JSON.stringify(message.debug, null, 2)}
            </pre>
            {message.metadata && (
              <div className="text-xs text-muted-foreground mt-2 space-y-1">
                <div>Request ID: {message.metadata.request_id}</div>
                <div>Timestamp: {message.metadata.timestamp}</div>
                <div>Tools executed: {message.metadata.tools_executed}</div>
                <div>Source: {message.metadata.source}</div>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
```

---

### CAMBIO 4: TIPOS TYPESCRIPT (RECOMENDADO)

**Archivo:** `types/chat.ts` o similar

```typescript
export interface AIMessage {
  answer: string
  toolsUsed: string[]
  executionTime: number
  metadata?: {
    request_id: string
    timestamp: string
    model: string
    tools_executed: number
    source: string
  }
  debug?: {
    tools_detail: Array<{
      name: string
      status: 'executed' | 'failed'
      timestamp: string
    }>
  }
}

export interface ChatError {
  error: string
  message: string
  details?: string
}
```

---

## 📋 CHECKLIST DE IMPLEMENTACIÓN

### Obligatorio (P0):
```bash
□ Badge de tools ejecutados (verde con checkmark)
□ Metadata visible (modelo + latencia en texto pequeño)
□ Error handler diferenciado (warning amarillo vs error rojo)
□ Navegación a /settings/email desde error de "sin cuentas"
□ Tipos TypeScript para AIMessage
```

### Opcional (P1):
```bash
□ Debug mode toggle en settings
□ Collapsible con JSON completo de debug
□ Request/Response logging en DevTools
```

---

## 🧪 PRUEBAS DE VALIDACIÓN

Una vez implementado, validar con:

### TEST 1: Usuario sin cuentas de correo
```bash
Mensaje: "revisa mis correos"
Resultado esperado:
- Alert amarillo con icono Settings
- Mensaje: "Sin cuentas de correo configuradas"
- Botón: "Configurar ahora →"
- Badge: [✓ list_emails] (aunque falló)
```

### TEST 2: Usuario con correos
```bash
Mensaje: "revisa mis correos"
Resultado esperado:
- Respuesta con formato estructurado
- **Cuenta:** visible
- **Correos:** cantidad numérica
- **Fuente:** email_messages
- Badge: [✓ list_emails] verde
- Metadata: llama-3.3-70b • XXXXms
```

### TEST 3: Web search
```bash
Mensaje: "qué es OpenAI"
Resultado esperado:
- Respuesta con información de Tavily
- **Fuente:** Tavily visible
- Badge: [✓ web_search] verde
- Metadata visible
```

### TEST 4: Error técnico (simular desconexión)
```bash
Mensaje: cualquiera (con backend apagado)
Resultado esperado:
- Alert rojo con XCircle
- Mensaje: "Error técnico"
- Texto: "No pude conectar con el servidor"
```

---

## 🚀 DEPLOYMENT

### Backend (YA DESPLEGADO ✅):
```bash
✅ Commit: 3ce2ee2
✅ Pusheado a GitHub
✅ Listo para deploy a EC2
```

### Frontend (TU TURNO):
1. Implementar cambios P0 (badges + metadata + error handler)
2. Probar localmente contra http://localhost:3000/api/ai/chat
3. Deploy a producción
4. Validar contra http://100.27.201.233:3000/api/ai/chat

---

## 🎯 EJEMPLO COMPLETO DE INTEGRACIÓN

```tsx
// components/Chat/AIMessage.tsx
import { Badge } from '@/components/ui/badge'
import { CheckCircle, Settings, XCircle } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useNavigate } from 'react-router-dom'
import type { AIMessage as AIMessageType } from '@/types/chat'

interface Props {
  message: AIMessageType
  error?: { message: string; details?: string }
}

export function AIMessage({ message, error }: Props) {
  const navigate = useNavigate()
  
  // Mostrar error si existe
  if (error) {
    if (error.message?.includes('NO_EMAIL_ACCOUNTS')) {
      return (
        <Alert variant="warning" className="bg-amber-50 border-amber-200">
          <Settings className="h-4 w-4 text-amber-600" />
          <AlertTitle className="text-amber-900">Sin cuentas de correo</AlertTitle>
          <AlertDescription className="text-amber-700">
            Para usar esta función, configura una cuenta en Email Hub.
            <Button 
              variant="link" 
              className="text-amber-600 underline p-0 h-auto ml-1"
              onClick={() => navigate('/settings/email')}
            >
              Configurar ahora →
            </Button>
          </AlertDescription>
        </Alert>
      )
    }
    
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>Error técnico</AlertTitle>
        <AlertDescription>
          {error.message || 'Ocurrió un error inesperado'}
        </AlertDescription>
      </Alert>
    )
  }
  
  // Mostrar respuesta normal
  return (
    <div className="space-y-2">
      {/* Respuesta */}
      <div className="prose prose-sm max-w-none">
        <p className="whitespace-pre-wrap">{message.answer}</p>
      </div>
      
      {/* Tools ejecutados */}
      {message.toolsUsed && message.toolsUsed.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {message.toolsUsed.map((tool: string) => (
            <Badge 
              key={tool} 
              variant="outline" 
              className="text-xs bg-green-50 border-green-200 text-green-700"
            >
              <CheckCircle className="w-3 h-3 mr-1" />
              {tool.replace('_', ' ')}
            </Badge>
          ))}
        </div>
      )}
      
      {/* Metadata */}
      {message.metadata && (
        <div className="text-xs text-muted-foreground">
          {message.metadata.model?.replace('groq/', '')} • {message.executionTime}ms
        </div>
      )}
    </div>
  )
}
```

---

## 📞 COORDINACIÓN BACKEND-FRONTEND

### Backend está esperando por:
- ✅ Nada, backend completamente funcional

### Frontend debe:
1. Implementar cambios P0 (2-3 horas)
2. Probar localmente
3. Desplegar
4. Validar en conjunto

### Validación final conjunta:
```bash
□ Backend: Logs muestran tools ejecutados
□ Backend: OpenAI Referee activo corrigiendo
□ Frontend: Badges verdes visibles
□ Frontend: Metadata visible (modelo + latencia)
□ Frontend: Errores diferenciados (amarillo/rojo)
□ Frontend: Navegación a settings funciona
```

---

## ✅ DEFINICIÓN DE "LISTO"

AL-E queda OPERATIVA cuando:

1. ✅ **Backend:** System prompt anti-mentiras activo
2. ✅ **Backend:** Validación post-respuesta funcionando
3. ✅ **Backend:** Email tools con validación de cuentas
4. ✅ **Backend:** Metadata en respuesta JSON
5. ⏳ **Frontend:** Badges de tools visibles
6. ⏳ **Frontend:** Metadata visible (modelo + latencia)
7. ⏳ **Frontend:** Errores diferenciados
8. ⏳ **Validación:** Pruebas E2E pasando

**Backend: 100% LISTO ✅**  
**Frontend: 0% (esperando implementación) ⏳**

---

**PRÓXIMO PASO:** Implementar cambios P0 en frontend (2-3 horas)

**DESPUÉS:** Validación conjunta backend + frontend en producción

**LUEGO:** Iterar sobre memoria, acciones proactivas, y autonomía (próximos días)

---

**Contacto Backend:** Core Team  
**Status Backend:** ✅ DESPLEGADO Y LISTO  
**Endpoint:** `http://100.27.201.233:3000/api/ai/chat`

