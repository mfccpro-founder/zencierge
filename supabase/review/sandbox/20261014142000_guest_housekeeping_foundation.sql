-- SANDBOX ONLY. Review before manual application to ygipnetialejzuazfjcn.
-- Minimal foundation required by the current guest-stay and housekeeping-proof
-- server routes. No business-row reads, backfill, public policies, or client grants.
-- Confirm the Dashboard URL contains /project/ygipnetialejzuazfjcn/ first.

begin;

do $$
begin
  if to_regclass('public.properties') is null
     or to_regclass('public.reservations') is null then
    raise exception using errcode = 'ZHF00', message = 'properties and reservations must exist first';
  end if;
  if to_regclass('public.guest_stay_tokens') is not null
     or to_regclass('public.housekeeping_proof_tasks') is not null
     or to_regclass('public.housekeeping_proof_tokens') is not null
     or to_regclass('public.housekeeping_proof_photos') is not null then
    raise exception using errcode = 'ZHF01', message = 'sandbox foundation already exists; stop and diagnose drift';
  end if;
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception using errcode = 'ZHF03', message = 'Supabase Storage catalogs are missing';
  end if;
  if exists (select 1 from storage.buckets where id = 'housekeeping-proof') then
    raise exception using errcode = 'ZHF04', message = 'housekeeping-proof bucket already exists; stop and diagnose its configuration';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_class t on t.oid = i.indrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'reservations'
      and c.relname = 'reservations_id_property_id_uidx'
      and i.indisunique and i.indisvalid
  ) then
    raise exception using errcode = 'ZHF02', message = 'reservations composite unique index is missing';
  end if;
end;
$$;

create table public.guest_stay_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  reservation_id text not null,
  property_id text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint guest_stay_tokens_reservation_property_fkey
    foreign key (reservation_id, property_id)
    references public.reservations (id, property_id)
    on delete cascade,
  constraint guest_stay_tokens_revocation_check
    check (revoked_at is null or revoked_at >= created_at)
);

create index guest_stay_tokens_reservation_idx on public.guest_stay_tokens (reservation_id);
create index guest_stay_tokens_property_idx on public.guest_stay_tokens (property_id);
create index guest_stay_tokens_expires_idx on public.guest_stay_tokens (expires_at);
create unique index guest_stay_tokens_id_reservation_property_uidx
  on public.guest_stay_tokens (id, reservation_id, property_id);

create table public.housekeeping_proof_tasks (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id),
  reservation_id text not null,
  stage text not null check (stage in ('post_checkout', 'ready_for_checkin')),
  status text not null default 'open'
    check (status in ('open', 'submitted', 'approved', 'needs_attention', 'closed')),
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

create index housekeeping_proof_tasks_property_idx on public.housekeeping_proof_tasks (property_id);
create index housekeeping_proof_tasks_reservation_idx on public.housekeeping_proof_tasks (reservation_id);
create index housekeeping_proof_tasks_status_idx on public.housekeeping_proof_tasks (status);
create unique index housekeeping_proof_tasks_reservation_stage_uidx
  on public.housekeeping_proof_tasks (reservation_id, stage);
create unique index housekeeping_proof_tasks_id_reservation_property_uidx
  on public.housekeeping_proof_tasks (id, reservation_id, property_id);

create table public.housekeeping_proof_tokens (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.housekeeping_proof_tasks (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint housekeeping_proof_tokens_revocation_check
    check (revoked_at is null or revoked_at >= created_at)
);

create index housekeeping_proof_tokens_task_idx on public.housekeeping_proof_tokens (task_id);
create unique index housekeeping_proof_tokens_one_active_per_task_idx
  on public.housekeeping_proof_tokens (task_id) where revoked_at is null;

create table public.housekeeping_proof_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.housekeeping_proof_tasks (id) on delete cascade,
  storage_path text not null unique check (storage_path ~ '^proof/[0-9a-f-]{36}\.jpg$'),
  content_type text not null check (content_type = 'image/jpeg'),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null
);

