-- =====================================================
-- CALENDAR EVENTS TABLE
-- =====================================================
-- 
-- Sistema de calendario para que AL-E pueda:
-- - Agendar citas automáticamente
-- - Detectar fechas en emails
-- - Crear eventos desde chat
-- - Enviar recordatorios
-- 
-- =====================================================

CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Información del evento
  title VARCHAR(500) NOT NULL,
  description TEXT,
  location VARCHAR(500),
  
  -- Fechas
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ,
  
  -- Participantes
  attendees TEXT[],
  
  -- Recordatorios
  reminder_minutes INTEGER DEFAULT 30,
  reminder_sent BOOLEAN DEFAULT FALSE,
  
  -- Metadatos
  source VARCHAR(50) DEFAULT 'manual', -- manual, email, chat
  source_id VARCHAR(255), -- ID del email o mensaje origen
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Índices
  CONSTRAINT valid_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_calendar_events_user_id ON calendar_events(user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_date ON calendar_events(start_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source, source_id);

-- RLS Policies
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- Los usuarios solo pueden ver sus propios eventos
CREATE POLICY "Users can view own events"
  ON calendar_events
  FOR SELECT
  USING (auth.uid() = user_id);

-- Los usuarios pueden crear sus propios eventos
CREATE POLICY "Users can create own events"
  ON calendar_events
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Los usuarios pueden actualizar sus propios eventos
CREATE POLICY "Users can update own events"
  ON calendar_events
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Los usuarios pueden eliminar sus propios eventos
CREATE POLICY "Users can delete own events"
  ON calendar_events
  FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_calendar_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_events_updated_at();

-- Función para obtener próximos eventos
CREATE OR REPLACE FUNCTION get_upcoming_events(
  p_user_id UUID,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  id UUID,
  title VARCHAR,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  location VARCHAR,
  reminder_minutes INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.title,
    e.start_date,
    e.end_date,
    e.location,
    e.reminder_minutes
  FROM calendar_events e
  WHERE e.user_id = p_user_id
    AND e.start_date >= NOW()
    AND e.start_date <= NOW() + (p_days || ' days')::INTERVAL
  ORDER BY e.start_date ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para detectar conflictos de horario
CREATE OR REPLACE FUNCTION check_event_conflicts(
  p_user_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ,
  p_event_id UUID DEFAULT NULL
)
RETURNS TABLE (
  conflicting_event_id UUID,
  conflicting_title VARCHAR,
  conflicting_start TIMESTAMPTZ,
  conflicting_end TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.title,
    e.start_date,
    e.end_date
  FROM calendar_events e
  WHERE e.user_id = p_user_id
    AND (p_event_id IS NULL OR e.id != p_event_id)
    AND (
      (e.start_date, COALESCE(e.end_date, e.start_date + INTERVAL '1 hour')) 
      OVERLAPS 
      (p_start_date, COALESCE(p_end_date, p_start_date + INTERVAL '1 hour'))
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
