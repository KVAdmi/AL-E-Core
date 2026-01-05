-- =====================================================
-- FUNCIÓN DE BÚSQUEDA POR SIMILITUD COSENO
-- =====================================================
-- Esta función busca en kb_embeddings usando pgvector
-- y devuelve los chunks más relevantes con sus fuentes

CREATE OR REPLACE FUNCTION search_knowledge(
  query_embedding TEXT,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  chunk_id UUID,
  content TEXT,
  score FLOAT,
  source_path TEXT,
  source_type TEXT,
  metadata JSONB
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS chunk_id,
    c.content,
    1 - (e.embedding <=> query_embedding::vector) AS score,
    s.path AS source_path,
    s.type AS source_type,
    c.metadata
  FROM kb_embeddings e
  JOIN kb_chunks c ON c.id = e.chunk_id
  JOIN kb_sources s ON s.id = c.source_id
  WHERE 1 - (e.embedding <=> query_embedding::vector) > match_threshold
  ORDER BY e.embedding <=> query_embedding::vector
  LIMIT match_count;
END;
$$;
