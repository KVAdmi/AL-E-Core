-- Migration 023: Módulo de Reuniones (Altavoz Presencial + Upload)
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
    -- 'recording' -> 'processing' -> 'transcribing' -> 'generating_minutes' -> 'done' -> 'error'
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

CREATE INDEX idx_meetings_owner ON meetings(owner_user_id);
CREATE INDEX idx_meetings_status ON meetings(status);
CREATE INDEX idx_meetings_happened_at ON meetings(happened_at DESC);
CREATE INDEX idx_meetings_created_at ON meetings(created_at DESC);

COMMENT ON TABLE meetings IS 'Reuniones grabadas (modo altavoz presencial o archivo subido)';
COMMENT ON COLUMN meetings.mode IS 'live: grabación presencial por chunks | upload: archivo completo subido';
COMMENT ON COLUMN meetings.status IS 'recording -> processing -> transcribing -> generating_minutes -> done | error';


-- ========================================
-- 2. TABLA: meeting_assets
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
    chunk_index INTEGER, -- Para ordenar chunks en modo live
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meeting_assets_meeting ON meeting_assets(meeting_id);
CREATE INDEX idx_meeting_assets_type ON meeting_assets(asset_type);
CREATE INDEX idx_meeting_assets_chunk_index ON meeting_assets(chunk_index) WHERE asset_type = 'chunk';

COMMENT ON TABLE meeting_assets IS 'Assets de audio/video almacenados en S3';
COMMENT ON COLUMN meeting_assets.asset_type IS 'chunk: parcial live | final: ensamblado | original: archivo subido completo';


-- ========================================
-- 3. TABLA: meeting_transcripts
-- ========================================
CREATE TABLE IF NOT EXISTS meeting_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    
    -- Contenido
    language VARCHAR(10) DEFAULT 'es',
    raw_json JSONB NOT NULL, -- Segments con timestamps: [{start, end, text, speaker}]
    text TEXT NOT NULL, -- Transcript completo en texto plano
    
    -- Status
    is_final BOOLEAN DEFAULT false, -- false: parcial (live), true: final
    
    -- Metadata
    processing_time_sec NUMERIC(10,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meeting_transcripts_meeting ON meeting_transcripts(meeting_id);
CREATE INDEX idx_meeting_transcripts_final ON meeting_transcripts(is_final);

COMMENT ON TABLE meeting_transcripts IS 'Transcripciones de reuniones con timestamps y diarización';
COMMENT ON COLUMN meeting_transcripts.raw_json IS 'Array de segments: [{start, end, text, speaker}]';


-- ========================================
-- 4. TABLA: meeting_minutes
-- ========================================
CREATE TABLE IF NOT EXISTS meeting_minutes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    
    -- Contenido estructurado (output ejecutivo)
    summary TEXT NOT NULL, -- Resumen ejecutivo (5-10 bullets)
    
    -- Estructura JSON para cada sección
    agreements_json JSONB DEFAULT '[]'::jsonb, -- [{text, owner, deadline, priority}]
    tasks_json JSONB DEFAULT '[]'::jsonb, -- [{text, responsible, priority, status}]
    decisions_json JSONB DEFAULT '[]'::jsonb, -- [{text, impact, rationale}]
    risks_json JSONB DEFAULT '[]'::jsonb, -- [{text, severity, mitigation}]
    next_steps_json JSONB DEFAULT '[]'::jsonb, -- [{text, owner, timeline}]
    
    -- Metadata
    generated_by VARCHAR(50), -- 'groq', 'openai', etc
    processing_time_sec NUMERIC(10,2),
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meeting_minutes_meeting ON meeting_minutes(meeting_id);

COMMENT ON TABLE meeting_minutes IS 'Minutas ejecutivas generadas por LLM';
COMMENT ON COLUMN meeting_minutes.summary IS 'Resumen ejecutivo (5-10 bullets)';
COMMENT ON COLUMN meeting_minutes.agreements_json IS 'Acuerdos con owner, deadline, prioridad';
COMMENT ON COLUMN meeting_minutes.tasks_json IS 'Tareas/pendientes con responsable';


-- ========================================
-- 5. TABLA: meeting_notifications
-- ========================================
CREATE TABLE IF NOT EXISTS meeting_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    
    -- Canal: 'email', 'telegram'
    channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'telegram')),
    
    -- Status: 'pending', 'sent', 'failed'
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    error_message TEXT,
    
    -- Metadata
    recipient VARCHAR(500), -- Email o Telegram chat_id
    sent_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_meeting_notifications_meeting ON meeting_notifications(meeting_id);
