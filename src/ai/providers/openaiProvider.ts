import OpenAI from 'openai';

interface OpenAIChatRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
}

interface OpenAIChatResponse {
  content: string;
  raw: any;
}

export async function callOpenAIChat({
  messages,
  model = 'gpt-4-turbo',
  systemPrompt,
  temperature = 0.7
}: OpenAIChatRequest): Promise<OpenAIChatResponse> {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Preparar mensajes incluyendo system prompt si se proporciona
  const finalMessages = [...messages];
  
  if (systemPrompt) {
    finalMessages.unshift({
      role: 'system',
      content: systemPrompt
    });
  }

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: finalMessages,
      temperature,
      max_tokens: 4000,
      response_format: { type: "json_object" }
    });

    const content = completion.choices[0]?.message?.content || '';

    return {
      content,
      raw: completion
    };
  } catch (error) {
    console.error('Error en OpenAI API:', error);
    throw new Error(`Error en llamada a OpenAI: ${error instanceof Error ? error.message : 'Error desconocido'}`);
  }
}