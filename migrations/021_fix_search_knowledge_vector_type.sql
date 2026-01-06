-- =====================================================
-- FIX: search_knowledge con tipo VECTOR correcto
-- =====================================================
-- Problema: La función recibía TEXT y hacía cast a vector
-- Solución: Recibir directamente vector(1024)
-- Esto evita problemas de parsing y comparación en runtime

DROP FUNCTION IF EXISTS public.search_knowledge(text, float, int);

CREATE OR REPLACE FUNCTION public.search_knowledge(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  chunk_id uuid,
  content text,
  score float,
  source_path text,
  source_type text,
  metadata jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.id AS chunk_id,
    c.content,
    1 - (e.embedding <=> query_embedding) AS score,
    s.path AS source_path,
    s.type AS source_type,
    c.metadata
  FROM kb_embeddings e
  JOIN kb_chunks c ON c.id = e.chunk_id
  JOIN kb_sources s ON s.id = c.source_id
  WHERE e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.search_knowledge(vector, float, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_knowledge(vector, float, int) TO anon;

-- Comentario para tracking
COMMENT ON FUNCTION public.search_knowledge IS 'Búsqueda vectorial semántica con BGE-M3 embeddings. Recibe vector(1024) directamente para evitar problemas de cast.';
