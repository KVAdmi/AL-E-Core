# 🔧 AUDITORÍA COMPLETA FRONTEND - Todos los Módulos

**Fecha:** 17 de enero de 2026  
**Repo:** AL-EON (Frontend)  
**Backend:** AL-E Core (100% funcional validado)

---

## 📊 RESUMEN EJECUTIVO

| Módulo | Backend | Frontend | Problema Identificado | Prioridad |
|---|---|---|---|---|
| **Telegram Bots** | ✅ OK | ❌ Bug | No parsea wrapper `{ ok, bots }` | 🔴 P0 |
| **Voice Settings** | ✅ OK | ⚠️ Parcial | Selector género no cambia voz real | 🟡 P1 |
| **STT/TTS** | ✅ OK | ⚠️ No validado | MediaRecorder + playback pendiente | 🟡 P1 |
| **Meetings** | ✅ OK | ⚠️ No validado | UI upload + polling pendiente | 🟡 P2 |
| **OCR Attachments** | ✅ OK | ✅ FIXED | handlePaste con validación aplicado | ✅ P1-B |

---

## 1️⃣ TELEGRAM BOTS - Fix Response Parser

### 🐛 Problema
Backend devuelve:
```json
{ "ok": true, "bots": [{ "id": "...", "bot_username": "Patty_ALE_bot" }] }
```

Frontend espera array directo y el parser no extrae `result.bots`.

### ✅ Solución
**Archivo:** `src/services/telegramService.js`

**Ubicación 1:** Líneas 224-235 (función `getUserBots`)

**REEMPLAZAR:**
```javascript
      if (response.ok) {
        const bots = await response.json();
        console.log('[TelegramService] ✅ Bots obtenidos desde backend:', bots);
        
        // Validar que sea un array o un objeto (si es un solo bot)
        if (Array.isArray(bots)) {
          return bots;
        } else if (bots && typeof bots === 'object' && Object.keys(bots).length > 0) {
          return [bots]; // ❌ INCORRECTO
        }
        
        console.warn('[TelegramService] ⚠️ Backend devolvió formato inválido o vacío, usando Supabase');
      }
```

**POR:**
```javascript
      if (response.ok) {
        const result = await response.json();
        console.log('[TelegramService] ✅ Response desde backend:', result);
        
        // 🔥 SI VIENE { ok: true, bots: [...] } → extraer el array
        let bots = result;
        if (result && result.ok && Array.isArray(result.bots)) {
          bots = result.bots;
          console.log('[TelegramService] ✅ Bots extraídos del wrapper:', bots.length);
        }
        
        // Validar que sea un array
        if (Array.isArray(bots)) {
          return bots;
        } else if (bots && typeof bots === 'object' && !bots.ok) {
          // Si es un solo bot (sin el wrapper { ok: true })
          return [bots];
        }
        
        console.warn('[TelegramService] ⚠️ Backend devolvió formato inválido:', result);
      }
```

**Ubicación 2:** Líneas 416-418 (función `getChats`)

**REEMPLAZAR:**
```javascript
      if (response.ok) {
        const chats = await response.json();
        console.log('[TelegramService] ✅ Chats obtenidos desde backend:', chats);
        return chats;  // ❌ INCORRECTO
      }
```

**POR:**
```javascript
      if (response.ok) {
        const result = await response.json();
        console.log('[TelegramService] ✅ Response desde backend:', result);
        
        // 🔥 SI VIENE { ok: true, chats: [...] } → extraer el array
        let chats = result;
        if (result && result.ok && Array.isArray(result.chats)) {
          chats = result.chats;
          console.log('[TelegramService] ✅ Chats extraídos del wrapper:', chats.length);
        }
        
        return Array.isArray(chats) ? chats : [];
      }
```

### 📋 Pasos
```bash
cd "/Users/pg/Documents/CHAT AL-E"
# Editar src/services/telegramService.js con los cambios de arriba
npm run lint
git add src/services/telegramService.js
git commit -m "fix(telegram): parse backend response wrapper correctly"
git push origin main
```

### 🧪 Validación
Después del deploy, en DevTools:
```javascript
const token = localStorage.getItem('supabase.auth.token');
const response = await fetch('https://api.al-eon.com/api/telegram/bots', {
  headers: { 'Authorization': `Bearer ${JSON.parse(token).access_token}` }
});
const result = await response.json();
console.log('Backend response:', result);
console.log('Debe mostrar bots en UI ahora');
```

