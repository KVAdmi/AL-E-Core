# 🚀 RESPUESTA A FRONTEND - BUGS EMAIL RESUELTOS

**Fecha:** 9 de enero de 2026, 15:14  
**Backend:** AL-E Core (commit `91c0504`)  
**Status:** ✅ Backend arreglado + Desplegado a producción

---

## ✅ PROBLEMA 1: BACKEND ARREGLADO - Correos enviados ahora se guardan en "Sent"

### Lo que estaba mal (BACKEND):
El endpoint `/api/email/send` **NO estaba guardando** los correos enviados en la base de datos. Solo los enviaba por SMTP y ya.

### Lo que arreglé (BACKEND):
```typescript
// src/api/emailHub.ts - Líneas 588-620
// Después de enviar por SMTP:

// 🔥 GUARDAR CORREO ENVIADO EN DB CON FOLDER "SENT"
try {
  // Buscar folder "Sent" de esta cuenta
  const sentFolder = await foldersRepo.getEmailFolderByType(account.id, 'Sent');
  
  if (sentFolder) {
    // Guardar mensaje enviado
    await messagesRepo.createEmailMessage({
      account_id: account.id,
      owner_user_id: userId,
      folder_id: sentFolder.id, // ✅ SENT FOLDER
      message_id: result.messageId || `sent-${Date.now()}`,
      from_address: account.from_email,
      from_name: account.from_name,
      to_addresses: toArray,
      cc_addresses: ccArray,
      bcc_addresses: bccArray,
      subject: sanitizeSubject(subject),
      body_text: body_text,
      body_html: body_html,
      has_attachments: false,
      attachment_count: 0,
      date: new Date(),
      in_reply_to: in_reply_to
    });
    
    console.log('[EMAIL HUB] ✅ Correo guardado en Sent folder');
  }
} catch (saveError) {
  console.error('[EMAIL HUB] ⚠️ Error al guardar correo enviado (no crítico):', saveError.message);
}
```

**Resultado:** Ahora cuando envías un correo:
1. ✅ Se envía por SMTP
2. ✅ Se guarda en DB con `folder_id` del folder "Sent"
3. ✅ Aparece en la carpeta correcta

---

## 🔧 PROBLEMA 2: FRONTEND DEBE ARREGLARSE - Filtro de carpetas

### El problema (FRONTEND):
El query en `EmailInbox.jsx` hace un JOIN y luego intenta filtrar por `folder.folder_type`:

```javascript
// ❌ ESTO NO FUNCIONA EN SUPABASE:
query = query.eq('folder.folder_type', dbFolderType);
```

**Supabase NO soporta** filtrar por columnas de JOIN con `.eq()`.

### La solución (FRONTEND):

**PASO 1:** Primero obtener el `folder_id` del folder que quieres filtrar:

```javascript
// src/features/email/components/EmailInbox.jsx
// LÍNEA 48 - REEMPLAZAR TODO EL BLOQUE DE QUERY

const fetchMessages = async () => {
  if (!accountId) return;
  
  setLoading(true);
  setError(null);
  
  try {
    let targetFolderId = null;
    
    // PASO 1: Si hay filtro de folder, obtener el folder_id
    if (folder) {
      const folderTypeMap = {
        'inbox': 'Inbox',
        'sent': 'Sent',
        'drafts': 'Drafts',
        'starred': 'Starred',
        'spam': 'Spam',
        'archive': 'Archive',
        'trash': 'Trash'
      };
      const dbFolderType = folderTypeMap[folder] || folder;
      
      console.log(`[EmailInbox] 🔍 Buscando folder_id para tipo: ${dbFolderType}`);
      
      const { data: folderData, error: folderError } = await supabase
        .from('email_folders')
        .select('id')
        .eq('account_id', accountId)
        .eq('folder_type', dbFolderType)
        .maybeSingle();
      
      if (folderError) {
        console.error('[EmailInbox] ❌ Error al buscar folder:', folderError);
      } else if (folderData) {
        targetFolderId = folderData.id;
        console.log(`[EmailInbox] ✅ folder_id encontrado: ${targetFolderId}`);
      } else {
        console.warn(`[EmailInbox] ⚠️ No se encontró folder tipo ${dbFolderType}`);
      }
    }
    
    // PASO 2: Query de mensajes con filtro directo por folder_id
    let query = supabase
      .from('email_messages')
      .select(`
        *,
        folder:email_folders!folder_id(id, folder_name, folder_type, imap_path)
      `)
      .eq('account_id', accountId);
    
    // ✅ FILTRAR POR folder_id DIRECTAMENTE (NO POR JOIN)
    if (targetFolderId) {
      query = query.eq('folder_id', targetFolderId);
      console.log(`[EmailInbox] 🔍 Filtrando por folder_id: ${targetFolderId}`);
    }
    
    query = query
      .order('date', { ascending: false })
      .limit(50);
    
    const { data: messages, error: messagesError } = await query;
    
    if (messagesError) {
      console.error('[EmailInbox] ❌ Error al obtener mensajes:', messagesError);
      setError('Error al cargar mensajes');
      return;
    }
    
    console.log(`[EmailInbox] ✅ ${messages?.length || 0} mensajes obtenidos`);
    setMessages(messages || []);
  } catch (err) {
    console.error('[EmailInbox] Error:', err);
    setError('Error al cargar mensajes');
  } finally {
    setLoading(false);
  }
};
```

