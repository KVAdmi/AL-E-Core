-- =====================================================
-- MIGRACIÓN 022: EMBEDDING STATUS - ARQUITECTURA ENTERPRISE
-- =====================================================
-- 
-- PROBLEMA RESUELTO:
-- Chunks pueden existir sin embeddings y el sistema no lo detecta
-- 
-- SOLUCIÓN:
-- Estado explícito de embeddings en cada chunk
-- Worker independiente para procesamiento
-- Idempotencia por source_hash
-- 
-- Estados: pending | processing | ready | error
-- =====================================================

-- 1. Agregar columna de estado a kb_chunks
ALTER TABLE kb_chunks 
ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending';

-- 2. Agregar índice para el worker (queries frecuentes)
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding_status 
ON kb_chunks(embedding_status) 
WHERE embedding_status IN ('pending', 'error');

-- 3. Agregar source_hash para idempotencia
ALTER TABLE kb_sources 
ADD COLUMN IF NOT EXISTS source_hash TEXT;

-- 4. Índice único en source_hash (evita duplicados)
CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_sources_hash 
ON kb_sources(source_hash) 
WHERE source_hash IS NOT NULL;

-- 5. Agregar timestamp de último intento de embedding
ALTER TABLE kb_chunks 
ADD COLUMN IF NOT EXISTS embedding_attempted_at TIMESTAMPTZ;

ALTER TABLE kb_chunks 
ADD COLUMN IF NOT EXISTS embedding_error TEXT;

-- =====================================================
-- MIGRACIÓN DE DATOS EXISTENTES
-- =====================================================

-- Marcar chunks con embeddings como 'ready'
UPDATE kb_chunks
SET embedding_status = 'ready'
WHERE id IN (
  SELECT chunk_id FROM kb_embeddings
);

-- Marcar chunks sin embeddings como 'pending'
UPDATE kb_chunks
SET embedding_status = 'pending'
WHERE id NOT IN (
  SELECT chunk_id FROM kb_embeddings WHERE chunk_id IS NOT NULL
);

-- =====================================================
-- COMENTARIOS PARA TRACKING
-- =====================================================

COMMENT ON COLUMN kb_chunks.embedding_status IS 'Estado del embedding: pending (sin procesar) | processing (en curso) | ready (listo) | error (falló)';
COMMENT ON COLUMN kb_chunks.embedding_attempted_at IS 'Última vez que se intentó generar el embedding';
COMMENT ON COLUMN kb_chunks.embedding_error IS 'Mensaje de error si embedding_status = error';
COMMENT ON COLUMN kb_sources.source_hash IS 'SHA-256 del contenido para idempotencia (evita duplicados)';

-- =====================================================
-- VALIDACIÓN
-- =====================================================

-- Query para verificar estado del sistema
-- SELECT 
--   embedding_status,
--   COUNT(*) as count
-- FROM kb_chunks
-- GROUP BY embedding_status;
--
-- Resultado esperado después de migración + worker:
-- ready   | 13
-- pending | 0
-- error   | 0
