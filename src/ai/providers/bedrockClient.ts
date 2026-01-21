import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

// Cliente Bedrock singleton (usa IAM role en EC2, no API keys)
const bedrockClient = new BedrockRuntimeClient({ 
  region: 'us-east-1'
});

export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BedrockResponse {
  content: string;
  stop_reason: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Llama a Claude 3 Sonnet via Bedrock
 */
export async function callClaude(
  messages: BedrockMessage[],
  maxTokens: number = 2048,
  systemPrompt?: string
): Promise<BedrockResponse> {
  const body: any = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    messages: messages
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const command = new InvokeModelCommand({
    modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return {
    content: responseBody.content[0].text,
    stop_reason: responseBody.stop_reason,
    usage: responseBody.usage
  };
}

/**
 * Llama a Mistral Large 3 via Bedrock (Messages API format)
 */
export async function callMistral(
  messages: BedrockMessage[],
  maxTokens: number = 2048,
  systemPrompt?: string
): Promise<BedrockResponse> {
  // Mistral Large 3 usa Messages API format
  const body: any = {
    messages: messages.map(m => ({
      role: m.role,
      content: m.content
    })),
    max_tokens: maxTokens,
    temperature: 0.7,
    top_p: 0.9
  };

  // Agregar system prompt si existe
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const command = new InvokeModelCommand({
    modelId: 'mistral.mistral-large-3-675b-instruct', // 🔥 P0: Mistral Large 3 (Bedrock namespace)
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return {
    content: responseBody.choices[0].message.content,
    stop_reason: responseBody.choices[0].finish_reason || 'complete',
    usage: responseBody.usage || { input_tokens: 0, output_tokens: 0 }
  };
}

export { bedrockClient };