CREATE INDEX idx_meeting_notifications_status ON meeting_notifications(status);

COMMENT ON TABLE meeting_notifications IS 'Historial de envíos de minutas por email/telegram';


-- ========================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ========================================
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_minutes ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_notifications ENABLE ROW LEVEL SECURITY;

-- Policy: Owner can see their own meetings
CREATE POLICY meetings_owner_policy ON meetings
    FOR ALL USING (auth.uid() = owner_user_id);

CREATE POLICY meeting_assets_owner_policy ON meeting_assets
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM meetings 
            WHERE meetings.id = meeting_assets.meeting_id 
            AND meetings.owner_user_id = auth.uid()
        )
    );

CREATE POLICY meeting_transcripts_owner_policy ON meeting_transcripts
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM meetings 
            WHERE meetings.id = meeting_transcripts.meeting_id 
            AND meetings.owner_user_id = auth.uid()
        )
    );

CREATE POLICY meeting_minutes_owner_policy ON meeting_minutes
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM meetings 
            WHERE meetings.id = meeting_minutes.meeting_id 
            AND meetings.owner_user_id = auth.uid()
        )
    );

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

-- Función: Actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_meetings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meetings_updated_at_trigger
    BEFORE UPDATE ON meetings
    FOR EACH ROW
    EXECUTE FUNCTION update_meetings_updated_at();


-- Función: Obtener transcript completo de un meeting
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


-- Función: Obtener minuta completa
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


-- ========================================
-- 8. INTEGRACIÓN CON RAG (knowledge_chunks)
-- ========================================
-- Nota: Los transcripts y minutas se ingestan en knowledge_chunks
-- con source_type = 'meeting' y metadata JSON con meetingId, date, participants

-- Función helper para buscar meetings en RAG
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
    -- Esta función se implementará cuando se integre con embedding search
    -- Por ahora retorna vacío
    RETURN QUERY
    SELECT 
        kc.id as chunk_id,
        kc.metadata->>'meetingId' as meeting_id,
        kc.content,
        0.0::FLOAT as similarity
    FROM knowledge_chunks kc
    WHERE kc.user_id = user_id_param
    AND kc.source_type = 'meeting'
    LIMIT 0; -- Placeholder
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ========================================
-- 9. VIEWS ÚTILES
-- ========================================

-- View: Meetings con status completo
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
    
    -- Count de assets
    COUNT(DISTINCT ma.id) as asset_count,
    
    -- Transcript disponible
    EXISTS(SELECT 1 FROM meeting_transcripts mt WHERE mt.meeting_id = m.id AND mt.is_final = true) as has_transcript,
    
    -- Minuta disponible
    EXISTS(SELECT 1 FROM meeting_minutes mm WHERE mm.meeting_id = m.id) as has_minutes,
    
    -- Notificaciones enviadas
    (SELECT COUNT(*) FROM meeting_notifications mn WHERE mn.meeting_id = m.id AND mn.status = 'sent') as notifications_sent

FROM meetings m
LEFT JOIN meeting_assets ma ON ma.meeting_id = m.id
GROUP BY m.id;

COMMENT ON VIEW meetings_with_status IS 'Vista resumen de meetings con contadores y flags';


-- ========================================
-- FIN MIGRACIÓN 023
-- ========================================
