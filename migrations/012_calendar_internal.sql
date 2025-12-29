-- =====================================================
-- MIGRATION 012: CALENDAR INTERNO
-- =====================================================
-- Sistema de calendario 100% interno
-- Elimina dependencia de Google Calendar API
-- =====================================================

-- =====================================================
-- 1) CALENDAR EVENTS
-- =====================================================
CREATE TABLE IF NOT EXISTS calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  
  title TEXT NOT NULL,
  description TEXT,
  
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  
  location TEXT,
  attendees_json JSONB DEFAULT '[]'::jsonb, -- [{ email, name, status: 'pending'|'accepted'|'declined' }]
  
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_calendar_events_owner ON calendar_events(owner_user_id);
CREATE INDEX idx_calendar_events_start ON calendar_events(start_at);
CREATE INDEX idx_calendar_events_status ON calendar_events(status);
CREATE INDEX idx_calendar_events_owner_range ON calendar_events(owner_user_id, start_at, end_at);

-- RLS
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_events_owner_policy ON calendar_events
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- 2) NOTIFICATION JOBS
-- =====================================================
CREATE TABLE IF NOT EXISTS notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  
  type TEXT NOT NULL, -- 'event_reminder', 'email_notification', etc
  payload JSONB NOT NULL, -- Datos del evento/notificación
  
  run_at TIMESTAMPTZ NOT NULL, -- Cuándo debe ejecutarse
  channel TEXT NOT NULL CHECK (channel IN ('telegram', 'email', 'push')),
  
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  last_error TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX idx_notification_jobs_owner ON notification_jobs(owner_user_id);
CREATE INDEX idx_notification_jobs_status ON notification_jobs(status);
CREATE INDEX idx_notification_jobs_run_at ON notification_jobs(run_at) WHERE status = 'pending';
CREATE INDEX idx_notification_jobs_pending ON notification_jobs(status, run_at) WHERE status = 'pending';

-- RLS
ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_jobs_owner_policy ON notification_jobs
  FOR ALL
  USING (owner_user_id = auth.uid());

-- =====================================================
-- HELPER: Crear recordatorios automáticos
-- =====================================================

CREATE OR REPLACE FUNCTION create_event_reminders()
RETURNS TRIGGER AS $$
BEGIN
  -- Recordatorio 1 hora antes (solo Telegram por ahora)
  IF NEW.start_at > NOW() + INTERVAL '1 hour' THEN
    INSERT INTO notification_jobs (
      owner_user_id,
      type,
      payload,
      run_at,
      channel,
      status
    ) VALUES (
      NEW.owner_user_id,
      'event_reminder',
      jsonb_build_object(
        'event_id', NEW.id,
        'title', NEW.title,
        'start_at', NEW.start_at,
        'location', NEW.location
      ),
      NEW.start_at - INTERVAL '1 hour',
      'telegram',
      'pending'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger
DROP TRIGGER IF EXISTS trigger_create_event_reminders ON calendar_events;
CREATE TRIGGER trigger_create_event_reminders
  AFTER INSERT ON calendar_events
  FOR EACH ROW
  WHEN (NEW.status = 'scheduled')
  EXECUTE FUNCTION create_event_reminders();

-- =====================================================
-- COMENTARIOS
-- =====================================================

COMMENT ON TABLE calendar_events IS 'Eventos de calendario interno de AL-E';
COMMENT ON COLUMN calendar_events.timezone IS 'Timezone del evento (default: America/Mexico_City)';
COMMENT ON TABLE notification_jobs IS 'Jobs de notificaciones pendientes (worker las procesa)';
