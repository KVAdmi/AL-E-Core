export interface AssistantMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AssistantRequest {
  workspaceId?: string;
  userId?: string;
  mode?: 'universal' | 'legal' | 'medico' | 'seguros' | 'contabilidad';
  messages: AssistantMessage[];
}

export interface AssistantResponse {
  content: string;
  raw?: any;
}

export interface IAssistantProvider {
  chat(request: AssistantRequest): Promise<AssistantResponse>;
}