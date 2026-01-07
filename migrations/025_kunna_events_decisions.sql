-- Migration 025: KUNNA Events & Decisions System
-- Created: 2026-01-07
-- Description: Multi-app event processing system (KUNNA, AL-Eon, etc.)

-- ========================================
-- 1. TABLA: ae_events
-- ========================================
CREATE TABLE IF NOT EXISTS ae_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ae_events_workspace ON ae_events(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ae_events_app ON ae_events(app_id);
CREATE INDEX IF NOT EXISTS idx_ae_events_user ON ae_events(user_id);
CREATE INDEX IF NOT EXISTS idx_ae_events_type ON ae_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ae_events_timestamp ON ae_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_ae_events_workspace_user ON ae_events(workspace_id, user_id);

-- Comentarios
COMMENT ON TABLE ae_events IS 'Eventos recibidos de apps multi-tenant (KUNNA, etc.)';
COMMENT ON COLUMN ae_events.workspace_id IS 'ID del workspace/organización';
COMMENT ON COLUMN ae_events.app_id IS 'ID de la app origen: kunna, aleon, etc.';
COMMENT ON COLUMN ae_events.user_id IS 'ID del usuario en el workspace';
COMMENT ON COLUMN ae_events.event_type IS 'Tipo: checkin_failed, inactivity, diary_entry, state_change, sos_manual';
COMMENT ON COLUMN ae_events.metadata IS 'Datos adicionales: source, risk_level, text, duration_minutes, location, device';

-- ========================================
-- 2. TABLA: ae_decisions
-- ========================================
CREATE TABLE IF NOT EXISTS ae_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    event_id UUID,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    FOREIGN KEY (event_id) REFERENCES ae_events(id) ON DELETE SET NULL
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_ae_decisions_workspace ON ae_decisions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ae_decisions_app ON ae_decisions(app_id);
CREATE INDEX IF NOT EXISTS idx_ae_decisions_user ON ae_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_ae_decisions_event ON ae_decisions(event_id);
CREATE INDEX IF NOT EXISTS idx_ae_decisions_created ON ae_decisions(created_at DESC);

-- Comentarios
COMMENT ON TABLE ae_decisions IS 'Decisiones tomadas y acciones recomendadas por el rule engine';
COMMENT ON COLUMN ae_decisions.event_id IS 'ID del evento que disparó esta decisión (nullable)';
COMMENT ON COLUMN ae_decisions.actions IS 'Array de acciones: [{type, priority, reason, payload}]';

-- ========================================
-- 3. RLS (DESHABILITADO para service-to-service auth)
-- ========================================
-- Nota: Como estas tablas se acceden con SERVICE_TOKEN (no user JWT),
-- NO habilitamos RLS. El auth se hace a nivel de API middleware.

-- ========================================
-- 4. REFRESH SCHEMA CACHE
-- ========================================
NOTIFY pgrst, 'reload schema';
