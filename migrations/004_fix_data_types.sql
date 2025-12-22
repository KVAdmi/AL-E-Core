-- Migración 004: Corrección de tipos de datos para compatibilidad GPT PRO
-- Esta migración corrige los tipos de datos de las tablas existentes

-- 1. Primero eliminamos las foreign keys que causan conflicto
ALTER TABLE public.ae_sessions DROP CONSTRAINT IF EXISTS ae_sessions_user_id_fkey;
ALTER TABLE public.ae_messages DROP CONSTRAINT IF EXISTS ae_messages_session_id_fkey;
ALTER TABLE public.ae_emotional_events DROP CONSTRAINT IF EXISTS ae_emotional_events_session_id_fkey;
ALTER TABLE public.ae_emotional_events DROP CONSTRAINT IF EXISTS ae_emotional_events_message_id_fkey;
ALTER TABLE public.ae_user_memory DROP CONSTRAINT IF EXISTS ae_user_memory_user_id_fkey;

-- 2. Actualizamos ae_sessions para ser compatible con GPT PRO
ALTER TABLE public.ae_sessions 
    ADD COLUMN IF NOT EXISTS title text,
    ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now(),
    ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS total_messages integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_tokens integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS estimated_cost numeric(10,4) DEFAULT 0;

-- Cambiar user_id a text si es necesario (para compatibilidad con auth externos)
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'ae_sessions' AND column_name = 'user_id' AND data_type = 'uuid') THEN
        ALTER TABLE public.ae_sessions ALTER COLUMN user_id TYPE text USING user_id::text;
    END IF;
END $$;

-- 3. Actualizamos ae_messages para ser compatible con GPT PRO  
ALTER TABLE public.ae_messages 
    ADD COLUMN IF NOT EXISTS tokens integer DEFAULT 0,
    ADD COLUMN IF NOT EXISTS cost numeric(10,4) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- 4. Creamos las tablas faltantes del esquema GPT PRO

-- Tabla de archivos
CREATE TABLE IF NOT EXISTS public.ae_files (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid REFERENCES public.ae_sessions(id) ON DELETE CASCADE,
    name text NOT NULL,
    type text NOT NULL,
    size bigint NOT NULL,
    url text NOT NULL,
    upload_date timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb
);

