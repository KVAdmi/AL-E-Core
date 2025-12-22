import OpenAI from 'openai';

interface OpenAIChatRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
  }>;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

interface OpenAIChatResponse {
  content: string;
  raw: any;
}

export async function callOpenAIChat({
  messages,
  model = 'gpt-4-turbo',
  systemPrompt,
  temperature = 0.7,
  topP = 1.0,
  presencePenalty = 0.0,
  frequencyPenalty = 0.0
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
      messages: finalMessages as any, // Cast necesario para soportar multimodal
      temperature,
      top_p: topP,
      presence_penalty: presencePenalty,
      frequency_penalty: frequencyPenalty,
      max_tokens: 4000
      // NO usar response_format json_object para AL-EON (responde en texto natural)
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