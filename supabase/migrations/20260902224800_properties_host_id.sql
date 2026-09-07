-- Nullable listing owner. No backfill. Do not apply from the app.
-- public.properties.id remains text (see supabase/schema.sql).
-- Reservations are unchanged; ownership is derived via reservations.property_id.
-- RLS policies are not modified in this migration.

alter table public.properties
  add column if not exists host_id uuid references auth.users (id) on delete set null;

create index if not exists properties_host_id_idx
  on public.properties (host_id);