-- Tabla de chunks para RAG
CREATE TABLE IF NOT EXISTS public.ae_chunks (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    file_id uuid REFERENCES public.ae_files(id) ON DELETE CASCADE,
    content text NOT NULL,
    embedding vector(1536),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- Tabla de memoria a largo plazo
CREATE TABLE IF NOT EXISTS public.ae_memory (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid REFERENCES public.ae_sessions(id) ON DELETE CASCADE,
    type text NOT NULL, -- 'fact', 'preference', 'context'
    content text NOT NULL,
    importance numeric(3,2) DEFAULT 0.5,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Tabla de acciones ejecutadas
CREATE TABLE IF NOT EXISTS public.ae_actions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid REFERENCES public.ae_sessions(id) ON DELETE CASCADE,
    message_id uuid REFERENCES public.ae_messages(id) ON DELETE CASCADE,
    action_type text NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb,
    result jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);

-- Tabla de requests para analytics
CREATE TABLE IF NOT EXISTS public.ae_requests (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id uuid REFERENCES public.ae_sessions(id) ON DELETE CASCADE,
    ip_address text,
    user_agent text,
    endpoint text NOT NULL,
    method text NOT NULL,
    status_code integer,
    response_time integer, -- en ms
    tokens_used integer DEFAULT 0,
    cost numeric(10,4) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb
);

-- 5. Creamos índices para optimización
CREATE INDEX IF NOT EXISTS idx_ae_sessions_user_id ON public.ae_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ae_sessions_created_at ON public.ae_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_ae_messages_session_id ON public.ae_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_ae_messages_created_at ON public.ae_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_ae_files_session_id ON public.ae_files(session_id);
CREATE INDEX IF NOT EXISTS idx_ae_chunks_file_id ON public.ae_chunks(file_id);
CREATE INDEX IF NOT EXISTS idx_ae_memory_session_id ON public.ae_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_ae_actions_session_id ON public.ae_actions(session_id);
CREATE INDEX IF NOT EXISTS idx_ae_requests_session_id ON public.ae_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_ae_requests_created_at ON public.ae_requests(created_at);

-- 6. Triggers para auto-actualización de timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Aplicar trigger a las tablas que lo necesiten
DROP TRIGGER IF EXISTS update_ae_sessions_updated_at ON public.ae_sessions;
CREATE TRIGGER update_ae_sessions_updated_at 
    BEFORE UPDATE ON public.ae_sessions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ae_messages_updated_at ON public.ae_messages;
CREATE TRIGGER update_ae_messages_updated_at 
    BEFORE UPDATE ON public.ae_messages 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_ae_memory_updated_at ON public.ae_memory;
CREATE TRIGGER update_ae_memory_updated_at 
    BEFORE UPDATE ON public.ae_memory 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Función para generar títulos automáticos de sesiones
CREATE OR REPLACE FUNCTION generate_session_title(session_uuid uuid)
RETURNS text AS $$
DECLARE
    first_message text;
    title text;
BEGIN
    -- Obtener el primer mensaje del usuario
    SELECT content INTO first_message 
    FROM public.ae_messages 
    WHERE session_id = session_uuid AND role = 'user' 
    ORDER BY created_at ASC 
    LIMIT 1;
    
    -- Si no hay mensaje, usar título por defecto
    IF first_message IS NULL THEN
        RETURN 'Nueva conversación';
    END IF;
    
    -- Truncar y limpiar el mensaje para usarlo como título
    title := TRIM(SUBSTRING(first_message FROM 1 FOR 50));
    
    -- Si es muy corto, usar título por defecto
    IF LENGTH(title) < 5 THEN
        RETURN 'Nueva conversación';
    END IF;
    
    -- Si se truncó, agregar puntos suspensivos
    IF LENGTH(first_message) > 50 THEN
        title := title || '...';
    END IF;
    
    RETURN title;
END;
$$ LANGUAGE plpgsql;

-- 8. Trigger para generar título automáticamente
CREATE OR REPLACE FUNCTION auto_generate_session_title()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo generar título si es el primer mensaje del usuario y la sesión no tiene título
    IF NEW.role = 'user' AND 
       (SELECT title FROM public.ae_sessions WHERE id = NEW.session_id) IS NULL THEN
        
        UPDATE public.ae_sessions 
        SET title = generate_session_title(NEW.session_id)
        WHERE id = NEW.session_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_title_trigger ON public.ae_messages;
CREATE TRIGGER auto_title_trigger
    AFTER INSERT ON public.ae_messages
    FOR EACH ROW EXECUTE FUNCTION auto_generate_session_title();

-- 9. Políticas RLS (Row Level Security)
ALTER TABLE public.ae_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_emotional_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_user_memory ENABLE ROW LEVEL SECURITY;

-- Política básica: permitir todo al service_role
DROP POLICY IF EXISTS "Service role can do everything sessions" ON public.ae_sessions;
CREATE POLICY "Service role can do everything sessions" ON public.ae_sessions FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything messages" ON public.ae_messages;
CREATE POLICY "Service role can do everything messages" ON public.ae_messages FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything files" ON public.ae_files;
CREATE POLICY "Service role can do everything files" ON public.ae_files FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything chunks" ON public.ae_chunks;
CREATE POLICY "Service role can do everything chunks" ON public.ae_chunks FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything memory" ON public.ae_memory;
CREATE POLICY "Service role can do everything memory" ON public.ae_memory FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything actions" ON public.ae_actions;
CREATE POLICY "Service role can do everything actions" ON public.ae_actions FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything requests" ON public.ae_requests;
CREATE POLICY "Service role can do everything requests" ON public.ae_requests FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything emotional" ON public.ae_emotional_events;
CREATE POLICY "Service role can do everything emotional" ON public.ae_emotional_events FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can do everything user_memory" ON public.ae_user_memory;
CREATE POLICY "Service role can do everything user_memory" ON public.ae_user_memory FOR ALL USING (auth.role() = 'service_role');

COMMIT;