**Esperado:** Bot `@Patty_ALE_bot` aparece en lista de Settings → Telegram

---

## 2️⃣ VOICE SETTINGS - Fix Selector de Género

### 🐛 Problema
UI tiene selector **Hombre 👨 / Mujer 👩** pero:

1. **Click en género NO cambia la voz seleccionada si no hay voces mexicanas** del género clickeado
2. **Auto-selección al montar** solo busca voces femeninas (líneas 107-115)
3. **`tts_gender` se guarda en DB** pero **NO se usa** en `useChat.js` al hablar

**Archivo afectado:** `src/pages/SettingsPage.jsx`

### ✅ Solución Completa

#### **FIX 1: Auto-selección inicial debe respetar género guardado**

**Ubicación:** Líneas 92-125 (función `loadVoices`)

**BUSCAR** (línea ~107):
```javascript
      // Auto-seleccionar voz mexicana si no hay ninguna guardada
      if (!settings.tts_voice_name && spanishVoices.length > 0) {
        const mexicanVoice = spanishVoices.find(v => 
          v.lang === 'es-MX' || v.name.toLowerCase().includes('mexico')
        );
        
        if (mexicanVoice) {
          setSettings(prev => ({
            ...prev,
            tts_voice_name: mexicanVoice.name,
          }));
        }
      }
```

**REEMPLAZAR POR:**
```javascript
      // Auto-seleccionar voz mexicana si no hay ninguna guardada (respetando género)
      if (!settings.tts_voice_name && spanishVoices.length > 0) {
        const mexicanVoices = spanishVoices.filter(v => 
          v.lang === 'es-MX' || v.name.toLowerCase().includes('mexico')
        );
        
        if (mexicanVoices.length > 0) {
          // 🔥 Filtrar por género guardado en settings
          const gender = settings.tts_gender || 'female';
          
          let preferredVoice = null;
          if (gender === 'female') {
            preferredVoice = mexicanVoices.find(v => 
              v.name.toLowerCase().includes('female') ||
              v.name.toLowerCase().includes('mujer') ||
              v.name.toLowerCase().includes('paulina') ||
              v.name.toLowerCase().includes('monica')
            );
          } else {
            preferredVoice = mexicanVoices.find(v => 
              v.name.toLowerCase().includes('male') ||
              v.name.toLowerCase().includes('hombre') ||
              v.name.toLowerCase().includes('diego') ||
              v.name.toLowerCase().includes('jorge')
            );
          }
          
          // Fallback: usar la primera mexicana disponible
          const selectedVoice = preferredVoice || mexicanVoices[0];
          
          setSettings(prev => ({
            ...prev,
            tts_voice_name: selectedVoice.name,
          }));
          
          console.log('[TTS] Auto-seleccionada voz:', selectedVoice.name, 'género:', gender);
        }
      }
```

#### **FIX 2: Selector de género debe tener fallback si no hay voces del género clickeado**

**Ubicación:** Líneas 1330-1424 (botones Hombre/Mujer)

**BUSCAR** (línea ~1340):
```javascript
                    onClick={() => {
                      // 🔥 RECALCULAR mexicanVoices en el momento del click
                      const safeVoices = Array.isArray(availableVoices) ? availableVoices : [];
                      const mexicanVoicesNow = safeVoices.filter(v => 
                        v.lang === 'es-MX' || 
                        v.name.toLowerCase().includes('mexico') ||
                        v.name.toLowerCase().includes('mexican')
                      );
                      
                      const femaleVoice = mexicanVoicesNow.find(v => 
                        v.name.toLowerCase().includes('female') ||
                        v.name.toLowerCase().includes('mujer') ||
                        v.name.toLowerCase().includes('paulina') ||
                        v.name.toLowerCase().includes('monica')
                      ) || mexicanVoicesNow.find(v => !v.name.toLowerCase().includes('male'));
                      
                      setSettings({
                        ...settings,
                        tts_gender: 'female',
                        tts_voice_name: femaleVoice?.name || null,
                      });
                    }}
```

