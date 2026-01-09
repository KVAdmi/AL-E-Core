# 🎯 AJUSTE CRÍTICO - DECLARACIÓN EXPLÍCITA DE FALLOS

**Fecha**: 2026-01-09  
**Para**: Equipo de desarrollo  
**Estado**: ✅ Implementado y compilado

---

## 🚨 CONTEXTO DE LA CONFUSIÓN

### Lo que se entendió MAL:
- ❌ "Bloquear attachments por seguridad"
- ❌ "Elegir entre procesar o ser honesto"

### Lo que REALMENTE se requería:
- ✅ Procesar TODO lo técnicamente posible
- ✅ Declarar explícitamente cuando algo falla
- ✅ NUNCA inventar para rellenar vacíos

**Modelo de referencia**: GPT / GitHub Copilot / ChatGPT Enterprise

---

## ✅ LO QUE YA ESTABA BIEN

1. **Procesamiento real de attachments**
   - Google Vision OCR ✅
   - PDF parsing ✅
   - DOCX parsing ✅
   - Supabase Storage ✅

2. **Eliminado el bloqueo automático**
   - Ya NO rechaza archivos por defecto ✅

---

## 🔧 LO QUE SE AJUSTÓ HOY

### 1. **Manejo de errores granular** (`attachmentProcessor.ts`)

**ANTES**:
```typescript
// Si algo falla, mensaje genérico
extractedText = '[Error procesando archivo]';
```

**AHORA**:
```typescript
// Captura específica de cada tipo de error
try {
  const visionResult = await analyzeImage(buffer);
  if (!extractedText || extractedText.trim().length === 0) {
    throw new Error('OCR completado pero no se detectó texto legible');
  }
} catch (visionError) {
  throw new Error(`Fallo en OCR de imagen: ${visionError.message}`);
}
```

**Resultado**: Cada error tiene contexto técnico preciso.

---

### 2. **Contexto con instrucciones explícitas** (`generateAttachmentContext`)

**ANTES**:
```typescript
if (attachment.metadata.error) {
  context += `⚠️ Error: ${error}\n\n`;
}
```

**AHORA**:
```typescript
if (attachment.metadata.error) {
  context += `⚠️ IMPORTANTE: No fue posible procesar este archivo.\n`;
  context += `Motivo: ${attachment.metadata.error}\n\n`;
  context += `INSTRUCCIÓN PARA TI:\n`;
  context += `- Declara explícitamente que no pudiste procesar este archivo\n`;
  context += `- Indica el motivo técnico\n`;
  context += `- Pide al usuario que describa el contenido O\n`;
  context += `- Sugiere revisión humana O\n`;
  context += `- Consulta otra fuente si está disponible\n`;
  context += `- NUNCA inventes o inferas su contenido\n\n`;
}
```

**Resultado**: AL-EON recibe instrucciones explícitas sobre cómo manejar el fallo.

---

### 3. **Prompt de AL-EON actualizado** (`aleon.ts`)

