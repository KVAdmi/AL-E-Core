-- =====================================================
-- MIGRACIÓN: meeting_transcriptions
-- Tabla para guardar transcripciones con diarización
-- =====================================================

-- Crear tabla
CREATE TABLE IF NOT EXISTS meeting_transcriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  duration NUMERIC NOT NULL DEFAULT 0, -- en segundos
  speakers_count INTEGER NOT NULL DEFAULT 0,
  segments JSONB NOT NULL DEFAULT '[]'::jsonb, -- array de {speaker, start, end, text}
  audio_path TEXT, -- path al archivo original en /tmp o S3
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_meeting_transcriptions_user_id ON meeting_transcriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcriptions_created_at ON meeting_transcriptions(created_at DESC);

-- RLS policies
ALTER TABLE meeting_transcriptions ENABLE ROW LEVEL SECURITY;

-- Policy: usuarios solo ven sus propias reuniones
CREATE POLICY "Users can view their own meeting transcriptions"
  ON meeting_transcriptions
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: usuarios solo pueden insertar sus propias reuniones
CREATE POLICY "Users can insert their own meeting transcriptions"
  ON meeting_transcriptions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: usuarios solo pueden actualizar sus propias reuniones
CREATE POLICY "Users can update their own meeting transcriptions"
  ON meeting_transcriptions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: usuarios solo pueden eliminar sus propias reuniones
CREATE POLICY "Users can delete their own meeting transcriptions"
  ON meeting_transcriptions
  FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_meeting_transcriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_meeting_transcriptions_updated_at
  BEFORE UPDATE ON meeting_transcriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_meeting_transcriptions_updated_at();

-- Comentarios
COMMENT ON TABLE meeting_transcriptions IS 'Transcripciones de reuniones con diarización de speakers (Pyannote + faster-whisper)';
COMMENT ON COLUMN meeting_transcriptions.segments IS 'Array JSON de segmentos: [{speaker: "SPEAKER_00", start: 0.5, end: 4.2, text: "..."}]';
COMMENT ON COLUMN meeting_transcriptions.duration IS 'Duración total del audio en segundos';
COMMENT ON COLUMN meeting_transcriptions.speakers_count IS 'Número de speakers detectados';
