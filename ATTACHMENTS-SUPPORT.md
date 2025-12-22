# 📎 Soporte de Attachments en AL-E Core

## ✅ Implementado

AL-E Core ahora acepta **attachments** en el endpoint `/api/ai/chat` y los procesa automáticamente.

---

## 📋 Formato de Request

```typescript
POST /api/ai/chat

{
  "userId": "user-123",
  "workspaceId": "default",
  "mode": "aleon",
  "sessionId": "optional-session-uuid",
  "messages": [
    { "role": "user", "content": "Analiza este documento" }
  ],
  "attachments": [
    {
      "name": "reporte.pdf",
      "type": "application/pdf",
      "url": "https://example.com/files/reporte.pdf"
    },
    {
      "name": "imagen.png",
      "type": "image/png",
      "url": "https://example.com/files/imagen.png"
    }
  ]
}
```

---

## 🔧 Tipos de Archivos Soportados

### 📄 **Documentos (extracción de texto)**

| Tipo | MIME Type | Procesamiento |
|------|-----------|---------------|
| PDF | `application/pdf` | Extrae texto con `pdf-parse` |
| DOCX | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | Extrae texto con `mammoth` |
| DOC | `application/msword` | Extrae texto con `mammoth` |
| TXT | `text/plain` | Lee como UTF-8 |
| Markdown | `text/markdown` | Lee como UTF-8 |
| CSV | `text/csv` | Lee como UTF-8 |

### 🖼️ **Imágenes (visión multimodal)**

| Tipo | MIME Type | Procesamiento |
|------|-----------|---------------|
| PNG | `image/png` | GPT-4 Vision (multimodal) |
| JPEG | `image/jpeg`, `image/jpg` | GPT-4 Vision (multimodal) |
| GIF | `image/gif` | GPT-4 Vision (multimodal) |
| WebP | `image/webp` | GPT-4 Vision (multimodal) |

---

## 🚀 Comportamiento

### **1. Documentos → Contexto de Texto**

Si el attachment es un documento:

```
DOCUMENTO_ADJUNTO: reporte.pdf
--------------------------------------------------
[TEXTO EXTRAÍDO DEL PDF]
Contenido completo del documento aquí...
--------------------------------------------------
```

Este contexto se **agrega automáticamente** al prompt del usuario antes de llamar al modelo.

---

### **2. Imágenes → Visión Multimodal**

Si el attachment es una imagen:

- El mensaje se envía en **formato multimodal** a GPT-4 Vision
- Estructura:
  ```json
  {
    "role": "user",
    "content": [
      { "type": "text", "text": "Analiza esta imagen" },
      { "type": "image_url", "image_url": { "url": "https://..." } }
    ]
  }
  ```
- El modelo **"ve" la imagen** y responde describiéndola/analizándola

---

## 📊 Logging

```
[ATTACHMENTS] Recibidos 2 attachment(s)
[ATTACHMENTS] Procesando: reporte.pdf (application/pdf)
[ATTACHMENTS] Texto extraído: 3542 caracteres
[ATTACHMENTS] - reporte.pdf (application/pdf): OK
[ATTACHMENTS] Procesando: imagen.png (image/png)
[ATTACHMENTS] Imagen detectada: imagen.png
[ATTACHMENTS] - imagen.png (image/png): OK
[ATTACHMENTS] 1 imagen(es) para visión multimodal
[ATTACHMENTS] Procesados: 2 exitosos, 0 fallidos
```

---

## 🧩 Flujo Completo

```
1. Frontend envía mensaje + attachments
        ↓
2. Core descarga los archivos desde las URLs
        ↓
3. Para cada documento:
   - Extrae texto (PDF/DOCX/TXT)
   - Agrega al contexto del prompt
        ↓
4. Para cada imagen:
   - Prepara formato multimodal
   - Usa GPT-4 Vision
        ↓
5. Llama a OpenAI con contexto enriquecido
        ↓
6. Guarda mensajes en Supabase (ae_messages)
        ↓
7. Responde al frontend con la respuesta de AL-E
```

---

## 🎯 Ejemplo de Uso

### **Caso 1: Analizar un PDF**

**Request:**
```json
{
  "userId": "user-123",
  "messages": [{ "role": "user", "content": "Resume este documento" }],
  "attachments": [{
    "name": "contrato.pdf",
    "type": "application/pdf",
    "url": "https://storage.example.com/contrato.pdf"
  }]
}
```

**Prompt enviado a AL-E:**
```
Resume este documento

DOCUMENTO_ADJUNTO: contrato.pdf
--------------------------------------------------
[TEXTO COMPLETO DEL PDF]
Este contrato establece...
--------------------------------------------------
```

**Respuesta de AL-E:**
```
El documento es un contrato de servicios entre...
[Resumen inteligente del contenido]
```

---

### **Caso 2: Describir una imagen**

**Request:**
```json
{
  "userId": "user-123",
  "messages": [{ "role": "user", "content": "¿Qué ves en esta imagen?" }],
  "attachments": [{
    "name": "screenshot.png",
    "type": "image/png",
    "url": "https://storage.example.com/screenshot.png"
  }]
}
```

**Prompt enviado a AL-E (multimodal):**
```json
{
  "role": "user",
  "content": [
    { "type": "text", "text": "¿Qué ves en esta imagen?" },
    { "type": "image_url", "image_url": { "url": "https://..." } }
  ]
}
```

**Respuesta de AL-E:**
```
Veo un screenshot de una aplicación web con...
[Descripción detallada de la imagen]
```

---

## 🛡️ Seguridad y Límites

- **Timeout de descarga:** 30 segundos
- **Tamaño máximo:** 50MB por archivo
- **Validación de MIME types:** Solo tipos soportados
- **Manejo de errores:** Si un attachment falla, los demás se procesan igual
- **No rompe el flujo:** Si no hay attachments o fallan todos, el chat funciona normal

---

## 🚀 Deployment

```bash
# 1. Instalar nuevas dependencias
npm install

# 2. Compilar
npm run build

# 3. En EC2
git pull origin main
npm install
npm run build
pm2 restart ale-core --update-env
```

---

## ✅ Checklist de Validación

- [x] Descarga de archivos desde URL
- [x] Extracción de texto de PDF
- [x] Extracción de texto de DOCX
- [x] Lectura de archivos de texto plano
- [x] Soporte de imágenes con GPT-4 Vision
- [x] Logging detallado
- [x] Manejo de errores sin romper flujo
- [x] Build exitoso (0 errores)
- [ ] Testing en producción **PENDIENTE**

---

**Fecha:** 22 de diciembre de 2025  
**Status:** ✅ Listo para deployment
