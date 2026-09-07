-- Reservation-scoped Guest Portal stay tokens.
-- Do not apply from the app. Run in the Supabase SQL editor when ready.
-- public.properties.id and public.reservations.id are text (see supabase/schema.sql).
-- Access is server-only via the service role. No anon or authenticated policies.

create table if not exists public.guest_stay_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  reservation_id text not null references public.reservations (id) on delete cascade,
  property_id text not null references public.properties (id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists guest_stay_tokens_reservation_idx
  on public.guest_stay_tokens (reservation_id);

create index if not exists guest_stay_tokens_property_idx
  on public.guest_stay_tokens (property_id);

create index if not exists guest_stay_tokens_expires_idx
  on public.guest_stay_tokens (expires_at);

alter table public.guest_stay_tokens enable row level security;

drop policy if exists "anon select guest_stay_tokens" on public.guest_stay_tokens;
drop policy if exists "anon insert guest_stay_tokens" on public.guest_stay_tokens;
drop policy if exists "anon update guest_stay_tokens" on public.guest_stay_tokens;
drop policy if exists "anon delete guest_stay_tokens" on public.guest_stay_tokens;
drop policy if exists "authenticated select guest_stay_tokens" on public.guest_stay_tokens;
drop policy if exists "authenticated insert guest_stay_tokens" on public.guest_stay_tokens;
drop policy if exists "authenticated update guest_stay_tokens" on public.guest_stay_tokens;
drop policy if exists "authenticated delete guest_stay_tokens" on public.guest_stay_tokens;

revoke all on table public.guest_stay_tokens from public;
revoke all on table public.guest_stay_tokens from anon;
revoke all on table public.guest_stay_tokens from authenticated;

grant all on table public.guest_stay_tokens to service_role;
