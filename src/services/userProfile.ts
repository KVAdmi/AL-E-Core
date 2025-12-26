/**
 * User Profile Service - HOTFIX
 * Obtiene identidad del usuario SIN exponer PII al modelo
 */

import { supabase } from '../db/supabase';

export interface UserIdentity {
  name?: string;
  role?: string;
}

/**
 * Obtiene identidad del usuario desde user_profiles
 * @returns UserIdentity o null si no existe perfil
 */
export async function getUserIdentity(userId: string): Promise<UserIdentity | null> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('display_name, role')
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return {
      name: data.display_name,
      role: data.role
    };
  } catch (err) {
    console.error('[USER PROFILE] Error:', err);
    return null;
  }
}

/**
 * Construye bloque de identidad para system prompt
 */
export function buildIdentityBlock(identity: UserIdentity | null): string {
  if (!identity?.name && !identity?.role) {
    return `

---
Usuario autenticado en el sistema.
NO digas "no tengo capacidad de recordar" o "no sé quién eres".
---
`;
  }
  
  return `

---
Usuario: ${identity.name || 'Usuario'}${identity.role ? ` (${identity.role})` : ''}
NO digas "no tengo capacidad de recordar" o "no sé quién eres".
---
`;
}
