export type LiaModule = "agenda" | "brief" | "diario" | "general";

export interface LiaChatRequest {
	userId: string; // por ahora un string fijo "luis"
	message: string;
}

export interface LiaIntentResult {
	module: LiaModule;
	intent: string;
	entities?: Record<string, any>;
}

// ============================================
// CONTRATO ESTANDARIZADO GPT PRO
// ============================================

export type AssistantMode = string;

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  meta?: Record<string, any>;
}

export interface ChatRequest {
  workspaceId?: string;
  userId: string;
  mode?: AssistantMode;
  sessionId?: string;
  messages: Message[];
  meta?: {
    responseLanguage?: string;
    preferredVoice?: string;
    enableTTS?: boolean;
    localeHint?: string;
  };
}

export interface ArtifactItem {
  type: 'document' | 'image' | 'file' | 'code';
  format?: string;
  fileUrl?: string;
  storagePath?: string;
  previewText?: string;
  url?: string;
  prompt?: string;
  size?: string;
  content?: string;
  language?: string;
}

export interface SourceItem {
  type: 'web' | 'file' | 'memory' | 'external';
  title: string;
  url?: string;
  snippet?: string;
  fileId?: string;
  citation?: string;
}

export interface ActionItem {
  type: 'CREATE_APPOINTMENT' | 'UPDATE_APPOINTMENT' | 'CREATE_TASK' | 'UPDATE_TASK' | 
        'CREATE_REMINDER' | 'GENERATE_DOCUMENT' | 'SUMMARIZE_SESSION' | 'EXPORT_SESSION';
  payload: Record<string, any>;
}

export interface MemoryItem {
  kind: string;
  value: any;
  importance?: number;
}

// CONTRATO ÚNICO DE RESPUESTA ESTANDARIZADO
export interface ChatResponse {
  answer: string;
  sessionId: string;
  actions?: ActionItem[];
  sources?: SourceItem[];
  artifacts?: ArtifactItem[];
  memories_to_add?: MemoryItem[];
  meta?: {
    detectedLanguage?: string;
    responseLanguage?: string;
    audioUrl?: string;
    model?: string;
    tokens?: number;
    cost?: number;
  };
}

// ============================================
// SESIONES
// ============================================

export interface Session {
  id: string;
  workspaceId: string;
  userId: string;
  mode: AssistantMode;
  title?: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  pinned: boolean;
  archived: boolean;
  meta?: Record<string, any>;
}

export interface CreateSessionRequest {
  workspaceId?: string;
  userId: string;
  mode?: AssistantMode;
  assistantId?: string;
}

export interface UpdateSessionRequest {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

// ============================================
// ARCHIVOS Y RAG
// ============================================

export interface FileUploadRequest {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sessionId?: string;
}

export interface FileUploadResponse {
  storagePath: string;
  signedUrl: string;
  fileId: string;
}

export interface FileIngestRequest {
  storagePath: string;
  sessionId?: string;
  userId: string;
  mimeType: string;
}

export interface FileItem {
  id: string;
  userId: string;
  sessionId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  extractedText?: string;
  createdAt: string;
}

export interface AskFilesRequest {
  sessionId: string;
  question: string;
  userId: string;
}

// ============================================
// DOCUMENTOS
// ============================================

export interface GenerateDocumentRequest {
  templateId?: string;
  title: string;
  instructions: string;
  sessionId?: string;
  format: 'docx' | 'pdf' | 'md';
}

// ============================================
// IMÁGENES
// ============================================

export interface GenerateImageRequest {
  prompt: string;
  size?: '1024x1024' | '512x512' | '256x256';
  sessionId?: string;
  userId: string;
}

// ============================================
// WEB
// ============================================

export interface WebSearchRequest {
  query: string;
  maxResults?: number;
}

export interface WebFetchRequest {
  url: string;
}

export interface WebSearchResponse {
  sources: SourceItem[];
  content?: string;
  citations?: string[];
}

// ============================================
// VOZ
// ============================================

export interface TTSRequest {
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav' | 'ogg';
  language?: string;
  sessionId?: string; // P0: Para logging
  userId?: string; // P0: Para logging
}

export interface TTSResponse {
  audioUrl: string;
  format: string;
  duration?: number;
}

export interface STTRequest {
  language?: string;
  sessionId?: string; // P0: Para logging
  userId?: string; // P0: Para logging
}

export interface STTResponse {
  transcript: string;
  confidence?: number;
  detectedLanguage?: string;
}

// ============================================
// ACCIONES
// ============================================

export interface RunActionRequest {
  sessionId?: string;
  userId: string;
  actionType: string;
  payload: Record<string, any>;
}

export interface RunActionResponse {
  result: any;
  status: 'success' | 'error' | 'pending';
  error?: string;
}

// ============================================
// OBSERVABILIDAD
// ============================================

export interface RequestLog {
  sessionId?: string;
  userId: string;
  endpoint: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  costUsd?: number;
  statusCode?: number;
  errorMessage?: string;
}

// ============================================
// RATE LIMITING
// ============================================

export interface RateLimit {
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  tokensPerDay?: number;
}
