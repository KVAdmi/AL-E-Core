-- Migration: notification_jobs table
-- Created: 2026-01-07
-- Description: Sistema de notificaciones programadas (Telegram, Email, Push)

CREATE TABLE IF NOT EXISTS notification_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Tipo de notificación
    type VARCHAR(100) NOT NULL, -- 'event_reminder', 'task_due', 'custom', etc.
    
    -- Canal
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('telegram', 'email', 'push')),
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    
    -- Cuándo ejecutar
    run_at TIMESTAMPTZ NOT NULL,
    
    -- Payload (datos específicos de la notificación)
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Error tracking
    last_error TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_notification_jobs_owner ON notification_jobs(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_status ON notification_jobs(status);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_run_at ON notification_jobs(run_at);
CREATE INDEX IF NOT EXISTS idx_notification_jobs_status_run_at ON notification_jobs(status, run_at) 
    WHERE status = 'pending';

-- RLS
ALTER TABLE notification_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_jobs_owner_policy ON notification_jobs;
CREATE POLICY notification_jobs_owner_policy ON notification_jobs
    FOR ALL USING (auth.uid() = owner_user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_notification_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS notification_jobs_updated_at_trigger ON notification_jobs;
CREATE TRIGGER notification_jobs_updated_at_trigger
    BEFORE UPDATE ON notification_jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_notification_jobs_updated_at();

-- Comentarios
COMMENT ON TABLE notification_jobs IS 'Notificaciones programadas (event reminders, task due dates, etc.)';
COMMENT ON COLUMN notification_jobs.type IS 'Tipo: event_reminder, task_due, custom, etc.';
COMMENT ON COLUMN notification_jobs.channel IS 'Canal: telegram, email, push';
COMMENT ON COLUMN notification_jobs.status IS 'Estado: pending, sent, failed, cancelled';
COMMENT ON COLUMN notification_jobs.run_at IS 'Fecha/hora en que debe ejecutarse';
COMMENT ON COLUMN notification_jobs.payload IS 'Datos específicos de la notificación (título, descripción, etc.)';

-- Refresh schema cache
NOTIFY pgrst, 'reload schema';
