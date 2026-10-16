-- Sandbox-only, review before manual application to ygipnetialejzuazfjcn.
-- Persistent guest service requests linked to an authorized stay and the
-- existing housekeeping proof workflow. No backfill and no business-row reads.

begin;

-- Fail before any DDL if the sandbox demo foundation has not been installed.
-- The project reference itself must still be confirmed in the Dashboard URL;
-- PostgreSQL does not expose the Supabase project ref as a trusted catalog value.
do $$
declare
  v_missing text[] := array[]::text[];
begin
  if to_regclass('public.properties') is null then
    v_missing := array_append(v_missing, 'public.properties');
  end if;
  if to_regclass('public.reservations') is null then
    v_missing := array_append(v_missing, 'public.reservations');
  end if;
  if to_regclass('public.guest_stay_tokens') is null then
    v_missing := array_append(v_missing, 'public.guest_stay_tokens');
  end if;
  if to_regclass('public.housekeeping_proof_tasks') is null then
    v_missing := array_append(v_missing, 'public.housekeeping_proof_tasks');
  end if;
  if to_regclass('public.housekeeping_proof_photos') is null then
    v_missing := array_append(v_missing, 'public.housekeeping_proof_photos');
  end if;
  if to_regprocedure('public.issue_housekeeping_proof_link_atomic(text,text,text,timestamp with time zone,timestamp with time zone,text,uuid)') is null then
    v_missing := array_append(v_missing, 'public.issue_housekeeping_proof_link_atomic');
  end if;
  if to_regprocedure('public.submit_housekeeping_proof_atomic(text)') is null then
    v_missing := array_append(v_missing, 'public.submit_housekeeping_proof_atomic');
  end if;
  if to_regprocedure('public.review_housekeeping_proof_batch_atomic(text,text,text,text,uuid)') is null then
    v_missing := array_append(v_missing, 'public.review_housekeeping_proof_batch_atomic');
  end if;

  if cardinality(v_missing) > 0 then
    raise exception using
      errcode = 'ZSR00',
      message = 'guest service request prerequisites are missing',
      detail = array_to_string(v_missing, ', '),
      hint = 'Install and verify the sandbox guest-token and housekeeping-proof foundation first.';
  end if;
end;
$$;

create unique index if not exists guest_stay_tokens_id_reservation_property_uidx
  on public.guest_stay_tokens (id, reservation_id, property_id);

create unique index if not exists housekeeping_proof_tasks_id_reservation_property_uidx
  on public.housekeeping_proof_tasks (id, reservation_id, property_id);

create table public.guest_service_requests (
  id uuid primary key default gen_random_uuid(),
  property_id text not null references public.properties (id),
  reservation_id text not null,
  guest_stay_token_id uuid not null references public.guest_stay_tokens (id) on delete restrict,
  request_type text not null check (request_type in ('extra_towels')),
  quantity integer not null check (quantity = 2),
  status text not null default 'requested'
    check (status in ('requested', 'assigned', 'in_progress', 'evidence_submitted', 'completed', 'needs_attention')),
  assigned_to text check (assigned_to is null or assigned_to = 'Demo Housekeeping'),
  proof_task_id uuid unique,
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint guest_service_requests_reservation_property_fkey
    foreign key (reservation_id, property_id)
    references public.reservations (id, property_id)
    on delete cascade,
  constraint guest_service_requests_token_scope_fkey
    foreign key (guest_stay_token_id, reservation_id, property_id)
    references public.guest_stay_tokens (id, reservation_id, property_id)
    on delete restrict,
  constraint guest_service_requests_proof_scope_fkey
    foreign key (proof_task_id, reservation_id, property_id)
    references public.housekeeping_proof_tasks (id, reservation_id, property_id)
    on delete restrict,
  constraint guest_service_requests_assignment_state_check check (
    (status = 'requested' and assigned_to is null)
    or (status <> 'requested' and assigned_to = 'Demo Housekeeping')
  )
);

-- Deliberate Saturday-demo limitation: only one extra-towels request can exist
-- for a reservation. This makes repeated chat submissions idempotent, but it
-- also prevents a legitimate second towel request later in the same stay.
-- Do not generalize this constraint until request occurrences/idempotency keys
-- are designed as a separate scope expansion.
create unique index if not exists guest_service_requests_one_towel_request_per_stay_uidx
  on public.guest_service_requests (reservation_id, request_type);

create index if not exists guest_service_requests_property_status_idx
  on public.guest_service_requests (property_id, status, created_at desc);

