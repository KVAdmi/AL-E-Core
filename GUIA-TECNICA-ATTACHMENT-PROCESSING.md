# 🔧 GUÍA TÉCNICA PARA PROGRAMADOR: ATTACHMENT PROCESSING

**Autor**: GitHub Copilot  
**Fecha**: 2026-01-09  
**Para**: Equipo de desarrollo AL-E Core

---

## ⚠️ CONTEXTO CRÍTICO

### Problema Original
AL-EON estaba **rechazando** archivos adjuntos con un mensaje de "no puedo ver archivos", cuando en realidad **SÍ tiene las capacidades técnicas** instaladas:
- ✅ Google Vision API (OCR)
- ✅ pdf-parse (PDFs)
- ✅ mammoth (DOCX)
- ✅ Supabase Storage (descarga de archivos)

### Solución Implementada
**PROCESAR** los attachments antes de enviarlos a OpenAI, en lugar de rechazarlos.

---

## 📋 CAMBIOS REALIZADOS

### 1. **Archivo eliminado**: `src/utils/attachmentDetector.ts`
- ❌ Este archivo detectaba attachments y activaba un "modo restringido"
- ❌ Inyectaba un prompt que decía "no puedo ver archivos"
- ✅ **ACCIÓN**: Se eliminó por completo

---

### 2. **Archivo creado**: `src/utils/attachmentProcessor.ts`

**Ubicación**: `/Users/pg/Documents/AL-E Core/src/utils/attachmentProcessor.ts`

**Propósito**: Procesar attachments y extraer su contenido usando las capacidades ya instaladas.

**Funciones principales**:

```typescript
// 1. Procesa UN attachment
export async function processAttachment(
  attachment: AttachmentMetadata
): Promise<ProcessedAttachment>

// 2. Procesa MÚLTIPLES attachments en paralelo
export async function processAttachments(
  attachments: AttachmentMetadata[]
): Promise<ProcessedAttachment[]>

// 3. Genera contexto formateado para inyectar
export function generateAttachmentContext(
  processedAttachments: ProcessedAttachment[]
): string
```

**Flujo de procesamiento**:

```typescript
// 1. Obtener buffer del archivo
if (attachment.buffer) {
  buffer = attachment.buffer;
} else if (attachment.bucket && attachment.path) {
  // Descargar desde Supabase Storage
  const downloaded = await downloadAttachment({...});
  buffer = downloaded.buffer;
} else if (attachment.url) {
  // Descargar desde URL externa
  const response = await fetch(attachment.url);
  buffer = Buffer.from(await response.arrayBuffer());
}

// 2. Detectar tipo y procesar
const ext = path.extname(filename).toLowerCase();

// IMÁGENES → Google Vision OCR
if (type.startsWith('image/') || ['.jpg', '.png', '.gif'].includes(ext)) {
  const visionResult = await analyzeImage(buffer);
  extractedText = visionResult.fullText;
}

// PDFs → pdf-parse
else if (ext === '.pdf') {
  const tmpPath = path.join(os.tmpdir(), `ale-${Date.now()}-${filename}`);
  fs.writeFileSync(tmpPath, buffer);
  const parsed = await parseDocument(tmpPath);
  extractedText = parsed.text;
  fs.unlinkSync(tmpPath); // Limpiar
}

// DOCX / TXT / MD → Document Parser
else if (['.docx', '.txt', '.md'].includes(ext)) {
  const tmpPath = path.join(os.tmpdir(), `ale-${Date.now()}-${filename}`);
  fs.writeFileSync(tmpPath, buffer);
  const parsed = await parseDocument(tmpPath);
  extractedText = parsed.text;
  fs.unlinkSync(tmpPath);
}
```

**Imports necesarios**:
```typescript
import { analyzeImage } from '../services/visionService';
import { parseDocument } from '../services/documentParser';
import { downloadAttachment } from '../services/attachmentDownload';
import fs from 'fs';
import path from 'path';
import os from 'os';
```

---

### 3. **Archivo modificado**: `src/api/assistant.ts`

**Cambio 1: Import actualizado**

```typescript
// ANTES
import { detectAttachments, generateAttachmentRestrictionPrompt } from '../utils/attachmentDetector';

// AHORA
import { processAttachments, generateAttachmentContext } from '../utils/attachmentProcessor';
```

**Cambio 2: Procesamiento de attachments (líneas ~120-140)**

**ANTES**:
```typescript
// DETECCIÓN DE ATTACHMENTS (CRÍTICO)
const attachmentDetection = detectAttachments(
  userText,
  lastUserMessage?.attachments
);

console.log('[ATTACHMENTS] Detección:', {
  hasAttachments: attachmentDetection.hasAttachments,
  count: attachmentDetection.attachmentCount,
  restrictedMode: attachmentDetection.restrictedMode
});
```

