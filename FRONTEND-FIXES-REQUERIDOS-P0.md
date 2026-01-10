# 🚨 FRONTEND - FIXES P0 REQUERIDOS

**Fecha**: 10 de enero de 2026  
**Prioridad**: CRÍTICA - BLOQUEANTE PARA PRODUCCIÓN  
**Backend**: ✅ COMPLETO Y FUNCIONAL

---

## RESUMEN EJECUTIVO

El backend de AL-EON está **100% funcional** y corregido:
- ✅ Correos se leen correctamente (INBOX por defecto)
- ✅ OCR procesa attachments automáticamente
- ✅ URLs activan fetch web obligatorio
- ✅ Whisper STT + Edge-TTS configurados y operativos

**Los problemas reportados son exclusivamente de FRONTEND**. Necesitamos correcciones urgentes en:

1. **Sistema de Voz** (captura + reproducción)
2. **Módulo Mail** (escritura y respuesta)

---

## 🎤 PROBLEMA 1: SISTEMA DE VOZ - NO FUNCIONA

### SÍNTOMAS:
- ❌ El micrófono NO captura audio
- ❌ No hay waveform ni nivel de audio visible
- ❌ NUNCA se ha escuchado la voz de AL-EON
- ❌ El flujo voz → texto → respuesta → voz NO ocurre

### BACKEND VERIFICADO (FUNCIONA CORRECTAMENTE):
```
✅ /api/voice/stt existe y responde (Groq Whisper large-v3-turbo)
✅ /api/voice/tts existe y responde (Edge-TTS es-MX-DaliaNeural)
✅ Timeout: 20s STT, 15s TTS
✅ Soporta: mp3, wav, ogg, webm, m4a
```

### PROBLEMA = FRONTEND

**El audio nunca llega al backend porque el frontend no lo captura.**

### ACCIONES REQUERIDAS:

#### 1. Verificar permisos de micrófono
```javascript
// ¿Esto existe y funciona?
navigator.mediaDevices.getUserMedia({ audio: true })
  .then(stream => {
    console.log('✅ Micrófono OK:', stream);
  })
  .catch(err => {
    console.error('❌ Micrófono bloqueado:', err);
  });
```

**CHECK**:
- [ ] ¿Se solicita permiso de micrófono al usuario?
- [ ] ¿El navegador muestra el ícono de micrófono activo?
- [ ] ¿El stream de audio tiene tracks válidos?

---

#### 2. Verificar MediaRecorder
```javascript
// ¿El recorder se inicializa correctamente?
const recorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm' // o audio/mp4, audio/ogg
});

recorder.ondataavailable = (event) => {
  console.log('📊 Audio chunk:', event.data.size, 'bytes');
  // ¿event.data.size > 0?
};

recorder.start();
console.log('🎙️ Recording state:', recorder.state); // ¿dice "recording"?
```

**CHECK**:
- [ ] ¿MediaRecorder se crea sin errores?
- [ ] ¿`recorder.state` cambia a `"recording"`?
- [ ] ¿`ondataavailable` recibe chunks con `size > 0`?
- [ ] ¿El blob final tiene duración > 0?

---

#### 3. Verificar envío al backend
```javascript
// ¿El audio se envía correctamente?
const formData = new FormData();
formData.append('audio', audioBlob, 'recording.webm');

console.log('📤 Enviando audio:', audioBlob.size, 'bytes');

fetch('/api/voice/stt', {
  method: 'POST',
  body: formData
})
.then(res => res.json())
.then(data => {
  console.log('✅ Transcripción:', data.transcript);
})
.catch(err => {
  console.error('❌ Error STT:', err);
});
```

**CHECK**:
- [ ] ¿`audioBlob.size > 0`?
- [ ] ¿El fetch se ejecuta sin errores de red?
- [ ] ¿La respuesta contiene `transcript`?

---

#### 4. Verificar reproducción de respuesta
```javascript
// ¿La voz de AL-EON se reproduce?
fetch('/api/voice/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Hola, soy AL-EON' })
})
.then(res => res.json())
.then(data => {
  console.log('🔊 Audio URL:', data.audioUrl);
  
  const audio = new Audio(data.audioUrl); // data:audio/mpeg;base64,...
  audio.play()
    .then(() => console.log('✅ Reproduciendo voz'))
    .catch(err => console.error('❌ Error reproducción:', err));
});
```

**CHECK**:
- [ ] ¿El TTS retorna `audioUrl` válido?
- [ ] ¿`new Audio()` se crea sin errores?
- [ ] ¿`audio.play()` se ejecuta?
- [ ] ¿SE ESCUCHA el audio en los altavoces?

---

### FLUJO COMPLETO ESPERADO:

```
Usuario habla
    ↓
[Frontend] Captura audio con MediaRecorder
    ↓
[Frontend] Envía blob a /api/voice/stt
    ↓
[Backend] Whisper transcribe → texto
    ↓
[Backend] LLM procesa → respuesta
    ↓
[Backend] Edge-TTS genera audio
    ↓
[Frontend] Recibe audioUrl (base64)
    ↓
[Frontend] new Audio(audioUrl).play()
    ↓
Usuario ESCUCHA la voz de AL-EON
```

**Actualmente se rompe en el primer paso.**

---

### CRITERIO DE ACEPTACIÓN:

✅ **LISTO cuando**:
1. Usuario hable al micrófono
2. Backend reciba audio (verificar en logs: `[STT] Archivo recibido`)
3. Whisper transcriba correctamente
4. AL-EON responda con texto
5. Edge-TTS genere audio
6. Usuario **ESCUCHE** la voz de AL-EON

**Si no se escucha la voz, NO está arreglado.**

---

## 📧 PROBLEMA 2: MÓDULO MAIL - ESCRITURA BLOQUEADA

