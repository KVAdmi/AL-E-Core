# ⚡ PLAN DE EJECUCIÓN HOY - AL-E OPERATIVA

**Fecha:** 16 de enero de 2026  
**Objetivo:** AL-E funcional en producción HOY con verdad absoluta  
**Status:** EN EJECUCIÓN

---

## 🎯 ESTADO ACTUAL

### ✅ LO QUE YA FUNCIONA
```bash
✅ OpenAI Referee activo en producción (gpt-4o-mini)
✅ SimpleOrchestrator con Groq (llama-3.3-70b-versatile)
✅ Email Hub funcionando (IMAP/SMTP universal)
✅ Calendario interno operativo (owner_user_id OK)
✅ Telegram bot configurado
✅ Web search con Tavily
✅ Logs estructurados en ae_requests
✅ Endpoint: POST /api/ai/chat (truthChat.ts)
```

### 🔧 BACKEND - FIXES INMEDIATOS (HOY)

#### FIX 1: SYSTEM PROMPT ANTI-MENTIRAS (30 min)
**Archivo:** `src/ai/simpleOrchestrator.ts` líneas 213-247

**PROBLEMA:** System prompt permite inventar
**SOLUCIÓN:** Endurecer reglas

```typescript
const systemPrompt = `Eres ${assistantName}, asistente AI ejecutiva de ${userNickname}.

🚫 PROHIBICIONES ABSOLUTAS (NUNCA HAGAS ESTO):
❌ NUNCA inventes resultados de tools
❌ NUNCA digas "revisé" si no ejecutaste list_emails
❌ NUNCA digas "según encontré" si no ejecutaste web_search
❌ NUNCA inventes nombres de empresas, personas o correos
❌ NUNCA simules acciones completadas
❌ Si un tool falla, di "El tool falló: [razón]"
❌ Si no tienes información, di "No tengo esa información"

✅ REGLAS DE EJECUCIÓN:
1. "revisar correo" → EJECUTA list_emails INMEDIATAMENTE
2. "qué dice X correo" → EJECUTA read_email con el emailId
3. "busca/investiga" → EJECUTA web_search (Tavily)
4. "mi agenda" → EJECUTA list_events
5. Después de ejecutar tool → USA LOS DATOS REALES en tu respuesta

📊 FORMATO DE RESPUESTA OBLIGATORIO:
Cuando ejecutes un tool, SIEMPRE estructura así:

**Acción ejecutada:** [nombre del tool]
**Resultado:** [datos reales del tool]
**Fuente:** [email_messages / web_search / calendar_events]

Ejemplo correcto:
"Revisé tu correo.
**Cuenta:** usuario@gmail.com
**Correos encontrados:** 3
**Fuente:** email_messages

1. De: Juan Pérez - Asunto: Propuesta comercial
2. De: María López - Asunto: Reunión pendiente
3. De: Sistema - Asunto: Confirmación de pago

¿Deseas leer alguno?"

Ejemplo PROHIBIDO:
"Revisé tu correo y tienes varios mensajes importantes..."
(❌ NO dice cuántos, NO dice de quién, NO dice la fuente)

🧠 MEMORIA DEL USUARIO:
${userMemories}

📧 TOOLS DISPONIBLES:
- list_emails: Lista correos reales del usuario
- read_email: Lee UN correo específico
- send_email: Envía correo (requiere to, subject, body)
- web_search: Busca en web con Tavily
- list_events: Lista eventos del calendario
- create_event: Crea evento (requiere title, startTime)
- analyze_document: Analiza PDF/imagen con OCR

CONTEXTO:
- Usuario: ${userNickname} (${request.userId})
- Email: ${request.userEmail || 'N/A'}
- Workspace: ${workspaceId}

SI NO EJECUTASTE UN TOOL, NO DIGAS QUE LO HICISTE.
LA VERDAD ES MÁS IMPORTANTE QUE SER ÚTIL.`;
```

**ACCIÓN:**
```bash
cd "/Users/pg/Documents/AL-E Core"
# Editar src/ai/simpleOrchestrator.ts
# Reemplazar systemPrompt completo (líneas 213-247)
```

---

#### FIX 2: RESPUESTA ESTRUCTURADA OBLIGATORIA (20 min)
**Archivo:** `src/ai/simpleOrchestrator.ts` línea 380+

**PROBLEMA:** Respuesta final no valida estructura
**SOLUCIÓN:** Post-procesamiento obligatorio

