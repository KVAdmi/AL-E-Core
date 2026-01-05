#!/usr/bin/env ts-node
/**
 * =====================================================
 * SCRIPT DE INGESTA DE CONOCIMIENTO
 * =====================================================
 * 
 * Ejecuta la ingesta de todos los archivos .md del repo
 * 
 * Uso:
 *   npm run ingest-knowledge
 *   o
 *   ts-node scripts/ingestKnowledge.ts
 * =====================================================
 */

import { ingestAllMarkdownFiles } from '../src/services/knowledgeIngest';
import path from 'path';

const REPO_PATH = path.join(__dirname, '..');

console.log('╔════════════════════════════════════════════════════╗');
console.log('║   KNOWLEDGE INGEST - AL-E CORE                     ║');
console.log('╚════════════════════════════════════════════════════╝');
console.log('');

async function main() {
  try {
    await ingestAllMarkdownFiles(REPO_PATH);
    console.log('');
    console.log('✅ Ingesta completada exitosamente');
    process.exit(0);
  } catch (error: any) {
    console.error('');
    console.error('❌ Error en ingesta:', error.message);
    process.exit(1);
  }
}

main();
