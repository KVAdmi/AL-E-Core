# Transactional Executor V2 - EVIDENCIA OBLIGATORIA

## 🎯 Implementación Completada

Se ha implementado el formato transaccional REAL en `transactionalExecutor.ts` que exige evidencia de base de datos para confirmar éxito.

## 📋 Formato Transaccional REAL

### Caso FALLA (Obligatorio)

```typescript
{
  success: false,
  action: "<nombre_accion>",
  evidence: null,
  userMessage: "No pude completar la acción.",
  reason: "<MOTIVO_REAL>"
}
```

### Caso ÉXITO (Solo si hay evidencia REAL)

```typescript
{
  success: true,
  action: "<nombre_accion>",
  evidence: {
    table: "<tabla>",
    id: "<uuid_real>"
  },
  userMessage: "Acción completada correctamente."
}
```

## 🔒 Regla de Hierro

```
SI NO HAY DB WRITE REAL → success = false
SI NO HAY ID REAL → success = false
SI NO HAY LOG REAL → success = false

El LLM SOLO confirma si success=true Y evidence existe.
```

## 📁 Ubicación del Código

**Archivo:** `src/services/transactionalExecutor.ts`

**Función Nueva:** `executeTransactionalActionV2()`

**Tipo Exportado:** `TransactionalResult`

## ✅ Acciones Implementadas con Evidencia

### 1. calendar.create (DISPONIBLE)

**Caso de uso:** Usuario pide "agenda una reunión con Pablo mañana a las 3pm"

**Código:**
```typescript
const { data: newEvent, error } = await supabase
  .from('calendar_events')
  .insert({ ... })
  .select()
  .single();

// SI FALLA → success: false, evidence: null
if (error || !newEvent || !newEvent.id) {
  return {
    success: false,
    action: 'calendar.create',
    evidence: null,
    userMessage: 'No pude crear el evento en tu calendario.',
    reason: error?.message || 'NO_ID_RETURNED'
  };
}

// ✅ ÉXITO CON EVIDENCIA
return {
  success: true,
  action: 'calendar.create',
  evidence: {
    table: 'calendar_events',
    id: newEvent.id  // UUID REAL de la DB
  },
  userMessage: `Evento agendado: ${title} - ${fecha}`
};
```

**Logs:**
```
[TRANSACTIONAL-V2] Intent: CALENDAR_CREATE
[TRANSACTIONAL-V2] ✅ SUCCESS WITH EVIDENCE: a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

## ❌ Acciones NO Disponibles (Responden con success: false)

### 2. mail.send (NO DISPONIBLE)

```typescript
return {
  success: false,
  action: 'mail.send',
  evidence: null,
  userMessage: 'Esta función aún no está disponible.',
  reason: 'CAPABILITY_DISABLED'
};
```

### 3. mail.inbox (NO DISPONIBLE)

```typescript
return {
  success: false,
  action: 'mail.inbox',
  evidence: null,
  userMessage: 'Esta función aún no está disponible.',
  reason: 'CAPABILITY_DISABLED'
};
```

### 4. telegram (NO DISPONIBLE)

```typescript
return {
  success: false,
  action: 'telegram',
  evidence: null,
  userMessage: 'Esta función aún no está disponible.',
  reason: 'CAPABILITY_DISABLED'
};
```

## 🔄 Migración del Orchestrator

### Función Legacy (mantener temporalmente)

```typescript
export async function executeTransactionalAction(
  // ... mantiene el formato viejo
): Promise<ToolExecutionResult>
```

Esta función sigue devolviendo el formato anterior para no romper el orchestrator actual.

### Función Nueva (usar en nuevas implementaciones)

```typescript
export async function executeTransactionalActionV2(
  userMessage: string,
  userId: string,
  intent: IntentClassification,
  integrations: UserIntegrations
): Promise<TransactionalResult>
```

**TODO:** Migrar el orchestrator para usar `executeTransactionalActionV2()` en lugar de `executeTransactionalAction()`.

## 🧪 Ejemplo de Uso

```typescript
import { 
  executeTransactionalActionV2, 
  TransactionalResult 
} from './services/transactionalExecutor';

const result: TransactionalResult = await executeTransactionalActionV2(
  "agenda una reunión con Pablo mañana a las 3pm",
  userId,
  intent,
  integrations
);

