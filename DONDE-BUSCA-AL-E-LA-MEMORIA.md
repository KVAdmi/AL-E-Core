# 🧠 DÓNDE BUSCA AL-E LA MEMORIA DEL USUARIO

## RESUMEN EJECUTIVO

AL-E busca la información del usuario en **DOS TABLAS PRINCIPALES**:

1. **`user_profiles`** → Configuración permanente del usuario (quién es, cómo hablarle)
2. **`assistant_memories`** → Memorias de conversaciones, acuerdos, reglas de negocio

---

## 📊 TABLA 1: `user_profiles` (CONFIGURACIÓN PERMANENTE)

### ¿Qué guarda?
Información básica y preferencias de personalización del usuario.

### Columnas importantes:
```sql
user_id              UUID       -- ID único del usuario (Supabase Auth)
email                TEXT       -- Correo del usuario
display_name         TEXT       -- Nombre visible (ej: "Patto")
role                 TEXT       -- Rol (ej: "USER", "CEO")
preferred_name       TEXT       -- Cómo quiere que le diga AL-E (ej: "Patto", "Luis")
assistant_name       TEXT       -- Nombre de la asistente (ej: "Luma", "LUCI")
tone_pref            TEXT       -- Tono preferido ("barrio", "pro", "neutral")
preferred_language   TEXT       -- Idioma (ej: "es", "en")
timezone             TEXT       -- Zona horaria (ej: "America/Mexico_City")
```

### Ejemplo real en tu sistema:
```json
{
  "user_id": "56bc3448-6af0-4468-99b9-78779bf84ae8",
  "email": "p.garibay@infinitykode.com",
  "display_name": "Patto",
  "preferred_name": "Patto",
  "assistant_name": "Luma",
  "tone_pref": "barrio",
  "role": "USER"
}
```

### ¿Cuándo se carga?
**SIEMPRE** al inicio de cada conversación en el **Orchestrator**.

### Código que la carga:
```typescript
// src/ai/orchestrator.ts - Línea 140
const identity = await getUserIdentity(userId);

// src/services/userProfile.ts - Línea 60
const { data, error } = await supabase
  .from('user_profiles')
  .select('display_name, role, preferred_name, assistant_name, tone_pref')
  .eq('user_id', userId)
  .single();
```

### ¿Cómo se usa en el system prompt?
```typescript
// src/services/userProfile.ts - Línea 113
function buildIdentityBlock(identity) {
  return `
IDENTIDAD Y PREFERENCIAS DEL USUARIO (VERDAD DEL SISTEMA)

Usuario: ${identity.preferred_name} (${identity.role})
Tu nombre configurado: ${identity.assistant_name}
Tono preferido: ${identity.tone_pref}

INSTRUCCIONES CRÍTICAS:
1. Llama al usuario "${identity.preferred_name}" siempre que sea relevante
2. Refiérete a ti misma como "${identity.assistant_name}"
3. Usa tono "${identity.tone_pref}"
4. NO digas "no tengo capacidad de recordar" o "no sé quién eres"
  `;
}
```

---

## 🧠 TABLA 2: `assistant_memories` (MEMORIAS DE CONVERSACIÓN)

### ¿Qué guarda?
Memorias explícitas de conversaciones, acuerdos, reglas de negocio, decisiones importantes.

### Columnas importantes:
```sql
id               UUID       -- ID único de la memoria
workspace_id     TEXT       -- Workspace (ej: "al-eon")
user_id          UUID       -- ID del usuario
user_id_uuid     UUID       -- ID alternativo (mismo que user_id)
mode             TEXT       -- Modo ("universal", "executive", "technical")
memory           TEXT       -- Contenido de la memoria (texto largo)
importance       FLOAT      -- Nivel de importancia (0.0 a 1.0)
created_at       TIMESTAMP  -- Fecha de creación
```

### Ejemplo real en tu sistema (Usuario CEO):
```json
{
  "id": "84f215cf-1138-4282-9a28-b6e2f470056f",
  "workspace_id": "al-eon",
  "user_id": "aeafa6b7-8546-436f-bc43-943f6784fbd7",
  "mode": "universal",
  "memory": "[agreement] **RESUMEN EJECUTIVO**
Soy LUCI, asistente ejecutiva de Luis, con el objetivo de liderar y apoyar en 
la toma de decisiones estratégicas y operativas. Mi función es anticiparme, 
detectar riesgos, proponer mejoras y optimizar tiempo, dinero y esfuerzo.

**ALCANCE FUNCIONAL**
1. Agenda y Operación: Crear, mover, confirmar y cancelar citas.
2. Correos: Leer correos entrantes, analizar intención, urgencia y contexto, 
   proponer respuesta y responder directamente.
3. Negocio y Estrategia: Analizar proyectos, desglosar alcances, proponer 
   costos, tiempos y escenarios, hacer proyecciones financieras simples pero claras.
4. Pensamiento Estratégico: Entregar conclusiones, no procesos, sin repetir 
   información que ya conoce.
...",
  "importance": 1.0
}
```

