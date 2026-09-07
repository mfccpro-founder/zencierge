-- Atomic housekeeping proof link issue.
-- Do not apply from the app. Run in the Supabase SQL editor when ready.
-- Does not modify 20260902231500_housekeeping_proof.sql.
-- No backfill. No writes to existing rows except inside the function when called.
-- One task per reservation per stage. Token rotate is revoke-then-insert in one call.

create unique index if not exists housekeeping_proof_tasks_reservation_stage_uidx
  on public.housekeeping_proof_tasks (reservation_id, stage);

create or replace function public.issue_housekeeping_proof_link_atomic(
  p_property_id text,
  p_reservation_id text,
  p_stage text,
  p_due_at timestamptz,
  p_expires_at timestamptz,
  p_token_hash text,
  p_created_by uuid
)
returns table(task_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_task_id uuid;
  v_reservation_property_id text;
  v_task_property_id text;
begin
  if p_stage is distinct from 'post_checkout' and p_stage is distinct from 'ready_for_checkin' then
    raise exception 'unavailable';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'unavailable';
  end if;

  if p_expires_at is null or p_expires_at <= pg_catalog.now() then
    raise exception 'unavailable';
  end if;

  if p_property_id is null or btrim(p_property_id) = '' or p_reservation_id is null or btrim(p_reservation_id) = '' then
    raise exception 'unavailable';
  end if;

  select r.property_id
    into v_reservation_property_id
  from public.reservations as r
  where r.id = p_reservation_id
  for share;

  if v_reservation_property_id is null then
    raise exception 'unavailable';
  end if;

  if v_reservation_property_id is distinct from p_property_id then
    raise exception 'unavailable';
  end if;

  insert into public.housekeeping_proof_tasks (
    property_id,
    reservation_id,
    stage,
    status,
    created_by,
    due_at
  )
  values (
    p_property_id,
    p_reservation_id,
    p_stage,
    'open',
    p_created_by,
    p_due_at
  )
  on conflict (reservation_id, stage) do update
  set
    due_at = excluded.due_at,
    updated_at = pg_catalog.now()
  where public.housekeeping_proof_tasks.status in ('open', 'submitted', 'needs_attention')
  returning id into v_task_id;

  if v_task_id is null then
    raise exception 'unavailable';
  end if;

  select t.property_id
    into v_task_property_id
  from public.housekeeping_proof_tasks as t
  where t.id = v_task_id;

  if v_task_property_id is distinct from p_property_id then
    raise exception 'unavailable';
  end if;

  update public.housekeeping_proof_tokens as tok
  set revoked_at = pg_catalog.now()
  where tok.task_id = v_task_id
    and tok.revoked_at is null;

  insert into public.housekeeping_proof_tokens (
    task_id,
    token_hash,
    expires_at,
    created_by
  )
  values (
    v_task_id,
    p_token_hash,
    p_expires_at,
    p_created_by
  );

  task_id := v_task_id;
  expires_at := p_expires_at;
  return next;
end;
$$;

revoke all on function public.issue_housekeeping_proof_link_atomic(text, text, text, timestamptz, timestamptz, text, uuid) from public;
revoke all on function public.issue_housekeeping_proof_link_atomic(text, text, text, timestamptz, timestamptz, text, uuid) from anon;
revoke all on function public.issue_housekeeping_proof_link_atomic(text, text, text, timestamptz, timestamptz, text, uuid) from authenticated;
grant execute on function public.issue_housekeeping_proof_link_atomic(text, text, text, timestamptz, timestamptz, text, uuid) to service_role;
