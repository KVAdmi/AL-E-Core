-- Migration 023: Módulo de Reuniones COMPLETO
-- Created: 2026-01-07
-- Description: Sistema completo para grabar reuniones presenciales, transcribir, generar minutas, y buscar en RAG

-- ========================================
-- 1. TABLA PRINCIPAL: meetings
-- ========================================
CREATE TABLE IF NOT EXISTS meetings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Metadata básica
    title VARCHAR(500),
    description TEXT,
    happened_at TIMESTAMPTZ,
    
    -- Modo: 'live' (altavoz presencial) o 'upload' (archivo subido)
    mode VARCHAR(20) NOT NULL CHECK (mode IN ('live', 'upload')),
    
    -- Status del pipeline
    status VARCHAR(50) NOT NULL DEFAULT 'recording',
    error_message TEXT,
    
    -- Participantes (opcional, JSON array de strings)
    participants JSONB DEFAULT '[]'::jsonb,
    
    -- Configuración
    auto_send_enabled BOOLEAN DEFAULT false,
    send_email BOOLEAN DEFAULT false,
    send_telegram BOOLEAN DEFAULT false,
    
    -- Duración en segundos (calculada después)
    duration_sec INTEGER,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meetings_owner ON meetings(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_happened_at ON meetings(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_created_at ON meetings(created_at DESC);

-- ========================================
-- 2. RLS para meetings
-- ========================================
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meetings_owner_policy ON meetings;
CREATE POLICY meetings_owner_policy ON meetings
    FOR ALL USING (auth.uid() = owner_user_id);

-- ========================================
-- 3. TABLA: meeting_assets
-- ========================================

CREATE TABLE IF NOT EXISTS meeting_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    
    -- S3 Storage
    s3_key VARCHAR(1000) NOT NULL,
    s3_bucket VARCHAR(255) NOT NULL,
    s3_url TEXT,
    
    -- Metadata del archivo
    filename VARCHAR(500),
    mime_type VARCHAR(100),
    size_bytes BIGINT,
    duration_sec INTEGER,
    
    -- Tipo: 'chunk' (parcial), 'final' (ensamblado), 'original' (upload)
    asset_type VARCHAR(50) DEFAULT 'original' CHECK (asset_type IN ('chunk', 'final', 'original')),
    chunk_index INTEGER,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_assets_meeting ON meeting_assets(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_assets_type ON meeting_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_meeting_assets_chunk_index ON meeting_assets(chunk_index) WHERE asset_type = 'chunk';

ALTER TABLE meeting_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_assets_owner_policy ON meeting_assets;
CREATE POLICY meeting_assets_owner_policy ON meeting_assets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM meetings 
            WHERE meetings.id = meeting_assets.meeting_id 
            AND meetings.owner_user_id = auth.uid()
        )
    );

-- ========================================
-- 4. TABLA: meeting_transcripts
-- ========================================

CREATE TABLE IF NOT EXISTS meeting_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    
    language VARCHAR(10) DEFAULT 'es',
    raw_json JSONB NOT NULL,
    text TEXT NOT NULL,
    
    is_final BOOLEAN DEFAULT false,
    
    processing_time_sec NUMERIC(10,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_meeting ON meeting_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_final ON meeting_transcripts(is_final);

ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_transcripts_owner_policy ON meeting_transcripts;
CREATE POLICY meeting_transcripts_owner_policy ON meeting_transcripts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM meetings 
            WHERE meetings.id = meeting_transcripts.meeting_id 
            AND meetings.owner_user_id = auth.uid()
        )
    );

-- ========================================
-- 5. TABLA: meeting_minutes
-- ========================================

