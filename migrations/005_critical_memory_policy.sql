-- MIGRACIÓN CRÍTICA 005: Política de Memoria NO NEGOCIABLE
-- AL-E Core debe RECORDAR SIEMPRE - Esta es la responsabilidad CRÍTICA

-- 1. Actualizar ae_sessions con campos obligatorios para memoria
ALTER TABLE public.ae_sessions 
    ADD COLUMN IF NOT EXISTS workspace_id text DEFAULT 'default',
    ADD COLUMN IF NOT EXISTS mode text DEFAULT 'universal',
    ADD COLUMN IF NOT EXISTS last_message_at timestamp with time zone,
    ADD COLUMN IF NOT EXISTS pinned boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- 2. Asegurar que user_id sea consistente (texto para compatibilidad)
ALTER TABLE public.ae_sessions ALTER COLUMN user_id TYPE text;
ALTER TABLE public.ae_user_memory ALTER COLUMN user_id TYPE text;

-- 3. Índices CRÍTICOS para recuperación rápida de memoria
CREATE INDEX IF NOT EXISTS idx_ae_sessions_user_workspace ON public.ae_sessions(user_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_ae_sessions_last_message ON public.ae_sessions(last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_ae_user_memory_user ON public.ae_user_memory(user_id);
CREATE INDEX IF NOT EXISTS idx_assistant_memories_user ON public.assistant_memories(user_id);

-- 4. Función CRÍTICA: Actualizar last_message_at automáticamente
CREATE OR REPLACE FUNCTION update_session_last_message()
RETURNS TRIGGER AS $$
BEGIN
    -- Actualizar timestamp de último mensaje en la sesión
    UPDATE public.ae_sessions 
    SET last_message_at = NEW.created_at
    WHERE id = NEW.session_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar automáticamente
DROP TRIGGER IF EXISTS trigger_update_session_last_message ON public.ae_messages;
CREATE TRIGGER trigger_update_session_last_message
    AFTER INSERT ON public.ae_messages
    FOR EACH ROW EXECUTE FUNCTION update_session_last_message();

-- 5. Función para consolidar memoria personal (CRÍTICA)
CREATE OR REPLACE FUNCTION upsert_user_memory(
    p_user_id text,
    p_key text,
    p_value text
) RETURNS void AS $$
BEGIN
    INSERT INTO public.ae_user_memory (user_id, key, value, updated_at)
    VALUES (p_user_id, p_key, p_value, now())
    ON CONFLICT (user_id, key) 
    DO UPDATE SET 
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at;
END;
$$ LANGUAGE plpgsql;

-- 6. Función para recuperar memoria completa del usuario
CREATE OR REPLACE FUNCTION get_user_complete_memory(p_user_id text)
RETURNS jsonb AS $$
DECLARE
    personal_memory jsonb;
    semantic_memory jsonb;
    recent_context jsonb;
    result jsonb;
BEGIN
    -- Memoria personal (ae_user_memory)
    SELECT jsonb_object_agg(key, value)
    INTO personal_memory
    FROM public.ae_user_memory 
    WHERE user_id = p_user_id;
    
    -- Memoria semántica (assistant_memories) - más importantes
    SELECT jsonb_agg(
        jsonb_build_object(
            'content', memory,
            'importance', importance,
            'mode', mode,
            'created_at', created_at
        )
    )
    INTO semantic_memory
    FROM public.assistant_memories 
    WHERE user_id = p_user_id 
    ORDER BY importance DESC, created_at DESC 
    LIMIT 20;
    
    -- Contexto reciente de sesiones activas
    SELECT jsonb_agg(
        jsonb_build_object(
            'session_id', id,
            'title', title,
            'workspace_id', workspace_id,
            'last_message_at', last_message_at
        )
    )
    INTO recent_context
    FROM public.ae_sessions 
    WHERE user_id = p_user_id 
      AND archived = false
    ORDER BY last_message_at DESC NULLS LAST
    LIMIT 10;
    
    -- Construir resultado final
    result := jsonb_build_object(
        'personal', COALESCE(personal_memory, '{}'::jsonb),
        'semantic', COALESCE(semantic_memory, '[]'::jsonb),
        'recent_sessions', COALESCE(recent_context, '[]'::jsonb)
    );
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- 7. Constraint único para ae_user_memory (evitar duplicados)
ALTER TABLE public.ae_user_memory 
    DROP CONSTRAINT IF EXISTS unique_user_memory_key;
ALTER TABLE public.ae_user_memory 
    ADD CONSTRAINT unique_user_memory_key UNIQUE (user_id, key);

-- 8. Política de retención: NO borrar memoria crítica
-- Solo marcar como archivado sesiones > 90 días sin actividad
CREATE OR REPLACE FUNCTION archive_old_sessions()
RETURNS void AS $$
BEGIN
    UPDATE public.ae_sessions 
    SET archived = true
    WHERE last_message_at < (now() - interval '90 days')
      AND archived = false
      AND pinned = false;
END;
$$ LANGUAGE plpgsql;

COMMIT;