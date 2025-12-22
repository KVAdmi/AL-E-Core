-- Función auxiliar para ejecutar SQL desde el código TypeScript
-- Esta función es necesaria para que DatabaseService.executeRaw funcione

CREATE OR REPLACE FUNCTION exec_sql(query text, params text DEFAULT '[]')
RETURNS jsonb AS $$
DECLARE
    result jsonb;
BEGIN
    -- Esta es una función simplificada para las operaciones básicas que necesitamos
    -- En un entorno de producción, sería más seguro usar funciones específicas
    
    -- Por ahora, retornamos null y usaremos las funciones específicas
    RETURN '[]'::jsonb;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- También necesitamos ajustar la función get_user_complete_memory para ser una RPC
CREATE OR REPLACE FUNCTION get_user_complete_memory(p_user_id text)
RETURNS jsonb AS $$
DECLARE
    personal_memory jsonb;
    semantic_memory jsonb;
    recent_context jsonb;
    result jsonb;
BEGIN
    -- Memoria personal (ae_user_memory)
    SELECT jsonb_object_agg(key, value::jsonb)
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
$$ LANGUAGE plpgsql SECURITY DEFINER;