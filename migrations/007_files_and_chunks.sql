-- =====================================================
-- Migration 007: Files & Chunks (Knowledge Base)
-- =====================================================
-- Propósito: Ingesta estructural de documentos para entrenamiento de AL-E
-- Principio: Persistencia primero, recuperación inteligente, entrenamiento acumulativo
-- =====================================================

-- Tabla: ae_files
-- Guarda metadata de documentos ingeridos
CREATE TABLE IF NOT EXISTS public.ae_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id TEXT NOT NULL,
  user_id_uuid UUID,
  project_id TEXT,
  filename TEXT NOT NULL,
  mimetype TEXT NOT NULL,
  size BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para ae_files
CREATE INDEX IF NOT EXISTS idx_ae_files_workspace ON public.ae_files(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ae_files_user ON public.ae_files(user_id_uuid);
CREATE INDEX IF NOT EXISTS idx_ae_files_project ON public.ae_files(project_id);
CREATE INDEX IF NOT EXISTS idx_ae_files_created ON public.ae_files(created_at DESC);

-- Tabla: ae_chunks
-- Guarda fragmentos de conocimiento entrenable
CREATE TABLE IF NOT EXISTS public.ae_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.ae_files(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  user_id_uuid UUID,
  project_id TEXT,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  importance FLOAT DEFAULT 1.0,
  -- embedding VECTOR(1536), -- Comentado: Requiere extensión pgvector (instalar después)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para ae_chunks
CREATE INDEX IF NOT EXISTS idx_ae_chunks_file ON public.ae_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_ae_chunks_workspace ON public.ae_chunks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ae_chunks_user ON public.ae_chunks(user_id_uuid);
CREATE INDEX IF NOT EXISTS idx_ae_chunks_project ON public.ae_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_ae_chunks_importance ON public.ae_chunks(importance DESC);
CREATE INDEX IF NOT EXISTS idx_ae_chunks_created ON public.ae_chunks(created_at DESC);

-- Índice compuesto para búsquedas optimizadas
CREATE INDEX IF NOT EXISTS idx_ae_chunks_context ON public.ae_chunks(workspace_id, user_id_uuid, importance DESC);

-- Índice de texto completo para búsqueda por keywords (PostgreSQL full-text search)
CREATE INDEX IF NOT EXISTS idx_ae_chunks_content_fts ON public.ae_chunks USING gin(to_tsvector('spanish', content));

-- Índice para embeddings (para búsqueda semántica futura con pgvector)
-- Descomentar cuando se implementen embeddings:
-- CREATE INDEX IF NOT EXISTS idx_ae_chunks_embedding ON public.ae_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Comentarios para documentación
COMMENT ON TABLE public.ae_files IS 'Metadata de documentos ingeridos para entrenamiento de AL-E';
COMMENT ON TABLE public.ae_chunks IS 'Fragmentos de conocimiento entrenable extraídos de documentos';
COMMENT ON COLUMN public.ae_chunks.importance IS 'Peso de importancia del fragmento (1.0-2.0)';

-- Políticas RLS (Row Level Security) - Opcional, ajustar según necesidad
-- Por ahora, permitir acceso completo desde el backend
ALTER TABLE public.ae_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_chunks ENABLE ROW LEVEL SECURITY;

-- Política: Permitir todo desde service role (backend)
CREATE POLICY "Service role full access on ae_files" ON public.ae_files
  FOR ALL USING (true);

CREATE POLICY "Service role full access on ae_chunks" ON public.ae_chunks
  FOR ALL USING (true);

-- Trigger para actualizar updated_at en ae_files
CREATE OR REPLACE FUNCTION update_ae_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_ae_files_updated_at
  BEFORE UPDATE ON public.ae_files
  FOR EACH ROW
  EXECUTE FUNCTION update_ae_files_updated_at();

-- =====================================================
-- Extensiones necesarias (verificar que existan)
-- =====================================================

-- Para vector embeddings (pgvector) - OPCIONAL
-- Si deseas habilitar búsqueda semántica en el futuro:
-- 1. Instalar extensión: CREATE EXTENSION IF NOT EXISTS vector;
-- 2. Agregar columna: ALTER TABLE public.ae_chunks ADD COLUMN embedding VECTOR(1536);
-- 3. Crear índice: CREATE INDEX idx_ae_chunks_embedding ON public.ae_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Para full-text search en español (ya incluido en PostgreSQL)
-- No requiere instalación adicional

-- =====================================================
-- Fin de migración 007
-- =====================================================