**REEMPLAZAR POR:**
```javascript
                    onClick={() => {
                      const safeVoices = Array.isArray(availableVoices) ? availableVoices : [];
                      const mexicanVoicesNow = safeVoices.filter(v => 
                        v.lang === 'es-MX' || 
                        v.name.toLowerCase().includes('mexico') ||
                        v.name.toLowerCase().includes('mexican')
                      );
                      
                      let femaleVoice = mexicanVoicesNow.find(v => 
                        v.name.toLowerCase().includes('female') ||
                        v.name.toLowerCase().includes('mujer') ||
                        v.name.toLowerCase().includes('paulina') ||
                        v.name.toLowerCase().includes('monica')
                      );
                      
                      // 🔥 FALLBACK 1: Buscar cualquier voz que no tenga "male" en español
                      if (!femaleVoice) {
                        const spanishVoices = safeVoices.filter(v => v.lang.startsWith('es'));
                        femaleVoice = spanishVoices.find(v => 
                          (v.name.toLowerCase().includes('female') || 
                           v.name.toLowerCase().includes('mujer')) &&
                          !v.name.toLowerCase().includes('male')
                        );
                      }
                      
                      // 🔥 FALLBACK 2: Usar primera mexicana sin "male" en nombre
                      if (!femaleVoice && mexicanVoicesNow.length > 0) {
                        femaleVoice = mexicanVoicesNow.find(v => !v.name.toLowerCase().includes('male'));
                      }
                      
                      // 🔥 FALLBACK 3: Usar primera disponible
                      if (!femaleVoice && safeVoices.length > 0) {
                        femaleVoice = safeVoices[0];
                      }
                      
                      setSettings({
                        ...settings,
                        tts_gender: 'female',
                        tts_voice_name: femaleVoice?.name || null,
                      });
                      
                      console.log('[TTS] Cambiando a voz femenina:', femaleVoice?.name || 'ninguna');
                    }}
```

**APLICAR EL MISMO FIX AL BOTÓN "HOMBRE"** (líneas ~1384-1410):

**BUSCAR:**
```javascript
                    onClick={() => {
                      const safeVoices = Array.isArray(availableVoices) ? availableVoices : [];
                      const mexicanVoicesNow = safeVoices.filter(v => 
                        v.lang === 'es-MX' || 
                        v.name.toLowerCase().includes('mexico') ||
                        v.name.toLowerCase().includes('mexican')
                      );
                      
                      const maleVoice = mexicanVoicesNow.find(v => 
                        v.name.toLowerCase().includes('male') ||
                        v.name.toLowerCase().includes('hombre') ||
                        v.name.toLowerCase().includes('diego') ||
                        v.name.toLowerCase().includes('jorge')
                      );
                      
                      setSettings({
                        ...settings,
                        tts_gender: 'male',
                        tts_voice_name: maleVoice?.name || null,
                      });
                    }}
```

**REEMPLAZAR POR:**
```javascript
                    onClick={() => {
                      const safeVoices = Array.isArray(availableVoices) ? availableVoices : [];
                      const mexicanVoicesNow = safeVoices.filter(v => 
                        v.lang === 'es-MX' || 
                        v.name.toLowerCase().includes('mexico') ||
                        v.name.toLowerCase().includes('mexican')
                      );
                      
                      let maleVoice = mexicanVoicesNow.find(v => 
                        v.name.toLowerCase().includes('male') ||
                        v.name.toLowerCase().includes('hombre') ||
                        v.name.toLowerCase().includes('diego') ||
                        v.name.toLowerCase().includes('jorge')
                      );
                      
                      // 🔥 FALLBACK 1: Buscar cualquier voz masculina en español
                      if (!maleVoice) {
                        const spanishVoices = safeVoices.filter(v => v.lang.startsWith('es'));
                        maleVoice = spanishVoices.find(v => 
                          v.name.toLowerCase().includes('male') ||
                          v.name.toLowerCase().includes('hombre')
                        );
                      }
                      
                      // 🔥 FALLBACK 2: Usar primera mexicana
                      if (!maleVoice && mexicanVoicesNow.length > 0) {
                        maleVoice = mexicanVoicesNow[0];
                      }
                      
                      // 🔥 FALLBACK 3: Usar primera disponible
                      if (!maleVoice && safeVoices.length > 0) {
                        maleVoice = safeVoices[0];
                      }
                      
                      setSettings({
                        ...settings,
                        tts_gender: 'male',
                        tts_voice_name: maleVoice?.name || null,
                      });
                      
                      console.log('[TTS] Cambiando a voz masculina:', maleVoice?.name || 'ninguna');
                    }}
```

#### **FIX 3: Usar género en useChat.js al hablar**

**Archivo:** `src/features/chat/hooks/useChat.js`

**BUSCAR** (línea donde se llama `speak()` con TTS):
```javascript
// Probablemente algo como:
speak(assistantText, {
  lang: settings?.tts_lang || 'es-MX',
  voiceName: settings?.tts_voice_name,
});
```

