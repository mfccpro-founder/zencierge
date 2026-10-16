-- TTS meter foundation: logical requests, attempts, and leases.
-- Additive. Does not alter public.ai_usage_events or historical rows.
-- Does not call a provider and does not create a Storage bucket.
-- Run in the Supabase SQL editor. Do not apply from the app.
--
-- Audio object protocol:
-- Postgres and Supabase Storage do not share a transaction.
-- The server uploads one private object per attempt after it holds the lease.
-- The object key is tts-attempt/{attempt_id}/{acquisition_token} in bucket ai-usage-tts-audio.
-- That bucket is private, has no public policy, and is not created here.
-- commit_ai_usage_attempt_audio is conditioned on the current acquisition token and a live lease.
-- A stale acquisition token cannot replace a committed audio object.
-- The previous object of the same token is listed for cleanup when that token stores a replacement.
-- This migration does not assume storage lifecycle expiry.
-- mark_ai_usage_audio_for_cleanup lists orphan and expired objects for a later worker.
-- The worker deletes the Storage object, then acknowledge_ai_usage_audio_cleanup records that delete.
-- host_tts remains withheld in this block. That is a technical gate for this block, not a final commercial policy.
-- Lock the logical request before its attempt or audio row.
-- Check the acquisition token and the live lease while that request lock is held, before changing rows.
-- The sequential test does not prove concurrent races.

begin;

create table if not exists public.ai_usage_logical_requests (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  client_usage_key text not null,
  billing_subject text not null,
  source text not null,
  operation text not null,
  synthesis_binding_hash text not null,
  host_id uuid null,
  property_id text null,
  reservation_id text null,
  state text not null default 'issued',
  billing_eligibility text not null default 'withheld',
  key_origin text not null,
  expires_at timestamptz not null,
  acquisition_token uuid null,
  lease_expires_at timestamptz null,
  next_attempt_ordinal integer not null default 0,
  active_audio_object_key text null,
  active_audio_attempt_id uuid null,
  active_audio_expires_at timestamptz null,
  active_audio_owner_token uuid null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint ai_usage_logical_requests_key_unique unique (client_usage_key),
  constraint ai_usage_logical_requests_key_length_check check (char_length(client_usage_key) between 16 and 128),
  constraint ai_usage_logical_requests_subject_length_check check (char_length(billing_subject) between 3 and 200),
  constraint ai_usage_logical_requests_hash_length_check check (char_length(synthesis_binding_hash) between 32 and 128),
  constraint ai_usage_logical_requests_operation_check check (operation = 'tts'),
  constraint ai_usage_logical_requests_source_check check (
    source in ('guest_stay_tts', 'guest_stay_welcome_tts', 'host_tts')
  ),
  constraint ai_usage_logical_requests_state_check check (
    state in ('issued', 'acquired', 'in_progress', 'completed', 'failed', 'uncertain')
  ),
  constraint ai_usage_logical_requests_eligibility_check check (
    billing_eligibility in ('withheld', 'candidate')
  ),
  constraint ai_usage_logical_requests_origin_check check (key_origin in ('issued', 'legacy')),
  constraint ai_usage_logical_requests_ordinal_check check (next_attempt_ordinal >= 0),
  constraint ai_usage_logical_requests_legacy_withheld_check check (
    key_origin <> 'legacy' or billing_eligibility = 'withheld'
  ),
  constraint ai_usage_logical_requests_candidate_requires_host_and_property check (
    billing_eligibility <> 'candidate'
    or (
      state = 'completed'
      and host_id is not null
      and property_id is not null
      and key_origin = 'issued'
      and source in ('guest_stay_tts', 'guest_stay_welcome_tts')
    )
  ),
  constraint ai_usage_logical_requests_lease_matches_state_check check (
    (
      state in ('acquired', 'in_progress')
      and acquisition_token is not null
      and lease_expires_at is not null
    )
    or (
      state in ('issued', 'completed', 'failed', 'uncertain')
      and acquisition_token is null
      and lease_expires_at is null
    )
  )
);

comment on table public.ai_usage_logical_requests is
  'One logical TTS request. Eligibility starts withheld. host_tts cannot become candidate in this block.';

comment on column public.ai_usage_logical_requests.synthesis_binding_hash is
  'Binding check for subject, source, operation, and synthesis parameters. It does not deduplicate other requests.';

create table if not exists public.ai_usage_attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  logical_request_id uuid not null references public.ai_usage_logical_requests (id),
  attempt_ordinal integer not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  dispatch_progress text not null default 'reserved',
  result_state text not null default 'open',
  response_observed_at timestamptz null,
  provider text null,
  model text null,
  calculated_cost_cents integer null,
  cost_class text null,
  input_characters integer null,
  audio_bytes integer null,
  stream_completed boolean null,
  audio_delivery_state text not null default 'pending',
  audio_object_key text null,
  audio_expires_at timestamptz null,
  audio_committed_token uuid null,
  constraint ai_usage_attempts_ordinal_unique unique (logical_request_id, attempt_ordinal),
  constraint ai_usage_attempts_ordinal_positive check (attempt_ordinal >= 1),
  constraint ai_usage_attempts_dispatch_check check (
    dispatch_progress in ('reserved', 'dispatch_started', 'response_observed')
  ),
  constraint ai_usage_attempts_result_check check (
    result_state in ('open', 'provider_complete', 'failed', 'uncertain')
  ),
  constraint ai_usage_attempts_cost_check check (
    (cost_class is null and calculated_cost_cents is null)
    or (cost_class = 'pending' and calculated_cost_cents is null)
    or (cost_class = 'estimated' and calculated_cost_cents is not null and calculated_cost_cents >= 0)
  ),
  constraint ai_usage_attempts_uncertain_cost_check check (
    result_state <> 'uncertain'
    or (calculated_cost_cents is null and cost_class = 'pending')
  ),
  constraint ai_usage_attempts_observed_evidence_check check (
    (
      response_observed_at is null
      and dispatch_progress in ('reserved', 'dispatch_started')
    )
    or (
      response_observed_at is not null
      and dispatch_progress = 'response_observed'
    )
  ),
  constraint ai_usage_attempts_delivery_check check (
    audio_delivery_state in ('pending', 'stored', 'store_failed', 'delivery_failed')
  ),
  constraint ai_usage_attempts_audio_key_check check (
    (audio_object_key is null and audio_delivery_state <> 'stored')
    or (audio_object_key is not null and audio_delivery_state = 'stored')
  )
);

comment on column public.ai_usage_attempts.response_observed_at is
  'Kept after the result becomes uncertain. Observation and the final result are separate.';

comment on column public.ai_usage_attempts.dispatch_progress is
  'reserved, dispatch_started, or response_observed. dispatch_started does not confirm the provider received the call.';

create table if not exists public.ai_usage_key_rejections (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  created_at timestamptz not null default pg_catalog.now(),
  reason text not null,
  client_usage_key text null,
  billing_subject text null,
  source text null,
  operation text null,
  constraint ai_usage_key_rejections_reason_check check (
    reason in ('unknown', 'expired', 'subject_mismatch', 'binding_mismatch')
  )
);

comment on table public.ai_usage_key_rejections is
  'Rejected keys. Not a provider attempt: no provider, ordinal, or cost.';

