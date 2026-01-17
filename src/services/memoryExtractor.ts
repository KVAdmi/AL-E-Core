// src/services/memoryExtractor.ts
// FIX 3: Extractor de memoria REAL - Guarda en Supabase assistant_memories

import { supabase } from '../db/supabase';

/**
 * Extraer y guardar memoria importante de la conversación
 * 
 * PRODUCCIÓN REAL:
 * - Detecta nombres, preferencias, acuerdos
 * - Guarda en assistant_memories (Supabase)
 * - Actualiza user_profiles con nombre
 * - NO mock, NO temporal, NO simulado
 */
export async function extractAndSaveMemories(
  userId: string,
  workspaceId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  console.log(`[MEMORY_EXTRACTOR] 🧠 Analyzing conversation for ${userId}...`);
  
  const memories: Array<{ content: string; importance: number }> = [];
  
  // ============================================
  // 1. DETECTAR NOMBRE DEL USUARIO
  // ============================================
  const nameMatch = userMessage.match(/me llamo (\w+)|mi nombre es (\w+)|soy (\w+)|llámame (\w+)/i);
  if (nameMatch) {
    const name = nameMatch[1] || nameMatch[2] || nameMatch[3] || nameMatch[4];
    memories.push({
      content: `[fact] El usuario se llama ${name}`,
      importance: 1.0  // Máxima importancia
    });
    
    // Actualizar user_profile también (tabla REAL)
    try {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .upsert({
          user_id: userId,
          preferred_name: name,
          display_name: name,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });
      
      if (profileError) {
        console.error(`[MEMORY_EXTRACTOR] ❌ Error updating user_profile:`, profileError);
      } else {
        console.log(`[MEMORY_EXTRACTOR] ✓ User name saved to user_profiles: ${name}`);
      }
    } catch (err) {
      console.error(`[MEMORY_EXTRACTOR] ❌ Exception updating profile:`, err);
    }
  }
  
  // ============================================
  // 2. DETECTAR PREFERENCIAS
  // ============================================
  if (userMessage.match(/prefiero|me gusta|quiero que|no me gusta|odio/i)) {
    memories.push({
      content: `[preference] ${userMessage}`,
      importance: 0.7
    });
  }
  
  // ============================================
  // 3. DETECTAR ACUERDOS/DECISIONES
  // ============================================
  if (userMessage.match(/quedamos|acordamos|entonces|de acuerdo|ok|perfecto|vale|entendido/i) ||
      assistantResponse.match(/perfecto|entendido|de acuerdo/i)) {
    memories.push({
      content: `[agreement] Usuario: "${userMessage.substring(0, 200)}" → AL-E confirmó`,
      importance: 0.8
    });
  }
  
  // ============================================
  // 4. DETECTAR INFORMACIÓN PERSONAL (email, teléfono, etc)
  // ============================================
  const emailMatch = userMessage.match(/mi (correo|email) es ([^\s]+@[^\s]+)/i);
  if (emailMatch) {
    const email = emailMatch[2];
    memories.push({
      content: `[contact] Email del usuario: ${email}`,
      importance: 0.9
    });
  }
  
  const phoneMatch = userMessage.match(/mi (teléfono|celular|número) es ([\d\s\-\+\(\)]+)/i);
  if (phoneMatch) {
    const phone = phoneMatch[2];
    memories.push({
      content: `[contact] Teléfono del usuario: ${phone}`,
      importance: 0.9
    });
  }
  
  // ============================================
  // 5. GUARDAR EN ASSISTANT_MEMORIES (TABLA REAL)
  // ============================================
  if (memories.length > 0) {
    console.log(`[MEMORY_EXTRACTOR] 💾 Saving ${memories.length} memory(s) to Supabase...`);
    
    for (const mem of memories) {
      try {
        const { error } = await supabase
          .from('assistant_memories')
          .insert({
            workspace_id: workspaceId,
            user_id: userId,
            user_id_uuid: userId,  // Mismo valor por ahora
            mode: 'universal',
            memory: mem.content,
            importance: mem.importance,
            created_at: new Date().toISOString()
          });
        
        if (error) {
          console.error(`[MEMORY_EXTRACTOR] ❌ Error saving memory:`, error);
        } else {
          console.log(`[MEMORY_EXTRACTOR] ✓ Saved: "${mem.content.substring(0, 60)}..." (importance: ${mem.importance})`);
        }
      } catch (err) {
        console.error(`[MEMORY_EXTRACTOR] ❌ Exception saving memory:`, err);
      }
    }
    
    console.log(`[MEMORY_EXTRACTOR] ✅ Memory extraction completed - ${memories.length} item(s) saved`);
  } else {
    console.log(`[MEMORY_EXTRACTOR] ℹ️ No important info detected in this conversation`);
  }
}
