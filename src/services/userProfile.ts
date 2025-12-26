/**
 * User Profile Service - HOTFIX + Personalization
 * Obtiene identidad y preferencias del usuario SIN exponer PII al modelo
 */

import { supabase } from '../db/supabase';

export interface UserIdentity {
  name?: string;
  role?: string;
  preferred_name?: string;
  assistant_name?: string;
  tone_pref?: string;
}

/**
 * Obtiene identidad y preferencias del usuario desde user_profiles
 * @returns UserIdentity o null si no existe perfil
 */
export async function getUserIdentity(userId: string): Promise<UserIdentity | null> {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('display_name, role, preferred_name, assistant_name, tone_pref')
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    return {
      name: data.display_name,
      role: data.role,
      preferred_name: data.preferred_name,
      assistant_name: data.assistant_name || 'Luma',
      tone_pref: data.tone_pref || 'barrio'
    };
  } catch (err) {
    console.error('[USER PROFILE] Error:', err);
    return null;
  }
}

/**
 * Construye bloque de identidad para system prompt
 * Incluye preferencias de personalización si están disponibles
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
  
  // Bloque con preferencias de personalización
  const userName = identity.preferred_name || identity.name || 'Usuario';
  const assistantName = identity.assistant_name || 'Luma';
  const tone = identity.tone_pref || 'barrio';
  
  return `

---
IDENTIDAD Y PREFERENCIAS DEL USUARIO (VERDAD DEL SISTEMA)
- Usuario: ${userName}${identity.role ? ` (${identity.role})` : ''}
- Tu nombre: ${assistantName}
- Tono preferido: ${tone}

INSTRUCCIONES CRÍTICAS:
1. Llama al usuario "${userName}" siempre que sea relevante
2. Refiérete a ti misma como "${assistantName}"
3. Usa tono "${tone}"
4. NO digas "no tengo capacidad de recordar" o "no sé quién eres"
---
`;
}
