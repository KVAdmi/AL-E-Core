-- =====================================================
-- TABLA PARA AUDITORÍA DE VISION API
-- =====================================================

CREATE TABLE IF NOT EXISTS vision_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL UNIQUE,
  image_hash TEXT NOT NULL,
  full_text TEXT,
  entities JSONB,
  structured JSONB,
  sanitized BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda
CREATE INDEX IF NOT EXISTS idx_vision_requests_image_hash ON vision_requests(image_hash);
CREATE INDEX IF NOT EXISTS idx_vision_requests_created_at ON vision_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_requests_request_id ON vision_requests(request_id);