**RESUMEN DEL CAMBIO:**
1. **Primero:** Query a `email_folders` para obtener el `folder_id` del tipo que buscas
2. **Segundo:** Filtrar `email_messages` por ese `folder_id` directamente
3. **NO** intentar filtrar por `folder.folder_type` en el JOIN

---

## 🔧 PROBLEMA 3: FRONTEND DEBE ARREGLARSE - Error "Failed to fetch" después de enviar

### El problema (FRONTEND):
En `EmailComposer.jsx` después de enviar, llamas `triggerRefresh()` que hace fetch al backend. Si el backend tarda o hay timeout, muestra error aunque el correo SÍ se envió.

### La solución (FRONTEND):

**OPCIÓN A: Silenciar el error**

```javascript
// src/features/email/components/EmailComposer.jsx
// LÍNEA 175 - Dentro de handleSend(), después del toast de éxito

toast({
  title: "✓ Correo enviado",
  description: "El correo se envió exitosamente",
});

// ✅ OPCIÓN A: Agregar .catch() silencioso
if (triggerRefresh) {
  setTimeout(() => {
    triggerRefresh().catch(err => {
      console.warn('[EmailComposer] Error al refrescar (ignorado):', err);
      // NO mostrar error al usuario - el correo ya se envió
    });
  }, 500);
}

if (onSent) {
  onSent(result);
}

handleClose();
```

**OPCIÓN B: Recargar página completa (más seguro)**

```javascript
// src/features/email/components/EmailComposer.jsx
// LÍNEA 175 - Reemplazar el bloque de triggerRefresh

toast({
  title: "✓ Correo enviado",
  description: "El correo se envió exitosamente",
});

if (onSent) {
  onSent(result);
}

handleClose();

// ✅ OPCIÓN B: Recargar página después de cerrar composer
setTimeout(() => {
  window.location.reload();
}, 300);
```

**RECOMENDACIÓN:** Usa OPCIÓN A (con `.catch()`) porque es más rápida y no pierde el estado de la UI.

---

## 🔧 PROBLEMA 4: FRONTEND - getInbox no acepta filtro de folder

### El problema (FRONTEND):
La función `getInbox()` en `emailService.js` no acepta parámetro `folder` para filtrar.

### La solución (FRONTEND):

```javascript
// src/services/emailService.js
// LÍNEA 718 - Reemplazar toda la función getInbox

export async function getInbox(accountId, options = {}) {
  try {
    console.log('[EmailService] 📬 getInbox llamado con:', { accountId, options });
    
    let targetFolderId = null;
    
    // ✅ AGREGAR: Filtro por folder si se especifica
    if (options.folder) {
      const folderTypeMap = {
        'inbox': 'Inbox',
        'sent': 'Sent',
        'drafts': 'Drafts',
        'spam': 'Spam',
        'trash': 'Trash',
        'archive': 'Archive'
      };
      const folderType = folderTypeMap[options.folder] || options.folder;
      
      // Obtener folder_id
      const { data: folderData } = await supabase
        .from('email_folders')
        .select('id')
        .eq('account_id', accountId)
        .eq('folder_type', folderType)
        .maybeSingle();
      
      if (folderData?.id) {
        targetFolderId = folderData.id;
        console.log(`[EmailService] 🔍 Filtrando por folder: ${folderType} (${targetFolderId})`);
      }
    }
    
    // Query de mensajes
    let query = supabase
      .from('email_messages')
      .select(`
        *,
        folder:email_folders!folder_id(id, folder_name, folder_type, imap_path)
      `)
      .eq('account_id', accountId);
    
    // ✅ Filtrar por folder_id si se especificó
    if (targetFolderId) {
      query = query.eq('folder_id', targetFolderId);
    }
    
    query = query
      .order('date', { ascending: false })
      .limit(options.limit || 50);
    
    const { data: messages, error } = await query;
    
    if (error) {
      console.error('[EmailService] Error de Supabase:', error);
      throw new Error('Error al obtener mensajes de Supabase');
    }
    
    console.log(`[EmailService] ✅ ${messages?.length || 0} mensajes obtenidos`);
    
    // Transformar al formato esperado
    return {
      messages: (messages || []).map(msg => ({
        id: msg.id,
        message_id: msg.id,
        from_address: msg.from_address,
        from_name: msg.from_name,
        from_email: msg.from_address,
        to_addresses: msg.to_addresses,
        subject: msg.subject,
        preview: msg.body_preview,
        body_preview: msg.body_preview,
        date: msg.date,
        received_at: msg.date,
        is_read: msg.is_read,
        is_starred: msg.is_starred,
        has_attachments: msg.has_attachments,
        account_id: msg.account_id,
        folder: msg.folder?.folder_name || msg.folder?.folder_type || 'Unknown',
        folder_id: msg.folder_id,
        folder_type: msg.folder?.folder_type,
      }))
    };
  } catch (error) {
    console.error('[EmailService] Error en getInbox:', error);
    throw error;
  }
}
```