**REEMPLAZAR POR:**
```javascript
speak(assistantText, {
  lang: settings?.tts_lang || 'es-MX',
  voiceName: settings?.tts_voice_name,
  gender: settings?.tts_gender || 'female', // 🔥 AGREGAR GÉNERO
});
```

### 📋 Pasos
```bash
cd "/Users/pg/Documents/CHAT AL-E"
# 1. Editar src/pages/SettingsPage.jsx (3 fixes arriba)
# 2. Editar src/features/chat/hooks/useChat.js (agregar gender)
npm run lint
git add src/pages/SettingsPage.jsx src/features/chat/hooks/useChat.js
git commit -m "fix(voice): gender selector with fallback + use gender in TTS"
git push origin main
```

### 🧪 Validación
1. Ir a Settings → Voz
2. Activar TTS
3. Click en **Hombre 👨** → debe cambiar voz (o mostrar warning si no hay)
4. Click en **Mujer 👩** → debe cambiar voz
5. Probar voz → debe sonar género correcto
6. Ir al chat, escribir "hola" → respuesta debe sonar con género seleccionado

---

## 3️⃣ STT/TTS (Voz Manos Libres) - Validar Integración Completa

### ✅ Backend Validado
- ✅ `POST /api/voice/stt` con Groq Whisper (timeout 20s, max 10MB)
- ✅ `POST /api/voice/tts` con Edge-TTS (es-MX-DaliaNeural)
- ✅ Respuesta: `{ text, language, latency_ms }` para STT
- ✅ Respuesta: `{ audio: base64, duration_ms }` para TTS

### ⚠️ Frontend - Pendiente Validar

**Archivos clave:**
- `src/hooks/useVoiceMode.js` - Hook maestro
- `src/features/chat/components/VoiceControls.jsx` - UI controles
- `src/features/chat/hooks/useChat.js` - Integración con chat

**Checklist de validación:**

#### A) MediaRecorder Config
```javascript
// En useVoiceMode.js líneas ~160-180
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'audio/webm', // ✅ Verificar que sea compatible
  audioBitsPerSecond: 128000
});
```

**Verificar:** ¿El backend acepta `audio/webm`? Si no, cambiar a `audio/mp3` o convertir.

#### B) Upload de Audio
```javascript
// En useVoiceMode.js líneas ~200-230
const formData = new FormData();
formData.append('audio', audioBlob, 'recording.webm');

const response = await fetch(`${BACKEND_URL}/api/voice/stt`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
  },
  body: formData
});
```

**Verificar:**
- ✅ `Authorization` header correcto
- ✅ Backend recibe multipart/form-data
- ✅ Timeout configurado (20s)

#### C) TTS Playback
```javascript
// En useVoiceMode.js líneas ~430-450
const ttsResponse = await fetch(`${BACKEND_URL}/api/voice/tts`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    text: assistantText,
    voice: 'mx_female_default',  // ❌ HARDCODED
    format: 'mp3'
  })
});

const { audio } = await ttsResponse.json();
const audioBlob = base64ToBlob(audio, 'audio/mp3');
const audioUrl = URL.createObjectURL(audioBlob);
const audioElement = new Audio(audioUrl);
await audioElement.play();
```

**PROBLEMAS POTENCIALES:**
1. ❌ `voice: 'mx_female_default'` está hardcoded → debe usar `settings.tts_gender`
2. ❌ No valida si `audio` viene vacío o `null`
3. ⚠️ No libera `audioUrl` con `URL.revokeObjectURL()`

**FIX REQUERIDO:**

**Archivo:** `src/hooks/useVoiceMode.js`

**BUSCAR** (líneas ~430-450):
```javascript
        body: JSON.stringify({
          text: assistantText,
          voice: 'mx_female_default',
          format: 'mp3'
        }),
```

**REEMPLAZAR POR:**
```javascript
        body: JSON.stringify({
          text: assistantText,
          voice: settings?.tts_gender === 'male' ? 'mx_male_default' : 'mx_female_default',
          format: 'mp3'
        }),
```

**Y BUSCAR** (líneas ~460-470):
```javascript
      const audioBlob = base64ToBlob(audio, 'audio/mp3');
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      await audioElement.play();
```

