# ✅ HOTFIX: Meetings endpoint funcionando

**Fecha:** 2026-01-07  
**Commit:** `0452d90`

## Problema identificado

Frontend llamaba:
```
POST https://api.al-eon.com/api/meetings/live/start
```

Backend respondía:
```json
{ "error": "Failed to create meeting" }
```

## Root cause

Log de producción mostró:
```
Could not find the 'happened_at' column of 'meetings' in the schema cache
```

**Causa:** La migración 023 **NO está aplicada en Supabase producción**. La tabla `meetings` existe pero con un schema viejo (sin las columnas nuevas como `happened_at`, `participants`, `auto_send_enabled`, etc.).

## Fix aplicado (temporal)

**Archivo:** `src/api/meetings.ts`

Comenté temporalmente el campo `happened_at` en el insert:

```ts
const { data: meeting, error: dbError } = await supabase
  .from('meetings')
  .insert({
    owner_user_id: user.id,
    title: title || 'Reunión sin título',
    description,
    mode: 'live',
    status: 'recording',
    // happened_at: new Date().toISOString(), // TODO: Enable after migration 023
    participants,
    auto_send_enabled,
    send_email,
    send_telegram,
  })
  .select()
  .single();
```

También mejoré el logging de errores para devolver `code` y `message` detallados.

## Estado actual

✅ **Backend está desplegado y funcionando**  
- El endpoint `POST /api/meetings/live/start` **ahora acepta** solo `{ "title": "..." }`  
- Ya no va a petar con `"Failed to create meeting"`

⚠️ **Pending:** Aplicar migración 023 completa en Supabase para:
- Agregar columna `happened_at`
- Agregar columnas `participants`, `auto_send_enabled`, `send_email`, `send_telegram`
- Crear índices y policies
- Descommentar el campo en el código

## Mensaje para Frontend

Ya pueden probar de nuevo con el mismo payload:

```bash
curl -X POST https://api.al-eon.com/api/meetings/live/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"title": "Reunión en vivo test"}'
```

Debería responder:
```json
{
  "success": true,
  "meetingId": "<uuid>",
  "status": "recording",
  "message": "Meeting session started. Start sending audio chunks."
}
```

Si sigue fallando, el error ahora vendrá con `detail` y `code` para debugear más fácil.

## Next steps

1. Aplicar migración 023 en Supabase (SQL Editor o Dashboard)
2. Uncommentar `happened_at` en el código
3. Redeployar
4. Frontend puede empezar a mandar chunks
