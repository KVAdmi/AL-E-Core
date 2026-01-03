/**
 * =====================================================
 * EMAIL ACCOUNTS REPOSITORY
 * =====================================================
 * 
 * Acceso a tabla email_accounts en Supabase
 * Manejo de credenciales cifradas IMAP/SMTP
 * =====================================================
 */

import { supabase } from '../db/supabase';

export interface EmailAccount {
  id: string;
  owner_user_id: string;
  provider_label: string; // "Gmail", "Outlook", "Hostinger", etc.
  from_name: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass_enc: string; // Cifrado
  imap_host: string | null;
  imap_port: number | null;
  imap_secure: boolean;
  imap_user: string | null;
  imap_pass_enc: string | null; // Cifrado
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateEmailAccountData {
  owner_user_id: string;
  provider_label: string;
  from_name: string;
  from_email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass_enc: string;
  imap_host?: string;
  imap_port?: number;
  imap_secure?: boolean;
  imap_user?: string;
  imap_pass_enc?: string;
}

/**
 * Crear nueva cuenta de correo
 */
export async function createEmailAccount(data: CreateEmailAccountData): Promise<EmailAccount> {
  const { data: account, error } = await supabase
    .from('email_accounts')
    .insert({
      ...data,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) {
    console.error('[REPO] ❌ Error al crear cuenta:', error);
    throw new Error(`Error al crear cuenta: ${error.message}`);
  }
  
  return account;
}

/**
 * Obtener cuenta por ID (con validación de user_id)
 */
export async function getEmailAccountById(accountId: string, userId: string): Promise<EmailAccount | null> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('owner_user_id', userId)
    .single();
  
  if (error) {
    if (error.code === 'PGRST116') {
      return null; // No encontrado
    }
    console.error('[REPO] ❌ Error al obtener cuenta:', error);
    throw new Error(`Error al obtener cuenta: ${error.message}`);
  }
  
  return data;
}

/**
 * Listar cuentas del usuario
 */
export async function listEmailAccounts(userId: string): Promise<EmailAccount[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('[REPO] ❌ Error al listar cuentas:', error);
    throw new Error(`Error al listar cuentas: ${error.message}`);
  }
  
  return data || [];
}

/**
 * Actualizar cuenta
 */
export async function updateEmailAccount(
  accountId: string,
  userId: string,
  updates: Partial<EmailAccount>
): Promise<EmailAccount> {
  const { data, error } = await supabase
    .from('email_accounts')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', accountId)
    .eq('owner_user_id', userId)
    .select()
    .single();
  
  if (error) {
    console.error('[REPO] ❌ Error al actualizar cuenta:', error);
    throw new Error(`Error al actualizar cuenta: ${error.message}`);
  }
  
  return data;
}

/**
 * Eliminar cuenta (soft delete: marcar is_active=false)
 */
export async function deleteEmailAccount(accountId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('email_accounts')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', accountId)
    .eq('owner_user_id', userId);
  
  if (error) {
    console.error('[REPO] ❌ Error al eliminar cuenta:', error);
    throw new Error(`Error al eliminar cuenta: ${error.message}`);
  }
}

/**
 * Listar cuentas activas (para sync automático)
 */
export async function listActiveEmailAccounts(): Promise<EmailAccount[]> {
  const { data, error } = await supabase
    .from('email_accounts')
    .select('*')
    .eq('is_active', true)
    .not('imap_host', 'is', null); // Solo cuentas con IMAP configurado
  
  if (error) {
    console.error('[REPO] ❌ Error al listar cuentas activas:', error);
    return [];
  }
  
  return data || [];
}
