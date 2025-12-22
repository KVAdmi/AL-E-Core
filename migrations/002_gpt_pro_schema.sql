-- Migration 002: GPT PRO Schema - Sessions, Files, Memory
-- Execute in Supabase SQL Editor

-- ============================================
-- SESSIONS TABLE (ChatGPT-style sidebar)
-- ============================================
CREATE TABLE IF NOT EXISTS ae_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id text NOT NULL DEFAULT 'default',
    user_id text NOT NULL,
    mode text NOT NULL DEFAULT 'universal',
    title text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    last_message_at timestamptz DEFAULT now(),
    pinned boolean DEFAULT false,
    archived boolean DEFAULT false,
    meta jsonb DEFAULT '{}'::jsonb
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS ae_sessions_user_workspace_idx ON ae_sessions(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS ae_sessions_last_message_idx ON ae_sessions(last_message_at DESC);
CREATE INDEX IF NOT EXISTS ae_sessions_mode_idx ON ae_sessions(mode);

-- ============================================
-- MESSAGES TABLE (linked to sessions)
-- ============================================
CREATE TABLE IF NOT EXISTS ae_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES ae_sessions(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
    content text NOT NULL,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS ae_messages_session_idx ON ae_messages(session_id, created_at);

-- ============================================
-- FILES TABLE (uploads + RAG)
-- ============================================
CREATE TABLE IF NOT EXISTS ae_files (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    session_id uuid REFERENCES ae_sessions(id) ON DELETE SET NULL,
    message_id uuid REFERENCES ae_messages(id) ON DELETE SET NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    storage_path text NOT NULL,
    status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
    extracted_text text,
    created_at timestamptz DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS ae_files_user_idx ON ae_files(user_id);
CREATE INDEX IF NOT EXISTS ae_files_session_idx ON ae_files(session_id);
CREATE INDEX IF NOT EXISTS ae_files_status_idx ON ae_files(status);

-- ============================================
-- FILE CHUNKS (FASE 2 - RAG with embeddings)
-- ============================================
CREATE TABLE IF NOT EXISTS ae_file_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id uuid NOT NULL REFERENCES ae_files(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding vector(1536), -- OpenAI ada-002 dimensions
    created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS ae_file_chunks_file_idx ON ae_file_chunks(file_id, chunk_index);
-- Vector similarity index (requires pgvector extension)
-- CREATE INDEX IF NOT EXISTS ae_file_chunks_embedding_idx ON ae_file_chunks USING ivfflat (embedding vector_cosine_ops);

-- ============================================
-- ENHANCED USER MEMORY 
-- ============================================
-- Update existing table or create if not exists
ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS workspace_id text DEFAULT 'default';
ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS mode text DEFAULT 'universal';
ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS memory_type text DEFAULT 'semantic';
ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- Create index for enhanced queries
CREATE INDEX IF NOT EXISTS assistant_memories_workspace_mode_idx ON assistant_memories(workspace_id, mode, user_id);

-- ============================================
-- REQUEST TRACKING (observability/costs)
-- ============================================
CREATE TABLE IF NOT EXISTS ae_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES ae_sessions(id) ON DELETE SET NULL,
    user_id text NOT NULL,
    endpoint text NOT NULL,
    model text,
    tokens_in integer,
    tokens_out integer,
    latency_ms integer,
    cost_usd decimal(10,6),
    status_code integer,
    error_message text,
    created_at timestamptz DEFAULT now(),
    meta jsonb DEFAULT '{}'::jsonb
);

-- Indexes for analytics
CREATE INDEX IF NOT EXISTS ae_requests_user_date_idx ON ae_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS ae_requests_session_idx ON ae_requests(session_id);
CREATE INDEX IF NOT EXISTS ae_requests_endpoint_idx ON ae_requests(endpoint);

-- ============================================
-- ACTIONS TABLE (controllable actions)
-- ============================================
CREATE TABLE IF NOT EXISTS ae_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES ae_sessions(id) ON DELETE CASCADE,
    user_id text NOT NULL,
    action_type text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    result jsonb,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    created_at timestamptz DEFAULT now(),
    completed_at timestamptz
);

-- Indexes
CREATE INDEX IF NOT EXISTS ae_actions_session_idx ON ae_actions(session_id);
CREATE INDEX IF NOT EXISTS ae_actions_user_type_idx ON ae_actions(user_id, action_type);

-- ============================================
-- RLS POLICIES (Row Level Security)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE ae_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_file_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_actions ENABLE ROW LEVEL SECURITY;

-- Policies for sessions (user can only access their own)
CREATE POLICY "Users can access their own sessions" ON ae_sessions
    FOR ALL USING (user_id = current_setting('request.jwt.claims')::json->>'user_id');

-- Policies for messages (via session ownership)
CREATE POLICY "Users can access messages from their sessions" ON ae_messages
    FOR ALL USING (session_id IN (
        SELECT id FROM ae_sessions WHERE user_id = current_setting('request.jwt.claims')::json->>'user_id'
    ));

-- Policies for files (user ownership)
CREATE POLICY "Users can access their own files" ON ae_files
    FOR ALL USING (user_id = current_setting('request.jwt.claims')::json->>'user_id');

-- Similar policies for other tables...

-- ============================================
-- FUNCTIONS AND TRIGGERS
-- ============================================

-- Function to update session updated_at and last_message_at
CREATE OR REPLACE FUNCTION update_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE ae_sessions 
    SET updated_at = now(), last_message_at = now()
    WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on new messages
DROP TRIGGER IF EXISTS update_session_on_message ON ae_messages;
CREATE TRIGGER update_session_on_message
    AFTER INSERT ON ae_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_session_timestamp();

-- Function to auto-generate session title from first message
CREATE OR REPLACE FUNCTION generate_session_title()
RETURNS TRIGGER AS $$
BEGIN
    -- Only for first user message and if title is empty
    IF NEW.role = 'user' AND (
        SELECT title IS NULL OR title = '' 
        FROM ae_sessions 
        WHERE id = NEW.session_id
    ) THEN
        UPDATE ae_sessions 
        SET title = LEFT(NEW.content, 50) || CASE WHEN LENGTH(NEW.content) > 50 THEN '...' ELSE '' END
        WHERE id = NEW.session_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto-title generation
DROP TRIGGER IF EXISTS auto_generate_title ON ae_messages;
CREATE TRIGGER auto_generate_title
    AFTER INSERT ON ae_messages
    FOR EACH ROW
    EXECUTE FUNCTION generate_session_title();

COMMENT ON TABLE ae_sessions IS 'ChatGPT-style conversation sessions';
COMMENT ON TABLE ae_messages IS 'Messages within sessions';
COMMENT ON TABLE ae_files IS 'Uploaded files for RAG and document processing';
COMMENT ON TABLE ae_file_chunks IS 'Chunked content for vector search (FASE 2)';
COMMENT ON TABLE ae_requests IS 'Request tracking for observability and cost control';
COMMENT ON TABLE ae_actions IS 'Executable actions triggered by AI responses';