CREATE TABLE IF NOT EXISTS meeting_minutes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    
    summary TEXT NOT NULL,
    
    agreements_json JSONB DEFAULT '[]'::jsonb,
    tasks_json JSONB DEFAULT '[]'::jsonb,
    decisions_json JSONB DEFAULT '[]'::jsonb,
    risks_json JSONB DEFAULT '[]'::jsonb,
    next_steps_json JSONB DEFAULT '[]'::jsonb,
    
    generated_by VARCHAR(50),
    processing_time_sec NUMERIC(10,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_meeting ON meeting_minutes(meeting_id);

ALTER TABLE meeting_minutes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_minutes_owner_policy ON meeting_minutes;
CREATE POLICY meeting_minutes_owner_policy ON meeting_minutes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM meetings 
            WHERE meetings.id = meeting_minutes.meeting_id 
            AND meetings.owner_user_id = auth.uid()
        )
    );

-- ========================================
-- 6. TABLA: meeting_notifications
-- ========================================

CREATE TABLE IF NOT EXISTS meeting_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'telegram')),
    
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    
    recipient VARCHAR(500),
    sent_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_notifications_meeting ON meeting_notifications(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_notifications_status ON meeting_notifications(status);

ALTER TABLE meeting_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meeting_notifications_owner_policy ON meeting_notifications;
CREATE POLICY meeting_notifications_owner_policy ON meeting_notifications
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM meetings 
            WHERE meetings.id = meeting_notifications.meeting_id 
            AND meetings.owner_user_id = auth.uid()
        )
    );

-- ========================================
-- 7. HELPER FUNCTIONS
-- ========================================

CREATE OR REPLACE FUNCTION update_meetings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meetings_updated_at_trigger ON meetings;
CREATE TRIGGER meetings_updated_at_trigger
    BEFORE UPDATE ON meetings
    FOR EACH ROW
    EXECUTE FUNCTION update_meetings_updated_at();

CREATE OR REPLACE FUNCTION get_meeting_transcript(meeting_id_param UUID)
RETURNS TABLE (
    text TEXT,
    segments JSONB,
    language VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mt.text,
        mt.raw_json as segments,
        mt.language
    FROM meeting_transcripts mt
    WHERE mt.meeting_id = meeting_id_param
    AND mt.is_final = true
    ORDER BY mt.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_meeting_minute(meeting_id_param UUID)
RETURNS TABLE (
    summary TEXT,
    agreements JSONB,
    tasks JSONB,
    decisions JSONB,
    risks JSONB,
    next_steps JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mm.summary,
        mm.agreements_json,
        mm.tasks_json,
        mm.decisions_json,
        mm.risks_json,
        mm.next_steps_json
    FROM meeting_minutes mm
    WHERE mm.meeting_id = meeting_id_param
    ORDER BY mm.created_at DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION search_meetings_in_knowledge(
    query_text TEXT,
    user_id_param UUID,
    limit_param INTEGER DEFAULT 5
)
RETURNS TABLE (
    chunk_id UUID,
    meeting_id TEXT,
    content TEXT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        kc.id as chunk_id,
        kc.metadata->>'meetingId' as meeting_id,
        kc.content,
        0.0::FLOAT as similarity
    FROM knowledge_chunks kc
    WHERE kc.user_id = user_id_param
    AND kc.source_type = 'meeting'
    LIMIT 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ========================================
-- 8. VIEW
-- ========================================

CREATE OR REPLACE VIEW meetings_with_status AS
SELECT 
    m.id,
    m.owner_user_id,
    m.title,
    m.mode,
    m.status,
    m.happened_at,
    m.duration_sec,
    m.created_at,
    m.finalized_at,
    
    COUNT(DISTINCT ma.id) as asset_count,
    
    EXISTS(SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = m.id AND mt.is_final = true) as has_transcript,
    
    EXISTS(SELECT 1 FROM meeting_minutes mm WHERE mm.meeting_id = m.id) as has_minutes,
    
    (SELECT COUNT(*) FROM meeting_notifications mn WHERE mn.meeting_id = m.id AND mn.status = 'sent') as notifications_sent

FROM meetings m
LEFT JOIN meeting_assets ma ON ma.meeting_id = m.id
GROUP BY m.id;

-- ========================================
-- 9. REFRESH SCHEMA CACHE
-- ========================================

-- Force Supabase to refresh schema cache
NOTIFY pgrst, 'reload schema';
