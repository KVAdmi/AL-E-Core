# 🚨 INSTRUCCIONES PARA FRONTEND - ALINEACIÓN CRÍTICA BACKEND-FRONTEND

**Fecha:** 16 de enero de 2026  
**Commit Backend:** cf155ed  
**Status:** 🔴 **ACCIÓN REQUERIDA INMEDIATA**

---

## 🎯 RESUMEN EJECUTIVO

Backend hizo un **FIX CRÍTICO** en el schema. Detectamos que el código buscaba campos en `user_settings` que **no existían**. Los campos correctos están en `user_profiles`.

**CAMBIO:** Backend ahora usa `user_profiles` en vez de `user_settings`

---

## 📋 PASO 1: EJECUTAR MIGRACIÓN SQL

**ANTES de desplegar cualquier cambio**, ejecutar esta migración en Supabase:

```sql
-- =====================================================
-- MIGRATION: Backend-Frontend Schema Alignment
-- =====================================================
-- Fecha: 16 de enero de 2026
-- Propósito: Alinear user_profiles con lo que backend espera
-- Status: CRITICAL - Requerido para AL-E operativa
-- =====================================================

-- Backend está buscando estos campos en user_settings pero NO EXISTEN
-- Solución: Ya existen en user_profiles, solo validamos que estén correctos

-- =====================================================
-- VALIDACIÓN: Verificar que user_profiles tenga los campos necesarios
-- =====================================================

-- Campo: preferred_name (usado como user_nickname en backend)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_profiles' 
    AND column_name = 'preferred_name'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN preferred_name text;
    RAISE NOTICE 'Columna preferred_name agregada a user_profiles';
  ELSE
    RAISE NOTICE 'Columna preferred_name ya existe en user_profiles';
  END IF;
END $$;

-- Campo: assistant_name (nombre personalizado del asistente)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_profiles' 
    AND column_name = 'assistant_name'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN assistant_name text DEFAULT 'AL-E'::text;
    RAISE NOTICE 'Columna assistant_name agregada a user_profiles';
  ELSE
    RAISE NOTICE 'Columna assistant_name ya existe en user_profiles';
  END IF;
END $$;

-- Campo: tone_pref (preferencias de tono/estilo)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'user_profiles' 
    AND column_name = 'tone_pref'
  ) THEN
    ALTER TABLE public.user_profiles ADD COLUMN tone_pref text DEFAULT 'barrio'::text;
    RAISE NOTICE 'Columna tone_pref agregada a user_profiles';
  ELSE
    RAISE NOTICE 'Columna tone_pref ya existe en user_profiles';
  END IF;
END $$;

-- =====================================================
-- MIGRACIÓN DE DATOS (si existían en user_settings)
-- =====================================================

-- Si alguien creó campos custom en user_settings, migrarlos
-- (Esto es por si acaso, normalmente no debería existir)

-- No hay datos que migrar porque los campos nunca existieron en user_settings

-- =====================================================
-- VALIDACIÓN FINAL
-- =====================================================

-- Verificar que todos los usuarios tengan un perfil
INSERT INTO public.user_profiles (user_id, email, role, assistant_name, tone_pref)
SELECT 
  id,
  email,
  'USER',
  'AL-E',
  'barrio'
FROM auth.users
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_profiles WHERE user_profiles.user_id = auth.users.id
)
ON CONFLICT (user_id) DO NOTHING;

-- =====================================================
-- RESULTADO
-- =====================================================
-- ✅ user_profiles.preferred_name → Usado como nickname
-- ✅ user_profiles.assistant_name → Nombre del asistente
-- ✅ user_profiles.tone_pref → Preferencias de tono
-- ✅ Todos los usuarios tienen perfil
-- =====================================================
```

**Cómo ejecutar:**
1. Ir a Supabase Dashboard → SQL Editor
2. Pegar el código completo
3. Ejecutar (Run)
4. Verificar que diga "Success"

---

## 📋 PASO 2: ACTUALIZAR TIPOS TYPESCRIPT EN FRONTEND