**AHORA**:
```typescript
// PROCESAMIENTO DE ATTACHMENTS (CRÍTICO)
let attachmentContext = '';

if (lastUserMessage?.attachments && lastUserMessage.attachments.length > 0) {
  console.log(`[ATTACHMENTS] Procesando ${lastUserMessage.attachments.length} archivo(s)...`);
  
  try {
    const processedAttachments = await processAttachments(lastUserMessage.attachments);
    attachmentContext = generateAttachmentContext(processedAttachments);
    
    console.log(`[ATTACHMENTS] ✅ Contexto generado: ${attachmentContext.length} caracteres`);
  } catch (error: any) {
    console.error('[ATTACHMENTS] ❌ Error procesando attachments:', error.message);
    attachmentContext = `\n[⚠️ Error procesando archivos adjuntos: ${error.message}]\n`;
  }
}
```

**Cambio 3: Inyección de contexto (líneas ~150-170)**

**ANTES**:
```typescript
const payload: AssistantRequest = {
  workspaceId: chatRequest.workspaceId,
  userId: chatRequest.userId,
  mode: chatRequest.mode || 'aleon',
  messages: chatRequest.messages
};

// INYECTAR MODO RESTRINGIDO SI HAY ATTACHMENTS
if (attachmentDetection.restrictedMode) {
  const restrictionPrompt = generateAttachmentRestrictionPrompt();
  payload.messages = [
    { role: 'system', content: restrictionPrompt },
    ...payload.messages
  ];
  console.log('[ATTACHMENTS] ⚠️ MODO RESTRINGIDO ACTIVADO');
}
```

**AHORA**:
```typescript
const payload: AssistantRequest = {
  workspaceId: chatRequest.workspaceId,
  userId: chatRequest.userId,
  mode: chatRequest.mode || 'aleon',
  messages: chatRequest.messages
};

// INYECTAR CONTENIDO DE ATTACHMENTS PROCESADOS
if (attachmentContext) {
  payload.messages = [
    { role: 'system', content: attachmentContext },
    ...payload.messages
  ];
  console.log('[ATTACHMENTS] ✅ Contenido inyectado en contexto');
}
```

---

### 4. **Archivo modificado**: `src/ai/prompts/aleon.ts`

**Cambio**: Eliminadas las primeras ~80 líneas que contenían la "REGLA #0"

**ANTES** (líneas 11-90 aproximadamente):
```typescript
export const ALEON_SYSTEM_PROMPT = `
╔════════════════════════════════════════════════════════════════╗
║  🚨 REGLA #0 - ATTACHMENTS Y ARCHIVOS ADJUNTOS (CRÍTICO)      ║
╚════════════════════════════════════════════════════════════════╝

⚠️ LIMITACIÓN TÉCNICA FUNDAMENTAL - LEE ESTO PRIMERO:

NO TIENES CAPACIDAD DE VER NI PROCESAR:
❌ Imágenes (JPG, PNG, GIF, etc.)
❌ PDFs o documentos escaneados
...
[80 líneas de restricciones]
...

╔════════════════════════════════════════════════════════════════╗
║  🔧 REGLA SUPREMA - USA TUS HERRAMIENTAS (P0 CRÍTICO)         ║
╚════════════════════════════════════════════════════════════════╝
```

**AHORA** (línea 11):
```typescript
export const ALEON_SYSTEM_PROMPT = `
╔════════════════════════════════════════════════════════════════╗
║  🔧 REGLA SUPREMA - USA TUS HERRAMIENTAS (P0 CRÍTICO)         ║
╚════════════════════════════════════════════════════════════════╝
```

**Resultado**: El prompt ya NO dice que AL-EON "no puede ver archivos". Ahora los archivos se procesan y su contenido se inyecta automáticamente.

---

## 🔄 FLUJO TÉCNICO COMPLETO

### Request con attachment

```json
POST /api/ai/chat
{
  "userId": "user123",
  "mode": "aleon",
  "messages": [{
    "role": "user",
    "content": "¿Cuánto es el total de esta factura?",
    "attachments": [{
      "name": "factura-001.pdf",
      "type": "application/pdf",
      "bucket": "attachments",
      "path": "user123/factura-001.pdf"
    }]
  }]
}
```

### Procesamiento interno

