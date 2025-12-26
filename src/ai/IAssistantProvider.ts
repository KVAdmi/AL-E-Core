export interface AssistantMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

export interface AssistantRequest {
  workspaceId?: string;
  userId?: string;
  userEmail?: string;
  mode?: string;
  messages: AssistantMessage[];
}

export interface AssistantResponse {
  content: string;
  raw?: any;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface IAssistantProvider {
  chat(request: AssistantRequest): Promise<AssistantResponse>;
}