### ¿Cuándo se carga?
**SIEMPRE** al inicio de cada conversación, después de cargar el perfil.

### Código que la carga:
```typescript
// src/ai/orchestrator.ts - Línea 152
const memories = await this.loadMemories(userId, workspaceId, projectId);

// src/ai/orchestrator.ts - Línea 160
const { data: userMemories, error: userError } = await supabase
  .from('assistant_memories')
  .select('id, memory, importance, created_at')
  .eq('workspace_id', workspaceId)
  .or(`user_id_uuid.eq.${userId},user_id.eq.${userId}`)
  .gte('importance', 0.3) // Solo memorias con importancia >= 0.3
  .order('importance', { ascending: false })
  .limit(10);
```

### ¿Cómo se usa en el system prompt?
```typescript
// src/ai/orchestrator.ts - Línea 490
let memoryBlock = '';
if (context.memories.length > 0) {
  memoryBlock = `

═══════════════════════════════════════════════════════════════
MEMORIAS EXPLÍCITAS (${context.memories.length})
═══════════════════════════════════════════════════════════════

${context.memories.map(m => m.content).join('\n\n---\n\n')}

═══════════════════════════════════════════════════════════════
`;
}
```

---

## 🔍 FLUJO COMPLETO DE CARGA DE MEMORIA

```
1. Usuario envía mensaje → POST /api/chat
   ↓
2. Orchestrator.handleRequest()
   ↓
3. STEP 1: checkAuth() → Verificar autenticación
   ↓
4. STEP 2: loadProfile() → Buscar en user_profiles
   ↓
   SELECT * FROM user_profiles WHERE user_id = ?
   ↓
   RESULTADO: { preferred_name, assistant_name, tone_pref }
   ↓
5. STEP 3: loadMemories() → Buscar en assistant_memories
   ↓
   SELECT * FROM assistant_memories 
   WHERE user_id = ? 
   AND importance >= 0.3
   ORDER BY importance DESC
   LIMIT 10
   ↓
   RESULTADO: [ { memory: "Soy LUCI..." }, { memory: "Proyecto X..." } ]
   ↓
6. STEP 4: buildSystemPrompt()
   ↓
   - Inyectar brandContext (Infinity Kode)
   - Inyectar identityBlock (preferred_name, assistant_name, tone_pref)
   - Inyectar memoryBlock (memorias de assistant_memories)
   - Inyectar ALEON system prompt (src/ai/prompts/aleon.ts)
   ↓
7. Enviar a Anthropic/OpenRouter con system prompt completo
   ↓
8. AL-E responde con TODA la memoria cargada
```

---

## 📝 CÓMO SE GUARDA UNA NUEVA MEMORIA

### Opción 1: API Manual (POST /api/memory/save)
```typescript
POST http://localhost:3000/api/memory/save

Headers:
  Authorization: Bearer <token>

Body:
{
  "memory": "Luis prefiere reuniones cortas de máximo 30 minutos",
  "importance": 0.8,
  "mode": "universal"
}
```

### Opción 2: Automático desde Chat
Cuando AL-E detecta información importante, puede guardarla automáticamente usando herramientas.

---

## ✅ VERIFICACIÓN: ¿ESTÁ CARGANDO LA MEMORIA?

### Test 1: Ver logs del orchestrator
```bash
pm2 logs 7 --lines 50 | grep "ORCH"
```

**Buscar:**
```
[ORCH] profile_loaded=true, name=Patto
[ORCH] ✅ Loaded 1 memories from assistant_memories table
```

### Test 2: Ver qué está en la base de datos
```javascript
// Ejecutar en node
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Ver perfil
const { data: profile } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('user_id', 'TU_USER_UUID')
  .single();

console.log('Profile:', profile);

// Ver memorias
const { data: memories } = await supabase
  .from('assistant_memories')
  .select('*')
  .eq('user_id', 'TU_USER_UUID');

console.log('Memories:', memories);
```

---

