-- Housekeeping Proof cleaner submit RPC + submitted-only host review gate (additive).
-- Do not apply this file from the application.
-- Do not modify 20260902231500_housekeeping_proof.sql,
-- 20260903001500_housekeeping_proof_issue_rpc.sql, or
-- 20260904050400_housekeeping_proof_review_rpc.sql.

create or replace function public.submit_housekeeping_proof_atomic(
  p_token_hash text
)
returns table (
  status text,
  idempotent boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_task_id uuid;
  v_lookup_task_id uuid;
  v_token_task_id uuid;
  v_expires_at timestamptz;
  v_revoked_at timestamptz;
  v_task_status text;
  v_pending integer;
  v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP001',
      MESSAGE = 'unavailable';
  end if;

  -- Resolve task only (no token lock). Authoritative token checks happen after task lock
  -- so locking order stays task → token, matching issue/reissue and avoiding deadlocks.
  select tok.task_id
    into v_lookup_task_id
  from public.housekeeping_proof_tokens tok
  where tok.token_hash = p_token_hash;

  if v_lookup_task_id is null then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP002',
      MESSAGE = 'invalid';
  end if;

  select t.id, t.status
    into v_task_id, v_task_status
  from public.housekeeping_proof_tasks t
  where t.id = v_lookup_task_id
  for update;

  if v_task_id is null then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP002',
      MESSAGE = 'invalid';
  end if;

  select tok.task_id, tok.expires_at, tok.revoked_at
    into v_token_task_id, v_expires_at, v_revoked_at
  from public.housekeeping_proof_tokens tok
  where tok.token_hash = p_token_hash
  for update;

  if v_token_task_id is null then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP002',
      MESSAGE = 'invalid';
  end if;

  if v_token_task_id is distinct from v_task_id then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP002',
      MESSAGE = 'invalid';
  end if;

  if v_revoked_at is not null then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP005',
      MESSAGE = 'revoked';
  end if;

  v_now := pg_catalog.now();

  if v_expires_at is null or v_expires_at <= v_now then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP004',
      MESSAGE = 'expired';
  end if;

  if v_task_status = 'submitted' then
    status := 'submitted';
    idempotent := true;
    return next;
    return;
  end if;

  if v_task_status = 'approved' or v_task_status = 'closed' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  if v_task_status is distinct from 'open'
     and v_task_status is distinct from 'needs_attention' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  select count(*)::integer
    into v_pending
  from public.housekeeping_proof_photos p
  where p.task_id = v_task_id
    and p.review_status = 'pending';

  if v_pending < 1 then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  update public.housekeeping_proof_tasks t
  set
    status = 'submitted',
    submitted_at = v_now,
    updated_at = v_now
  where t.id = v_task_id;

  status := 'submitted';
  idempotent := false;
  return next;
end;
$$;

revoke all on function public.submit_housekeeping_proof_atomic(text) from public;
revoke all on function public.submit_housekeeping_proof_atomic(text) from anon;
revoke all on function public.submit_housekeeping_proof_atomic(text) from authenticated;
grant execute on function public.submit_housekeeping_proof_atomic(text) to service_role;

-- Host review: real decisions only after cleaner Finish (submitted).
create or replace function public.review_housekeeping_proof_batch_atomic(
  p_property_id text,
  p_reservation_id text,
  p_stage text,
  p_decision text,
  p_reviewed_by uuid default null
)
returns table (
  status text,
  reviewed_photo_count integer,
  idempotent boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_task_id uuid;
  v_task_property_id text;
  v_task_status text;
  v_pending integer;
  v_photo_status text;
  v_now timestamptz;
begin
  if p_property_id is null or pg_catalog.btrim(p_property_id) = '' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP001',
      MESSAGE = 'unavailable';
  end if;

  if p_reservation_id is null or pg_catalog.btrim(p_reservation_id) = '' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP001',
      MESSAGE = 'unavailable';
  end if;

  if p_stage is distinct from 'post_checkout' and p_stage is distinct from 'ready_for_checkin' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP001',
      MESSAGE = 'unavailable';
  end if;

  if p_decision is distinct from 'approve' and p_decision is distinct from 'needs_attention' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP001',
      MESSAGE = 'unavailable';
  end if;

  select t.id, t.property_id, t.status
    into v_task_id, v_task_property_id, v_task_status
  from public.housekeeping_proof_tasks t
  where t.reservation_id = p_reservation_id
    and t.stage = p_stage
  for update;

  if v_task_id is null then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP002',
      MESSAGE = 'invalid';
  end if;

  if v_task_property_id is distinct from p_property_id then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP002',
      MESSAGE = 'invalid';
  end if;

  select count(*)::integer
    into v_pending
  from public.housekeeping_proof_photos p
  where p.task_id = v_task_id
    and p.review_status = 'pending';

  if v_task_status = 'approved'
     and p_decision = 'approve'
     and v_pending = 0 then
    status := 'approved';
    reviewed_photo_count := 0;
    idempotent := true;
    return next;
    return;
  end if;

  if v_task_status = 'needs_attention'
     and p_decision = 'needs_attention'
     and v_pending = 0 then
    status := 'needs_attention';
    reviewed_photo_count := 0;
    idempotent := true;
    return next;
    return;
  end if;

  if v_task_status = 'closed' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  if v_task_status = 'approved' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  -- Real review decisions require cleaner Finish (submitted) + pending photos.
  if v_task_status is distinct from 'submitted' then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  if v_pending < 1 then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  v_now := pg_catalog.now();

  if p_decision = 'approve' then
    v_photo_status := 'approved';
    v_task_status := 'approved';
  else
    v_photo_status := 'rejected';
    v_task_status := 'needs_attention';
  end if;

  update public.housekeeping_proof_photos p
  set
    review_status = v_photo_status,
    reviewed_at = v_now,
    reviewed_by = p_reviewed_by
  where p.task_id = v_task_id
    and p.review_status = 'pending';

  get diagnostics reviewed_photo_count = row_count;

  if reviewed_photo_count < 1 then
    RAISE EXCEPTION USING
      ERRCODE = 'ZP003',
      MESSAGE = 'conflict';
  end if;

  update public.housekeeping_proof_tasks t
  set
    status = v_task_status,
    reviewed_at = v_now,
    updated_at = v_now
  where t.id = v_task_id;

  status := v_task_status;
  idempotent := false;
  return next;
end;
$$;

revoke all on function public.review_housekeeping_proof_batch_atomic(text, text, text, text, uuid) from public;
revoke all on function public.review_housekeeping_proof_batch_atomic(text, text, text, text, uuid) from anon;
revoke all on function public.review_housekeeping_proof_batch_atomic(text, text, text, text, uuid) from authenticated;
grant execute on function public.review_housekeeping_proof_batch_atomic(text, text, text, text, uuid) to service_role;
