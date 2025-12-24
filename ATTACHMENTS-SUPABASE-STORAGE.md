# Soporte de Attachments desde Supabase Storage

## Problema Resuelto

**ANTES**: AL-E Core solo procesaba archivos cuando llegaban como `multipart/form-data` con `files[]`.

**AHORA**: AL-E Core soporta **DOS modos**:
1. **Supabase Storage** (nuevo): Frontend envía JSON con `bucket + path + url`
2. **Multipart** (legacy): Frontend envía archivos raw

---

## Modo 1: Supabase Storage (AL-EON)

### Flujo Frontend → Backend

```
Frontend (AL-EON)                Backend (AL-E Core)
      |                                  |
      |--1. Usuario adjunta PDF-------->|
      |                                  |
      |--2. Sube a Supabase Storage---->|
      |   (bucket: "attachments")        |
      |                                  |
      |--3. POST /api/ai/chat (JSON)-->|
      |   {                              |
      |     messages: [...],             |
      |     attachments: [               |
      |       {                          |
      |         bucket: "attachments",   |
      |         path: "user123/doc.pdf", |
      |         url: "https://...",      |
      |         name: "doc.pdf",         |
      |         type: "application/pdf", |
      |         size: 524288             |
      |       }                          |
      |     ]                            |
      |   }                              |
      |                                  |
      |                          [BACKEND PROCESA]
      |                                  |
      |                          1. Detecta Supabase Storage
      |                          2. Descarga desde bucket/path
      |                          3. Extrae texto (pdf-parse)
      |                          4. Inyecta al prompt
      |                          5. Llama a OpenAI
      |                                  |
      |<--Respuesta con análisis del PDF-|
```

### Request JSON Esperado

```json
POST /api/ai/chat
Content-Type: application/json
Authorization: Bearer <token>

{
  "workspaceId": "default",
  "userId": "user-123",
  "mode": "universal",
  "messages": [
    {
      "role": "user",
      "content": "Analiza este contrato"
    }
  ],
  "attachments": [
    {
      "bucket": "attachments",
      "path": "workspace-default/user-123/contrato.pdf",
      "url": "https://gptwzuqmuvzttajgjrry.supabase.co/storage/v1/object/public/attachments/...",
      "name": "contrato.pdf",
      "type": "application/pdf",
      "size": 1048576
    }
  ]
}
```

### Campos de Attachment

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `bucket` | string | ✅ | Nombre del bucket en Supabase Storage |
| `path` | string | ✅ | Ruta del archivo dentro del bucket |
| `url` | string | ⚠️ | URL pública (fallback si bucket/path fallan) |
| `name` | string | ✅ | Nombre del archivo (ej: "documento.pdf") |
| `type` | string | ✅ | MIME type (ej: "application/pdf") |
| `size` | number | ❌ | Tamaño en bytes (opcional) |

---

## Implementación Backend

### Archivos Creados/Modificados

**1. `src/services/attachmentDownload.ts` (NUEVO)**

Servicio de descarga desde Supabase Storage:

```typescript
export async function downloadAttachment(attachment: AttachmentMetadata) {
  // Estrategia 1: Descargar con SERVICE_ROLE (preferido)
  const { data, error } = await supabase.storage
    .from(attachment.bucket)
    .download(attachment.path);
  
  if (!error && data) {
    return {
      originalname: attachment.name,
      mimetype: attachment.type,
      buffer: Buffer.from(await data.arrayBuffer())
    };
  }
  
  // Estrategia 2: Descargar desde URL pública (fallback)
  if (attachment.url) {
    const response = await axios.get(attachment.url, { 
      responseType: 'arraybuffer' 
    });
    return {
      originalname: attachment.name,
      mimetype: attachment.type,
      buffer: Buffer.from(response.data)
    };
  }
  
  return null;
}
```

**2. `src/api/chat.ts` (MODIFICADO)**

Detección automática del tipo de attachment:

```typescript
if (safeAttachments.length > 0) {
  const firstAttachment = safeAttachments[0];
  const isSupabaseStorage = validateAttachment(firstAttachment);
  
  if (isSupabaseStorage) {
    // MODO NUEVO: Descargar desde Supabase Storage
    const downloaded = await downloadAttachments(safeAttachments);
    const extracted = await extractTextFromFiles(downloaded);
    attachmentsContext = construirContexto(extracted);
    
  } else {
    // MODO LEGACY: URLs directas (compatibilidad)
    const processed = await processAttachments(safeAttachments);
    attachmentsContext = attachmentsToContext(processed);
  }
}
```