```
1. [assistant.ts línea ~125]
   Detecta: lastUserMessage.attachments.length = 1

2. [assistant.ts línea ~130]
   Llama: processAttachments([attachment])

3. [attachmentProcessor.ts línea ~70]
   Descarga desde Supabase Storage
   → buffer = downloadAttachment({bucket, path})

4. [attachmentProcessor.ts línea ~90]
   Detecta: ext = '.pdf'
   → Guarda temporalmente en /tmp/
   → Llama: parseDocument(tmpPath)

5. [documentParser.ts línea ~27]
   Usa pdf-parse para extraer texto
   → extractedText = "FACTURA #001\nTotal: $5,000 MXN\n..."

6. [attachmentProcessor.ts línea ~180]
   Genera contexto formateado:
   
   ╔══════════════════════════════════════╗
   ║  📎 ARCHIVOS ADJUNTOS PROCESADOS     ║
   ╚══════════════════════════════════════╝
   
   📄 Archivo: factura-001.pdf
      Tipo: application/pdf
      Método: pdf-parse
      
      Contenido:
      ----------------------------------------
      FACTURA #001
      Total: $5,000 MXN
      ...
      ----------------------------------------

7. [assistant.ts línea ~155]
   Inyecta contexto en payload.messages:
   
   payload.messages = [
     { role: 'system', content: attachmentContext },
     { role: 'user', content: "¿Cuánto es el total?" }
   ]

8. [assistant.ts línea ~200]
   Envía a OpenAI con contenido completo
   
9. OpenAI responde:
   "Según la factura proporcionada, el total es $5,000 MXN"
```

---

## 📊 CASOS DE USO SOPORTADOS

### Caso 1: Imagen con OCR
```typescript
// Input
attachment = {
  name: "factura-scan.jpg",
  type: "image/jpeg",
  buffer: <Buffer ...>
}

// Procesamiento
→ analyzeImage(buffer)
→ Google Vision API extrae texto
→ extractedText = "TOTAL: $5,000 MXN"

// Output inyectado
"📄 Archivo: factura-scan.jpg
    Contenido: TOTAL: $5,000 MXN"
```

### Caso 2: PDF
```typescript
// Input
attachment = {
  name: "contrato.pdf",
  type: "application/pdf",
  bucket: "docs",
  path: "user/contrato.pdf"
}

// Procesamiento
→ downloadAttachment() desde Supabase
→ Guardar en /tmp/ale-xxx-contrato.pdf
→ parseDocument() con pdf-parse
→ extractedText = "CONTRATO DE SERVICIOS\n..."

// Output inyectado
"📄 Archivo: contrato.pdf
    Contenido: CONTRATO DE SERVICIOS..."
```

### Caso 3: DOCX
```typescript
// Input
attachment = {
  name: "reporte.docx",
  type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  url: "https://example.com/reporte.docx"
}

// Procesamiento
→ fetch(url) y convertir a buffer
→ Guardar en /tmp/ale-xxx-reporte.docx
→ parseDocument() con mammoth
→ extractedText = "REPORTE MENSUAL\n..."

// Output inyectado
"📄 Archivo: reporte.docx
    Contenido: REPORTE MENSUAL..."
```

---

## ⚙️ DEPENDENCIAS NECESARIAS

Todas estas dependencias **YA ESTÁN INSTALADAS** en el proyecto:

```json
{
  "dependencies": {
    "@google-cloud/vision": "^4.x",  // Google Vision OCR
    "pdf-parse": "^1.x",              // PDF parsing
    "mammoth": "^1.x",                // DOCX parsing
    "@supabase/supabase-js": "^2.x"   // Supabase Storage
  }
}
```

**Verificar instalación**:
```bash
cd /Users/pg/Documents/AL-E\ Core
npm list | grep -E "vision|pdf-parse|mammoth|supabase"
```

---

## 🧪 TESTING

### Test 1: Verificar compilación
```bash
cd /Users/pg/Documents/AL-E\ Core
npm run build
```

**Esperado**: Sin errores de TypeScript ✅

### Test 2: Verificar logs
```bash
# Iniciar servidor
pm2 restart ale-core

# Ver logs en tiempo real
pm2 logs ale-core

# Buscar procesamiento de attachments
pm2 logs ale-core | grep ATTACHMENTS
```

**Esperado**:
```
[ATTACHMENTS] Procesando 1 archivo(s)...
[ATTACHMENTS] Usando Google Vision OCR para: imagen.jpg
[ATTACHMENTS] ✅ Procesado: imagen.jpg → 1234 caracteres
[ATTACHMENTS] ✅ Contexto generado: 5678 caracteres
[ATTACHMENTS] ✅ Contenido inyectado en contexto
```

### Test 3: Request real

**Preparar archivo de prueba**:
```bash
# Crear PDF de prueba
echo "FACTURA TEST\nTotal: $100.00" > test.txt
# (O usar un PDF real)
```

**Request con cURL**:
```bash
curl -X POST http://localhost:4000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "mode": "aleon",
    "messages": [{
      "role": "user",
      "content": "¿Qué dice este documento?",
      "attachments": [{
        "name": "test.pdf",
        "type": "application/pdf",
        "url": "https://example.com/test.pdf"
      }]
    }]
  }'
```

