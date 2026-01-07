-- Query para verificar notification_jobs pendientes
SELECT 
  id,
  type,
  channel,
  status,
  run_at,
  NOW() as now,
  (run_at <= NOW()) as should_run,
  payload->>'title' as event_title,
  created_at
FROM notification_jobs
WHERE status = 'pending'
ORDER BY run_at DESC
LIMIT 10;

-- Query para ver todas las notificaciones recientes (últimas 24h)
SELECT 
  id,
  type,
  channel,
  status,
  run_at,
  payload->>'title' as event_title,
  last_error,
  created_at
FROM notification_jobs
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC
LIMIT 20;