**REEMPLAZAR POR:**
```javascript
      if (!audio) {
        console.error('[TTS] ❌ Backend no devolvió audio');
        throw new Error('TTS no devolvió audio');
      }
      
      const audioBlob = base64ToBlob(audio, 'audio/mp3');
      const audioUrl = URL.createObjectURL(audioBlob);
      const audioElement = new Audio(audioUrl);
      
      audioElement.onended = () => {
        URL.revokeObjectURL(audioUrl); // 🔥 Liberar memoria
      };
      
      audioElement.onerror = (e) => {
        console.error('[TTS] ❌ Error reproduciendo audio:', e);
        URL.revokeObjectURL(audioUrl);
      };
      
      await audioElement.play();
```

### 📋 Pasos
```bash
cd "/Users/pg/Documents/CHAT AL-E"
# 1. Editar src/hooks/useVoiceMode.js con los fixes arriba
npm run lint
git add src/hooks/useVoiceMode.js
git commit -m "fix(voice): use gender setting in TTS + add audio validation"
git push origin main
```

### 🧪 Validación End-to-End
1. Ir al chat
2. Activar modo voz manos libres (toggle)
3. Click en micrófono 🎤
4. Hablar: "Hola, ¿cómo estás?"
5. **Esperado:**
   - UI muestra "Grabando..." ✅
   - Cuando sueltas, UI muestra "Procesando..." ✅
   - Aparece transcripción en input ✅
   - Llega respuesta de AL-E ✅
   - **Audio se reproduce automáticamente** ✅
   - Voz suena del género correcto (según Settings) ✅

---

## 4️⃣ MEETINGS (Reuniones) - Validar UI Upload + Polling

### ✅ Backend Validado
- ✅ `POST /api/meetings/ingest` - Upload audio completo
- ✅ `POST /api/meetings/live/start` - Iniciar grabación live
- ✅ `GET /api/meetings/:id/status` - Polling de estado
- ✅ `GET /api/meetings/:id/result` - Obtener transcript + minuta
- ✅ Pyannote API key configurada: `sk_f7ad1964de564e3abb1a4de97c450b23`

### ⚠️ Frontend - No Implementado

**Estado actual:** Backend completo, pero **NO hay UI en frontend** para:
- Upload de archivo de audio/video
- Polling de status mientras procesa
- Mostrar transcript con speakers (diarización)
- Mostrar minuta generada por LLM

**Prioridad:** 🟡 P2 (funcionalidad completa pero no crítica)

### 📋 Requerimientos para Implementar

#### Paso 1: Crear componente `MeetingsPage.jsx`

**Archivo:** `src/pages/MeetingsPage.jsx`

**Features necesarias:**
1. **Upload zone** (drag & drop o botón)
   - Formatos: `.mp3`, `.mp4`, `.wav`, `.m4a`
   - Max size: 100MB
   - Preview nombre + tamaño

2. **Formulario metadata:**
   ```jsx
   <input placeholder="Título de la reunión" />
   <textarea placeholder="Descripción (opcional)" />
   <input placeholder="Participantes (separados por coma)" />
   <checkbox label="Enviar por email" />
   <checkbox label="Enviar por Telegram" />
   ```

3. **Estado de procesamiento:**
   ```jsx
   {status === 'uploading' && <Progress value={uploadProgress} />}
   {status === 'processing' && <Spinner text="Transcribiendo y diarizando..." />}
   {status === 'completed' && <MeetingResult data={result} />}
   {status === 'error' && <ErrorMessage error={error} />}
   ```

4. **Polling logic:**
   ```javascript
   const pollStatus = async (meetingId) => {
     const interval = setInterval(async () => {
       const { data } = await fetch(`/api/meetings/${meetingId}/status`);
       if (data.status === 'completed' || data.status === 'failed') {
         clearInterval(interval);
         loadResult(meetingId);
       }
     }, 3000); // Poll cada 3 segundos
   };
   ```

5. **Componente resultado:**
   ```jsx
   <MeetingResult>
     <Transcript speakers={diarization} text={transcript} />
     <Minutes summary={summary} agreements={agreements} pending={pending} />
     <DownloadButton format="pdf" />
     <ShareButton channels={['email', 'telegram']} />
   </MeetingResult>
   ```

#### Paso 2: Agregar ruta en `App.jsx`

```javascript
<Route path="/meetings" element={<MeetingsPage />} />
```

#### Paso 3: Agregar link en navigation

```jsx
<NavLink to="/meetings">
  <Video size={20} />
  <span>Reuniones</span>
</NavLink>
```

### 🧪 Validación (cuando se implemente)