**Esperado**:
- Logs muestran `[ATTACHMENTS] Procesando 1 archivo(s)...`
- Respuesta incluye contenido extraído del PDF
- NO dice "no puedo ver archivos"

---

## 🐛 TROUBLESHOOTING

### Error: "Cannot find module attachmentDetector"

**Causa**: El archivo fue renombrado a `attachmentProcessor`

**Solución**: Ya aplicada en `src/api/assistant.ts` línea 9

```typescript
// Cambiar esto:
import { ... } from '../utils/attachmentDetector';

// Por esto:
import { ... } from '../utils/attachmentProcessor';
```

---

### Error: "Vision API authentication failed"

**Causa**: Falta configurar credenciales de Google Cloud

**Solución**:
```bash
# Verificar archivo de credenciales
ls -la /Users/pg/Documents/AL-E\ Core/al-eon-0e41ae57cf6f.json

# Verificar variable de entorno
echo $GOOGLE_APPLICATION_CREDENTIALS

# Si no existe, agregar a .env
echo "GOOGLE_APPLICATION_CREDENTIALS=./al-eon-0e41ae57cf6f.json" >> .env
```

---

### Error: "Cannot download attachment from Supabase"

**Causa**: Permisos de Storage o bucket incorrecto

**Solución**:
```bash
# Verificar en consola de Supabase:
# 1. Storage → Buckets → attachments existe?
# 2. Policies → Bucket tiene permisos de lectura?

# Alternativa: usar URL pública en lugar de bucket/path
{
  "attachments": [{
    "url": "https://xxxx.supabase.co/storage/v1/object/public/..."
  }]
}
```

---

### Logs muestran: "Tipo no soportado"

**Causa**: Archivo de tipo desconocido (ej: .xlsx, .zip)

**Comportamiento actual**: El sistema log un warning pero NO falla

```typescript
// En attachmentProcessor.ts línea ~120
else {
  console.warn(`[ATTACHMENT] Tipo no soportado: ${type}`);
  extractedText = `[Archivo de tipo ${type} - no se pudo extraer contenido]`;
}
```

**Para agregar soporte** (ej: Excel):
```typescript
// En attachmentProcessor.ts, agregar:
else if (['.xlsx', '.xls'].includes(ext)) {
  // Usar librería como 'xlsx'
  const workbook = XLSX.read(buffer);
  extractedText = XLSX.utils.sheet_to_txt(workbook.Sheets[0]);
  processingMethod = 'xlsx-parse';
}
```

---

## 📝 CHECKLIST DE DEPLOYMENT

Antes de deployar a producción:

- [x] ✅ Código compilado sin errores (`npm run build`)
- [ ] ⏳ Verificar Google Vision API credentials en servidor
- [ ] ⏳ Probar con imagen real (screenshot)
- [ ] ⏳ Probar con PDF real (factura)
- [ ] ⏳ Probar con DOCX real
- [ ] ⏳ Verificar logs en producción
- [ ] ⏳ Monitorear costos de Google Vision API
- [ ] ⏳ Configurar rate limiting si es necesario

---

## 🚀 DEPLOYMENT A PRODUCCIÓN

```bash
# 1. Commit cambios
git add .
git commit -m "feat: implementar procesamiento real de attachments (Vision OCR + PDF parser)"
git push origin main

# 2. En servidor EC2
ssh user@api.al-entity.com
cd /path/to/AL-E-Core

# 3. Pull y rebuild
git pull origin main
npm install  # Por si acaso
npm run build

# 4. Verificar variables de entorno
cat .env | grep GOOGLE_APPLICATION_CREDENTIALS

# Si no existe:
echo "GOOGLE_APPLICATION_CREDENTIALS=./al-eon-0e41ae57cf6f.json" >> .env

# 5. Restart
pm2 restart ale-core --update-env
pm2 save

# 6. Monitorear
pm2 logs ale-core --lines 100
```

---

## 📌 RESUMEN EJECUTIVO

**Archivos modificados**: 3
- `src/api/assistant.ts` → Procesa attachments antes de OpenAI
- `src/ai/prompts/aleon.ts` → Eliminada REGLA #0 de restricción
- `src/utils/attachmentDetector.ts` → RENOMBRADO a `attachmentProcessor.ts`

**Archivos creados**: 1
- `src/utils/attachmentProcessor.ts` → 195 líneas de código nuevo

**Capacidades activadas**:
- ✅ OCR de imágenes (Google Vision)
- ✅ Parsing de PDFs (pdf-parse)
- ✅ Parsing de DOCX (mammoth)
- ✅ Descarga desde Supabase Storage
- ✅ Descarga desde URLs externas

**Resultado**:
AL-EON ahora **VE y PROCESA** archivos adjuntos en lugar de rechazarlos.

---

**Pregunta**: ¿Necesitas aclaraciones sobre algún punto específico?