**Archivo:** `types/user.ts` o `types/profile.ts`

```typescript
// NUEVO: Schema alineado con backend
export interface UserProfile {
  id: string;
  user_id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  
  // 👤 PERSONALIZACIÓN (usado por backend)
  preferred_name?: string;      // ← Nickname del usuario
  assistant_name?: string;      // ← Nombre del asistente (default: "AL-E")
  tone_pref?: string;           // ← Tono/estilo (default: "barrio")
  
  // 🎨 UI/UX
  display_name?: string;        // ← Nombre público
  avatar_url?: string;
  assistant_avatar_url?: string;
  user_avatar_url?: string;
  
  // ⚙️ PREFERENCIAS
  preferred_language: string;   // ← Default: "es"
  timezone: string;             // ← Default: "America/Mexico_City"
  theme: 'light' | 'dark' | 'system';
  
  // 📅 METADATA
  created_at: string;
  updated_at: string;
}
```

---

## 📋 PASO 3: ACTUALIZAR QUERIES EN FRONTEND

### ❌ ANTES (INCORRECTO):
```typescript
// NO HACER: user_settings ya no se usa para personalización
const { data } = await supabase
  .from('user_settings')
  .select('assistant_name, user_nickname, preferences')
  .eq('user_id', userId)
  .single();
```

### ✅ AHORA (CORRECTO):
```typescript
// HACER: Usar user_profiles
const { data: profile } = await supabase
  .from('user_profiles')
  .select('preferred_name, assistant_name, tone_pref, display_name, email, timezone, preferred_language, theme')
  .eq('user_id', userId)
  .single();

// Usar con defaults
const assistantName = profile?.assistant_name || 'AL-E';
const userName = profile?.preferred_name || profile?.display_name || 'Usuario';
const tone = profile?.tone_pref || 'barrio';
```

---

## 📋 PASO 4: ACTUALIZAR COMPONENTE DE PERFIL/SETTINGS

Si tienes un componente de configuración de perfil, actualizar campos:

```tsx
// Componente: Settings o ProfileEditor
import { useUser } from '@/hooks/useUser';
import { supabase } from '@/lib/supabase';

function ProfileSettings() {
  const { user } = useUser();
  const [preferredName, setPreferredName] = useState('');
  const [assistantName, setAssistantName] = useState('AL-E');
  const [tonePref, setTonePref] = useState('barrio');
  
  // Cargar perfil
  useEffect(() => {
    async function loadProfile() {
      const { data } = await supabase
        .from('user_profiles')
        .select('preferred_name, assistant_name, tone_pref')
        .eq('user_id', user.id)
        .single();
      
      if (data) {
        setPreferredName(data.preferred_name || '');
        setAssistantName(data.assistant_name || 'AL-E');
        setTonePref(data.tone_pref || 'barrio');
      }
    }
    
    loadProfile();
  }, [user.id]);
  
  // Guardar perfil
  async function saveProfile() {
    await supabase
      .from('user_profiles')
      .update({
        preferred_name: preferredName,
        assistant_name: assistantName,
        tone_pref: tonePref,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id);
  }
  
  return (
    <div className="space-y-4">
      <div>
        <label>¿Cómo quieres que te llame?</label>
        <input 
          value={preferredName} 
          onChange={(e) => setPreferredName(e.target.value)}
          placeholder="Ej: Pedro, Jefe, Doc"
        />
      </div>
      
      <div>
        <label>¿Cómo quieres llamar al asistente?</label>
        <input 
          value={assistantName} 
          onChange={(e) => setAssistantName(e.target.value)}
          placeholder="Ej: AL-E, Luma, Asistente"
        />
      </div>
      
      <div>
        <label>Tono de conversación</label>
        <select value={tonePref} onChange={(e) => setTonePref(e.target.value)}>
          <option value="barrio">Casual (barrio)</option>
          <option value="profesional">Profesional</option>
          <option value="formal">Formal</option>
        </select>
      </div>
      
      <button onClick={saveProfile}>Guardar cambios</button>
    </div>
  );
}
```

---

## 📋 PASO 5: VALIDAR CAMBIOS