alter table public.guest_service_requests enable row level security;
alter table public.guest_service_requests force row level security;

revoke all on table public.guest_service_requests from public;
revoke all on table public.guest_service_requests from anon;
revoke all on table public.guest_service_requests from authenticated;
revoke all on table public.guest_service_requests from service_role;
grant select, insert, update on table public.guest_service_requests to service_role;

create or replace function public.enforce_guest_service_request_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.property_id <> old.property_id
    or new.reservation_id <> old.reservation_id
    or new.guest_stay_token_id <> old.guest_stay_token_id
    or new.request_type <> old.request_type
    or new.quantity <> old.quantity then
    raise exception using errcode = 'ZSR02', message = 'request scope is immutable';
  end if;

  if old.proof_task_id is not null and new.proof_task_id is distinct from old.proof_task_id then
    raise exception using errcode = 'ZSR03', message = 'proof task is immutable once linked';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'requested' and new.status = 'assigned')
    or (old.status = 'assigned' and new.status = 'in_progress')
    or (old.status = 'in_progress' and new.status = 'evidence_submitted')
    or (old.status = 'evidence_submitted' and new.status in ('completed', 'needs_attention'))
    or (old.status = 'needs_attention' and new.status = 'in_progress')
  ) then
    raise exception using errcode = 'ZSR04', message = 'invalid request status transition';
  end if;

  if old.status = 'requested' and new.status = 'assigned' then
    new.assigned_to := 'Demo Housekeeping';
    new.assigned_at := pg_catalog.now();
  elsif new.status = 'in_progress' and old.status is distinct from new.status then
    new.started_at := pg_catalog.now();
  elsif new.status = 'completed' and old.status is distinct from new.status then
    new.completed_at := pg_catalog.now();
  end if;

  if new.status = 'evidence_submitted' and not exists (
    select 1
    from public.housekeeping_proof_tasks t
    where t.id = new.proof_task_id
      and t.reservation_id = new.reservation_id
      and t.property_id = new.property_id
      and t.status = 'submitted'
      and exists (select 1 from public.housekeeping_proof_photos p where p.task_id = t.id)
  ) then
    raise exception using errcode = 'ZSR05', message = 'submitted evidence is required';
  end if;

  if new.status = 'completed' and not exists (
    select 1
    from public.housekeeping_proof_tasks t
    where t.id = new.proof_task_id
      and t.reservation_id = new.reservation_id
      and t.property_id = new.property_id
      and t.status = 'approved'
      and exists (
        select 1 from public.housekeeping_proof_photos p
        where p.task_id = t.id and p.review_status = 'approved'
      )
  ) then
    raise exception using errcode = 'ZSR06', message = 'approved evidence is required';
  end if;

  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

drop trigger if exists guest_service_requests_transition_guard on public.guest_service_requests;
create trigger guest_service_requests_transition_guard
before update on public.guest_service_requests
for each row execute function public.enforce_guest_service_request_transition();

revoke all on function public.enforce_guest_service_request_transition() from public;
revoke all on function public.enforce_guest_service_request_transition() from anon;
revoke all on function public.enforce_guest_service_request_transition() from authenticated;
revoke all on function public.enforce_guest_service_request_transition() from service_role;

create or replace function public.create_guest_towel_request_atomic(
  p_token_id uuid,
  p_reservation_id text,
  p_property_id text
)
returns table(request_id uuid, request_status text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.guest_stay_tokens t
    where t.id = p_token_id
      and t.reservation_id = p_reservation_id
      and t.property_id = p_property_id
      and t.revoked_at is null
      and t.expires_at > pg_catalog.now()
  ) then
    raise exception using errcode = 'ZSR01', message = 'stay token is not active';
  end if;

  insert into public.guest_service_requests (
    property_id, reservation_id, guest_stay_token_id, request_type, quantity
  ) values (
    p_property_id, p_reservation_id, p_token_id, 'extra_towels', 2
  )
  on conflict (reservation_id, request_type) do nothing;

  return query
  select r.id, r.status
  from public.guest_service_requests r
  where r.reservation_id = p_reservation_id
    and r.property_id = p_property_id
    and r.request_type = 'extra_towels';
end;
$$;

revoke all on function public.create_guest_towel_request_atomic(uuid, text, text) from public;
revoke all on function public.create_guest_towel_request_atomic(uuid, text, text) from anon;
revoke all on function public.create_guest_towel_request_atomic(uuid, text, text) from authenticated;
grant execute on function public.create_guest_towel_request_atomic(uuid, text, text) to service_role;

commit;