### SÍNTOMAS:
- ❌ Al intentar responder un correo manualmente, el teclado NO escribe
- ❌ El campo de texto está bloqueado
- ❌ El estado `isReplying` no cambia a `true`
- ❌ Correos aparecen duplicados en múltiples carpetas (Bandeja, Borradores, Enviados, Spam)

### BACKEND VERIFICADO (FUNCIONA CORRECTAMENTE):
```
✅ /api/email/accounts lista cuentas OK
✅ /api/mail/send envía correos OK
✅ email_messages tiene folder_id correcto
✅ email_folders tiene folder_type (inbox, sent, drafts, etc)
```

### PROBLEMA = FRONTEND

---

### ACCIONES REQUERIDAS:

#### 1. Verificar estado de composición
```jsx
// ¿El estado de reply está configurado correctamente?
const [isReplying, setIsReplying] = useState(false);
const [replyText, setReplyText] = useState('');

// Al hacer click en "Responder":
const handleReply = () => {
  setIsReplying(true); // ¿Esto se ejecuta?
  console.log('📧 isReplying:', isReplying);
};
```

**CHECK**:
- [ ] ¿`isReplying` cambia a `true` al hacer click en "Responder"?
- [ ] ¿El componente de textarea se renderiza cuando `isReplying === true`?
- [ ] ¿El estado se actualiza en React DevTools?

---

#### 2. Verificar input/textarea
```jsx
// ¿El textarea tiene el binding correcto?
<textarea
  value={replyText}
  onChange={(e) => setReplyText(e.target.value)} // ¿Esto funciona?
  disabled={isSending} // ¿No está disabled?
  autoFocus // ¿El focus funciona?
  placeholder="Escribe tu respuesta..."
/>
```

**CHECK**:
- [ ] ¿`value={replyText}` está presente?
- [ ] ¿`onChange` actualiza el estado?
- [ ] ¿`disabled={false}` (no está bloqueado)?
- [ ] ¿`autoFocus` hace focus automáticamente?
- [ ] ¿El cursor aparece en el campo?

---

#### 3. Verificar focus programático
```javascript
// ¿Se hace focus correctamente?
const textareaRef = useRef(null);

useEffect(() => {
  if (isReplying && textareaRef.current) {
    textareaRef.current.focus();
    console.log('✅ Focus aplicado');
  }
}, [isReplying]);

<textarea ref={textareaRef} ... />
```

**CHECK**:
- [ ] ¿El `ref` está asignado?
- [ ] ¿El `focus()` se ejecuta?
- [ ] ¿El cursor parpadea en el campo?

---

#### 4. Verificar carpetas duplicadas
```javascript
// ¿Cada carpeta tiene su propia query?
const fetchInbox = async () => {
  const res = await fetch('/api/email/messages?folderType=inbox');
  // ¿folderType está en la query?
};

const fetchSent = async () => {
  const res = await fetch('/api/email/messages?folderType=sent');
  // ¿Es una query DISTINTA?
};
```

**CHECK**:
- [ ] ¿Cada tab (Bandeja, Enviados, Borradores) tiene su propia query?
- [ ] ¿Se pasa `folderType` correcto en cada fetch?
- [ ] ¿No se reutiliza la misma colección para todos los tabs?

---

#### 5. Verificar bloqueos de UI
```javascript
// ¿Hay algo bloqueando el input?
// Revisar si hay:
- Modal invisible encima del textarea
- z-index incorrecto
- pointer-events: none
- Overlay/banner bloqueando interacción
```

**CHECK**:
- [ ] ¿No hay modal invisible?
- [ ] ¿No hay overlay bloqueando clicks?
- [ ] ¿El z-index es correcto?
- [ ] ¿`pointer-events: auto` (no `none`)?

---

### CRITERIO DE ACEPTACIÓN:

✅ **LISTO cuando**:
1. Click en "Responder" → textarea aparece
2. Usuario escribe → texto aparece en el campo
3. Click en "Enviar" → correo se envía
4. Bandeja de entrada muestra solo INBOX
5. Enviados muestra solo SENT
6. NO hay correos duplicados

---

## 🔧 HERRAMIENTAS DE DEBUG

### Para VOZ:
```javascript
// Agregar en consola del navegador:
navigator.mediaDevices.enumerateDevices()
  .then(devices => {
    const mics = devices.filter(d => d.kind === 'audioinput');
    console.log('🎤 Micrófonos:', mics);
  });
```

### Para MAIL:
```javascript
// Agregar en el componente Mail:
console.log('State:', {
  isReplying,
  replyText,
  disabled: textareaRef.current?.disabled,
  hasFocus: document.activeElement === textareaRef.current
});
```

---

## 📊 RESUMEN DE RESPONSABILIDADES

| Componente | Responsable | Estado |
|------------|-------------|--------|
| Backend VOZ | Core Team | ✅ COMPLETO |
| Frontend VOZ | **Frontend Team** | ❌ **PENDIENTE** |
| Backend Mail | Core Team | ✅ COMPLETO |
| Frontend Mail | **Frontend Team** | ❌ **PENDIENTE** |

---

## ⏰ DEADLINE

**INMEDIATO - P0 CRÍTICO**

Sin estos fixes, AL-EON:
- ❌ No puede usarse en modo manos libres
- ❌ No puede responder correos manualmente
- ❌ Está ROTA en funcionalidad básica

**Por favor, priorizar estos fixes sobre cualquier otra tarea.**

---

## 📞 CONTACTO

Si necesitan ayuda con:
- Endpoints del backend
- Formato de requests/responses
- Testing de APIs

Contactar al Core Team.

---

**Última actualización**: 10 de enero de 2026  
**Documento**: FRONTEND-FIXES-REQUERIDOS-P0.md