### TEST 1: Verificar perfil cargado
```typescript
// En consola del navegador
const { data } = await supabase
  .from('user_profiles')
  .select('*')
  .eq('user_id', '<TU_USER_ID>')
  .single();

console.log('Perfil:', data);
// Debe tener: preferred_name, assistant_name, tone_pref
```

### TEST 2: Actualizar perfil
```typescript
const { error } = await supabase
  .from('user_profiles')
  .update({
    preferred_name: 'Pedro',
    assistant_name: 'Luma',
    tone_pref: 'barrio'
  })
  .eq('user_id', '<TU_USER_ID>');

console.log('Error:', error); // Debe ser null
```

### TEST 3: Verificar en respuesta del chat
Hacer request a `/api/ai/chat` y verificar que logs de backend muestren:
```bash
[SIMPLE ORCH] 👤 Nombre asistente: Luma
[SIMPLE ORCH] 👤 Nickname usuario: Pedro
[SIMPLE ORCH] 👤 Tono preferido: barrio
```

---

## 📋 PASO 6: VERIFICAR SCHEMA OFICIAL

Frontend debe usar este schema como referencia única:

**Archivo:** `SUPABASE-SCHEMA-OFICIAL.sql` (en repo AL-E-Core)

**Tabla relevante:**
```sql
CREATE TABLE public.user_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'USER'::text,
  display_name text,
  created_at timestamp with time zone DEFAULT now(),
  preferred_language text DEFAULT 'es'::text,
  timezone text DEFAULT 'America/Mexico_City'::text,
  avatar_url text,
  theme text DEFAULT 'system'::text CHECK (theme = ANY (ARRAY['light'::text, 'dark'::text, 'system'::text])),
  updated_at timestamp with time zone DEFAULT now(),
  preferred_name text,              -- ← NUEVO PARA BACKEND
  assistant_name text DEFAULT 'AL-E'::text,  -- ← NUEVO PARA BACKEND
  tone_pref text DEFAULT 'barrio'::text,     -- ← NUEVO PARA BACKEND
  assistant_avatar_url text,
  user_avatar_url text,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id)
);
```

---

## ✅ CHECKLIST DE ALINEACIÓN

```bash
□ PASO 1: Ejecutar migración SQL en Supabase Dashboard
□ PASO 2: Actualizar tipos TypeScript (UserProfile interface)
□ PASO 3: Cambiar queries de user_settings → user_profiles
□ PASO 4: Actualizar componente de configuración de perfil
□ PASO 5: Validar con tests en consola
□ PASO 6: Descargar SUPABASE-SCHEMA-OFICIAL.sql del repo
□ PASO 7: Probar chat con backend actualizado
```

---

## 🚀 DEPLOYMENT

**Orden correcto:**

1. ✅ **Backend:** Ya pusheado a GitHub (commit cf155ed)
2. ⏳ **Database:** Ejecutar migración SQL (PASO 1)
3. ⏳ **Frontend:** Actualizar código con PASOS 2-4
4. ⏳ **Deploy Backend:** EC2 deployment
5. ⏳ **Deploy Frontend:** Producción
6. ⏳ **Validación:** Tests E2E

---

## 📞 COORDINACIÓN

**Backend está 100% listo y esperando por:**
- ✅ Migración SQL ejecutada en Supabase
- ✅ Frontend actualizado para usar `user_profiles`

**Después podremos:**
- Desplegar backend a EC2
- Validar personalización (nombres, tono)
- Continuar con badges y metadata (FRONTEND-CAMBIOS-HOY.md)

---

## 🔗 ARCHIVOS DE REFERENCIA

1. **SUPABASE-SCHEMA-OFICIAL.sql** → Schema completo oficial
2. **migrations/999_fix_user_profiles_backend_alignment.sql** → Migración a ejecutar
3. **FRONTEND-CAMBIOS-HOY.md** → Cambios P0 de UI (badges, metadata, errores)

---

**¿Preguntas?** Backend está esperando confirmación de que migración SQL fue ejecutada exitosamente.
