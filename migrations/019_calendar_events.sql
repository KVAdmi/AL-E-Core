-- =====================================================
-- CALENDAR EVENTS - CAMPOS ADICIONALES
-- =====================================================
-- 
-- Añade campos faltantes a calendar_events que ya existe
-- La tabla YA EXISTE con: id, owner_user_id, title, description,
-- start_at, end_at, timezone, location, attendees_json, status,
-- created_at, updated_at, notification_minutes
-- 
-- =====================================================

-- Añadir campos nuevos si no existen
ALTER TABLE calendar_events 
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS reminder_sent boolean DEFAULT false;

-- Índices adicionales
CREATE INDEX IF NOT EXISTS idx_calendar_events_owner_user_id ON calendar_events(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start_at ON calendar_events(start_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source, source_id);

-- RLS Policies (solo si no existen)
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own events" ON calendar_events;
CREATE POLICY "Users can view own events"
  ON calendar_events
  FOR SELECT
  USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Users can create own events" ON calendar_events;
CREATE POLICY "Users can create own events"
  ON calendar_events
  FOR INSERT
  WITH CHECK (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Users can update own events" ON calendar_events;
CREATE POLICY "Users can update own events"
  ON calendar_events
  FOR UPDATE
  USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS "Users can delete own events" ON calendar_events;
CREATE POLICY "Users can delete own events"
  ON calendar_events
  FOR DELETE
  USING (auth.uid() = owner_user_id);

-- Trigger para updated_at (si no existe)
CREATE OR REPLACE FUNCTION update_calendar_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calendar_events_updated_at ON calendar_events;
CREATE TRIGGER calendar_events_updated_at
  BEFORE UPDATE ON calendar_events
  FOR EACH ROW
  EXECUTE FUNCTION update_calendar_events_updated_at();

-- Función para obtener próximos eventos
CREATE OR REPLACE FUNCTION get_upcoming_events(
  p_owner_user_id UUID,
  p_days INTEGER DEFAULT 7
)
RETURNS TABLE (
  id UUID,
  title text,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  location text,
  notification_minutes integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.title,
    e.start_at,
    e.end_at,
    e.location,
    e.notification_minutes
  FROM calendar_events e
  WHERE e.owner_user_id = p_owner_user_id
    AND e.start_at >= NOW()
    AND e.start_at <= NOW() + (p_days || ' days')::INTERVAL
  ORDER BY e.start_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Función para detectar conflictos de horario
CREATE OR REPLACE FUNCTION check_event_conflicts(
  p_owner_user_id UUID,
  p_start_at timestamp with time zone,
  p_end_at timestamp with time zone,
  p_event_id UUID DEFAULT NULL
)
RETURNS TABLE (
  conflicting_event_id UUID,
  conflicting_title text,
  conflicting_start timestamp with time zone,
  conflicting_end timestamp with time zone
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.title,
    e.start_at,
    e.end_at
  FROM calendar_events e
  WHERE e.owner_user_id = p_owner_user_id
    AND (p_event_id IS NULL OR e.id != p_event_id)
    AND (
      (e.start_at, COALESCE(e.end_at, e.start_at + INTERVAL '1 hour')) 
      OVERLAPS 
      (p_start_at, COALESCE(p_end_at, p_start_at + INTERVAL '1 hour'))
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