create table if not exists public.ai_usage_audio_objects (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  attempt_id uuid not null references public.ai_usage_attempts (id),
  object_key text not null,
  acquisition_token uuid not null,
  byte_length integer not null,
  content_type text not null,
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  commit_state text not null default 'pending_upload',
  cleanup_state text not null default 'none',
  storage_deleted_at timestamptz null,
  constraint ai_usage_audio_objects_key_unique unique (object_key),
  constraint ai_usage_audio_objects_bytes_check check (byte_length > 0),
  constraint ai_usage_audio_objects_commit_check check (
    commit_state in ('pending_upload', 'committed', 'orphan', 'expired')
  ),
  constraint ai_usage_audio_objects_cleanup_check check (
    cleanup_state in ('none', 'cleanup_requested')
  )
);

comment on table public.ai_usage_audio_objects is
  'Registry of private audio objects. Storage deletion happens outside this transaction, after cleanup is requested.';

create index if not exists ai_usage_logical_requests_created_at_idx
  on public.ai_usage_logical_requests (created_at);

create index if not exists ai_usage_attempts_created_at_idx
  on public.ai_usage_attempts (created_at);

create index if not exists ai_usage_attempts_logical_request_idx
  on public.ai_usage_attempts (logical_request_id);

create index if not exists ai_usage_audio_objects_cleanup_idx
  on public.ai_usage_audio_objects (cleanup_state, expires_at)
  where storage_deleted_at is null;

alter table public.ai_usage_logical_requests enable row level security;
alter table public.ai_usage_attempts enable row level security;
alter table public.ai_usage_key_rejections enable row level security;
alter table public.ai_usage_audio_objects enable row level security;

drop policy if exists "anon select ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "anon insert ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "anon update ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "anon delete ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "authenticated select ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "authenticated insert ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "authenticated update ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "authenticated delete ai_usage_logical_requests" on public.ai_usage_logical_requests;
drop policy if exists "anon select ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "anon insert ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "anon update ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "anon delete ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "authenticated select ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "authenticated insert ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "authenticated update ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "authenticated delete ai_usage_attempts" on public.ai_usage_attempts;
drop policy if exists "anon select ai_usage_key_rejections" on public.ai_usage_key_rejections;
drop policy if exists "authenticated select ai_usage_key_rejections" on public.ai_usage_key_rejections;
drop policy if exists "anon select ai_usage_audio_objects" on public.ai_usage_audio_objects;
drop policy if exists "authenticated select ai_usage_audio_objects" on public.ai_usage_audio_objects;

revoke all on table public.ai_usage_logical_requests from public;
revoke all on table public.ai_usage_logical_requests from anon;
revoke all on table public.ai_usage_logical_requests from authenticated;
revoke all on table public.ai_usage_logical_requests from service_role;
revoke all on table public.ai_usage_attempts from public;
revoke all on table public.ai_usage_attempts from anon;
revoke all on table public.ai_usage_attempts from authenticated;
revoke all on table public.ai_usage_attempts from service_role;
revoke all on table public.ai_usage_key_rejections from public;
revoke all on table public.ai_usage_key_rejections from anon;
revoke all on table public.ai_usage_key_rejections from authenticated;
revoke all on table public.ai_usage_key_rejections from service_role;
revoke all on table public.ai_usage_audio_objects from public;
revoke all on table public.ai_usage_audio_objects from anon;
revoke all on table public.ai_usage_audio_objects from authenticated;
revoke all on table public.ai_usage_audio_objects from service_role;

