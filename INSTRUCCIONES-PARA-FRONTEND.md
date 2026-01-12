# 📋 INSTRUCCIONES CRÍTICAS PARA FRONTEND

**Fecha:** 11 de Enero de 2026  
**De:** Core (Backend)  
**Para:** Equipo Frontend  

---

## 🚨 PROBLEMAS CRÍTICOS QUE FRONTEND DEBE CORREGIR

### 1. MAIL - Contrato roto entre Core y Front

**PROBLEMA ACTUAL:**
- Front pide "último correo" pero muestra SENT
- Muestra los mismos correos en todas las carpetas
- Reply bloquea input, no envía threadId al Core

**LO QUE FRONTEND DEBE HACER:**

```javascript
// ❌ MAL (NO HACER):
// Filtrar carpetas en frontend
const inbox = emails.filter(e => e.folder === 'INBOX');

// ✅ BIEN (HACER):
// Cada carpeta = query distinta al backend
const inbox = await api.get('/api/email/list', { 
  params: { accountId, label: 'INBOX' } 
});

const sent = await api.get('/api/email/list', { 
  params: { accountId, label: 'SENT' } 
});
```

**REPLY - ARREGLAR:**

```javascript
// ❌ MAL (NO HACER):
const handleReply = () => {
  setIsReplying(true);
  // Input sigue bloqueado
};

// ✅ BIEN (HACER):
const handleReply = (email) => {
  setIsReplying(true);
  setReplyData({
    threadId: email.threadId,
    messageId: email.id,
    to: email.from,
    subject: `Re: ${email.subject}`
  });
  // Desbloquear textarea
  inputRef.current?.focus();
};

// Al enviar:
await api.post('/api/email/reply', {
  threadId: replyData.threadId,
  messageId: replyData.messageId,
  body: replyText
});
```

---

### 2. ATTACHMENTS - Frontend no confía en el Core

**PROBLEMA ACTUAL:**
- Frontend dice "la IA no puede ver archivos"
- No envía metadata al Core

**LO QUE FRONTEND DEBE HACER:**

```javascript
// ❌ MAL (NO HACER):
if (hasAttachment) {
  toast.error("La IA no puede ver archivos");
  return;
}

// ✅ BIEN (HACER):
if (hasAttachment) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('message', userMessage);
  
  const response = await api.post('/api/chat', formData);
  
  // Si Core falla, ENTONCES mostrar error
  if (!response.ok) {
    toast.error(response.error); // Error del Core
  }
}
```

---

### 3. VOZ - Audio vacío se envía al Core

**PROBLEMA ACTUAL:**
- Frontend no valida que audio.size > 0
- No pide permisos explícitos

**LO QUE FRONTEND DEBE HACER:**

```javascript
// ✅ ANTES DE ENVIAR:
const handleVoiceEnd = async (audioBlob) => {
  // VALIDAR
  if (!audioBlob || audioBlob.size === 0) {
    toast.error("No se capturó audio. Inténtalo de nuevo.");
    return;
  }
  
  console.log('[VOICE] Audio size:', audioBlob.size);
  console.log('[VOICE] Audio type:', audioBlob.type);
  
  // Enviar al Core
  const formData = new FormData();
  formData.append('audio', audioBlob, 'voice.webm');
  
  const response = await api.post('/api/voice/stt', formData);
  
  if (response.ok) {
    // Reproducir TTS automáticamente
    const audio = new Audio(response.audioUrl);
    audio.play();
  }
};

// PERMISOS EXPLÍCITOS:
const requestMicPermission = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: true 
    });
    setMicGranted(true);
    return stream;
  } catch (err) {
    toast.error("Necesitas dar permisos de micrófono");
    setMicGranted(false);
  }
};
```

---

### 4. ERRORES - Frontend simula éxito

**PROBLEMA ACTUAL:**
- Frontend no muestra errores reales del Core
- Simula éxito cuando el Core falló

**LO QUE FRONTEND DEBE HACER:**

```javascript
// ❌ MAL (NO HACER):
const sendEmail = async () => {
  setLoading(true);
  // Asumir que funcionó
  toast.success("Correo enviado");
  closeComposer();
};

// ✅ BIEN (HACER):
const sendEmail = async () => {
  setLoading(true);
  
  const response = await api.post('/api/email/send', emailData);
  
  if (response.success && response.messageId) {
    // SOLO si hay messageId real
    toast.success(`Correo enviado (ID: ${response.messageId})`);
    closeComposer();
  } else {
    // Mostrar error real
    toast.error(`Error: ${response.error || 'Sin evidencia de envío'}`);
  }
  
  setLoading(false);
};
```

---

### 5. "NO PUEDO" - Frontend bloquea prematuramente

**PROBLEMA ACTUAL:**
- Frontend dice "no puedo" sin intentar
- No envía la acción al Core

**LO QUE FRONTEND DEBE HACER:**

```javascript
// ❌ MAL (NO HACER):
const handleUserMessage = async (message) => {
  if (message.includes("archivo") || message.includes("imagen")) {
    return "No puedo procesar archivos";
  }
  
  if (message.includes("enviar correo")) {
    return "No tengo acceso a tu correo";
  }
};

// ✅ BIEN (HACER):
const handleUserMessage = async (message) => {
  // SIEMPRE enviar al Core
  const response = await api.post('/api/chat', { message });
  
  // El Core decide si puede o no
  return response.reply;
};
```

---

## 📊 RESUMEN DE CAMBIOS REQUERIDOS

| Módulo | Acción | Impacto |
|--------|--------|---------|
| Email | Queries distintas por label | CRÍTICO |
| Email | Reply con threadId | CRÍTICO |
| Attachments | Eliminar bloqueo "no puedo ver" | CRÍTICO |
| Voice | Validar audio.size > 0 | CRÍTICO |
| Errores | Mostrar error real del Core | CRÍTICO |
| General | Eliminar "no puedo" sin intentar | ALTO |

---

## ✅ CHECKLIST DE VALIDACIÓN

Frontend debe poder demostrar:

- [ ] Inbox ≠ Sent (queries distintas)
- [ ] Reply incluye threadId en request
- [ ] Attachments se envían sin bloqueo
- [ ] Voice valida audio.size > 0
- [ ] Errores del Core se muestran al usuario
- [ ] No hay mensajes "no puedo" sin llamar al Core

---

**FIN DE INSTRUCCIONES.**

**Si tienen dudas, revisar:**
- `CIERRE-EJECUTIVO-DEFINITIVO-11-ENERO-2026.md`
- Logs del Core en producción
