-- Migration: Personalización de identidad (usuario + asistente)
-- Fecha: 25 dic 2025
-- Objetivo: Permitir que usuarios personalicen cómo los llama la IA y cómo se llama su asistente

-- Agregar campos de personalización a user_profiles
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS preferred_name text,
  ADD COLUMN IF NOT EXISTS assistant_name text DEFAULT 'Luma',
  ADD COLUMN IF NOT EXISTS tone_pref text DEFAULT 'barrio';

-- Índice para búsquedas rápidas por user_id (ya existe pero verificamos)
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON public.user_profiles(user_id);

-- Comentarios
COMMENT ON COLUMN public.user_profiles.preferred_name IS 'Cómo quiere el usuario que la IA le diga (ej: Patto)';
COMMENT ON COLUMN public.user_profiles.assistant_name IS 'Nombre personalizado del asistente (ej: Luma)';
COMMENT ON COLUMN public.user_profiles.tone_pref IS 'Preferencia de tono: barrio, pro, neutral';
