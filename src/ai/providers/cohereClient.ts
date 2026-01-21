/**
 * COHERE COMMAND R CLIENT
 * 
 * Cohere Command R para RAG / búsqueda en documentos internos
 * 
 * IMPORTANTE: 
 * - Cohere NO gobierna
 * - Cohere NO decide
 * - Cohere SOLO responde cuando Mistral lo invoca
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });

export interface CohereRequest {
  query: string;
  documents?: string[]; // Documentos para hacer RAG
  maxTokens?: number;
  temperature?: number;
}

export interface CohereResponse {
  text: string;
  citations?: Array<{
    document_index: number;
    text: string;
  }>;
}

/**
 * Llama a Cohere Command R para RAG/búsqueda
 * Solo se invoca cuando Mistral decide que necesita buscar en docs internos
 */
export async function callCohere(request: CohereRequest): Promise<CohereResponse> {
  console.log('[COHERE] 🔍 RAG Query:', request.query);
  
  try {
    const payload = {
      message: request.query,
      documents: request.documents || [],
      max_tokens: request.maxTokens || 1024,
      temperature: request.temperature || 0.3,
    };
    
    const command = new InvokeModelCommand({
      modelId: 'cohere.command-r-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });
    
    const response = await bedrock.send(command);
    const result = JSON.parse(Buffer.from(response.body).toString());
    
    console.log('[COHERE] ✅ RAG completado');
    
    return {
      text: result.text,
      citations: result.citations || []
    };
    
  } catch (error: any) {
    console.error('[COHERE] ❌ Error:', error.message);
    throw new Error(`Cohere Command R failed: ${error.message}`);
  }
}