```typescript
// DESPUÉS de la línea 380 (donde se genera finalAnswer)
// AÑADIR:

// 🔍 VALIDACIÓN POST-RESPUESTA: Verificar que menciona tools ejecutados
console.log('[SIMPLE ORCH] 🔍 Validando respuesta...');

if (toolsUsed.length > 0) {
  // Si ejecutó tools, DEBE mencionar resultados
  const responseText = finalAnswer.toLowerCase();
  
  let mentionedTools = false;
  for (const tool of toolsUsed) {
    if (responseText.includes(tool.replace('_', ' ')) || 
        responseText.includes('encontré') || 
        responseText.includes('revisé') ||
        responseText.includes('fuente:')) {
      mentionedTools = true;
      break;
    }
  }
  
  if (!mentionedTools) {
    console.warn('[SIMPLE ORCH] ⚠️ Respuesta no menciona tools ejecutados');
    
    // Forzar estructura
    const toolsSummary = toolResults.map((tr: any, idx: number) => 
      `${idx + 1}. Tool: ${tr.toolName}\n   Resultado: ${JSON.stringify(tr.result).substring(0, 200)}`
    ).join('\n');
    
    finalAnswer = `⚠️ Ejecuté las siguientes acciones:\n\n${toolsSummary}\n\n---\n\n${finalAnswer}`;
  }
}
```

**ACCIÓN:**
```bash
# Editar src/ai/simpleOrchestrator.ts
# Insertar validación ANTES de return (línea ~380-390)
```

---

#### FIX 3: CALENDARIO - ERROR DE COLUMNA (10 min)
**Archivo:** Ya está OK en `src/services/calendarInternal.ts`

**VERIFICACIÓN:**
```bash
# Confirmar que TODAS las queries usan owner_user_id
grep -n "user_id" src/services/calendarInternal.ts
# Debe retornar SOLO: owner_user_id (NO user_id)
```

**Si hay algún user_id:**
```bash
# Reemplazar en calendarInternal.ts:
.eq('user_id', userId)
# POR:
.eq('owner_user_id', userId)
```

---

#### FIX 4: LOGS OBLIGATORIOS EN RESPUESTA (15 min)
**Archivo:** `src/api/truthChat.ts` línea 100+

**PROBLEMA:** Frontend no recibe logs de tools ejecutados
**SOLUCIÓN:** Añadir metadata en respuesta

```typescript
// REEMPLAZAR línea ~100-110:

return res.json({
  answer: result.answer,
  toolsUsed: result.toolsUsed,
  executionTime: result.executionTime,
});

// POR:

return res.json({
  answer: result.answer,
  toolsUsed: result.toolsUsed,
  executionTime: result.executionTime,
  metadata: {
    request_id: `req-${Date.now()}`,
    timestamp: new Date().toISOString(),
    model: 'groq/llama-3.3-70b-versatile',
    tools_executed: result.toolsUsed.length,
    source: 'SimpleOrchestrator',
  },
  // 🔍 LOGS ESTRUCTURADOS (para debugging)
  debug: {
    tools_detail: result.toolsUsed.map((tool: string) => ({
      name: tool,
      status: 'executed',
      timestamp: new Date().toISOString(),
    })),
  },
});
```

**ACCIÓN:**
```bash
# Editar src/api/truthChat.ts
# Ampliar respuesta JSON con metadata y debug
```

---

#### FIX 5: VALIDACIÓN DE CUENTAS DE EMAIL (15 min)
**Archivo:** `src/ai/tools/emailTools.ts`

**PROBLEMA:** Si no hay cuentas, tool dice "no hay correos" (ambiguo)
**SOLUCIÓN:** Diferenciar "sin cuentas" vs "sin correos"