**Nueva sección agregada** (REGLA #0):

```typescript
╔════════════════════════════════════════════════════════════════╗
║  🔥 REGLA #0 - DECLARACIÓN EXPLÍCITA DE LÍMITES (CRÍTICO)    ║
╚════════════════════════════════════════════════════════════════╝

⚠️ PRINCIPIO FUNDAMENTAL - NO INVENTAR NUNCA:

Cuando recibes archivos adjuntos en el contexto, el sistema YA los procesó.

✅ SI VES CONTENIDO EXTRAÍDO:
- Úsalo para responder
- Cita exactamente lo que dice el archivo
- Confía en el contenido procesado

⚠️ SI VES UN ERROR DE PROCESAMIENTO:
- Declara explícitamente: "No pude procesar el archivo [nombre]"
- Indica el motivo técnico proporcionado
- Pregunta al usuario: "¿Puedes describir lo que contiene?"
- Ofrece alternativas: "Puedo buscar información relacionada con web_search"
- NUNCA inventes, inferas o adivines el contenido

❌ PROHIBIDO ABSOLUTAMENTE:
- Inventar montos, fechas, nombres que no aparecen en el texto extraído
- Inferir contenido de imágenes que no pudieron procesarse
- "Adivinar" qué dice un PDF que falló
- Completar con lógica cuando falta información

✅ EJEMPLO CORRECTO - Fallo parcial:
Usuario: "¿Cuánto es el total de esta factura?" [adjunta PDF que falló]
Tú: "No pude procesar el archivo PDF adjunto. El sistema reporta: 'PDF escaneado sin OCR'.
¿Podrías indicarme el monto total manualmente? O si tienes una versión con texto seleccionable, puedo procesarla."

❌ EJEMPLO INCORRECTO:
Tú: "Según la factura, el total es $5,000..." [INVENTADO - no viste el contenido]
```

**Resultado**: AL-EON ahora tiene instrucciones claras sobre el comportamiento correcto.

---

## 📊 CASOS DE USO ACTUALIZADOS

### Caso 1: ✅ Procesamiento exitoso
```
Input: factura.pdf (con texto)
Processing: pdf-parse extrae "$5,000 MXN"
Contexto inyectado:
  ✅ Contenido extraído exitosamente:
  FACTURA #001
  Total: $5,000 MXN

Respuesta de AL-EON:
"Según la factura proporcionada, el total es $5,000 MXN."
```

---

### Caso 2: ⚠️ Fallo parcial - PDF escaneado
```
Input: factura-scan.pdf (imagen sin OCR)
Processing: pdf-parse NO encuentra texto
Error capturado: "Documento procesado pero está vacío. Puede ser un PDF escaneado sin OCR."

Contexto inyectado:
  ⚠️ IMPORTANTE: No fue posible procesar este archivo.
  Motivo: Documento procesado pero está vacío. Puede ser un PDF escaneado sin OCR.
  
  INSTRUCCIÓN PARA TI:
  - Declara explícitamente que no pudiste procesar este archivo
  - Indica el motivo técnico
  - Pide al usuario que describa el contenido
  - NUNCA inventes o inferas su contenido

Respuesta de AL-EON:
"No pude procesar el archivo PDF adjunto. El sistema detectó que es un documento 
escaneado sin OCR (sin texto seleccionable).

¿Podrías indicarme manualmente el monto total de la factura? 

Alternativamente, si tienes:
- Una versión del PDF con texto seleccionable
- Una imagen más clara del documento
- El archivo original (Word, Excel, etc.)

Podré procesarlo correctamente."
```

---

### Caso 3: ⚠️ Fallo técnico - Imagen sin texto
```
Input: grafica.png (imagen de gráfica sin texto)
Processing: Google Vision OCR completa pero no detecta texto
Error capturado: "OCR completado pero no se detectó texto legible en la imagen"

Contexto inyectado:
  ⚠️ IMPORTANTE: No fue posible procesar este archivo.
  Motivo: OCR completado pero no se detectó texto legible en la imagen
  
  INSTRUCCIÓN PARA TI:
  - Declara explícitamente que no pudiste procesar este archivo
  - Pide al usuario que describa el contenido
  - NUNCA inventes o inferas su contenido

Respuesta de AL-EON:
"Procesé la imagen con OCR pero no detecté texto legible. Parece ser una gráfica o imagen sin texto.

¿Podrías describir qué información de la gráfica necesitas analizar?
Por ejemplo:
- ¿Qué datos muestra?
- ¿Qué tendencias observas?
- ¿Qué conclusión necesitas sacar?"
```

---

### Caso 4: ❌ Error crítico - Archivo corrupto
```
Input: documento.docx (archivo corrupto)
Processing: mammoth lanza error "Cannot read file"
Error capturado: "Fallo al procesar documento .docx: Cannot read file"

Contexto inyectado:
  ⚠️ IMPORTANTE: No fue posible procesar este archivo.
  Motivo: Fallo al procesar documento .docx: Cannot read file
  
  INSTRUCCIÓN PARA TI:
  - Declara explícitamente que no pudiste procesar este archivo
  - Indica el motivo técnico
  - Sugiere verificar el archivo
  - NUNCA inventes o inferas su contenido

Respuesta de AL-EON:
"No pude procesar el archivo DOCX. El sistema reporta un error al intentar leerlo.

Esto puede deberse a:
- Archivo corrupto o dañado
- Formato incompatible
- Descarga incompleta

¿Podrías:
1. Verificar que el archivo se abre correctamente en Word
2. Intentar volver a adjuntarlo
3. O copiarlo y pegarlo como texto directamente en el chat?"
```

---

## 🎯 DIFERENCIA CLAVE (ANTES vs AHORA)

### ❌ ANTES (incorrecto):
```
Usuario: "¿Cuánto es el total?"
[PDF falla en procesamiento]

AL-EON: "Según la factura adjunta, el total es aproximadamente $5,000..."
         ↑↑↑ INVENTADO - nunca vio el contenido
```

### ✅ AHORA (correcto):
```
Usuario: "¿Cuánto es el total?"
[PDF falla en procesamiento]

AL-EON: "No pude procesar el archivo PDF. El sistema indica: 'PDF escaneado sin OCR'.
         ¿Podrías indicarme manualmente el monto total?"
         ↑↑↑ HONESTO - declara límite y pide info real
```

---

## 🔥 PRINCIPIO SUPREMO

**AL-EON NO NECESITA INVENTAR**

Tiene estas fuentes reales:
- ✅ Google Vision OCR
- ✅ PDF parsing
- ✅ Document parsing
- ✅ Web search API
- ✅ Email API
- ✅ Calendar API
- ✅ Memory API
- ✅ Base de conocimiento

**Secuencia correcta**:
1. Intentar procesar con herramientas
2. Si falla, declarar explícitamente
3. Preguntar al usuario
4. Consultar APIs alternativas
5. **NUNCA** rellenar con imaginación

---

## 🧪 TESTING RECOMENDADO

### Test 1: PDF con texto ✅
```bash
# Archivo: factura.pdf (con texto seleccionable)
# Esperado: Extrae contenido y responde con info real
```

### Test 2: PDF escaneado ⚠️
```bash
# Archivo: factura-scan.pdf (imagen sin OCR)
# Esperado: Declara "no pude procesar, es PDF escaneado sin OCR"
```

### Test 3: Imagen sin texto ⚠️
```bash
# Archivo: grafica.png (gráfica sin texto)
# Esperado: Declara "OCR completado pero no detecté texto legible"
```

### Test 4: Archivo corrupto ❌
```bash
# Archivo: corrupto.docx
# Esperado: Declara "error al leer archivo, puede estar corrupto"
```

### Test 5: Tipo no soportado ❌
```bash
# Archivo: datos.xlsx
# Esperado: Declara "tipo de archivo no soportado (xlsx)"
```

---

## ✅ CHECKLIST DE IMPLEMENTACIÓN

- [x] Captura granular de errores en `attachmentProcessor.ts`
- [x] Contexto con instrucciones explícitas en `generateAttachmentContext`
- [x] Nueva REGLA #0 en prompt de AL-EON (`aleon.ts`)
- [x] Compilación exitosa (`npm run build`)
- [ ] Testing con archivos reales (5 casos)
- [ ] Deploy a producción
- [ ] Monitoreo de comportamiento en logs

---

## 📝 ARCHIVOS MODIFICADOS

1. **`src/utils/attachmentProcessor.ts`**
   - Líneas ~95-115: Captura de error específico en Vision OCR
   - Líneas ~120-145: Captura de error específico en PDF/DOCX parsing
   - Líneas ~150-155: Error específico para tipo no soportado
   - Líneas ~190-220: Contexto con instrucciones explícitas para AL-EON

2. **`src/ai/prompts/aleon.ts`**
   - Líneas ~11-50: Nueva REGLA #0 - Declaración explícita de límites
   - Incluye ejemplos de comportamiento correcto e incorrecto

---

## 🎓 LECCIÓN APRENDIDA

**NO es una elección binaria**:
- ❌ "Bloquear y ser honesto" vs "Procesar y mentir"

**ES una integración**:
- ✅ Procesar TODO lo posible
- ✅ Declarar honestamente los límites
- ✅ Usar herramientas antes que imaginación
- ✅ Preguntar cuando falta información

**Modelo**: GitHub Copilot / GPT / ChatGPT Enterprise

---

## 🚀 PRÓXIMOS PASOS

1. **Testing inmediato**: Probar con los 5 casos de uso
2. **Monitoreo**: Verificar logs de procesamiento
3. **Validación**: Confirmar que AL-EON declara fallos correctamente
4. **Deployment**: Si tests OK → deploy a producción

---

**¿Dudas o aclaraciones?** Este documento explica el ajuste crítico para que AL-EON sea un clon funcional de GPT/Copilot en el manejo de attachments.
