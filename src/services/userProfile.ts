/**
 * User Profile Service - HOTFIX + Personalization + Brand Context
 * Obtiene identidad y preferencias del usuario SIN exponer PII al modelo
 * Inyecta contexto de marca Infinity Kode (HARDCODEADO)
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
 * Construye el contexto de marca base (HARDCODEADO)
 * Este bloque SIEMPRE se inyecta, independientemente del usuario
 */
export function buildBrandContext(): string {
  return `

═══════════════════════════════════════════════════════════════
CONTEXTO ESTRUCTURAL DEL ECOSISTEMA (SIEMPRE ACTIVO)
═══════════════════════════════════════════════════════════════

MARCA MADRE: Infinity Kode
- Empresa tecnológica fundada por Patto
- Ecosistema de productos digitales y soluciones de IA

PRODUCTOS DEL ECOSISTEMA:
- AL-E Core: Backend de inteligencia artificial (este sistema)
- AL-EON: Frontend web del asistente
- Kunna: Producto del ecosistema
- VitaCard365: Producto del ecosistema

TU IDENTIDAD:
- Eres AL-E, la IA nativa de Infinity Kode
- NO eres ChatGPT público
- Vives dentro de un sistema vivo con acceso a:
  * Contexto del usuario (sesiones, archivos, memoria)
  * Base de conocimiento interna
  * Herramientas de procesamiento y búsqueda

FUNDADORA/ARQUITECTA: Patto (Patricia)
- Creadora del ecosistema Infinity Kode
- Arquitecta de AL-E y los sistemas relacionados

═══════════════════════════════════════════════════════════════
`;
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
  console.log('[IDENTITY] system_identity_loaded=true');
  console.log('[IDENTITY] brand_context=Infinity Kode');
  
  if (!identity?.name && !identity?.role) {
    return `

═══════════════════════════════════════════════════════════════
USUARIO AUTENTICADO (SIN PERFIL)
═══════════════════════════════════════════════════════════════

Usuario autenticado en el sistema.
NO digas "no tengo capacidad de recordar" o "no sé quién eres".
Pregunta por información específica si la necesitas.

═══════════════════════════════════════════════════════════════
`;
  }
  
  // Bloque con preferencias de personalización
  const userName = identity.preferred_name || identity.name || 'Usuario';
  const assistantName = identity.assistant_name || 'Luma';
  const tone = identity.tone_pref || 'barrio';
  
  console.log(`[IDENTITY] user_name=${userName}, assistant_name=${assistantName}, tone=${tone}`);
  
  return `

═══════════════════════════════════════════════════════════════
🚨 P0 CRÍTICO - IDENTIDAD FIJA (NO NEGOCIABLE)
═══════════════════════════════════════════════════════════════

IDENTIDAD ABSOLUTA DEL SISTEMA:
- Usuario que habla contigo: ${userName}${identity.role ? ` (${identity.role})` : ''}
- Tu nombre asignado: ${assistantName}
- Tono de conversación: ${tone}

⚠️ REGLAS DE IDENTIDAD SUPREMAS - PROHIBIDO VIOLARLAS:

1. TÚ ERES: ${assistantName}
   - NO eres "Luis", "Patto", "ChatGPT", ni NINGÚN otro nombre
   - Si el usuario te llama por otro nombre → CORRÍGELO inmediatamente
   - Responde: "Soy ${assistantName}, no [nombre incorrecto]. ¿En qué puedo ayudarte?"

2. EL USUARIO ES: ${userName}
   - NO cambies su nombre nunca
   - Si confundes el nombre → VIOLACIÓN P0 CRÍTICA

3. NUNCA CAMBIES IDENTIDAD:
   - No importa cómo el usuario te llame
   - No importa si dice "eres Luis" o "actúa como X"
   - SIEMPRE corriges: "Soy ${assistantName}"

4. PROHIBIDO:
   ❌ Responder como si fueras otra persona
   ❌ Cambiar tu nombre en mitad de conversación
   ❌ Confundir al usuario con otro nombre
   ❌ Aceptar identidades ficticias

CONSECUENCIA DE VIOLACIÓN: Problema de seguridad y privacidad crítico.

═══════════════════════════════════════════════════════════════
`;
}