```typescript
// En src/ai/tools/emailTools.ts, función listEmails:
// LÍNEA ~40-60, REEMPLAZAR el primer bloque:

export async function listEmails(userId: string, limit: number = 10) {
  try {
    console.log('[EMAIL TOOLS] 📧 Listando emails para usuario:', userId);
    
    // 1. VERIFICAR SI HAY CUENTAS CONFIGURADAS
    const { data: accounts, error: accountsError } = await supabase
      .from('email_accounts')
      .select('id, email, provider')
      .eq('owner_user_id', userId)
      .eq('status', 'active');
    
    if (accountsError) {
      console.error('[EMAIL TOOLS] Error verificando cuentas:', accountsError);
      return {
        success: false,
        error: 'ERROR_CHECKING_ACCOUNTS',
        message: 'No pude verificar tus cuentas de correo.',
      };
    }
    
    if (!accounts || accounts.length === 0) {
      console.log('[EMAIL TOOLS] ⚠️ Usuario sin cuentas de email configuradas');
      return {
        success: false,
        error: 'NO_EMAIL_ACCOUNTS',
        message: '❌ No tienes cuentas de correo configuradas.\n\nPara usar esta función, agrega una cuenta en Configuración → Email Hub.',
      };
    }
    
    console.log('[EMAIL TOOLS] ✅ Cuentas encontradas:', accounts.length);
    
    // 2. BUSCAR CORREOS
    const { data: emails, error: emailsError } = await supabase
      .from('email_messages')
      .select('*')
      .eq('owner_user_id', userId)
      .order('date', { ascending: false })
      .limit(limit);
    
    if (emailsError) {
      console.error('[EMAIL TOOLS] Error listando emails:', emailsError);
      return {
        success: false,
        error: 'DATABASE_ERROR',
        message: 'Error al buscar correos en la base de datos.',
      };
    }
    
    if (!emails || emails.length === 0) {
      console.log('[EMAIL TOOLS] ℹ️ No se encontraron correos');
      return {
        success: true,
        emails: [],
        count: 0,
        message: `✅ Cuentas activas: ${accounts.length}\n📭 No hay correos en tu bandeja (o aún no se han sincronizado).\n\nCuentas configuradas:\n${accounts.map(a => `- ${a.email}`).join('\n')}`,
      };
    }
    
    console.log('[EMAIL TOOLS] ✅ Correos encontrados:', emails.length);
    
    return {
      success: true,
      emails: emails.map(e => ({
        id: e.id,
        from: e.from_address,
        subject: e.subject,
        date: e.date,
        preview: e.text_preview || e.text_body?.substring(0, 100),
        has_attachments: e.has_attachments || false,
      })),
      count: emails.length,
      accounts: accounts.map(a => a.email),
      message: `✅ ${emails.length} correo(s) encontrado(s) en ${accounts.length} cuenta(s)`,
    };
    
  } catch (error: any) {
    console.error('[EMAIL TOOLS] Error:', error);
    return {
      success: false,
      error: 'UNEXPECTED_ERROR',
      message: `Error inesperado: ${error.message}`,
    };
  }
}
```

**ACCIÓN:**
```bash
# Editar src/ai/tools/emailTools.ts
# Reemplazar función listEmails completa
```

---

### 🎨 FRONTEND - CAMBIOS REQUERIDOS (COORDINAR)

#### CAMBIO 1: MOSTRAR METADATA DE TOOLS (P0)
**Componente:** Chat message display

**REQUERIMIENTO:**
Cuando el backend responda con `toolsUsed: ['list_emails', 'web_search']`, frontend debe:

1. **Mostrar badge de tools ejecutados:**
```tsx
{message.toolsUsed && message.toolsUsed.length > 0 && (
  <div className="flex gap-1 mt-2">
    {message.toolsUsed.map(tool => (
      <Badge key={tool} variant="outline" className="text-xs">
        <CheckCircle className="w-3 h-3 mr-1" />
        {tool.replace('_', ' ')}
      </Badge>
    ))}
  </div>
)}
```

2. **Mostrar timestamp y modelo:**
```tsx
{message.metadata && (
  <div className="text-xs text-muted-foreground mt-1">
    {message.metadata.model} • {message.executionTime}ms
  </div>
)}
```

**EJEMPLO VISUAL:**

```
┌─────────────────────────────────────┐
│ AL-E                                │
│ Revisé tu correo.                   │
│                                     │
│ **Cuenta:** usuario@gmail.com       │
│ **Correos:** 3                      │
│ **Fuente:** email_messages          │
│                                     │
│ 1. Juan Pérez - Propuesta comercial│
│ 2. María López - Reunión pendiente  │
│                                     │
│ [✓ list_emails] [✓ read_email]     │ ← BADGES
│ groq/llama-3.3-70b • 1240ms        │ ← METADATA
└─────────────────────────────────────┘
```

---

#### CAMBIO 2: MODO DEBUG OPCIONAL (P1)
**Componente:** Settings o Developer Tools

**REQUERIMIENTO:**
Toggle para activar "Debug Mode" que muestre JSON completo del response:

```tsx
{debugMode && message.debug && (
  <Collapsible>
    <CollapsibleTrigger className="text-xs text-muted-foreground">
      Ver logs técnicos
    </CollapsibleTrigger>
    <CollapsibleContent>
      <pre className="text-xs bg-muted p-2 rounded mt-2">
        {JSON.stringify(message.debug, null, 2)}
      </pre>
    </CollapsibleContent>
  </Collapsible>
)}
```

---

#### CAMBIO 3: ERROR HANDLING CLARO (P0)
**Componente:** Error messages

**REQUERIMIENTO:**
Distinguir errores de configuración vs errores técnicos:

