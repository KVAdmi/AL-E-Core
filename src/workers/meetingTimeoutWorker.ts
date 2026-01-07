/**
 * Meeting Timeout Worker
 * Auto-finaliza meetings en modo "recording" que no reciben chunks por 2+ minutos
 * Esto maneja el caso de iOS PWA cuando el usuario bloquea pantalla o cambia de app
 */

import { createClient } from '@supabase/supabase-js';
import { enqueueJob } from '../jobs/meetingQueue';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const TIMEOUT_MINUTES = 2;
const CHECK_INTERVAL_MS = 30 * 1000; // Check every 30 seconds

export function startMeetingTimeoutWorker() {
  console.log('[MEETING-TIMEOUT] Worker started');
  console.log(`[MEETING-TIMEOUT] Will auto-finalize meetings inactive for ${TIMEOUT_MINUTES} minutes`);

  setInterval(async () => {
    try {
      await checkAndFinalizeStale();
    } catch (error) {
      console.error('[MEETING-TIMEOUT] Error in worker:', error);
    }
  }, CHECK_INTERVAL_MS);
}

async function checkAndFinalizeStale() {
  // Buscar meetings en estado "recording" que no se han actualizado en N minutos
  const cutoffTime = new Date(Date.now() - TIMEOUT_MINUTES * 60 * 1000).toISOString();

  const { data: staleMeetings, error } = await supabase
    .from('meetings')
    .select('id, owner_user_id, title, updated_at')
    .eq('status', 'recording')
    .lt('updated_at', cutoffTime);

  if (error) {
    console.error('[MEETING-TIMEOUT] Error fetching stale meetings:', error);
    return;
  }

  if (!staleMeetings || staleMeetings.length === 0) {
    return; // No hay meetings para finalizar
  }

  console.log(`[MEETING-TIMEOUT] Found ${staleMeetings.length} stale meeting(s)`);

  for (const meeting of staleMeetings) {
    console.log(`[MEETING-TIMEOUT] Auto-finalizing meeting ${meeting.id} (last update: ${meeting.updated_at})`);

    // Actualizar status a "processing"
    await supabase
      .from('meetings')
      .update({
        status: 'processing',
        finalized_at: new Date().toISOString(),
      })
      .eq('id', meeting.id);

    // Encolar generación de minuta
    await enqueueJob('GENERATE_MINUTES', {
      meetingId: meeting.id,
      userId: meeting.owner_user_id,
      autoFinalized: true, // Flag para indicar que fue auto-finalizado
    });

    console.log(`[MEETING-TIMEOUT] ✅ Meeting ${meeting.id} queued for finalization`);
  }
}

export default {
  startMeetingTimeoutWorker,
};