create or replace function public.ai_usage_record_key_rejection(
  p_reason pg_catalog.text,
  p_client_usage_key pg_catalog.text,
  p_billing_subject pg_catalog.text,
  p_source pg_catalog.text,
  p_operation pg_catalog.text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  insert into public.ai_usage_key_rejections (
    reason,
    client_usage_key,
    billing_subject,
    source,
    operation
  ) values (
    p_reason,
    pg_catalog.left(p_client_usage_key, 128),
    pg_catalog.left(p_billing_subject, 200),
    pg_catalog.left(p_source, 64),
    pg_catalog.left(p_operation, 16)
  );
end;
$$;

create or replace function public.issue_ai_usage_logical_request(
  p_billing_subject pg_catalog.text,
  p_source pg_catalog.text,
  p_operation pg_catalog.text,
  p_synthesis_binding_hash pg_catalog.text,
  p_host_id pg_catalog.uuid,
  p_property_id pg_catalog.text,
  p_reservation_id pg_catalog.text,
  p_expires_at pg_catalog.timestamptz,
  p_key_origin pg_catalog.text default 'issued'
)
returns table (
  result_logical_request_id pg_catalog.uuid,
  result_client_usage_key pg_catalog.text,
  result_expires_at pg_catalog.timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id pg_catalog.uuid;
  v_key pg_catalog.text;
  v_subject pg_catalog.text;
  v_hash pg_catalog.text;
  v_property pg_catalog.text;
  v_reservation pg_catalog.text;
begin
  v_subject := pg_catalog.btrim(coalesce(p_billing_subject, ''));
  v_hash := pg_catalog.btrim(coalesce(p_synthesis_binding_hash, ''));
  v_property := nullif(pg_catalog.btrim(coalesce(p_property_id, '')), '');
  v_reservation := nullif(pg_catalog.btrim(coalesce(p_reservation_id, '')), '');
  if char_length(v_subject) < 3 or char_length(v_subject) > 200
     or char_length(v_hash) < 32 or char_length(v_hash) > 128
     or p_operation is distinct from 'tts'
     or p_source is null
     or p_source not in ('guest_stay_tts', 'guest_stay_welcome_tts', 'host_tts')
     or p_key_origin is null
     or p_key_origin not in ('issued', 'legacy')
     or p_expires_at is null
     or p_expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '22023', message = 'invalid ai usage logical request';
  end if;

  v_key := pg_catalog.gen_random_uuid()::pg_catalog.text;
  insert into public.ai_usage_logical_requests (
    client_usage_key,
    billing_subject,
    source,
    operation,
    synthesis_binding_hash,
    host_id,
    property_id,
    reservation_id,
    state,
    billing_eligibility,
    key_origin,
    expires_at
  ) values (
    v_key,
    v_subject,
    p_source,
    'tts',
    v_hash,
    p_host_id,
    v_property,
    v_reservation,
    'issued',
    'withheld',
    p_key_origin,
    p_expires_at
  )
  returning id into v_id;

  return query
  select v_id, v_key, p_expires_at;
end;
$$;

create or replace function public.validate_ai_usage_logical_request(
  p_client_usage_key pg_catalog.text,
  p_billing_subject pg_catalog.text,
  p_source pg_catalog.text,
  p_operation pg_catalog.text,
  p_synthesis_binding_hash pg_catalog.text
)
returns table (
  result_ok pg_catalog.bool,
  result_logical_request_id pg_catalog.uuid,
  result_rejection_reason pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id pg_catalog.uuid;
  v_subject pg_catalog.text;
  v_source pg_catalog.text;
  v_operation pg_catalog.text;
  v_hash pg_catalog.text;
  v_expires pg_catalog.timestamptz;
  v_reason pg_catalog.text;
begin
  if p_client_usage_key is null or pg_catalog.btrim(p_client_usage_key) = '' then
    raise exception using errcode = '22023', message = 'ai usage key is required';
  end if;

  select r.id, r.billing_subject, r.source, r.operation, r.synthesis_binding_hash, r.expires_at
  into v_id, v_subject, v_source, v_operation, v_hash, v_expires
  from public.ai_usage_logical_requests as r
  where r.client_usage_key = pg_catalog.btrim(p_client_usage_key);

  if v_id is null then
    perform public.ai_usage_record_key_rejection(
      'unknown', p_client_usage_key, p_billing_subject, p_source, p_operation
    );
    return query select false, null::pg_catalog.uuid, 'unknown'::pg_catalog.text;
    return;
  end if;

  if p_billing_subject is distinct from v_subject then
    v_reason := 'subject_mismatch';
  elsif v_expires <= pg_catalog.clock_timestamp() then
    v_reason := 'expired';
  elsif p_source is distinct from v_source
     or p_operation is distinct from v_operation
     or p_synthesis_binding_hash is distinct from v_hash then
    v_reason := 'binding_mismatch';
  end if;

  if v_reason is not null then
    perform public.ai_usage_record_key_rejection(
      v_reason, p_client_usage_key, p_billing_subject, p_source, p_operation
    );
    return query select false, null::pg_catalog.uuid, v_reason;
    return;
  end if;

  return query select true, v_id, null::pg_catalog.text;
end;
$$;

create or replace function public.acquire_ai_usage_logical_request(
  p_client_usage_key pg_catalog.text,
  p_billing_subject pg_catalog.text,
  p_source pg_catalog.text,
  p_operation pg_catalog.text,
  p_synthesis_binding_hash pg_catalog.text,
  p_lease_seconds pg_catalog.int4 default 30,
  p_allow_retry pg_catalog.bool default false
)
returns table (
  result_outcome pg_catalog.text,
  result_logical_request_id pg_catalog.uuid,
  result_attempt_id pg_catalog.uuid,
  result_attempt_ordinal pg_catalog.int4,
  result_acquisition_token pg_catalog.uuid,
  result_lease_expires_at pg_catalog.timestamptz,
  result_rejection_reason pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id pg_catalog.uuid;
  v_subject pg_catalog.text;
  v_source pg_catalog.text;
  v_operation pg_catalog.text;
  v_hash pg_catalog.text;
  v_expires pg_catalog.timestamptz;
  v_state pg_catalog.text;
  v_reason pg_catalog.text;
  v_ordinal pg_catalog.int4;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
  v_attempt pg_catalog.uuid;
  v_lease_seconds pg_catalog.int4;
begin
  if p_client_usage_key is null or pg_catalog.btrim(p_client_usage_key) = '' then
    raise exception using errcode = '22023', message = 'ai usage key is required';
  end if;

  select
    r.id,
    r.billing_subject,
    r.source,
    r.operation,
    r.synthesis_binding_hash,
    r.expires_at,
    r.state
  into v_id, v_subject, v_source, v_operation, v_hash, v_expires, v_state
  from public.ai_usage_logical_requests as r
  where r.client_usage_key = pg_catalog.btrim(p_client_usage_key)
  for update;

  if v_id is null then
    perform public.ai_usage_record_key_rejection(
      'unknown', p_client_usage_key, p_billing_subject, p_source, p_operation
    );
    return query select
      'rejected'::pg_catalog.text,
      null::pg_catalog.uuid,
      null::pg_catalog.uuid,
      null::pg_catalog.int4,
      null::pg_catalog.uuid,
      null::pg_catalog.timestamptz,
      'unknown'::pg_catalog.text;
    return;
  end if;

  if p_billing_subject is distinct from v_subject then
    v_reason := 'subject_mismatch';
  elsif v_expires <= pg_catalog.clock_timestamp() then
    v_reason := 'expired';
  elsif p_source is distinct from v_source
     or p_operation is distinct from v_operation
     or p_synthesis_binding_hash is distinct from v_hash then
    v_reason := 'binding_mismatch';
  end if;

  if v_reason is not null then
    perform public.ai_usage_record_key_rejection(
      v_reason, p_client_usage_key, p_billing_subject, p_source, p_operation
    );
    return query select
      'rejected'::pg_catalog.text,
      null::pg_catalog.uuid,
      null::pg_catalog.uuid,
      null::pg_catalog.int4,
      null::pg_catalog.uuid,
      null::pg_catalog.timestamptz,
      v_reason;
    return;
  end if;

  if v_state = 'completed' then
    return query select
      'completed'::pg_catalog.text, v_id, null::pg_catalog.uuid, null::pg_catalog.int4,
      null::pg_catalog.uuid, null::pg_catalog.timestamptz, null::pg_catalog.text;
    return;
  end if;

  if v_state in ('acquired', 'in_progress') then
    return query select
      'busy'::pg_catalog.text, v_id, null::pg_catalog.uuid, null::pg_catalog.int4,
      null::pg_catalog.uuid, null::pg_catalog.timestamptz, null::pg_catalog.text;
    return;
  end if;

  if v_state in ('failed', 'uncertain') and p_allow_retry is not true then
    return query select
      'not_retryable'::pg_catalog.text, v_id, null::pg_catalog.uuid, null::pg_catalog.int4,
      null::pg_catalog.uuid, null::pg_catalog.timestamptz, null::pg_catalog.text;
    return;
  end if;

  if v_state not in ('issued', 'failed', 'uncertain') then
    return query select
      'busy'::pg_catalog.text, v_id, null::pg_catalog.uuid, null::pg_catalog.int4,
      null::pg_catalog.uuid, null::pg_catalog.timestamptz, null::pg_catalog.text;
    return;
  end if;

  v_lease_seconds := least(greatest(coalesce(p_lease_seconds, 30), 5), 120);
  v_token := pg_catalog.gen_random_uuid();
  v_lease := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_lease_seconds);

  update public.ai_usage_logical_requests as r
  set next_attempt_ordinal = r.next_attempt_ordinal + 1,
      state = 'acquired',
      acquisition_token = v_token,
      lease_expires_at = v_lease,
      updated_at = pg_catalog.clock_timestamp()
  where r.id = v_id
  returning r.next_attempt_ordinal into v_ordinal;

  insert into public.ai_usage_attempts (logical_request_id, attempt_ordinal)
  values (v_id, v_ordinal)
  returning id into v_attempt;

  return query select
    'acquired'::pg_catalog.text, v_id, v_attempt, v_ordinal, v_token, v_lease, null::pg_catalog.text;
end;
$$;

create or replace function public.renew_ai_usage_lease(
  p_logical_request_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid,
  p_lease_seconds pg_catalog.int4 default 30
)
returns table (
  result_renewed pg_catalog.bool,
  result_lease_expires_at pg_catalog.timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_token pg_catalog.uuid;
  v_current_lease pg_catalog.timestamptz;
  v_lease pg_catalog.timestamptz;
  v_lease_seconds pg_catalog.int4;
begin
  select r.acquisition_token, r.lease_expires_at
  into v_token, v_current_lease
  from public.ai_usage_logical_requests as r
  where r.id = p_logical_request_id
  for update;

  if v_token is distinct from p_acquisition_token
     or v_current_lease is null
     or v_current_lease <= pg_catalog.clock_timestamp() then
    return query select false, null::pg_catalog.timestamptz;
    return;
  end if;

  v_lease_seconds := least(greatest(coalesce(p_lease_seconds, 30), 5), 120);
  v_lease := pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_lease_seconds);

  update public.ai_usage_logical_requests as r
  set lease_expires_at = v_lease,
      updated_at = pg_catalog.clock_timestamp()
  where r.id = p_logical_request_id;

  return query select true, v_lease;
end;
$$;

create or replace function public.mark_ai_usage_dispatch_started(
  p_attempt_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid
)
returns table (
  result_updated pg_catalog.bool
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_request_id pg_catalog.uuid;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
  v_state pg_catalog.text;
  v_ordinal pg_catalog.int4;
begin
  select a.logical_request_id into v_request_id
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id;
  if v_request_id is null then
    return query select false;
    return;
  end if;

  select r.acquisition_token, r.lease_expires_at, r.state, r.next_attempt_ordinal
  into v_token, v_lease, v_state, v_ordinal
  from public.ai_usage_logical_requests as r
  where r.id = v_request_id
  for update;

  if v_token is distinct from p_acquisition_token
     or v_lease is null
     or v_lease <= pg_catalog.clock_timestamp()
     or v_state not in ('acquired', 'in_progress') then
    return query select false;
    return;
  end if;

  perform 1
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id
    and a.logical_request_id = v_request_id
    and a.attempt_ordinal = v_ordinal
    and a.dispatch_progress = 'reserved'
    and a.result_state = 'open'
  for update;
  if not found then
    return query select false;
    return;
  end if;

  update public.ai_usage_attempts as a
  set dispatch_progress = 'dispatch_started',
      updated_at = pg_catalog.clock_timestamp()
  where a.id = p_attempt_id;

  update public.ai_usage_logical_requests as r
  set state = 'in_progress',
      updated_at = pg_catalog.clock_timestamp()
  where r.id = v_request_id;

  return query select true;
end;
$$;

create or replace function public.mark_ai_usage_response_observed(
  p_attempt_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid
)
returns table (
  result_updated pg_catalog.bool
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_request_id pg_catalog.uuid;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
  v_ordinal pg_catalog.int4;
begin
  select a.logical_request_id into v_request_id
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id;
  if v_request_id is null then
    return query select false;
    return;
  end if;

  select r.acquisition_token, r.lease_expires_at, r.next_attempt_ordinal
  into v_token, v_lease, v_ordinal
  from public.ai_usage_logical_requests as r
  where r.id = v_request_id
  for update;

  if v_token is distinct from p_acquisition_token
     or v_lease is null
     or v_lease <= pg_catalog.clock_timestamp() then
    return query select false;
    return;
  end if;

  perform 1
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id
    and a.logical_request_id = v_request_id
    and a.attempt_ordinal = v_ordinal
    and a.dispatch_progress in ('dispatch_started', 'response_observed')
    and a.result_state = 'open'
  for update;
  if not found then
    return query select false;
    return;
  end if;

  update public.ai_usage_attempts as a
  set dispatch_progress = 'response_observed',
      response_observed_at = coalesce(a.response_observed_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where a.id = p_attempt_id;

  return query select true;
end;
$$;

create or replace function public.record_ai_usage_attempt_result(
  p_attempt_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid,
  p_result_state pg_catalog.text,
  p_calculated_cost_cents pg_catalog.int4,
  p_cost_class pg_catalog.text,
  p_provider pg_catalog.text,
  p_model pg_catalog.text,
  p_input_characters pg_catalog.int4,
  p_audio_bytes pg_catalog.int4,
  p_stream_completed pg_catalog.bool
)
returns table (
  result_recorded pg_catalog.bool
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_request_id pg_catalog.uuid;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
  v_ordinal pg_catalog.int4;
  v_progress pg_catalog.text;
  v_cents pg_catalog.int4;
  v_class pg_catalog.text;
begin
  if p_result_state not in ('provider_complete', 'failed', 'uncertain') then
    raise exception using errcode = '22023', message = 'invalid ai usage attempt result';
  end if;

  select a.logical_request_id into v_request_id
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id;
  if v_request_id is null then
    return query select false;
    return;
  end if;

  select r.acquisition_token, r.lease_expires_at, r.next_attempt_ordinal
  into v_token, v_lease, v_ordinal
  from public.ai_usage_logical_requests as r
  where r.id = v_request_id
  for update;

  if v_token is distinct from p_acquisition_token
     or v_lease is null
     or v_lease <= pg_catalog.clock_timestamp() then
    return query select false;
    return;
  end if;

  select a.dispatch_progress into v_progress
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id
    and a.logical_request_id = v_request_id
    and a.attempt_ordinal = v_ordinal
    and a.result_state = 'open'
    and a.dispatch_progress in ('dispatch_started', 'response_observed')
  for update;

  if v_progress is null then
    return query select false;
    return;
  end if;

  if p_result_state = 'provider_complete'
     and (
       v_progress is distinct from 'response_observed'
       or p_stream_completed is not true
       or p_audio_bytes is null
       or p_audio_bytes <= 0
     ) then
    return query select false;
    return;
  end if;

  if p_result_state = 'provider_complete' and p_cost_class = 'estimated' then
    if p_calculated_cost_cents is null or p_calculated_cost_cents < 0 then
      raise exception using errcode = '22023', message = 'estimated cost requires cents';
    end if;
    v_cents := p_calculated_cost_cents;
    v_class := 'estimated';
  else
    v_cents := null;
    v_class := 'pending';
  end if;

  update public.ai_usage_attempts as a
  set result_state = p_result_state,
      calculated_cost_cents = v_cents,
      cost_class = v_class,
      provider = pg_catalog.left(p_provider, 64),
      model = pg_catalog.left(p_model, 128),
      input_characters = p_input_characters,
      audio_bytes = p_audio_bytes,
      stream_completed = p_stream_completed,
      updated_at = pg_catalog.clock_timestamp()
  where a.id = p_attempt_id;

  return query select true;
end;
$$;

create or replace function public.record_ai_usage_audio_delivery_failure(
  p_attempt_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid,
  p_delivery_state pg_catalog.text
)
returns table (
  result_recorded pg_catalog.bool
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_request_id pg_catalog.uuid;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
begin
  if p_delivery_state not in ('store_failed', 'delivery_failed') then
    raise exception using errcode = '22023', message = 'invalid ai usage audio delivery state';
  end if;

  select a.logical_request_id into v_request_id
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id;
  if v_request_id is null then
    return query select false;
    return;
  end if;

  select r.acquisition_token, r.lease_expires_at
  into v_token, v_lease
  from public.ai_usage_logical_requests as r
  where r.id = v_request_id
  for update;

  if v_token is distinct from p_acquisition_token
     or v_lease is null
     or v_lease <= pg_catalog.clock_timestamp() then
    return query select false;
    return;
  end if;

  update public.ai_usage_attempts as a
  set audio_delivery_state = p_delivery_state,
      updated_at = pg_catalog.clock_timestamp()
  where a.id = p_attempt_id
    and a.logical_request_id = v_request_id
    and a.audio_delivery_state = 'pending'
    and a.result_state = 'provider_complete';
  if not found then
    return query select false;
    return;
  end if;
  return query select true;
end;
$$;

create or replace function public.begin_ai_usage_fallback_attempt(
  p_logical_request_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid
)
returns table (
  result_started pg_catalog.bool,
  result_attempt_id pg_catalog.uuid,
  result_attempt_ordinal pg_catalog.int4
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_state pg_catalog.text;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
  v_result pg_catalog.text;
  v_ordinal pg_catalog.int4;
  v_attempt pg_catalog.uuid;
begin
  select r.acquisition_token, r.lease_expires_at, r.state
  into v_token, v_lease, v_state
  from public.ai_usage_logical_requests as r
  where r.id = p_logical_request_id
  for update;

  if v_token is distinct from p_acquisition_token
     or v_lease is null
     or v_lease <= pg_catalog.clock_timestamp()
     or v_state is distinct from 'in_progress' then
    return query select false, null::pg_catalog.uuid, null::pg_catalog.int4;
    return;
  end if;

  select a.result_state into v_result
  from public.ai_usage_attempts as a
  join public.ai_usage_logical_requests as r on r.id = a.logical_request_id
  where r.id = p_logical_request_id
    and a.attempt_ordinal = r.next_attempt_ordinal
  for update of a;

  select r.lease_expires_at into v_lease
  from public.ai_usage_logical_requests as r
  where r.id = p_logical_request_id;

  if v_lease is null
     or v_lease <= pg_catalog.clock_timestamp()
     or v_result = 'open'
     or v_result is null then
    return query select false, null::pg_catalog.uuid, null::pg_catalog.int4;
    return;
  end if;

  update public.ai_usage_logical_requests as r
  set next_attempt_ordinal = r.next_attempt_ordinal + 1,
      updated_at = pg_catalog.clock_timestamp()
  where r.id = p_logical_request_id
  returning r.next_attempt_ordinal into v_ordinal;

  insert into public.ai_usage_attempts (logical_request_id, attempt_ordinal)
  values (p_logical_request_id, v_ordinal)
  returning id into v_attempt;

  return query select true, v_attempt, v_ordinal;
end;
$$;

create or replace function public.commit_ai_usage_attempt_audio(
  p_attempt_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid,
  p_object_key pg_catalog.text,
  p_byte_length pg_catalog.int4,
  p_content_type pg_catalog.text,
  p_expires_at pg_catalog.timestamptz
)
returns table (
  result_committed pg_catalog.bool,
  result_orphan pg_catalog.bool
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_request_id pg_catalog.uuid;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
  v_ordinal pg_catalog.int4;
  v_active_key pg_catalog.text;
  v_owner_token pg_catalog.uuid;
  v_audio_bytes pg_catalog.int4;
  v_stream pg_catalog.bool;
  v_result pg_catalog.text;
  v_object_attempt pg_catalog.uuid;
  v_object_token pg_catalog.uuid;
  v_object_bytes pg_catalog.int4;
  v_commit_state pg_catalog.text;
  v_cleanup_state pg_catalog.text;
  v_deleted pg_catalog.timestamptz;
  v_key pg_catalog.text;
  v_inserted pg_catalog.int8;
  v_object_found pg_catalog.bool;
begin
  if p_object_key is null
     or pg_catalog.btrim(p_object_key) = ''
     or p_byte_length is null
     or p_byte_length <= 0
     or p_content_type is null
     or pg_catalog.btrim(p_content_type) = ''
     or p_expires_at is null then
    raise exception using errcode = '22023', message = 'invalid ai usage audio object';
  end if;

  v_key := pg_catalog.btrim(p_object_key);

  select a.logical_request_id into v_request_id
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id;
  if v_request_id is null then
    return query select false, false;
    return;
  end if;

  select r.acquisition_token, r.lease_expires_at, r.next_attempt_ordinal,
         r.active_audio_object_key, r.active_audio_owner_token
  into v_token, v_lease, v_ordinal, v_active_key, v_owner_token
  from public.ai_usage_logical_requests as r
  where r.id = v_request_id
  for update;

  if v_token is distinct from p_acquisition_token
     or v_lease is null
     or v_lease <= pg_catalog.clock_timestamp() then
    insert into public.ai_usage_audio_objects (
      attempt_id, object_key, acquisition_token, byte_length, content_type, expires_at,
      commit_state, cleanup_state
    ) values (
      p_attempt_id, v_key, p_acquisition_token, p_byte_length,
      pg_catalog.left(pg_catalog.btrim(p_content_type), 128), p_expires_at,
      'orphan', 'cleanup_requested'
    )
    on conflict (object_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      update public.ai_usage_audio_objects as o
      set commit_state = 'orphan',
          cleanup_state = 'cleanup_requested'
      where o.object_key = v_key
        and o.attempt_id = p_attempt_id
        and o.acquisition_token = p_acquisition_token
        and o.commit_state = 'pending_upload'
        and o.cleanup_state = 'none'
        and o.storage_deleted_at is null;
      v_inserted := case when found then 1 else 0 end;
    end if;
    return query select false, v_inserted = 1;
    return;
  end if;

  select a.result_state, a.stream_completed, a.audio_bytes
  into v_result, v_stream, v_audio_bytes
  from public.ai_usage_attempts as a
  where a.id = p_attempt_id
    and a.logical_request_id = v_request_id
    and a.attempt_ordinal = v_ordinal
  for update;

  if v_result is distinct from 'provider_complete'
     or v_stream is not true
     or v_audio_bytes is null
     or v_audio_bytes is distinct from p_byte_length then
    return query select false, false;
    return;
  end if;

  if v_active_key is not null
     and v_active_key is distinct from v_key
     and v_owner_token is distinct from p_acquisition_token then
    insert into public.ai_usage_audio_objects (
      attempt_id, object_key, acquisition_token, byte_length, content_type, expires_at,
      commit_state, cleanup_state
    ) values (
      p_attempt_id, v_key, p_acquisition_token, p_byte_length,
      pg_catalog.left(pg_catalog.btrim(p_content_type), 128), p_expires_at,
      'orphan', 'cleanup_requested'
    )
    on conflict (object_key) do nothing;
    get diagnostics v_inserted = row_count;
    return query select false, v_inserted = 1;
    return;
  end if;

  select o.attempt_id, o.acquisition_token, o.byte_length, o.commit_state, o.cleanup_state, o.storage_deleted_at
  into v_object_attempt, v_object_token, v_object_bytes, v_commit_state, v_cleanup_state, v_deleted
  from public.ai_usage_audio_objects as o
  where o.object_key = v_key
  for update;
  v_object_found := found;

  if v_object_found and (
       v_object_attempt is distinct from p_attempt_id
       or v_object_token is distinct from p_acquisition_token
     ) then
    return query select false, false;
    return;
  end if;

  if v_object_found and (
       v_deleted is not null
       or v_cleanup_state is distinct from 'none'
       or v_commit_state in ('orphan', 'expired')
       or v_object_bytes is distinct from p_byte_length
     ) then
    return query select false, false;
    return;
  end if;

  if v_active_key is not null and v_active_key is distinct from v_key then
    update public.ai_usage_audio_objects as o
    set commit_state = 'orphan',
        cleanup_state = 'cleanup_requested'
    where o.object_key = v_active_key
      and o.attempt_id = p_attempt_id
      and o.acquisition_token = p_acquisition_token
      and o.commit_state = 'committed'
      and o.cleanup_state = 'none';
  end if;

  if v_object_found is not true then
    insert into public.ai_usage_audio_objects (
      attempt_id, object_key, acquisition_token, byte_length, content_type, expires_at,
      commit_state, cleanup_state
    ) values (
      p_attempt_id, v_key, p_acquisition_token, p_byte_length,
      pg_catalog.left(pg_catalog.btrim(p_content_type), 128), p_expires_at,
      'pending_upload', 'none'
    );
  end if;

  update public.ai_usage_audio_objects as o
  set commit_state = 'committed',
      cleanup_state = 'none'
  where o.object_key = v_key
    and o.attempt_id = p_attempt_id
    and o.acquisition_token = p_acquisition_token
    and o.byte_length = p_byte_length
    and o.storage_deleted_at is null
    and o.cleanup_state = 'none'
    and o.commit_state in ('pending_upload', 'committed');
  if not found then
    return query select false, false;
    return;
  end if;

  update public.ai_usage_attempts as a
  set audio_delivery_state = 'stored',
      audio_object_key = v_key,
      audio_expires_at = p_expires_at,
      audio_committed_token = p_acquisition_token,
      updated_at = pg_catalog.clock_timestamp()
  where a.id = p_attempt_id
    and a.logical_request_id = v_request_id;

  update public.ai_usage_logical_requests as r
  set active_audio_object_key = v_key,
      active_audio_attempt_id = p_attempt_id,
      active_audio_expires_at = p_expires_at,
      active_audio_owner_token = p_acquisition_token,
      updated_at = pg_catalog.clock_timestamp()
  where r.id = v_request_id;

  return query select true, false;
end;
$$;

create or replace function public.close_ai_usage_logical_request(
  p_logical_request_id pg_catalog.uuid,
  p_acquisition_token pg_catalog.uuid,
  p_outcome pg_catalog.text
)
returns table (
  result_outcome pg_catalog.text,
  result_state pg_catalog.text,
  result_billing_eligibility pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_state pg_catalog.text;
  v_eligibility pg_catalog.text;
  v_source pg_catalog.text;
  v_origin pg_catalog.text;
  v_host pg_catalog.uuid;
  v_property pg_catalog.text;
  v_token pg_catalog.uuid;
  v_lease pg_catalog.timestamptz;
  v_active_attempt pg_catalog.uuid;
  v_active_key pg_catalog.text;
  v_audio_ok pg_catalog.bool;
begin
  if p_outcome not in ('completed', 'failed', 'uncertain') then
    raise exception using errcode = '22023', message = 'invalid ai usage close outcome';
  end if;

  select
    r.state,
    r.billing_eligibility,
    r.source,
    r.key_origin,
    r.host_id,
    r.property_id,
    r.acquisition_token,
    r.lease_expires_at,
    r.active_audio_attempt_id,
    r.active_audio_object_key
  into
    v_state,
    v_eligibility,
    v_source,
    v_origin,
    v_host,
    v_property,
    v_token,
    v_lease,
    v_active_attempt,
    v_active_key
  from public.ai_usage_logical_requests as r
  where r.id = p_logical_request_id
  for update;

  if v_state is null
     or v_token is distinct from p_acquisition_token
     or v_lease is null
     or v_lease <= pg_catalog.clock_timestamp() then
    return query select 'stale'::pg_catalog.text, null::pg_catalog.text, null::pg_catalog.text;
    return;
  end if;

  if p_outcome = 'completed' then
    select exists (
      select 1
      from public.ai_usage_attempts as a
      join public.ai_usage_audio_objects as o
        on o.attempt_id = a.id
       and o.object_key = a.audio_object_key
      where a.id = v_active_attempt
        and a.logical_request_id = p_logical_request_id
        and a.result_state = 'provider_complete'
        and a.stream_completed is true
        and a.audio_bytes is not null
        and a.audio_bytes = o.byte_length
        and a.audio_delivery_state = 'stored'
        and a.audio_object_key = v_active_key
        and o.commit_state = 'committed'
        and o.cleanup_state = 'none'
        and o.byte_length > 0
        and o.storage_deleted_at is null
        and o.expires_at > pg_catalog.clock_timestamp()
    ) into v_audio_ok;

    if v_audio_ok is not true then
      return query select 'audio_absent'::pg_catalog.text, v_state, v_eligibility;
      return;
    end if;

    v_eligibility := 'withheld';
    if v_origin = 'issued'
       and v_host is not null
       and v_property is not null
       and v_source in ('guest_stay_tts', 'guest_stay_welcome_tts') then
      v_eligibility := 'candidate';
    end if;

    update public.ai_usage_logical_requests as r
    set state = 'completed',
        billing_eligibility = v_eligibility,
        acquisition_token = null,
        lease_expires_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where r.id = p_logical_request_id;

    return query select 'completed'::pg_catalog.text, 'completed'::pg_catalog.text, v_eligibility;
    return;
  end if;

  if p_outcome = 'failed' then
    update public.ai_usage_attempts as a
    set result_state = 'failed',
        updated_at = pg_catalog.clock_timestamp()
    where a.logical_request_id = p_logical_request_id
      and a.result_state = 'open'
      and a.dispatch_progress = 'reserved';

    update public.ai_usage_attempts as a
    set result_state = 'failed',
        calculated_cost_cents = null,
        cost_class = 'pending',
        updated_at = pg_catalog.clock_timestamp()
    where a.logical_request_id = p_logical_request_id
      and a.result_state = 'open'
      and a.dispatch_progress in ('dispatch_started', 'response_observed');

    update public.ai_usage_logical_requests as r
    set state = 'failed',
        billing_eligibility = 'withheld',
        acquisition_token = null,
        lease_expires_at = null,
        updated_at = pg_catalog.clock_timestamp()
    where r.id = p_logical_request_id;

    return query select 'failed'::pg_catalog.text, 'failed'::pg_catalog.text, 'withheld'::pg_catalog.text;
    return;
  end if;

  update public.ai_usage_attempts as a
  set result_state = 'failed',
      updated_at = pg_catalog.clock_timestamp()
  where a.logical_request_id = p_logical_request_id
    and a.result_state = 'open'
    and a.dispatch_progress = 'reserved';

  update public.ai_usage_attempts as a
  set result_state = 'uncertain',
      calculated_cost_cents = null,
      cost_class = 'pending',
      updated_at = pg_catalog.clock_timestamp()
  where a.logical_request_id = p_logical_request_id
    and a.result_state = 'open'
    and a.dispatch_progress in ('dispatch_started', 'response_observed');

  update public.ai_usage_logical_requests as r
  set state = 'uncertain',
      billing_eligibility = 'withheld',
      acquisition_token = null,
      lease_expires_at = null,
      updated_at = pg_catalog.clock_timestamp()
  where r.id = p_logical_request_id;

  return query select 'uncertain'::pg_catalog.text, 'uncertain'::pg_catalog.text, 'withheld'::pg_catalog.text;
end;
$$;

create or replace function public.expire_ai_usage_leases(
  p_now pg_catalog.timestamptz default null
)
returns table (
  result_expired pg_catalog.int4
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now pg_catalog.timestamptz;
  v_count pg_catalog.int4;
begin
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());
  perform r.id
  from public.ai_usage_logical_requests as r
  where r.lease_expires_at is not null
    and r.lease_expires_at <= v_now
    and r.state in ('acquired', 'in_progress')
  order by r.id
  for update;

  update public.ai_usage_attempts as a
  set result_state = 'failed',
      updated_at = v_now
  from public.ai_usage_logical_requests as r
  where a.logical_request_id = r.id
    and r.lease_expires_at is not null
    and r.lease_expires_at <= v_now
    and r.state in ('acquired', 'in_progress')
    and a.result_state = 'open'
    and a.dispatch_progress = 'reserved';

  update public.ai_usage_attempts as a
  set result_state = 'uncertain',
      calculated_cost_cents = null,
      cost_class = 'pending',
      updated_at = v_now
  from public.ai_usage_logical_requests as r
  where a.logical_request_id = r.id
    and r.lease_expires_at is not null
    and r.lease_expires_at <= v_now
    and r.state in ('acquired', 'in_progress')
    and a.result_state = 'open'
    and a.dispatch_progress in ('dispatch_started', 'response_observed');

  update public.ai_usage_logical_requests as r
  set state = 'uncertain',
      billing_eligibility = 'withheld',
      acquisition_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where r.lease_expires_at is not null
    and r.lease_expires_at <= v_now
    and r.state in ('acquired', 'in_progress');
  get diagnostics v_count = row_count;
  return query select v_count;
end;
$$;

create or replace function public.summarize_ai_usage_tts_meter(
  p_from pg_catalog.timestamptz,
  p_to pg_catalog.timestamptz
)
returns table (
  logical_requests pg_catalog.int8,
  reserved_attempts pg_catalog.int8,
  dispatch_started_attempts pg_catalog.int8,
  observed_attempts pg_catalog.int8,
  uncertain_attempts pg_catalog.int8,
  uncertain_while_reserved pg_catalog.int8,
  uncertain_after_observation pg_catalog.int8,
  pending_cost_attempts pg_catalog.int8,
  estimated_cost_cents pg_catalog.int8,
  totals_partial pg_catalog.bool
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_pending pg_catalog.int8;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception using errcode = '22023', message = 'invalid ai usage meter range';
  end if;

  -- Counts logical requests by logical request created_at.
  -- Counts attempts by attempt created_at.
  -- Does not count distinct logical_request_id from attempts.
  -- Does not read public.ai_usage_events. Historical rows stay outside this summary.
  select count(*) into v_pending
  from public.ai_usage_attempts as a
  where a.created_at >= p_from
    and a.created_at < p_to
    and (
      a.result_state = 'uncertain'
      or a.cost_class = 'pending'
      or (a.result_state = 'provider_complete' and a.calculated_cost_cents is null)
      or (
        a.result_state = 'open'
        and a.dispatch_progress in ('dispatch_started', 'response_observed')
      )
    );

  return query
  select
    (
      select count(*)
      from public.ai_usage_logical_requests as r
      where r.created_at >= p_from
        and r.created_at < p_to
    ),
    (
      select count(*)
      from public.ai_usage_attempts as a
      where a.created_at >= p_from
        and a.created_at < p_to
        and a.dispatch_progress = 'reserved'
        and a.result_state = 'open'
    ),
    (
      select count(*)
      from public.ai_usage_attempts as a
      where a.created_at >= p_from
        and a.created_at < p_to
        and a.dispatch_progress = 'dispatch_started'
        and a.response_observed_at is null
    ),
    (
      select count(*)
      from public.ai_usage_attempts as a
      where a.created_at >= p_from
        and a.created_at < p_to
        and a.response_observed_at is not null
    ),
    (
      select count(*)
      from public.ai_usage_attempts as a
      where a.created_at >= p_from
        and a.created_at < p_to
        and a.result_state = 'uncertain'
    ),
    (
      select count(*)
      from public.ai_usage_attempts as a
      where a.created_at >= p_from
        and a.created_at < p_to
        and a.result_state = 'uncertain'
        and a.dispatch_progress = 'reserved'
    ),
    (
      select count(*)
      from public.ai_usage_attempts as a
      where a.created_at >= p_from
        and a.created_at < p_to
        and a.result_state = 'uncertain'
        and a.response_observed_at is not null
    ),
    v_pending,
    (
      select sum(a.calculated_cost_cents)::pg_catalog.int8
      from public.ai_usage_attempts as a
      where a.created_at >= p_from
        and a.created_at < p_to
        and a.cost_class = 'estimated'
        and a.calculated_cost_cents is not null
    ),
    v_pending > 0;
end;
$$;

create or replace function public.mark_ai_usage_audio_for_cleanup(
  p_now pg_catalog.timestamptz default null
)
returns table (
  result_marked pg_catalog.int4
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_now pg_catalog.timestamptz;
  v_expired pg_catalog.int4;
  v_stale pg_catalog.int4;
begin
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());
  update public.ai_usage_audio_objects as o
  set commit_state = 'expired',
      cleanup_state = 'cleanup_requested'
  where o.commit_state = 'committed'
    and o.expires_at <= v_now
    and o.storage_deleted_at is null;
  get diagnostics v_expired = row_count;

  update public.ai_usage_audio_objects as o
  set commit_state = 'orphan',
      cleanup_state = 'cleanup_requested'
  where o.commit_state = 'pending_upload'
    and o.created_at <= v_now - pg_catalog.make_interval(mins => 15)
    and o.storage_deleted_at is null;
  get diagnostics v_stale = row_count;

  return query select v_expired + v_stale;
end;
$$;

create or replace function public.list_ai_usage_audio_cleanup()
returns table (
  result_object_key pg_catalog.text,
  result_commit_state pg_catalog.text,
  result_expires_at pg_catalog.timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  return query
  select o.object_key, o.commit_state, o.expires_at
  from public.ai_usage_audio_objects as o
  where o.cleanup_state = 'cleanup_requested'
    and o.storage_deleted_at is null
  order by o.created_at asc, o.object_key asc;
end;
$$;

create or replace function public.acknowledge_ai_usage_audio_cleanup(
  p_object_key pg_catalog.text
)
returns table (
  result_acknowledged pg_catalog.bool
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_acknowledged pg_catalog.bool;
begin
  update public.ai_usage_audio_objects as o
  set storage_deleted_at = pg_catalog.clock_timestamp()
  where o.object_key = p_object_key
    and o.cleanup_state = 'cleanup_requested'
    and o.storage_deleted_at is null;
  v_acknowledged := found;
  return query select v_acknowledged;
end;
$$;

create or replace function public.lookup_ai_usage_replay_audio(
  p_client_usage_key pg_catalog.text,
  p_billing_subject pg_catalog.text
)
returns table (
  result_status pg_catalog.text,
  result_object_key pg_catalog.text,
  result_byte_length pg_catalog.int4,
  result_content_type pg_catalog.text
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id pg_catalog.uuid;
  v_subject pg_catalog.text;
  v_state pg_catalog.text;
  v_expires pg_catalog.timestamptz;
  v_key pg_catalog.text;
  v_bytes pg_catalog.int4;
  v_type pg_catalog.text;
begin
  if p_client_usage_key is null or pg_catalog.btrim(p_client_usage_key) = '' then
    raise exception using errcode = '22023', message = 'ai usage key is required';
  end if;

  select r.id, r.billing_subject, r.state, r.expires_at
  into v_id, v_subject, v_state, v_expires
  from public.ai_usage_logical_requests as r
  where r.client_usage_key = pg_catalog.btrim(p_client_usage_key);

  if v_id is null then
    perform public.ai_usage_record_key_rejection(
      'unknown', p_client_usage_key, p_billing_subject, null, 'tts'
    );
    return query select
      'unavailable'::pg_catalog.text, null::pg_catalog.text, null::pg_catalog.int4, null::pg_catalog.text;
    return;
  end if;

  if p_billing_subject is distinct from v_subject then
    perform public.ai_usage_record_key_rejection(
      'subject_mismatch', p_client_usage_key, p_billing_subject, null, 'tts'
    );
    return query select
      'unavailable'::pg_catalog.text, null::pg_catalog.text, null::pg_catalog.int4, null::pg_catalog.text;
    return;
  end if;

  if v_expires <= pg_catalog.clock_timestamp() then
    perform public.ai_usage_record_key_rejection(
      'expired', p_client_usage_key, p_billing_subject, null, 'tts'
    );
    return query select
      'unavailable'::pg_catalog.text, null::pg_catalog.text, null::pg_catalog.int4, null::pg_catalog.text;
    return;
  end if;

  if v_state = 'completed' then
    select o.object_key, o.byte_length, o.content_type
    into v_key, v_bytes, v_type
    from public.ai_usage_logical_requests as r
    join public.ai_usage_audio_objects as o on o.object_key = r.active_audio_object_key
    where r.id = v_id
      and o.commit_state = 'committed'
      and o.cleanup_state = 'none'
      and o.storage_deleted_at is null
      and o.expires_at > pg_catalog.clock_timestamp()
      and o.byte_length > 0;
  end if;

  if v_key is null or v_bytes is null or v_bytes <= 0 then
    return query select
      'unavailable'::pg_catalog.text, null::pg_catalog.text, null::pg_catalog.int4, null::pg_catalog.text;
    return;
  end if;

  return query select 'ready'::pg_catalog.text, v_key, v_bytes, v_type;
end;
$$;

revoke all on function public.ai_usage_record_key_rejection(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) from public;
revoke all on function public.ai_usage_record_key_rejection(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) from anon;
revoke all on function public.ai_usage_record_key_rejection(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) from authenticated;
revoke all on function public.ai_usage_record_key_rejection(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) from service_role;

do $ai_usage_rejection_owner$
begin
  execute format(
    'grant execute on function public.ai_usage_record_key_rejection(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) to %I',
    current_user
  );
end;
$ai_usage_rejection_owner$;

revoke all on function public.issue_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.text) from public;
revoke all on function public.issue_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.text) from anon;
revoke all on function public.issue_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.text) from authenticated;
grant execute on function public.issue_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.timestamptz, pg_catalog.text) to service_role;

revoke all on function public.validate_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) from public;
revoke all on function public.validate_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) from anon;
revoke all on function public.validate_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) from authenticated;
grant execute on function public.validate_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text) to service_role;

revoke all on function public.acquire_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.bool) from public;
revoke all on function public.acquire_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.bool) from anon;
revoke all on function public.acquire_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.bool) from authenticated;
grant execute on function public.acquire_ai_usage_logical_request(pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.bool) to service_role;

revoke all on function public.renew_ai_usage_lease(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4) from public;
revoke all on function public.renew_ai_usage_lease(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4) from anon;
revoke all on function public.renew_ai_usage_lease(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4) from authenticated;
grant execute on function public.renew_ai_usage_lease(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.int4) to service_role;

revoke all on function public.mark_ai_usage_dispatch_started(pg_catalog.uuid, pg_catalog.uuid) from public;
revoke all on function public.mark_ai_usage_dispatch_started(pg_catalog.uuid, pg_catalog.uuid) from anon;
revoke all on function public.mark_ai_usage_dispatch_started(pg_catalog.uuid, pg_catalog.uuid) from authenticated;
grant execute on function public.mark_ai_usage_dispatch_started(pg_catalog.uuid, pg_catalog.uuid) to service_role;

revoke all on function public.mark_ai_usage_response_observed(pg_catalog.uuid, pg_catalog.uuid) from public;
revoke all on function public.mark_ai_usage_response_observed(pg_catalog.uuid, pg_catalog.uuid) from anon;
revoke all on function public.mark_ai_usage_response_observed(pg_catalog.uuid, pg_catalog.uuid) from authenticated;
grant execute on function public.mark_ai_usage_response_observed(pg_catalog.uuid, pg_catalog.uuid) to service_role;

revoke all on function public.record_ai_usage_attempt_result(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.int4, pg_catalog.bool) from public;
revoke all on function public.record_ai_usage_attempt_result(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.int4, pg_catalog.bool) from anon;
revoke all on function public.record_ai_usage_attempt_result(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.int4, pg_catalog.bool) from authenticated;
grant execute on function public.record_ai_usage_attempt_result(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.int4, pg_catalog.int4, pg_catalog.bool) to service_role;

revoke all on function public.record_ai_usage_audio_delivery_failure(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) from public;
revoke all on function public.record_ai_usage_audio_delivery_failure(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) from anon;
revoke all on function public.record_ai_usage_audio_delivery_failure(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) from authenticated;
grant execute on function public.record_ai_usage_audio_delivery_failure(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) to service_role;

revoke all on function public.begin_ai_usage_fallback_attempt(pg_catalog.uuid, pg_catalog.uuid) from public;
revoke all on function public.begin_ai_usage_fallback_attempt(pg_catalog.uuid, pg_catalog.uuid) from anon;
revoke all on function public.begin_ai_usage_fallback_attempt(pg_catalog.uuid, pg_catalog.uuid) from authenticated;
grant execute on function public.begin_ai_usage_fallback_attempt(pg_catalog.uuid, pg_catalog.uuid) to service_role;

revoke all on function public.commit_ai_usage_attempt_audio(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) from public;
revoke all on function public.commit_ai_usage_attempt_audio(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) from anon;
revoke all on function public.commit_ai_usage_attempt_audio(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) from authenticated;
grant execute on function public.commit_ai_usage_attempt_audio(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.int4, pg_catalog.text, pg_catalog.timestamptz) to service_role;

revoke all on function public.close_ai_usage_logical_request(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) from public;
revoke all on function public.close_ai_usage_logical_request(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) from anon;
revoke all on function public.close_ai_usage_logical_request(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) from authenticated;
grant execute on function public.close_ai_usage_logical_request(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text) to service_role;

revoke all on function public.expire_ai_usage_leases(pg_catalog.timestamptz) from public;
revoke all on function public.expire_ai_usage_leases(pg_catalog.timestamptz) from anon;
revoke all on function public.expire_ai_usage_leases(pg_catalog.timestamptz) from authenticated;
grant execute on function public.expire_ai_usage_leases(pg_catalog.timestamptz) to service_role;

revoke all on function public.summarize_ai_usage_tts_meter(pg_catalog.timestamptz, pg_catalog.timestamptz) from public;
revoke all on function public.summarize_ai_usage_tts_meter(pg_catalog.timestamptz, pg_catalog.timestamptz) from anon;
revoke all on function public.summarize_ai_usage_tts_meter(pg_catalog.timestamptz, pg_catalog.timestamptz) from authenticated;
grant execute on function public.summarize_ai_usage_tts_meter(pg_catalog.timestamptz, pg_catalog.timestamptz) to service_role;

revoke all on function public.mark_ai_usage_audio_for_cleanup(pg_catalog.timestamptz) from public;
revoke all on function public.mark_ai_usage_audio_for_cleanup(pg_catalog.timestamptz) from anon;
revoke all on function public.mark_ai_usage_audio_for_cleanup(pg_catalog.timestamptz) from authenticated;
grant execute on function public.mark_ai_usage_audio_for_cleanup(pg_catalog.timestamptz) to service_role;

revoke all on function public.list_ai_usage_audio_cleanup() from public;
revoke all on function public.list_ai_usage_audio_cleanup() from anon;
revoke all on function public.list_ai_usage_audio_cleanup() from authenticated;
grant execute on function public.list_ai_usage_audio_cleanup() to service_role;

revoke all on function public.acknowledge_ai_usage_audio_cleanup(pg_catalog.text) from public;
revoke all on function public.acknowledge_ai_usage_audio_cleanup(pg_catalog.text) from anon;
revoke all on function public.acknowledge_ai_usage_audio_cleanup(pg_catalog.text) from authenticated;
grant execute on function public.acknowledge_ai_usage_audio_cleanup(pg_catalog.text) to service_role;

revoke all on function public.lookup_ai_usage_replay_audio(pg_catalog.text, pg_catalog.text) from public;
revoke all on function public.lookup_ai_usage_replay_audio(pg_catalog.text, pg_catalog.text) from anon;
revoke all on function public.lookup_ai_usage_replay_audio(pg_catalog.text, pg_catalog.text) from authenticated;
grant execute on function public.lookup_ai_usage_replay_audio(pg_catalog.text, pg_catalog.text) to service_role;

comment on function public.summarize_ai_usage_tts_meter(pg_catalog.timestamptz, pg_catalog.timestamptz) is
  'Logical requests by request created_at. Attempts by attempt created_at. Uncertain, pending, and open dispatched attempts set totals_partial. Does not read historical ai_usage_events.';

commit;