```tsx
// Si backend retorna error: 'NO_EMAIL_ACCOUNTS'
<Alert variant="warning">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Sin cuentas de correo</AlertTitle>
  <AlertDescription>
    Para usar esta función, configura una cuenta en Email Hub.
    <Button variant="link" onClick={() => navigate('/settings/email')}>
      Configurar ahora
    </Button>
  </AlertDescription>
</Alert>

// Si backend retorna error: 'DATABASE_ERROR'
<Alert variant="destructive">
  <XCircle className="h-4 w-4" />
  <AlertTitle>Error técnico</AlertTitle>
  <AlertDescription>
    No pude conectar con el servidor. Intenta nuevamente.
  </AlertDescription>
</Alert>
```

---

#### CAMBIO 4: REQUEST/RESPONSE LOGGING (P1 - OPCIONAL)
**Componente:** Developer Console

**REQUERIMIENTO:**
Opción para ver requests/responses en tiempo real (como Network tab):

```tsx
// En DevTools panel
<div className="space-y-2">
  {requestLog.map(req => (
    <div key={req.id} className="border rounded p-2">
      <div className="flex justify-between text-xs">
        <span className="font-mono">{req.method} {req.endpoint}</span>
        <span className={req.status === 200 ? 'text-green-600' : 'text-red-600'}>
          {req.status}
        </span>
      </div>
      <div className="text-xs text-muted-foreground mt-1">
        {req.executionTime}ms • {new Date(req.timestamp).toLocaleTimeString()}
      </div>
      <details className="text-xs mt-2">
        <summary>Ver detalles</summary>
        <pre className="bg-muted p-2 rounded mt-1">
          {JSON.stringify(req.response, null, 2)}
        </pre>
      </details>
    </div>
  ))}
</div>
```

---

### 📋 CHECKLIST DE VALIDACIÓN (HOY)

#### Backend (1.5 horas total)
```bash
□ FIX 1: System prompt anti-mentiras (30 min)
□ FIX 2: Validación de respuesta estructurada (20 min)
□ FIX 3: Verificar calendario owner_user_id (10 min)
□ FIX 4: Logs en respuesta JSON (15 min)
□ FIX 5: Email tools con validación de cuentas (15 min)
□ Build y deploy a EC2 (10 min)
```

#### Frontend (2 horas total)
```bash
□ CAMBIO 1: Badges de tools ejecutados (30 min)
□ CAMBIO 2: Metadata visible (modelo + latencia) (20 min)
□ CAMBIO 3: Error handling diferenciado (40 min)
□ CAMBIO 4: Debug mode opcional (30 min)
```

---

### 🚀 DESPLIEGUE

#### Backend
```bash
cd "/Users/pg/Documents/AL-E Core"

# 1. Aplicar fixes
# (Editar archivos según FIX 1-5)

# 2. Build
npm run build

# 3. Git
git add src/ai/simpleOrchestrator.ts \
        src/api/truthChat.ts \
        src/ai/tools/emailTools.ts \
        src/services/calendarInternal.ts

git commit -m "fix(P0): AL-E anti-mentiras + logs estructurados

FIXES APLICADOS:
1. System prompt con prohibiciones absolutas
2. Validación post-respuesta obligatoria
3. Calendario con owner_user_id verificado
4. Metadata y debug en respuesta JSON
5. Email tools con validación de cuentas

RESULTADO:
✅ AL-E no puede inventar resultados
✅ Logs estructurados por request
✅ Frontend recibe metadata completa
✅ Errores diferenciados (config vs técnico)

Closes: AL-E Operativa HOY"

git push origin main

# 4. Deploy a EC2
ssh ubuntu@100.27.201.233 << 'EOF'
cd al-e-api
git pull origin main
npm run build
pm2 restart al-e-api --update-env
pm2 logs al-e-api --lines 50
EOF
```

---

### ✅ PRUEBAS DE VALIDACIÓN (POST-DEPLOY)

#### TEST 1: Email sin cuentas
```bash
curl -X POST http://100.27.201.233:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "revisa mis correos"}],
    "userId": "test-user-sin-cuentas"
  }'

# ESPERADO:
{
  "answer": "❌ No tienes cuentas de correo configuradas...",
  "toolsUsed": ["list_emails"],
  "metadata": {
    "tools_executed": 1,
    "source": "SimpleOrchestrator"
  }
}
```

#### TEST 2: Email con cuentas
```bash
curl -X POST http://100.27.201.233:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "revisa mis correos"}],
    "userId": "USUARIO_REAL_CON_CUENTAS"
  }'

# ESPERADO:
{
  "answer": "Revisé tu correo.\n**Cuenta:** ...\n**Correos:** X\n**Fuente:** email_messages",
  "toolsUsed": ["list_emails"],
  "metadata": { ... }
}
```

