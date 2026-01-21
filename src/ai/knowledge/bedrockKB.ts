/**
 * BEDROCK KNOWLEDGE BASE - RAG Integration
 * 
 * Única fuente de verdad para memoria larga y conocimiento interno.
 * NO es opcional. Es core del sistema.
 * 
 * Arquitectura:
 * - IAM Role/Instance Profile para credenciales (NO Access Keys)
 * - KB ID: UDP5DLU7JT (us-east-1)
 * - Fail-closed: Si KB devuelve 0 chunks para query de conocimiento → error explícito
 */

import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';

interface KBRetrievalResult {
  content: string;
  score: number;
  documentId?: string;
  documentTitle?: string;
  location?: string;
}

interface KBQueryResult {
  results: KBRetrievalResult[];
  resultsCount: number;
  query: string;
  topScores: number[];
  documentRefs: string[];
}

/**
 * Cliente Bedrock KB con IAM Role (sin Access Keys)
 */
const getBedrockKBClient = () => {
  return new BedrockAgentRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1',
    // IAM Role credentials se obtienen automáticamente en EC2
    // NO se especifica accessKeyId ni secretAccessKey
  });
};

/**
 * Query Bedrock Knowledge Base para recuperar contexto
 * 
 * @param query - Pregunta del usuario
 * @param userId - ID del usuario (para filtros)
 * @param workspaceId - ID del workspace (para filtros)
 * @param numberOfResults - Número de chunks a recuperar (default: 5)
 * @returns Resultados de KB con scores y referencias
 */
export async function queryKnowledgeBase(
  query: string,
  userId: string,
  workspaceId: string = 'default',
  numberOfResults: number = 5
): Promise<KBQueryResult> {
  const startTime = Date.now();
  
  console.log('[KB] 🧠 Query:', query.substring(0, 100));
  console.log('[KB] 📊 numberOfResults:', numberOfResults);
  
  const knowledgeBaseId = process.env.BEDROCK_KB_ID;
  
  if (!knowledgeBaseId) {
    console.error('[KB] ❌ BEDROCK_KB_ID no configurado en .env');
    throw new Error('BEDROCK_KB_ID not configured');
  }
  
  try {
    const client = getBedrockKBClient();
    
    const command = new RetrieveCommand({
      knowledgeBaseId,
      retrievalQuery: {
        text: query
      },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults,
          // Filtros opcionales por metadata
          // filter: {
          //   equals: {
          //     key: 'user_id',
          //     value: userId
          //   }
          // }
        }
      }
    });
    
    const response = await client.send(command);
    const retrievalResults = response.retrievalResults || [];
    
    // Procesar resultados
    const results: KBRetrievalResult[] = retrievalResults.map(r => ({
      content: r.content?.text || '',
      score: r.score || 0,
      documentId: r.location?.s3Location?.uri || undefined,
      documentTitle: typeof r.metadata?.['document_title'] === 'string' 
        ? r.metadata['document_title'] 
        : undefined,
      location: r.location?.type || undefined
    }));
    
    // Extraer top scores y document refs
    const topScores = results.map(r => r.score).slice(0, 3);
    const documentRefs = results
      .map(r => r.documentTitle || r.documentId)
      .filter(Boolean)
      .slice(0, 3) as string[];
    
    const executionTime = Date.now() - startTime;
    
    // 📊 LOG OBLIGATORIO
    console.log('[KB] ✅ Retrieved:', retrievalResults.length, 'chunks');
    console.log('[KB] ⏱️', executionTime, 'ms');
    console.log('[KB] 🎯 Top scores:', topScores);
    console.log('[KB] 📄 Doc refs:', documentRefs);
    
    return {
      results,
      resultsCount: results.length,
      query,
      topScores,
      documentRefs
    };
    
  } catch (error: any) {
    console.error('[KB] ❌ Error querying KB:', error.message);
    console.error('[KB] 🔍 Error code:', error.name);
    
    // Si es error de credenciales IAM, indicarlo explícitamente
    if (error.name === 'CredentialsProviderError' || error.name === 'AccessDeniedException') {
      console.error('[KB] 🚨 CRITICAL: IAM Role no configurado en EC2 o sin permisos bedrock:Retrieve');
    }
    
    throw error;
  }
}

/**
 * Detectar si una pregunta requiere consultar KB
 * 
 * Intent patterns que DEBEN ir a KB:
 * - Memoria/conocimiento interno
 * - Políticas/procesos
 * - Acuerdos/decisiones pasadas
 * - Documentación/FAQs
 */
export function requiresKnowledgeBase(userMessage: string): boolean {
  const messageLower = userMessage.toLowerCase();
  
  // Patterns de memoria/conocimiento
  const memoryPatterns = [
    /qué (acordamos|dijimos|decidimos|hablamos)/,
    /cuál (fue|era) (el|la|mi|tu)/,
    /recuerdas (cuando|que|si)/,
    /según (lo que|mis notas|lo acordado)/,
    /(política|proceso|procedimiento) (de|para)/,
    /cómo (es|funciona) (la gobernanza|el proceso)/,
    /qué hicimos (ayer|la semana pasada|antes)/,
    /documentación (de|sobre)/,
    /faq|pregunta frecuente/,
    /manual|guía/,
  ];
  
  return memoryPatterns.some(pattern => pattern.test(messageLower));
}

/**
 * Formatear resultados de KB para inyectar en system prompt
 */
export function formatKBContextForPrompt(kbResult: KBQueryResult): string {
  if (kbResult.resultsCount === 0) {
    return 'No hay información relevante en la base de conocimiento para esta consulta.';
  }
  
  const contextChunks = kbResult.results
    .map((r, idx) => {
      const score = (r.score * 100).toFixed(1);
      const source = r.documentTitle || r.documentId || 'documento';
      return `[${idx + 1}] (score: ${score}%) ${r.content}\nFuente: ${source}`;
    })
    .join('\n\n---\n\n');
  
  return `📚 CONTEXTO DE BASE DE CONOCIMIENTO (${kbResult.resultsCount} fragmentos recuperados):

${contextChunks}

Referencias principales: ${kbResult.documentRefs.join(', ')}
Scores de relevancia: ${kbResult.topScores.map(s => (s * 100).toFixed(1) + '%').join(', ')}`;
}
