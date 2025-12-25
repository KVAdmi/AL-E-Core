-- =====================================================
-- FIX: Políticas RLS para ae_sessions
-- =====================================================
-- Problema: service_role no puede insertar en ae_sessions
-- Solución: Deshabilitar RLS o crear política permisiva
-- =====================================================

-- OPCIÓN 1: Deshabilitar RLS completamente (más simple para backend)
ALTER TABLE public.ae_sessions DISABLE ROW LEVEL SECURITY;

-- OPCIÓN 2 (alternativa): Mantener RLS pero permitir todo a service_role
-- ALTER TABLE public.ae_sessions ENABLE ROW LEVEL SECURITY;
-- 
-- DROP POLICY IF EXISTS "service_role_full_access" ON public.ae_sessions;
-- 
-- CREATE POLICY "service_role_full_access" 
--   ON public.ae_sessions
--   FOR ALL
--   TO service_role
--   USING (true)
--   WITH CHECK (true);

-- =====================================================
-- APLICAR LO MISMO A OTRAS TABLAS CRÍTICAS
-- =====================================================

ALTER TABLE public.ae_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_chunks DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ae_files DISABLE ROW LEVEL SECURITY;

-- Verificación
SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE 'ae_%'
ORDER BY tablename;
