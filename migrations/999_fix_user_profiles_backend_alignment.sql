-- =====================================================
-- MIGRATION: Backend-Frontend Schema Alignment
-- =====================================================
-- Fecha: 16 de enero de 2026
-- Propósito: Alinear user_profiles con lo que backend espera
-- Status: CRITICAL - Requerido para AL-E operativa
-- =====================================================

-- Backend está buscando estos campos en user_settings pero NO EXISTEN
-- Solución: Ya existen en user_profiles, solo validamos que estén correctos

-- =====================================================
-- VALIDACIÓN: Verificar que user_profiles tenga los campos necesarios
-- =====================================================

-- Campo: preferred_name (usado como user_nickname en backend)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_profiles' 
    AND column_name = 'preferred_name'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN preferred_name text;
    RAISE NOTICE 'Columna preferred_name agregada a user_profiles';
  ELSE
    RAISE NOTICE 'Columna preferred_name ya existe en user_profiles';
  END IF;
END $$;

-- Campo: assistant_name (nombre personalizado del asistente)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_profiles' 
    AND column_name = 'assistant_name'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN assistant_name text DEFAULT 'AL-E'::text;
    RAISE NOTICE 'Columna assistant_name agregada a user_profiles';
  ELSE
    RAISE NOTICE 'Columna assistant_name ya existe en user_profiles';
  END IF;
END $$;

-- Campo: tone_pref (preferencias de tono/estilo)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_profiles' 
    AND column_name = 'tone_pref'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN tone_pref text DEFAULT 'barrio'::text;
    RAISE NOTICE 'Columna tone_pref agregada a user_profiles';
  ELSE
    RAISE NOTICE 'Columna tone_pref ya existe en user_profiles';
  END IF;
END $$;

-- =====================================================
-- MIGRACIÓN DE DATOS (si existían en user_settings)
-- =====================================================

-- Si alguien creó campos custom en user_settings, migrarlos
-- (Esto es por si acaso, normalmente no debería existir)

-- No hay datos que migrar porque los campos nunca existieron en user_settings

-- =====================================================
-- VALIDACIÓN FINAL
-- =====================================================

-- Verificar que todos los usuarios tengan un perfil
INSERT INTO public.user_profiles (user_id, email, role, assistant_name, tone_pref)
SELECT 
  id,
  email,
  'USER',
  'AL-E',
  'barrio'
FROM auth.users
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_profiles WHERE user_profiles.user_id = auth.users.id
)
ON CONFLICT (user_id) DO NOTHING;

-- =====================================================
-- RESULTADO
-- =====================================================
-- ✅ user_profiles.preferred_name → Usado como nickname
-- ✅ user_profiles.assistant_name → Nombre del asistente
-- ✅ user_profiles.tone_pref → Preferencias de tono
-- ✅ Todos los usuarios tienen perfil
-- =====================================================
