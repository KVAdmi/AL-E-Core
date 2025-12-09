-- Tabla de memoria persistente para AL-E Core
-- Ejecutar en Supabase SQL Editor

CREATE TABLE assistant_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id VARCHAR(255),
    user_id VARCHAR(255),
    mode VARCHAR(50) NOT NULL CHECK (mode IN ('universal', 'legal', 'medico', 'seguros', 'contabilidad')),
    type VARCHAR(50) NOT NULL CHECK (type IN ('profile', 'preference', 'project', 'decision', 'fact')),
    summary TEXT NOT NULL,
    importance INTEGER DEFAULT 3 CHECK (importance >= 1 AND importance <= 5),
    source VARCHAR(20) DEFAULT 'auto' CHECK (source IN ('manual', 'auto', 'system')),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Índices para optimizar consultas frecuentes
CREATE INDEX idx_assistant_memories_workspace ON assistant_memories(workspace_id);
CREATE INDEX idx_assistant_memories_user ON assistant_memories(user_id);
CREATE INDEX idx_assistant_memories_mode ON assistant_memories(mode);
CREATE INDEX idx_assistant_memories_importance ON assistant_memories(importance DESC, created_at DESC);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_assistant_memories_updated_at
    BEFORE UPDATE ON assistant_memories
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column();

-- Política RLS (Row Level Security) - opcional, ajustar según necesidades
ALTER TABLE assistant_memories ENABLE ROW LEVEL SECURITY;

-- Política básica: permitir todas las operaciones para usuarios autenticados
CREATE POLICY "Permitir acceso a memorias para usuarios autenticados"
ON assistant_memories
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);