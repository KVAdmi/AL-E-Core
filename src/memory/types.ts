export interface MemoryRecord {
  id: string;
  workspaceId?: string | null;
  userId?: string | null;
  mode: 'universal' | 'legal' | 'medico' | 'seguros' | 'contabilidad';
  type: 'profile' | 'preference' | 'project' | 'decision' | 'fact';
  summary: string;
  importance: number;
  source: 'manual' | 'auto' | 'system';
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemoryQuery {
  workspaceId?: string;
  userId?: string;
  mode?: string;
  limit?: number;
}

export interface NewMemoryInput {
  workspaceId?: string;
  userId?: string;
  mode: 'universal' | 'legal' | 'medico' | 'seguros' | 'contabilidad';
  type: 'profile' | 'preference' | 'project' | 'decision' | 'fact';
  summary: string;
  importance?: number;
  source?: 'manual' | 'auto' | 'system';
  metadata?: any;
}

export interface AIResponseWithMemory {
  answer: string;
  memories_to_add: Array<{
    type: 'profile' | 'preference' | 'project' | 'decision' | 'fact';
    summary: string;
    importance: number;
  }>;
}