// Verificar evidencia REAL
if (result.success && result.evidence) {
  console.log('✅ ACCIÓN CONFIRMADA');
  console.log('Tabla:', result.evidence.table);
  console.log('ID:', result.evidence.id);
  
  // El LLM puede confirmar al usuario
  return `${result.userMessage} (ID: ${result.evidence.id})`;
  
} else {
  console.log('❌ ACCIÓN FALLÓ');
  console.log('Razón:', result.reason);
  
  // El LLM NO debe simular éxito
  return result.userMessage;
}
```

## 📊 Casos de Prueba

### Caso 1: Éxito Real

**Input:** "agenda reunión con Pablo mañana a las 3pm"

**Output:**
```json
{
  "success": true,
  "action": "calendar.create",
  "evidence": {
    "table": "calendar_events",
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  },
  "userMessage": "Evento agendado: Reunión con Pablo - martes, 31 de diciembre de 2025, 03:00 PM"
}
```

**Log DB:**
```sql
SELECT * FROM calendar_events WHERE id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
-- ✅ Registro existe
```

### Caso 2: Falta Parámetro

**Input:** "agenda una reunión"

**Output:**
```json
{
  "success": false,
  "action": "calendar.create",
  "evidence": null,
  "userMessage": "¿Para qué fecha y hora quieres agendar el evento?",
  "reason": "MISSING_DATE"
}
```

### Caso 3: Error de DB

**Input:** "agenda reunión con Pablo mañana a las 3pm" (pero Supabase falla)

**Output:**
```json
{
  "success": false,
  "action": "calendar.create",
  "evidence": null,
  "userMessage": "No pude crear el evento en tu calendario.",
  "reason": "duplicate key value violates unique constraint"
}
```

### Caso 4: Capacidad Deshabilitada

**Input:** "revisa mi correo"

**Output:**
```json
{
  "success": false,
  "action": "mail.inbox",
  "evidence": null,
  "userMessage": "Esta función aún no está disponible.",
  "reason": "CAPABILITY_DISABLED"
}
```

## 🚫 Anti-Patrones (PROHIBIDO)

### ❌ NO HACER: Simular éxito sin evidencia

```typescript
// ❌ PROHIBIDO
return {
  success: true,  // ← FALSO
  action: 'calendar.create',
  evidence: null,  // ← NO HAY EVIDENCIA
  userMessage: 'Evento creado'  // ← MENTIRA
};
```

### ❌ NO HACER: Devolver success:true sin ID

```typescript
// ❌ PROHIBIDO
return {
  success: true,
  action: 'calendar.create',
  evidence: {
    table: 'calendar_events',
    id: 'pending'  // ← NO ES UN ID REAL
  },
  userMessage: 'Procesando...'
};
```

### ❌ NO HACER: Ignorar errores de DB

```typescript
// ❌ PROHIBIDO
const { error } = await supabase.from('...').insert(...);
// Sin verificar error ← PELIGRO

return {
  success: true,  // ← ASUME ÉXITO SIN VERIFICAR
  ...
};
```

## ✅ Patrón Correcto

```typescript
// ✅ CORRECTO
const { data, error } = await supabase
  .from('table')
  .insert(...)
  .select()
  .single();

// Verificar TRES condiciones
if (error || !data || !data.id) {
  return {
    success: false,
    action: 'action.name',
    evidence: null,
    userMessage: 'No pude completar la acción.',
    reason: error?.message || 'NO_ID_RETURNED'
  };
}

// Solo aquí se puede decir success: true
return {
  success: true,
  action: 'action.name',
  evidence: {
    table: 'table',
    id: data.id  // ← ID REAL VERIFICADO
  },
  userMessage: 'Acción completada.'
};
```

## 📝 Próximos Pasos

1. ✅ **COMPLETADO:** Implementar `executeTransactionalActionV2()` con formato nuevo
2. ✅ **COMPLETADO:** Implementar `calendar.create` con evidencia real
3. ✅ **COMPLETADO:** Configurar respuestas de error para capacidades deshabilitadas
4. ⏳ **PENDIENTE:** Migrar orchestrator para usar V2
5. ⏳ **PENDIENTE:** Implementar `mail.send` cuando esté listo
6. ⏳ **PENDIENTE:** Implementar `mail.inbox` cuando esté listo
7. ⏳ **PENDIENTE:** Deprecar `executeTransactionalAction()` legacy

## 🎯 Principio Fundamental

> **El sistema NO PUEDE "quedar bien" sin evidencia real.**
> 
> Si no hay registro en la base de datos con un ID confirmado,
> entonces `success` DEBE ser `false`.
> 
> **No hay excepciones.**

---

**Fecha de implementación:** 30 de diciembre de 2025  
**Versión:** 2.0.0  
**Status:** ✅ IMPLEMENTADO Y COMPILADO
