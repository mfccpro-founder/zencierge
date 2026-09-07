-- Isolated maid photo proof foundation (before check-in / after checkout).
-- Do not apply from the app. Run in the Supabase SQL editor when ready.
-- public.properties.id and public.reservations.id are text (see supabase/schema.sql).
-- No backfill. No writes to existing rows.
-- Do not reuse legacy inspection tables, the public staff bucket, or the staff camera upload route.
-- Access is server-only via the service role after later token/ownership checks.
-- No anon or authenticated policies. Existing RLS policies are unchanged.

create unique index if not exists reservations_id_property_id_uidx
  on public.reservations (id, property_id);

create table if not exists public.housekeeping_proof_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id),
  reservation_id text not null,
  stage text not null check (stage in ('post_checkout', 'ready_for_checkin')),
  status text not null default 'open' check (status in ('open', 'submitted', 'approved', 'needs_attention', 'closed')),
  created_by uuid references auth.users (id) on delete set null,
  due_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint housekeeping_proof_tasks_reservation_property_fkey
    foreign key (reservation_id, property_id)
    references public.reservations (id, property_id)
    on delete cascade
);

create index if not exists housekeeping_proof_tasks_property_idx
  on public.housekeeping_proof_tasks (property_id);

create index if not exists housekeeping_proof_tasks_reservation_idx
  on public.housekeeping_proof_tasks (reservation_id);

create index if not exists housekeeping_proof_tasks_status_idx
  on public.housekeeping_proof_tasks (status);

create table if not exists public.housekeeping_proof_tokens (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.housekeeping_proof_tasks (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists housekeeping_proof_tokens_task_idx
  on public.housekeeping_proof_tokens (task_id);

create unique index if not exists housekeeping_proof_tokens_one_active_per_task_idx
  on public.housekeeping_proof_tokens (task_id)
  where revoked_at is null;

create table if not exists public.housekeeping_proof_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.housekeeping_proof_tasks (id) on delete cascade,
  storage_path text not null unique,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null
);

create index if not exists housekeeping_proof_photos_task_idx
  on public.housekeeping_proof_photos (task_id);

create index if not exists housekeeping_proof_photos_review_idx
  on public.housekeeping_proof_photos (task_id, review_status);

alter table public.housekeeping_proof_tasks enable row level security;
alter table public.housekeeping_proof_tokens enable row level security;
alter table public.housekeeping_proof_photos enable row level security;

revoke all on table public.housekeeping_proof_tasks from public;
revoke all on table public.housekeeping_proof_tasks from anon;
revoke all on table public.housekeeping_proof_tasks from authenticated;
revoke all on table public.housekeeping_proof_tokens from public;
revoke all on table public.housekeeping_proof_tokens from anon;
revoke all on table public.housekeeping_proof_tokens from authenticated;
revoke all on table public.housekeeping_proof_photos from public;
revoke all on table public.housekeeping_proof_photos from anon;
revoke all on table public.housekeeping_proof_photos from authenticated;

grant all on table public.housekeeping_proof_tasks to service_role;
grant all on table public.housekeeping_proof_tokens to service_role;
grant all on table public.housekeeping_proof_photos to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'housekeeping-proof',
  'housekeeping-proof',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