#### TEST 3: Web search
```bash
curl -X POST http://100.27.201.233:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "qué es OpenAI"}],
    "userId": "test-user"
  }'

# ESPERADO:
{
  "answer": "Según la búsqueda web:\n**Fuente:** Tavily\n\nOpenAI es...",
  "toolsUsed": ["web_search"],
  "metadata": { ... }
}
```

#### TEST 4: Calendario
```bash
curl -X POST http://100.27.201.233:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "qué tengo hoy en mi agenda"}],
    "userId": "USUARIO_REAL_CON_CALENDARIO"
  }'

# ESPERADO:
{
  "answer": "Tu agenda de hoy:\n**Fuente:** calendar_events\n\n15:00 - Reunión...",
  "toolsUsed": ["list_events"],
  "metadata": { ... }
}
```

#### TEST 5: OpenAI Referee
```bash
curl -X POST http://100.27.201.233:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "no tengo acceso a esa información"}],
    "userId": "test-user"
  }'

# ESPERADO: Groq debería ejecutar tools, NO decir "no tengo acceso"
# Si dice eso, OpenAI Referee debe corregir
```

---

## 📊 DEFINICIÓN DE "LISTO HOY"

### ✅ CRITERIOS DE ACEPTACIÓN

AL-E queda OPERATIVA HOY si:

1. **Email real:**
   - ✅ Usuario con cuentas → lista correos reales
   - ✅ Usuario sin cuentas → dice "no tienes cuentas configuradas"
   - ✅ Respuesta incluye: cuenta, cantidad, fuente

2. **Web search real:**
   - ✅ Búsqueda ejecutada → muestra fuente Tavily
   - ✅ Sin resultados → dice "no encontré información verificable"
   - ✅ NUNCA dice "según encontré" sin tool execution

3. **Calendario real:**
   - ✅ Lista eventos sin error de columna
   - ✅ Respuesta incluye: hora, título, fuente calendar_events

4. **Logs obligatorios:**
   - ✅ Cada respuesta incluye `toolsUsed: []`
   - ✅ Cada respuesta incluye `metadata.tools_executed`
   - ✅ Frontend muestra badges de tools

5. **OpenAI Referee activo:**
   - ✅ Logs muestran `[OPENAI_REFEREE]` cuando detecta evasión
   - ✅ Respuesta corregida cuando Groq miente
   - ✅ Health check `/_health/referee` retorna active

6. **Sin mentiras:**
   - ✅ NUNCA inventa correos, empresas, búsquedas
   - ✅ Si no ejecuta tool, NO dice que lo hizo
   - ✅ Errores técnicos mostrados honestamente

---

## 🎯 PRÓXIMOS PASOS (POST-HOY)

Una vez validado HOY:

**Día 2-3: Memoria básica**
- `src/memory/conversationMemory.ts`
- Store/retrieve en Supabase
- Integrar con SimpleOrchestrator

**Día 4-5: Email actions**
- `src/services/emailActionsOrchestrator.ts`
- Detectar "agenda reunión" → crear automáticamente
- Detectar "responde" → draft reply

**Día 6-7: Telegram proactivo**
- `src/services/telegramNotifier.ts`
- Notificaciones automáticas
- Comandos básicos

**Semana 2: Documentos OCR**
- Ampliar `analyze_document`
- OCR para PDFs complejos
- Acciones derivadas

---

## 📝 NOTAS FINALES

### Para Backend:
- Todos los fixes son en archivos existentes (NO crear nuevos)
- Total: ~1.5 horas de trabajo
- Deploy inmediato después de commit

### Para Frontend:
- Cambios NO bloquean funcionalidad actual
- Se pueden hacer incrementales
- Priorizar: badges + metadata (P0)
- Debug mode puede ser después (P1)

### Coordinación:
- Backend despliega primero
- Frontend valida con backend en EC2
- Tests de validación en conjunto

---

**ESTADO:** ⏳ PENDIENTE DE EJECUCIÓN  
**ETA:** HOY (16 enero 2026) antes de las 20:00  
**Responsable Backend:** Core Team  
**Responsable Frontend:** [TU EQUIPO]

---

**Una vez completado, AL-E será:**
- ✅ Verificable (logs claros)
- ✅ Honesta (sin inventar)
- ✅ Consistente (siempre misma estructura)
- ✅ Operativa (email, web, calendario funcionales)

**Eso es suficiente para producción inicial.**  
**Lo demás se itera después.**
