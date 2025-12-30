/**
 * Integration Checker
 * P0: Verifica qué integraciones tiene activas el usuario
 * ANTES de decir "No tengo acceso"
 */

import { supabase } from '../db/supabase';

export interface UserIntegrations {
  hasEmail: boolean;
  hasCalendar: boolean; // Siempre true (calendario interno)
  hasTelegram: boolean;
  emailAccounts: number;
  telegramBots: number;
}

/**
 * Verifica qué integraciones tiene configuradas el usuario
 */
export async function checkIntegrations(userId: string): Promise<UserIntegrations> {
  console.log(`[INTEGRATION_CHECKER] Verificando integraciones para user: ${userId}`);
  
  // Verificar cuentas de email
  const { data: emailAccounts, error: emailError } = await supabase
    .from('email_accounts')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('is_active', true);
  
  if (emailError) {
    console.error('[INTEGRATION_CHECKER] Error checking email accounts:', emailError);
  }
  
  const hasEmail = (emailAccounts?.length || 0) > 0;
  const emailCount = emailAccounts?.length || 0;
  
  console.log(`[INTEGRATION_CHECKER] Email accounts: ${emailCount}`);
  
  // Verificar bots de Telegram
  const { data: telegramBots, error: telegramError } = await supabase
    .from('telegram_bots')
    .select('id')
    .eq('owner_user_id', userId)
    .eq('is_active', true);
  
  if (telegramError) {
    console.error('[INTEGRATION_CHECKER] Error checking telegram bots:', telegramError);
  }
  
  const hasTelegram = (telegramBots?.length || 0) > 0;
  const telegramCount = telegramBots?.length || 0;
  
  console.log(`[INTEGRATION_CHECKER] Telegram bots: ${telegramCount}`);
  
  // Calendario interno siempre está disponible
  const hasCalendar = true;
  
  return {
    hasEmail,
    hasCalendar,
    hasTelegram,
    emailAccounts: emailCount,
    telegramBots: telegramCount
  };
}

/**
 * Genera mensaje de status de integraciones
 */
export function getIntegrationStatusMessage(integrations: UserIntegrations): string {
  const lines: string[] = [];
  
  lines.push('**Estado de tus integraciones:**');
  lines.push('');
  
  if (integrations.hasEmail) {
    lines.push(`✅ Email: ${integrations.emailAccounts} cuenta(s) configurada(s)`);
  } else {
    lines.push('❌ Email: No configurado');
  }
  
  lines.push('✅ Calendario: Disponible (interno de AL-E)');
  
  if (integrations.hasTelegram) {
    lines.push(`✅ Telegram: ${integrations.telegramBots} bot(s) conectado(s)`);
  } else {
    lines.push('❌ Telegram: No configurado');
  }
  
  return lines.join('\n');
}
