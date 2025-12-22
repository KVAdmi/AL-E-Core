-- Migration 003: Update existing schema to GPT PRO
-- Execute in Supabase SQL Editor

-- ============================================
-- UPDATE ae_sessions to match GPT PRO schema
-- ============================================
ALTER TABLE ae_sessions 
ADD COLUMN IF NOT EXISTS workspace_id text DEFAULT 'default',
ADD COLUMN IF NOT EXISTS mode text DEFAULT 'universal',
ADD COLUMN IF NOT EXISTS title text,
ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS last_message_at timestamptz DEFAULT now(),
ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- Update user_id to text type if needed
ALTER TABLE ae_sessions ALTER COLUMN user_id TYPE text;

-- ============================================
-- UPDATE ae_messages to match GPT PRO schema
-- ============================================
ALTER TABLE ae_messages 
ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- Remove columns specific to emotional processing if they exist
ALTER TABLE ae_messages DROP COLUMN IF EXISTS emotional_state;
ALTER TABLE ae_messages DROP COLUMN IF EXISTS risk_level;

-- ============================================
-- CREATE NEW TABLES FOR GPT PRO
-- ============================================

-- FILES TABLE (uploads + RAG)
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

-- FILE CHUNKS (FASE 2 - RAG with embeddings)
CREATE TABLE IF NOT EXISTS ae_file_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id uuid NOT NULL REFERENCES ae_files(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    embedding vector(1536), -- OpenAI ada-002 dimensions (requires pgvector)
    created_at timestamptz DEFAULT now()
);

-- REQUEST TRACKING (observability/costs)
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

-- ACTIONS TABLE (controllable actions)
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

-- ============================================
-- UPDATE assistant_memories (already exists)
-- ============================================
-- Add missing columns if they don't exist
ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS memory_type text DEFAULT 'semantic';
ALTER TABLE assistant_memories ADD COLUMN IF NOT EXISTS meta jsonb DEFAULT '{}'::jsonb;

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Sessions indexes
CREATE INDEX IF NOT EXISTS ae_sessions_user_workspace_idx ON ae_sessions(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS ae_sessions_last_message_idx ON ae_sessions(last_message_at DESC);
CREATE INDEX IF NOT EXISTS ae_sessions_mode_idx ON ae_sessions(mode);

-- Messages indexes
CREATE INDEX IF NOT EXISTS ae_messages_session_idx ON ae_messages(session_id, created_at);

-- Files indexes
CREATE INDEX IF NOT EXISTS ae_files_user_idx ON ae_files(user_id);
CREATE INDEX IF NOT EXISTS ae_files_session_idx ON ae_files(session_id);
CREATE INDEX IF NOT EXISTS ae_files_status_idx ON ae_files(status);

-- File chunks indexes
CREATE INDEX IF NOT EXISTS ae_file_chunks_file_idx ON ae_file_chunks(file_id, chunk_index);

-- Requests indexes
CREATE INDEX IF NOT EXISTS ae_requests_user_date_idx ON ae_requests(user_id, created_at);
CREATE INDEX IF NOT EXISTS ae_requests_session_idx ON ae_requests(session_id);
CREATE INDEX IF NOT EXISTS ae_requests_endpoint_idx ON ae_requests(endpoint);

-- Actions indexes
CREATE INDEX IF NOT EXISTS ae_actions_session_idx ON ae_actions(session_id);
CREATE INDEX IF NOT EXISTS ae_actions_user_type_idx ON ae_actions(user_id, action_type);

-- Assistant memories enhanced index
CREATE INDEX IF NOT EXISTS assistant_memories_workspace_mode_idx ON assistant_memories(workspace_id, mode, user_id);

-- ============================================
-- FUNCTIONS AND TRIGGERS
-- ============================================

-- Function to update session timestamp
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

-- Function to auto-generate session title
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

-- ============================================
-- RLS POLICIES (Row Level Security)
-- ============================================

-- Enable RLS on new tables
ALTER TABLE ae_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_file_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ae_actions ENABLE ROW LEVEL SECURITY;

-- Note: We don't add RLS policies here as we're using service role key
-- In production, you would add appropriate RLS policies for user access

-- ============================================
-- CLEANUP old tables if needed
-- ============================================

-- Drop emotional events table if it exists (not needed for GPT PRO)
DROP TABLE IF EXISTS ae_emotional_events;

-- Update ae_user_memory to use text user_id
ALTER TABLE ae_user_memory ALTER COLUMN user_id TYPE text;

COMMENT ON TABLE ae_sessions IS 'Updated for GPT PRO - ChatGPT-style conversation sessions';
COMMENT ON TABLE ae_messages IS 'Updated for GPT PRO - Messages within sessions with metadata';
COMMENT ON TABLE ae_files IS 'GPT PRO - Uploaded files for RAG and document processing';
COMMENT ON TABLE ae_requests IS 'GPT PRO - Request tracking for observability and cost control';
COMMENT ON TABLE ae_actions IS 'GPT PRO - Executable actions triggered by AI responses';