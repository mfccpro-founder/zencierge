-- Temporary complimentary access on host_subscriptions.
-- Explicit columns — do not overload trial metadata or is_lifetime_free.
-- Do not apply from the app. Run in the Supabase SQL editor when ready.
-- No Square mutations. No RLS changes.

alter table public.host_subscriptions
  add column if not exists complimentary_starts_at timestamptz;

alter table public.host_subscriptions
  add column if not exists complimentary_ends_at timestamptz;

alter table public.host_subscriptions
  add column if not exists complimentary_granted_by uuid references auth.users (id) on delete set null;

alter table public.host_subscriptions
  add column if not exists complimentary_granted_at timestamptz;

comment on column public.host_subscriptions.complimentary_starts_at is
  'Founder-granted complimentary access window start (UTC).';

comment on column public.host_subscriptions.complimentary_ends_at is
  'Founder-granted complimentary access window end (UTC). Access ends automatically after this instant.';

comment on column public.host_subscriptions.complimentary_granted_by is
  'SuperAdmin auth.users.id who last granted or extended complimentary access.';

comment on column public.host_subscriptions.complimentary_granted_at is
  'When complimentary access was last granted or extended.';

create index if not exists host_subscriptions_complimentary_ends_idx
  on public.host_subscriptions (complimentary_ends_at)
  where complimentary_ends_at is not null;
