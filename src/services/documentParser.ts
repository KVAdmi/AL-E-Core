/**
 * =====================================================
 * DOCUMENT PARSER - P0 EXPRESS
 * =====================================================
 * Parsea PDF, DOCX, y extrae texto para RAG.
 * NO usa librerías complejas. Solo lo mínimo funcional.
 */

import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import fs from 'fs';
import path from 'path';

export interface ParsedDocument {
  text: string;
  metadata: {
    pages?: number;
    wordCount: number;
    filename: string;
    type: 'pdf' | 'docx' | 'txt' | 'md';
  };
}

/**
 * Parsea PDF y extrae texto
 */
export async function parsePDF(filePath: string): Promise<ParsedDocument> {
  const dataBuffer = fs.readFileSync(filePath);
  // @ts-ignore - pdf-parse tiene problemas con tipos pero funciona
  const data = await pdf(dataBuffer);
  
  return {
    text: data.text,
    metadata: {
      pages: data.numpages,
      wordCount: data.text.split(/\s+/).length,
      filename: path.basename(filePath),
      type: 'pdf'
    }
  };
}

/**
 * Parsea DOCX y extrae texto
 */
export async function parseDOCX(filePath: string): Promise<ParsedDocument> {
  const result = await mammoth.extractRawText({ path: filePath });
  
  return {
    text: result.value,
    metadata: {
      wordCount: result.value.split(/\s+/).length,
      filename: path.basename(filePath),
      type: 'docx'
    }
  };
}

/**
 * Parsea texto plano (MD, TXT)
 */
export async function parseText(filePath: string): Promise<ParsedDocument> {
  const text = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  
  return {
    text,
    metadata: {
      wordCount: text.split(/\s+/).length,
      filename: path.basename(filePath),
      type: ext === '.md' ? 'md' : 'txt'
    }
  };
}

/**
 * Parser universal - detecta tipo y llama al parser correcto
 */
export async function parseDocument(filePath: string): Promise<ParsedDocument> {
  const ext = path.extname(filePath).toLowerCase();
  
  switch (ext) {
    case '.pdf':
      return parsePDF(filePath);
    case '.docx':
      return parseDOCX(filePath);
    case '.md':
    case '.txt':
      return parseText(filePath);
    default:
      throw new Error(`Tipo de archivo no soportado: ${ext}`);
  }
}

/**
 * Chunking simple por secciones/párrafos
 * NO usa tokens ciegos, respeta estructura del documento
 */
export function chunkDocument(text: string, maxChunkSize: number = 1000): string[] {
  const chunks: string[] = [];
  
  // Split por doble salto de línea (párrafos)
  const paragraphs = text.split(/\n\s*\n/);
  
  let currentChunk = '';
  
  for (const para of paragraphs) {
    // Si el párrafo solo cabe en nuevo chunk
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }
  
  // Agregar último chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks.filter(c => c.length > 50); // Filtrar chunks muy pequeños
}

/**
 * Procesar documento completo: parse + chunk
 */
export async function processDocument(filePath: string): Promise<{
  parsed: ParsedDocument;
  chunks: string[];
}> {
  const parsed = await parseDocument(filePath);
  const chunks = chunkDocument(parsed.text);
  
  console.log(`[DOC PARSER] Procesado: ${parsed.metadata.filename}`);
  console.log(`[DOC PARSER] Texto: ${parsed.text.length} chars`);
  console.log(`[DOC PARSER] Chunks: ${chunks.length}`);
  
  return { parsed, chunks };
}
