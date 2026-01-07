# SCHEMA ACTUAL DE SUPABASE (REFERENCIA)

⚠️ **ESTE ES EL SCHEMA REAL** - Úsalo SIEMPRE para nuevas migraciones

## PATRÓN DE FOREIGN KEYS

```sql
-- ✅ CORRECTO - Todas las tablas usan estos campos:
user_id UUID REFERENCES auth.users(id)
owner_user_id UUID REFERENCES auth.users(id)  -- Solo en email_accounts, telegram_*, notification_jobs
```

## TABLAS CON user_id (MAYORÍA)
- ae_sessions → `user_id UUID`
- user_conversations → `user_id UUID`
- user_integrations → `user_id UUID`
- user_notifications → `user_id UUID`
- user_profiles → `user_id UUID`
- user_projects → `user_id UUID`
- user_sessions → `user_id UUID`
- user_settings → `user_id UUID`
- mail_attachments_new → `user_id UUID`
- mail_drafts_new → `user_id UUID`
- mail_filters → `user_id UUID`
- mail_messages_new → `user_id UUID`
- project_members → `user_id UUID`
- telegram_accounts → `user_id UUID`

## TABLAS CON owner_user_id (EMAIL/TELEGRAM)
- email_accounts → `owner_user_id UUID`
- email_attachments → `owner_user_id UUID`
- email_contacts → `owner_user_id UUID`
- email_drafts → `owner_user_id UUID`
- email_folders → `owner_user_id UUID`
- email_messages → `owner_user_id UUID`
- email_rules → `owner_user_id UUID`
- email_threads → `owner_user_id UUID`
- mail_messages_old → `owner_user_id UUID`
- mail_threads_old → `owner_user_id UUID`
- notification_jobs → `owner_user_id UUID`
- telegram_bots → `owner_user_id UUID`
- telegram_chats → `owner_user_id UUID`
- telegram_messages → `owner_user_id UUID`

## TABLAS CON AMBOS
- ae_sessions → `user_id_uuid UUID` (deprecated) + `user_id UUID` (nuevo)

## CALENDAR_EVENTS (YA EXISTE EN PRODUCCIÓN)

```sql
CREATE TABLE public.calendar_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  start_at timestamp with time zone NOT NULL,
  end_at timestamp with time zone NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Mexico_City'::text,
  location text,
  attendees_json jsonb DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'scheduled'::text CHECK (status = ANY (ARRAY['scheduled'::text, 'cancelled'::text, 'completed'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  notification_minutes integer DEFAULT 60,
  CONSTRAINT calendar_events_pkey PRIMARY KEY (id)
);
```

## REGLAS PARA NUEVAS MIGRACIONES

1. **Email/Telegram/Notifications** → usa `owner_user_id`
2. **User settings/projects/sessions** → usa `user_id`
3. **Calendar** → usa `owner_user_id` (ya existe así)
4. Siempre usa `gen_random_uuid()` no `uuid_generate_v4()`
5. Siempre usa `text` no `VARCHAR`
6. Timestamps: `timestamp with time zone` no `TIMESTAMPTZ`
7. Arrays: usa `jsonb` con valor default `'[]'::jsonb`

## ÚLTIMA ACTUALIZACIÓN
6 de enero de 2026 - 21:45