**Script de prueba:**
```bash
# 1. Upload audio de prueba
curl -X POST https://api.al-eon.com/api/meetings/ingest \
  -H "Authorization: Bearer $TOKEN" \
  -F "audio=@meeting-test.mp3" \
  -F "title=Reunión de prueba" \
  -F "participants=Juan,María,Pedro"

# Response: { meeting_id: "uuid-aqui" }

# 2. Poll status
while true; do
  curl https://api.al-eon.com/api/meetings/uuid-aqui/status \
    -H "Authorization: Bearer $TOKEN"
  sleep 3
done

# 3. Get result cuando status = completed
curl https://api.al-eon.com/api/meetings/uuid-aqui/result \
  -H "Authorization: Bearer $TOKEN"
```

**Esperado:**
```json
{
  "transcript": "...",
  "diarization": [
    { "speaker": "SPEAKER_00", "text": "Hola, comenzamos la reunión", "start": 0.5, "end": 3.2 },
    { "speaker": "SPEAKER_01", "text": "Perfecto, gracias", "start": 3.5, "end": 5.1 }
  ],
  "minutes": {
    "summary": "Se discutió...",
    "agreements": ["Implementar feature X", "Review el viernes"],
    "pending": ["Juan enviará mockups"],
    "risks": []
  }
}
```

---

## 📝 ORDEN DE IMPLEMENTACIÓN RECOMENDADO

### **Ahora (Usuario debe hacer):**
1. ✅ **P0 - Telegram Parser** (5 min) → Crítico, usuarios no ven bots
2. ✅ **P1 - Voice Gender Selector** (15 min) → Funcionalidad visible incompleta
3. ✅ **P1 - Voice Gender en useVoiceMode** (5 min) → Coherencia con settings

### **Hoy (Validar):**
4. ⚠️ **P1 - STT/TTS End-to-End** → Probar con audio real, verificar que funcione

### **Próximos días:**
5. 🟡 **P2 - Meetings UI** → Feature completa pero no crítica

---

## 🎯 RESULTADO ESPERADO DESPUÉS DE TODOS LOS FIXES

### Settings → Telegram
```
🤖 Bots de Telegram
┌──────────────────────────┐
│ @Patty_ALE_bot    [Activo] │
│ Auto-send: ON             │
└──────────────────────────┘
[+ Conectar otro bot]
```

### Settings → Voz
```
🎤 Voz

[✓] Respuestas por voz (TTS habilitado)

Género de voz:
[👩 Mujer] [👨 Hombre]  ← Ambos funcionales con fallback

Voz específica:
[Dropdown con voces mexicanas agrupadas]

[Probar voz]  ← Suena género correcto
```

### Chat → Modo Voz
```
[Texto] [🎤 Voz Manos Libres]  ← Toggle funciona

Estado: Grabando...
[🔴 Micrófono activo]

→ Sueltas micrófono
Estado: Procesando...

→ Llega respuesta
Estado: Hablando...
Audio: [▶️ ━━━━━━ 85%] ← Voz de género correcto
```

### Meetings (cuando se implemente)
```
📹 Reuniones

[Subir archivo de reunión]
Formatos: MP3, MP4, WAV | Max: 100MB

Título: [____________________]
Participantes: [_____________]

[✓] Enviar por email
[✓] Enviar por Telegram

[Procesar reunión]

→ Mientras procesa
Estado: Transcribiendo (35%)...

→ Cuando termina
📝 Transcript:
[00:05] SPEAKER_00: Hola...
[00:12] SPEAKER_01: Perfecto...

📋 Minuta:
• Resumen: ...
• Acuerdos: ...
• Pendientes: ...

[Descargar PDF] [Compartir]
```

---

## 📞 PRÓXIMOS PASOS

Cuando termines los **3 fixes prioritarios** (Telegram + Voice Gender x2):

1. Avísame con:
```
✅ FIXES APLICADOS

Commits:
- [hash] fix(telegram): parse backend response wrapper
- [hash] fix(voice): gender selector with fallback
- [hash] fix(voice): use gender setting in TTS

Tests:
- Telegram bot visible: [SÍ/NO]
- Género cambia voz: [SÍ/NO]
- TTS suena género correcto: [SÍ/NO]
```

2. Entonces validaremos **STT/TTS end-to-end** con audio real

3. Y si todo OK, pasamos a crear **Meetings UI** (o lo dejamos para después)

---

**Documento creado:** 17 de enero de 2026  
**Para:** Frontend developer (AL-EON)  
**De:** GitHub Copilot (auditoría backend + frontend)