---

## Logs de Debug

### Cuando funciona correctamente:

```
[CHAT] Attachments recibidos: 1
[ATTACHMENTS] Modo: Supabase Storage (1 archivo(s))
[AttachmentDownload] Descargando: contrato.pdf (application/pdf)
[AttachmentDownload] Bucket: attachments, Path: user123/contrato.pdf
[AttachmentDownload] ✓ Descargado desde Storage: contrato.pdf (524288 bytes)
[AttachmentDownload] Descargados exitosamente: 1/1
[ATTACHMENTS] Extrayendo texto de 1 archivo(s)...
[DocumentText] Procesando: contrato.pdf
[ATTACHMENTS] ✓ Procesados 1 documento(s), 15420 caracteres de contexto
```

### Cuando falla la descarga:

```
[ATTACHMENTS] Modo: Supabase Storage (1 archivo(s))
[AttachmentDownload] Descargando: documento.pdf (application/pdf)
[AttachmentDownload] Error en Storage API: Object not found
[AttachmentDownload] Intentando descarga desde URL: https://...
[AttachmentDownload] ✓ Descargado desde URL: documento.pdf (1048576 bytes)
```

### Cuando attachment es inválido:

```
[ATTACHMENTS] 1 attachment(s) inválido(s) ignorados
[ATTACHMENTS] No se pudo descargar ningún archivo
```

---

## Formatos Soportados

| Formato | Extensión | MIME Type | Procesamiento |
|---------|-----------|-----------|---------------|
| PDF | `.pdf` | `application/pdf` | pdf-parse → texto completo |
| Word | `.docx` | `application/vnd.openxmlformats-...` | mammoth → texto plano |
| Texto | `.txt` | `text/plain` | Lectura directa UTF-8 |
| Markdown | `.md` | `text/markdown` | Lectura directa UTF-8 |
| CSV | `.csv` | `text/csv` | Lectura directa UTF-8 |
| JSON | `.json` | `application/json` | Lectura directa UTF-8 |

---

## Límites

- ✅ Sin límite de tamaño del archivo (descarga con streaming)
- ✅ Timeout de descarga: 30 segundos por archivo
- ✅ Texto extraído limitado a 30,000 caracteres por documento
- ✅ Sin límite de cantidad de attachments (el límite lo pone el frontend)

---

## Testing

### 1. Probar con curl (modo Supabase Storage)

```bash
curl -X POST https://api.al-eon.com/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "workspaceId": "default",
    "mode": "universal",
    "messages": [
      {"role": "user", "content": "Resume este documento"}
    ],
    "attachments": [
      {
        "bucket": "attachments",
        "path": "test/documento.pdf",
        "url": "https://gptwzuqmuvzttajgjrry.supabase.co/storage/v1/object/public/attachments/test/documento.pdf",
        "name": "documento.pdf",
        "type": "application/pdf"
      }
    ]
  }'
```

### 2. Verificar en logs de PM2

```bash
pm2 logs ale-core --lines 100 | grep ATTACHMENTS
```

Deberías ver:
```
[ATTACHMENTS] Modo: Supabase Storage (1 archivo(s))
[ATTACHMENTS] ✓ Procesados 1 documento(s)
```

---

## Retrocompatibilidad

✅ **El modo multipart SIGUE funcionando** (para testing con Postman/curl):

```bash
curl -X POST https://api.al-eon.com/api/ai/chat \
  -H "Authorization: Bearer <token>" \
  -F "messages=[{\"role\":\"user\",\"content\":\"Analiza\"}]" \
  -F "mode=universal" \
  -F "userId=test" \
  -F "files=@documento.pdf"
```

---

## Ventajas del Nuevo Sistema

✅ **Seguridad**: Archivos en Supabase Storage con RLS policies  
✅ **Persistencia**: Archivos no desaparecen al terminar el request  
✅ **Performance**: Descarga con SERVICE_ROLE (sin autenticación extra)  
✅ **Trazabilidad**: Logs completos de descarga y procesamiento  
✅ **Fallback**: Si falla bucket/path, intenta con URL pública  
✅ **Compatibilidad**: Modo multipart sigue funcionando  

---

## Próximos Pasos

1. ✅ Código implementado y compilado
2. ⚠️ Pendiente: Deploy a EC2
3. ⚠️ Pendiente: Testing con PDF real desde AL-EON
4. ⚠️ Pendiente: Validar logs en producción