create index housekeeping_proof_photos_task_idx on public.housekeeping_proof_photos (task_id);
create index housekeeping_proof_photos_review_idx
  on public.housekeeping_proof_photos (task_id, review_status);

alter table public.guest_stay_tokens enable row level security;
alter table public.guest_stay_tokens force row level security;
alter table public.housekeeping_proof_tasks enable row level security;
alter table public.housekeeping_proof_tasks force row level security;
alter table public.housekeeping_proof_tokens enable row level security;
alter table public.housekeeping_proof_tokens force row level security;
alter table public.housekeeping_proof_photos enable row level security;
alter table public.housekeeping_proof_photos force row level security;

revoke all on table public.guest_stay_tokens from public, anon, authenticated, service_role;
revoke all on table public.housekeeping_proof_tasks from public, anon, authenticated, service_role;
revoke all on table public.housekeeping_proof_tokens from public, anon, authenticated, service_role;
revoke all on table public.housekeeping_proof_photos from public, anon, authenticated, service_role;
grant select, insert, update on table public.guest_stay_tokens to service_role;
grant select, insert, update on table public.housekeeping_proof_tasks to service_role;
grant select, insert, update on table public.housekeeping_proof_tokens to service_role;
grant select, insert, update on table public.housekeeping_proof_photos to service_role;

-- Private Storage bucket. Current routes upload/download/remove only through the
-- server service-role client; no storage.objects policy is needed or added.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('housekeeping-proof', 'housekeeping-proof', false, 10485760, array['image/jpeg']::text[]);

