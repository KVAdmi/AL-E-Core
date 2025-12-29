-- =====================================================
-- MIGRATION 015: Agregar columna notification_minutes
-- =====================================================
-- HOTFIX: El código en transactionalExecutor.ts inserta
-- notification_minutes pero la columna no existía
-- =====================================================

ALTER TABLE calendar_events 
ADD COLUMN IF NOT EXISTS notification_minutes INTEGER DEFAULT 60;

COMMENT ON COLUMN calendar_events.notification_minutes IS 
  'Minutos antes del evento para enviar notificación (default: 60 = 1 hora antes)';
