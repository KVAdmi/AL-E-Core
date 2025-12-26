/**
 * User Profile Service
 * 
 * Obtiene información de identidad del usuario para inyectar en prompts
 * SIN exponer PII (emails, UUIDs) al modelo de IA
 */

import { supabase } from '../db/supabase';

export interface UserIdentity {
  name?: string;      // Nombre o apodo (ej: "Patto")
  role?: string;      // Rol en el sistema (ej: "founder", "socia estratégica")
  tone?: string;      // Preferencia de tono (ej: "barrio", "formal")
  preferences?: any;  // Otras preferencias del usuario
}

/**
 * Obtiene la identidad del usuario para inyectar en el prompt
 * 
 * @param userId - UUID del usuario de Supabase Auth
 * @returns UserIdentity con nombre/rol/tono o null si no hay info
 */
export async function getUserIdentity(userId: string): Promise<UserIdentity | null> {
  try {
    // Consultar tabla user_profiles
    const { data, error } = await supabase
      .from('user_profiles')
      .select('display_name, role, preferred_language, timezone')
      .eq('user_id', userId)
      .single();
    
    if (error || !data) {
      console.log(`[USER PROFILE] No profile found for userId=${userId}:`, error?.message);
      return null;
    }
    
    // Si no tiene display_name ni role, no hay identidad relevante
    if (!data.display_name && !data.role) {
      return null;
    }
    
    return {
      name: data.display_name,
      role: data.role,
      tone: undefined, // TODO: agregar campo 'tone' a user_profiles si se necesita
      preferences: {
        language: data.preferred_language,
        timezone: data.timezone
      }
    };
    
  } catch (err) {
    console.error('[USER PROFILE] Error fetching user identity:', err);
    return null;
  }
}

/**
 * Construye el bloque de identidad para inyectar en el system prompt
 * 
 * @param identity - UserIdentity del usuario
 * @returns String formateado para agregar al prompt
 */
export function buildIdentityBlock(identity: UserIdentity | null): string {
  if (!identity || (!identity.name && !identity.role)) {
    // Fallback: usuario autenticado sin perfil completo
    return `

---
CONTEXTO DE USUARIO:
Usuario autenticado y reconocido en el sistema.

IMPORTANTE:
- Reconoce al usuario como alguien conocido
- NO digas "no tengo capacidad de recordar" o "no sé quién eres"
- Si necesitas más contexto, pregunta directamente
---
`;
  }
  
  // Usuario con perfil completo
  const parts: string[] = [];
  
  if (identity.name) {
    parts.push(`- Nombre: ${identity.name}`);
  }
  
  if (identity.role) {
    parts.push(`- Rol: ${identity.role}`);
  }
  
  if (identity.tone) {
    parts.push(`- Estilo de comunicación preferido: ${identity.tone}`);
  }
  
  return `

---
CONTEXTO DE USUARIO:
${parts.join('\n')}

IMPORTANTE:
- Reconoce al usuario como ${identity.name || 'usuario conocido'}
- Adapta tu tono según sus preferencias${identity.tone ? ` (${identity.tone})` : ''}
- NO digas "no tengo capacidad de recordar" o "no sé quién eres"
- NO menciones "tengo un token" o detalles técnicos de autenticación
---
`;
}