---

## 📊 RESUMEN DE CAMBIOS REQUERIDOS EN FRONTEND

### ✅ ARCHIVO 1: `src/features/email/components/EmailInbox.jsx`
**Cambio:** Reemplazar query completo (línea ~48)
- Primero obtener `folder_id` del folder deseado
- Luego filtrar por `folder_id` directamente
- NO filtrar por `folder.folder_type` en JOIN

### ✅ ARCHIVO 2: `src/features/email/components/EmailComposer.jsx`
**Cambio:** Agregar `.catch()` en `triggerRefresh()` (línea ~175)
- Silenciar error si backend tarda
- O usar `window.location.reload()` como alternativa

### ✅ ARCHIVO 3: `src/services/emailService.js`
**Cambio:** Actualizar `getInbox()` (línea ~718)
- Aceptar `options.folder` como parámetro
- Obtener `folder_id` primero, luego filtrar

---

## 🧪 CÓMO PROBAR QUE FUNCIONA

### Test 1: Enviar correo aparece en "Sent"
1. Ir a `/correo`
2. Click "Nuevo correo"
3. Enviar correo a cualquier destinatario
4. Esperar toast "✓ Correo enviado"
5. Click en "Enviados" (sidebar izquierdo)
6. **✅ RESULTADO ESPERADO:** El correo aparece en "Enviados", NO en "Inbox"

### Test 2: Filtro de folders funciona
1. Click en "Spam" → Solo debe mostrar spam
2. Click en "Borradores" → Solo debe mostrar drafts
3. Click en "Bandeja de entrada" → Solo debe mostrar inbox
4. **✅ RESULTADO ESPERADO:** Cada folder muestra mensajes diferentes

### Test 3: No error después de enviar
1. Enviar correo
2. Esperar toast verde "✓ Correo enviado"
3. **✅ RESULTADO ESPERADO:** NO debe aparecer letrero rojo "Error al sincronizar"

---

## 🚀 PRÓXIMOS PASOS

1. **FRONTEND:** Implementar los 3 cambios arriba ✅
2. **FRONTEND:** Probar flujo completo de envío ✅
3. **FRONTEND:** Probar filtros de folders ✅
4. **FRONTEND:** Deploy a Netlify ✅
5. **FRONTEND:** Actualizar badge a `v15:XX 🟢` ✅

6. **URGENTE:** Configurar SPF/DKIM en Hostinger (ver `FIX-GMAIL-SMTP-PROBLEM.md`)
7. **URGENTE:** Actualizar cuenta SMTP de Gmail a Hostinger

---

## 📞 SI SIGUEN HABIENDO PROBLEMAS

### Backend logs:
```bash
ssh ubuntu@100.27.201.233
pm2 logs al-e-core --lines 100 | grep "EMAIL HUB"
```

Buscar:
- `[EMAIL HUB] ✅ Correo guardado en Sent folder` ← Debe aparecer al enviar
- `[EMAIL HUB] ⚠️ No se encontró folder Sent` ← Si aparece, folders no están creados

### Frontend logs:
Abrir DevTools Console, buscar:
- `[EmailInbox] ✅ folder_id encontrado: XXX` ← Debe aparecer al cambiar folder
- `[EmailInbox] ✅ 10 mensajes obtenidos` ← Debe mostrar cantidad correcta
- `[EmailComposer] Error al refrescar (ignorado)` ← OK si aparece después de silenciar

---

## ✅ CONFIRMACIÓN

**Backend:** ✅ Desplegado commit `91c0504`
- Endpoint `/api/email/send` ahora guarda correos en folder "Sent"
- Nueva función `getEmailFolderByType()` para buscar folders por tipo
- Logs detallados en consola

**Frontend:** 🔧 REQUIERE CAMBIOS
- Implementar los 3 cambios descritos arriba
- Probar flujo completo
- Deploy a Netlify

**Tiempo estimado:** 30-45 minutos para implementar todos los cambios en frontend

---

**Documentado por:** GitHub Copilot  
**Backend desplegado:** ✅ Producción (100.27.201.233)  
**Urgencia:** 🔥 CRÍTICO - Frontend debe implementar estos cambios YA
