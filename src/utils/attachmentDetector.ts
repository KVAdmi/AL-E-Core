/**
 * ATTACHMENT DETECTOR
 * 
 * REGLA CRÍTICA DE NEGOCIO:
 * AL-EON NO puede ver ni procesar imágenes, PDFs, archivos adjuntos.
 * AL-EON NO debe inventar contenido de archivos que no puede leer.
 * 
 * Este módulo detecta cuando hay adjuntos en un mensaje y activa
 * el MODO RESTRINGIDO obligatorio.
 */

export interface AttachmentMetadata {
  name?: string;
  type?: string;
  size?: number;
  url?: string;
  bucket?: string;
  path?: string;
}

export interface AttachmentDetectionResult {
  hasAttachments: boolean;
  attachmentCount: number;
  attachmentTypes: string[];
  textualReferences: string[];
  restrictedMode: boolean;
}

/**
 * Palabras clave que indican referencias a archivos adjuntos
 */
const ATTACHMENT_KEYWORDS = [
  // Español
  'adjunto', 'adjunta', 'adjuntos', 'archivo', 'archivos',
  'documento', 'documentos', 'imagen', 'imágenes', 'foto', 'fotos',
  'pdf', 'excel', 'word', 'screenshot', 'captura',
  'factura', 'facturas', 'comprobante', 'comprobantes',
  'evidencia', 'evidencias', 'constancia',
  
  // English
  'attachment', 'attachments', 'attached', 'file', 'files',
  'document', 'documents', 'image', 'images', 'picture', 'pictures',
  'photo', 'photos', 'screenshot', 'invoice', 'receipt',
  'proof', 'evidence'
];

/**
 * Detecta si un mensaje contiene attachments o referencias a ellos
 */
export function detectAttachments(
  messageContent: string,
  attachments?: AttachmentMetadata[]
): AttachmentDetectionResult {
  
  // 1. Detectar attachments explícitos (array)
  const hasExplicitAttachments = attachments && attachments.length > 0;
  const attachmentCount = attachments?.length || 0;
  const attachmentTypes = attachments?.map(a => a.type || 'unknown').filter(Boolean) || [];
  
  // 2. Detectar referencias textuales a archivos
  const textualReferences: string[] = [];
  const lowerContent = messageContent.toLowerCase();
  
  for (const keyword of ATTACHMENT_KEYWORDS) {
    if (lowerContent.includes(keyword)) {
      textualReferences.push(keyword);
    }
  }
  
  // 3. Determinar si hay attachments (explícitos o referenciados)
  const hasAttachments = hasExplicitAttachments || textualReferences.length > 0;
  
  // 4. MODO RESTRINGIDO: Se activa si hay cualquier indicio de attachments
  const restrictedMode = hasAttachments;
  
  return {
    hasAttachments,
    attachmentCount,
    attachmentTypes,
    textualReferences,
    restrictedMode
  };
}

/**
 * Genera el mensaje de restricción obligatorio
 * Este mensaje SE DEBE INYECTAR al system prompt cuando hay attachments
 */
export function generateAttachmentRestrictionPrompt(): string {
  return `
╔════════════════════════════════════════════════════════════════╗
║  🚨 MODO RESTRINGIDO - ATTACHMENTS DETECTADOS                  ║
╚════════════════════════════════════════════════════════════════╝

⚠️ ATENCIÓN CRÍTICA - COMPORTAMIENTO OBLIGATORIO:

El usuario ha enviado o mencionado archivos adjuntos (imágenes, PDFs, documentos).

DEBES INICIAR TU RESPUESTA CON ESTA DECLARACIÓN EXACTA:

"No tengo la capacidad de ver ni analizar imágenes o archivos adjuntos."

SIN EMOJIS. SIN ADORNOS. SIN ALTERNATIVAS CREATIVAS.

═══════════════════════════════════════════════════════════════
PROHIBICIONES ABSOLUTAS EN MODO RESTRINGIDO
═══════════════════════════════════════════════════════════════

QUEDA TOTALMENTE PROHIBIDO:

❌ Inferir montos, cantidades, números de archivos
❌ Validar facturas o documentos financieros
❌ Interpretar contenido de PDFs
❌ Analizar screenshots o capturas
❌ Sacar conclusiones legales o financieras de documentos
❌ Usar frases como:
   - "según el documento"
   - "parece que"
   - "el archivo indica"
   - "en la imagen se ve"
   - "el PDF muestra"
   - "basándome en la factura"

❌ INVENTAR O COMPLETAR INFORMACIÓN que no puedes ver

Si esto sucede → es un BUG CRÍTICO del sistema.

═══════════════════════════════════════════════════════════════
COMPORTAMIENTO PERMITIDO
═══════════════════════════════════════════════════════════════

SOLO puedes:

✅ Declarar la limitación claramente
✅ Pedir descripción textual del contenido
✅ Sugerir revisión humana
✅ Consultar APIs o bases de datos SI están disponibles
✅ Escalar el caso

EJEMPLO VÁLIDO:

"No puedo ver el archivo adjunto.
¿Puedes describir el contenido con palabras o prefieres que lo revise una persona?"

═══════════════════════════════════════════════════════════════
PRINCIPIO FUNDAMENTAL
═══════════════════════════════════════════════════════════════

AL-EON NO MIENTE.
AL-EON NO INFIERE CUANDO NO VE.
AL-EON NO COMPLETA VACÍOS CON SUPOSICIONES.

Prefiero decir "no lo sé" que responder mal.
Esto es enterprise-grade.

NO HAY EXCEPCIONES.
`;
}

/**
 * Valida si un mensaje de AL-E cumple con las reglas de modo restringido
 * Útil para testing y QA
 */
export function validateRestrictedModeResponse(response: string): {
  valid: boolean;
  violations: string[];
} {
  const violations: string[] = [];
  const lowerResponse = response.toLowerCase();
  
  // 1. Debe declarar la limitación
  const hasDeclaration = 
    lowerResponse.includes('no tengo la capacidad') ||
    lowerResponse.includes('no puedo ver') ||
    lowerResponse.includes('no puedo analizar');
  
  if (!hasDeclaration) {
    violations.push('Falta declaración explícita de limitación');
  }
  
  // 2. No debe usar frases prohibidas
  const forbiddenPhrases = [
    'según el documento',
    'parece que',
    'el archivo indica',
    'en la imagen',
    'el pdf muestra',
    'basándome en la factura',
    'en el screenshot',
    'veo que',
    'observo que'
  ];
  
  for (const phrase of forbiddenPhrases) {
    if (lowerResponse.includes(phrase)) {
      violations.push(`Uso de frase prohibida: "${phrase}"`);
    }
  }
  
  return {
    valid: violations.length === 0,
    violations
  };
}