## 🎯 CASO ESPECÍFICO: CEO CONFIGURADO

### Lo que hiciste (configurar usuario CEO):
Guardaste en `assistant_memories`:
```
Usuario: Luis (CEO)
Asistente: LUCI
Función: Asistente ejecutiva
Alcance: Agenda, correos, negocios, estrategia
Tono: Conclusiones directas, sin repetir info conocida
```

### Dónde quedó guardado:
```sql
SELECT * FROM assistant_memories 
WHERE user_id = 'aeafa6b7-8546-436f-bc43-943f6784fbd7';
```

### Cómo AL-E lo carga:
1. Usuario Luis inicia sesión → `user_id = aeafa6b7-8546-436f-bc43-943f6784fbd7`
2. Orchestrator ejecuta: `loadMemories(userId)`
3. Query a DB:
   ```sql
   SELECT memory FROM assistant_memories 
   WHERE user_id = 'aeafa6b7-8546-436f-bc43-943f6784fbd7'
   AND importance >= 0.3
   ORDER BY importance DESC
   LIMIT 10;
   ```
4. Resultado: "Soy LUCI, asistente ejecutiva de Luis..."
5. Se inyecta en system prompt
6. AL-E responde como LUCI, siguiendo las reglas del CEO

---

## 🚨 IMPORTANTE: DIFERENCIA ENTRE TABLAS

| Aspecto | `user_profiles` | `assistant_memories` |
|---------|----------------|---------------------|
| **Propósito** | Configuración básica del usuario | Memorias de conversaciones |
| **Persistencia** | PERMANENTE (no cambia seguido) | CRECE CON EL TIEMPO |
| **Contenido** | Nombre, tono, idioma | Acuerdos, reglas, decisiones |
| **Límite** | 1 registro por usuario | Múltiples registros |
| **Actualización** | Via PATCH /api/profile/me | Via POST /api/memory/save |
| **Carga** | SIEMPRE (cada request) | SIEMPRE (top 10 por importancia) |

---

## 📂 ARCHIVOS CLAVE EN EL CÓDIGO

### 1. Carga de perfil:
- `src/services/userProfile.ts` - Líneas 55-80
- `src/api/profile.ts` - Líneas 20-50

### 2. Carga de memorias:
- `src/ai/orchestrator.ts` - Líneas 150-195
- `src/memory/memoryService.ts` - Líneas 10-60

### 3. Construcción del system prompt:
- `src/ai/orchestrator.ts` - Líneas 470-550
- `src/services/userProfile.ts` - Líneas 90-133

### 4. Guardado de memorias:
- `src/api/memory.ts` - Todo el archivo
- `src/memory/memoryService.ts` - Función `saveMemory()`

---

## 🎯 RESPUESTA A TU PREGUNTA

> "quiero saber dónde ella va y busca la info de su usuario para que siempre recuerde las reglas que le pone en que tabla busca?"

**RESPUESTA:**
AL-E busca en **DOS lugares SIEMPRE**:

1. **`user_profiles`** → Configuración básica (nombre, tono, etc.)
   - Query: `SELECT * FROM user_profiles WHERE user_id = ?`
   - Se ejecuta: **SIEMPRE al inicio** de cada conversación

2. **`assistant_memories`** → Reglas, acuerdos, configuración específica (ej: CEO)
   - Query: `SELECT * FROM assistant_memories WHERE user_id = ? AND importance >= 0.3 ORDER BY importance DESC LIMIT 10`
   - Se ejecuta: **SIEMPRE al inicio** de cada conversación

**CRÍTICO:** El texto que le pusiste al CEO (Luis = LUCI, asistente ejecutiva) está guardado en `assistant_memories` con `importance = 1.0`, por lo que **SIEMPRE** se carga en el system prompt.

---

## 🔧 PRÓXIMOS PASOS RECOMENDADOS

1. **Ver memorias actuales:**
   ```bash
   node -e "const {createClient} = require('@supabase/supabase-js'); const s = createClient('URL', 'SERVICE_KEY'); (async()=>{const {data}=await s.from('assistant_memories').select('*'); console.log(data);})();"
   ```

2. **Agregar más memorias vía API:**
   ```bash
   curl -X POST http://100.27.201.233:3000/api/memory/save \
     -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" \
     -d '{"memory": "Nueva regla aquí", "importance": 0.9}'
   ```

3. **Verificar que se cargan en producción:**
   ```bash
   ssh ec2-user@100.27.201.233
   pm2 logs 7 --lines 100 | grep "Loaded.*memories"
   ```