create function public.issue_housekeeping_proof_link_atomic(
  p_property_id text,
  p_reservation_id text,
  p_stage text,
  p_due_at timestamptz,
  p_expires_at timestamptz,
  p_token_hash text,
  p_created_by uuid
)
returns table(task_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_task_id uuid;
  v_existing_status text;
begin
  if p_stage is null or p_stage not in ('post_checkout', 'ready_for_checkin')
     or p_property_id is null or btrim(p_property_id) = ''
     or p_reservation_id is null or btrim(p_reservation_id) = ''
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null or p_expires_at <= pg_catalog.now() then
    raise exception using errcode = 'ZP001', message = 'unavailable';
  end if;
  if not exists (
    select 1 from public.reservations r
    where r.id = p_reservation_id and r.property_id = p_property_id
  ) then
    raise exception using errcode = 'ZP002', message = 'invalid';
  end if;

  insert into public.housekeeping_proof_tasks
    (property_id, reservation_id, stage, status, created_by, due_at)
  values (p_property_id, p_reservation_id, p_stage, 'open', p_created_by, p_due_at)
  on conflict (reservation_id, stage) do update
    set due_at = excluded.due_at, updated_at = pg_catalog.now()
    where public.housekeeping_proof_tasks.status in ('open', 'needs_attention')
  returning id into v_task_id;

  if v_task_id is null then
    select status into v_existing_status from public.housekeeping_proof_tasks
    where reservation_id = p_reservation_id and stage = p_stage;
    if v_existing_status = 'submitted' then
      raise exception using errcode = 'ZP004', message = 'submitted';
    end if;
    raise exception using errcode = 'ZP003', message = 'conflict';
  end if;

  update public.housekeeping_proof_tokens as tok
    set revoked_at = pg_catalog.now()
    where tok.task_id = v_task_id and tok.revoked_at is null;
  insert into public.housekeeping_proof_tokens
    (task_id, token_hash, expires_at, created_by)
  values (v_task_id, p_token_hash, p_expires_at, p_created_by);
  task_id := v_task_id;
  expires_at := p_expires_at;
  return next;
end;
$$;

create function public.submit_housekeeping_proof_atomic(p_token_hash text)
returns table(status text, idempotent boolean)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_task_id uuid; v_expires_at timestamptz; v_revoked_at timestamptz;
  v_status text; v_pending integer;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'ZP001', message = 'unavailable';
  end if;
  select tok.task_id into v_task_id from public.housekeeping_proof_tokens tok
    where tok.token_hash = p_token_hash;
  if v_task_id is null then raise exception using errcode = 'ZP002', message = 'invalid'; end if;
  select t.status into v_status from public.housekeeping_proof_tasks t
    where t.id = v_task_id for update;
  select tok.expires_at, tok.revoked_at into v_expires_at, v_revoked_at
    from public.housekeeping_proof_tokens tok
    where tok.token_hash = p_token_hash and tok.task_id = v_task_id for update;
  if v_revoked_at is not null then raise exception using errcode = 'ZP005', message = 'revoked'; end if;
  if v_expires_at is null or v_expires_at <= pg_catalog.now() then
    raise exception using errcode = 'ZP004', message = 'expired';
  end if;
  if v_status = 'submitted' then status := v_status; idempotent := true; return next; return; end if;
  if v_status not in ('open', 'needs_attention') then
    raise exception using errcode = 'ZP003', message = 'conflict';
  end if;
  select count(*)::integer into v_pending from public.housekeeping_proof_photos
    where task_id = v_task_id and review_status = 'pending';
  if v_pending < 1 then raise exception using errcode = 'ZP003', message = 'conflict'; end if;
  update public.housekeeping_proof_tasks set status = 'submitted',
    submitted_at = pg_catalog.now(), updated_at = pg_catalog.now() where id = v_task_id;
  status := 'submitted'; idempotent := false; return next;
end;
$$;

create function public.review_housekeeping_proof_batch_atomic(
  p_property_id text, p_reservation_id text, p_stage text,
  p_decision text, p_reviewed_by uuid default null
)
returns table(status text, reviewed_photo_count integer, idempotent boolean)
language plpgsql security definer set search_path = pg_catalog
as $$
declare
  v_task_id uuid; v_status text; v_pending integer; v_photo_status text;
begin
  if p_stage is null or p_stage not in ('post_checkout', 'ready_for_checkin')
     or p_decision is null or p_decision not in ('approve', 'needs_attention') then
    raise exception using errcode = 'ZP001', message = 'unavailable';
  end if;
  select t.id, t.status into v_task_id, v_status
    from public.housekeeping_proof_tasks t
    where t.property_id = p_property_id and t.reservation_id = p_reservation_id
      and t.stage = p_stage for update;
  if v_task_id is null then raise exception using errcode = 'ZP002', message = 'invalid'; end if;
  select count(*)::integer into v_pending from public.housekeeping_proof_photos
    where task_id = v_task_id and review_status = 'pending';
  if v_status = 'approved' and p_decision = 'approve' and v_pending = 0 then
    status := v_status; reviewed_photo_count := 0; idempotent := true; return next; return;
  end if;
  if v_status = 'needs_attention' and p_decision = 'needs_attention' and v_pending = 0 then
    status := v_status; reviewed_photo_count := 0; idempotent := true; return next; return;
  end if;
  if v_status <> 'submitted' or v_pending < 1 then
    raise exception using errcode = 'ZP003', message = 'conflict';
  end if;
  v_photo_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  update public.housekeeping_proof_photos set review_status = v_photo_status,
    reviewed_at = pg_catalog.now(), reviewed_by = p_reviewed_by
    where task_id = v_task_id and review_status = 'pending';
  get diagnostics reviewed_photo_count = row_count;
  v_status := case when p_decision = 'approve' then 'approved' else 'needs_attention' end;
  update public.housekeeping_proof_tasks set status = v_status,
    reviewed_at = pg_catalog.now(), updated_at = pg_catalog.now() where id = v_task_id;
  status := v_status; idempotent := false; return next;
end;
$$;

revoke all on function public.issue_housekeeping_proof_link_atomic(text,text,text,timestamptz,timestamptz,text,uuid) from public, anon, authenticated;
revoke all on function public.submit_housekeeping_proof_atomic(text) from public, anon, authenticated;
revoke all on function public.review_housekeeping_proof_batch_atomic(text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.issue_housekeeping_proof_link_atomic(text,text,text,timestamptz,timestamptz,text,uuid) to service_role;
grant execute on function public.submit_housekeeping_proof_atomic(text) to service_role;
grant execute on function public.review_housekeeping_proof_batch_atomic(text,text,text,text,uuid) to service_role;

commit;
