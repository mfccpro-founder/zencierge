-- Real Postgres checks for the TTS meter. Not a static source scan.
-- The caller creates anon, authenticated, and service_role before the migration.

do $meter$
declare
  v_hash pg_catalog.text := repeat('a', 64);
  v_other_hash pg_catalog.text := repeat('b', 64);
  v_host pg_catalog.uuid := '00000000-0000-4000-8000-000000000001';
  v_issue record;
  v_other record;
  v_row record;
  v_attempts pg_catalog.int8;
  v_before pg_catalog.int8;
  v_replay record;
  v_summary record;
  v_again record;
  v_old_token pg_catalog.uuid;
  v_active_key pg_catalog.text;
  v_foreign_key pg_catalog.text;
  v_recorded pg_catalog.bool;
  v_cleanup pg_catalog.text;
begin
  set local role service_role;
  begin
    perform 1 from public.ai_usage_logical_requests;
    raise exception 'service_role read the meter table';
  exception
    when insufficient_privilege then
      null;
  end;
  reset role;

  set local role anon;
  begin
    perform 1 from public.issue_ai_usage_logical_request(
      'stay:anon', 'guest_stay_tts', 'tts', v_hash, null, null, null,
      pg_catalog.clock_timestamp() + interval '1 day', 'issued'
    );
    raise exception 'anon executed issue';
  exception
    when insufficient_privilege then
      null;
  end;
  reset role;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:one', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-1', 'reservation-1',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_other from public.issue_ai_usage_logical_request(
    'stay:one', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-1', 'reservation-1',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  if v_issue.result_logical_request_id = v_other.result_logical_request_id then
    raise exception 'same synthesis hash collapsed two keys';
  end if;

  select count(*) into v_before from public.ai_usage_attempts;
  select * into v_row from public.validate_ai_usage_logical_request(
    'missing-key-value-xxxx', 'stay:one', 'guest_stay_tts', 'tts', v_hash
  );
  if v_row.result_ok or v_row.result_rejection_reason is distinct from 'unknown' then
    raise exception 'unknown key was accepted';
  end if;
  select * into v_row from public.validate_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:other', 'guest_stay_tts', 'tts', v_hash
  );
  if v_row.result_rejection_reason is distinct from 'subject_mismatch' then
    raise exception 'other subject was accepted';
  end if;
  select * into v_row from public.validate_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:one', 'guest_stay_tts', 'tts', v_other_hash
  );
  if v_row.result_rejection_reason is distinct from 'binding_mismatch' then
    raise exception 'other synthesis was accepted';
  end if;
  select count(*) into v_attempts from public.ai_usage_attempts;
  if v_attempts is distinct from v_before then
    raise exception 'rejected key created an attempt';
  end if;

  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:one', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  if v_row.result_outcome is distinct from 'acquired' or v_row.result_attempt_ordinal is distinct from 1 then
    raise exception 'first acquire failed';
  end if;
  v_old_token := v_row.result_acquisition_token;
  select * into v_other from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:one', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  if v_other.result_outcome is distinct from 'busy' or v_other.result_acquisition_token is not null then
    raise exception 'second acquire started a synthesis';
  end if;
  select count(*) into v_attempts from public.ai_usage_attempts where logical_request_id = v_issue.result_logical_request_id;
  if v_attempts is distinct from 1 then
    raise exception 'busy acquire inserted an attempt';
  end if;

  update public.ai_usage_logical_requests
  set lease_expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
  where id = v_issue.result_logical_request_id;
  select * into v_row from public.close_ai_usage_logical_request(
    v_issue.result_logical_request_id, v_old_token, 'failed'
  );
  if v_row.result_outcome is distinct from 'stale' then
    raise exception 'expired lease was closed';
  end if;
  select * into v_row from public.renew_ai_usage_lease(v_issue.result_logical_request_id, v_old_token, 30);
  if v_row.result_renewed then
    raise exception 'expired lease was renewed';
  end if;
  perform 1 from public.expire_ai_usage_leases(pg_catalog.clock_timestamp());
  select * into v_row from public.close_ai_usage_logical_request(
    v_issue.result_logical_request_id, v_old_token, 'failed'
  );
  if v_row.result_outcome is distinct from 'stale' then
    raise exception 'old token closed the request after expiry';
  end if;
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:one', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  if v_row.result_outcome is distinct from 'not_retryable' then
    raise exception 'uncertain request retried without permission';
  end if;
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:one', 'guest_stay_tts', 'tts', v_hash, 30, true
  );
  if v_row.result_outcome is distinct from 'acquired' or v_row.result_attempt_ordinal is distinct from 2 then
    raise exception 'explicit retry did not take the next ordinal';
  end if;
  if v_row.result_acquisition_token = v_old_token then
    raise exception 'retry kept the old token';
  end if;
  select * into v_other from public.mark_ai_usage_dispatch_started(
    v_row.result_attempt_id, v_old_token
  );
  if v_other.result_updated then
    raise exception 'old token dispatched the retry';
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:observed', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-1', 'reservation-observed',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:observed', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'uncertain',
    99, 'estimated', 'openai', 'gpt-4o-mini-tts', 20, null, false
  );
  if exists (
    select 1 from public.ai_usage_attempts as a
    where a.id = v_row.result_attempt_id
      and (
        a.response_observed_at is null
        or a.dispatch_progress is distinct from 'response_observed'
        or a.result_state is distinct from 'uncertain'
        or a.calculated_cost_cents is not null
        or a.cost_class is distinct from 'pending'
      )
  ) then
    raise exception 'uncertain result erased observation or stored a cost';
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:cost', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-1', 'reservation-cost',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:cost', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'provider_complete',
    40, 'estimated', 'elevenlabs', 'eleven_multilingual_v2', 40, 100, true
  );
  perform 1 from public.record_ai_usage_audio_delivery_failure(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'store_failed'
  );
  select * into v_other from public.close_ai_usage_logical_request(
    v_issue.result_logical_request_id, v_row.result_acquisition_token, 'completed'
  );
  if v_other.result_outcome is distinct from 'audio_absent' then
    raise exception 'close reported success without audio';
  end if;
  if exists (
    select 1 from public.ai_usage_attempts as a
    where a.id = v_row.result_attempt_id
      and (a.calculated_cost_cents is distinct from 40 or a.audio_delivery_state is distinct from 'store_failed')
  ) or exists (
    select 1 from public.ai_usage_logical_requests as r
    where r.id = v_issue.result_logical_request_id
      and r.state is distinct from 'in_progress'
  ) then
    raise exception 'audio store failure cleared the provider cost';
  end if;
  perform 1 from public.expire_ai_usage_leases(pg_catalog.clock_timestamp() + interval '1 day');
  if exists (
    select 1 from public.ai_usage_attempts as a
    where a.id = v_row.result_attempt_id
      and (a.calculated_cost_cents is distinct from 40 or a.result_state is distinct from 'provider_complete')
  ) then
    raise exception 'lease expiry cleared a complete provider cost';
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:partial', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-partial', 'reservation-partial',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:partial', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_row.result_acquisition_token);
  select result_recorded into v_recorded from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'provider_complete',
    4, 'estimated', 'elevenlabs', 'eleven_multilingual_v2', 4, 80, false
  );
  if v_recorded or exists (
    select 1 from public.ai_usage_attempts as a
    where a.id = v_row.result_attempt_id and a.result_state is distinct from 'open'
  ) then
    raise exception 'incomplete audio was recorded as complete';
  end if;
  perform 1 from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'provider_complete',
    4, 'estimated', 'elevenlabs', 'eleven_multilingual_v2', 4, 80, true
  );
  v_active_key := 'tts-attempt/' || v_row.result_attempt_id::text || '/partial';
  select * into v_other from public.commit_ai_usage_attempt_audio(
    v_row.result_attempt_id, v_row.result_acquisition_token, v_active_key, 10, 'audio/mpeg',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  if v_other.result_committed or exists (
    select 1 from public.ai_usage_audio_objects as o where o.object_key = v_active_key
  ) then
    raise exception 'audio size did not match the recorded bytes';
  end if;
  perform 1 from public.commit_ai_usage_attempt_audio(
    v_row.result_attempt_id, v_row.result_acquisition_token, v_active_key, 80, 'audio/mpeg',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  update public.ai_usage_audio_objects
  set byte_length = 10
  where object_key = v_active_key;
  select * into v_other from public.close_ai_usage_logical_request(
    v_issue.result_logical_request_id, v_row.result_acquisition_token, 'completed'
  );
  if v_other.result_outcome is distinct from 'audio_absent' then
    raise exception 'close accepted audio whose size does not match';
  end if;
  update public.ai_usage_audio_objects
  set byte_length = 80
  where object_key = v_active_key;
  update public.ai_usage_audio_objects
  set cleanup_state = 'cleanup_requested'
  where object_key = v_active_key;
  select * into v_other from public.commit_ai_usage_attempt_audio(
    v_row.result_attempt_id, v_row.result_acquisition_token, v_active_key, 80, 'audio/mpeg',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  select o.cleanup_state into v_cleanup
  from public.ai_usage_audio_objects as o
  where o.object_key = v_active_key;
  if v_other.result_committed or v_cleanup is distinct from 'cleanup_requested' then
    raise exception 'cleanup request was committed again';
  end if;
  update public.ai_usage_audio_objects
  set cleanup_state = 'none'
  where object_key = v_active_key;

  select * into v_other from public.issue_ai_usage_logical_request(
    'stay:foreign', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-foreign', 'reservation-foreign',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  v_foreign_key := v_active_key;
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_other.result_client_usage_key, 'stay:foreign', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'provider_complete',
    4, 'estimated', 'elevenlabs', 'eleven_multilingual_v2', 4, 80, true
  );
  select * into v_row from public.commit_ai_usage_attempt_audio(
    v_row.result_attempt_id, v_row.result_acquisition_token, v_foreign_key, 80, 'audio/mpeg',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  if v_row.result_committed or exists (
    select 1 from public.ai_usage_audio_objects as o
    where o.object_key = v_foreign_key
      and (o.commit_state is distinct from 'committed' or o.cleanup_state is distinct from 'none')
  ) then
    raise exception 'another attempt adopted a stored object';
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:ready', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-ready', 'reservation-ready',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:ready', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  v_old_token := v_row.result_acquisition_token;
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_old_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_old_token);
  perform 1 from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_old_token, 'provider_complete',
    10, 'estimated', 'elevenlabs', 'eleven_multilingual_v2', 10, 80, true
  );
  v_active_key := 'tts-attempt/' || v_row.result_attempt_id::text || '/' || v_old_token::text;
  perform 1 from public.commit_ai_usage_attempt_audio(
    v_row.result_attempt_id, v_old_token, v_active_key, 80, 'audio/mpeg',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  select * into v_other from public.close_ai_usage_logical_request(
    v_issue.result_logical_request_id, v_old_token, 'completed'
  );
  if v_other.result_outcome is distinct from 'completed' or v_other.result_billing_eligibility is distinct from 'candidate' then
    raise exception 'complete guest audio did not become candidate';
  end if;
  select * into v_replay from public.lookup_ai_usage_replay_audio(v_issue.result_client_usage_key, 'stay:ready');
  if v_replay.result_status is distinct from 'ready'
     or v_replay.result_object_key is distinct from v_active_key
     or v_replay.result_byte_length is distinct from 80 then
    raise exception 'replay did not return the stored audio';
  end if;
  update public.ai_usage_logical_requests
  set expires_at = pg_catalog.clock_timestamp() - interval '1 minute'
  where id = v_issue.result_logical_request_id;
  select * into v_replay from public.lookup_ai_usage_replay_audio(v_issue.result_client_usage_key, 'stay:ready');
  if v_replay.result_status is distinct from 'unavailable' or v_replay.result_object_key is not null then
    raise exception 'expired key returned audio';
  end if;
  update public.ai_usage_logical_requests
  set expires_at = pg_catalog.clock_timestamp() + interval '1 day'
  where id = v_issue.result_logical_request_id;
  select * into v_other from public.commit_ai_usage_attempt_audio(
    v_row.result_attempt_id, v_old_token, v_active_key || '-stale', 80, 'audio/mpeg',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  if v_other.result_committed or not v_other.result_orphan then
    raise exception 'old token replaced committed audio';
  end if;
  select * into v_replay from public.lookup_ai_usage_replay_audio(v_issue.result_client_usage_key, 'stay:ready');
  if v_replay.result_object_key is distinct from v_active_key then
    raise exception 'stale commit changed the replay object';
  end if;
  perform 1 from public.mark_ai_usage_audio_for_cleanup(pg_catalog.clock_timestamp() + interval '2 days');
  select * into v_replay from public.lookup_ai_usage_replay_audio(v_issue.result_client_usage_key, 'stay:ready');
  if v_replay.result_status is distinct from 'unavailable' or v_replay.result_object_key is not null then
    raise exception 'missing audio was returned as success';
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'host:preview', 'host_tts', 'tts', v_hash, v_host, 'property-host', null,
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'host:preview', 'host_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'provider_complete',
    3, 'estimated', 'openai', 'gpt-4o-mini-tts', 8, 40, true
  );
  perform 1 from public.commit_ai_usage_attempt_audio(
    v_row.result_attempt_id, v_row.result_acquisition_token,
    'tts-attempt/' || v_row.result_attempt_id::text || '/host', 40, 'audio/pcm',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  select * into v_other from public.close_ai_usage_logical_request(
    v_issue.result_logical_request_id, v_row.result_acquisition_token, 'completed'
  );
  if v_other.result_state is distinct from 'completed' or v_other.result_billing_eligibility is distinct from 'withheld' then
    raise exception 'host_tts became candidate';
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:span', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-span', 'reservation-span',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:span', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.record_ai_usage_attempt_result(
    v_row.result_attempt_id, v_row.result_acquisition_token, 'failed',
    15, 'estimated', 'openai', 'gpt-4o-mini-tts', 12, null, false
  );
  select * into v_other from public.begin_ai_usage_fallback_attempt(
    v_issue.result_logical_request_id, v_row.result_acquisition_token
  );
  if not v_other.result_started or v_other.result_attempt_ordinal is distinct from 2 then
    raise exception 'fallback did not stay on the same acquisition';
  end if;
  perform 1 from public.mark_ai_usage_dispatch_started(v_other.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_other.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.record_ai_usage_attempt_result(
    v_other.result_attempt_id, v_row.result_acquisition_token, 'provider_complete',
    7, 'estimated', 'elevenlabs', 'eleven_multilingual_v2', 7, 20, true
  );
  update public.ai_usage_logical_requests
  set created_at = timestamptz '2026-01-15 12:00:00+00'
  where id = v_issue.result_logical_request_id;
  update public.ai_usage_attempts
  set created_at = timestamptz '2026-01-20 12:00:00+00'
  where id = v_row.result_attempt_id;
  update public.ai_usage_attempts
  set created_at = timestamptz '2026-02-02 12:00:00+00'
  where id = v_other.result_attempt_id;

  select * into v_other from public.issue_ai_usage_logical_request(
    'stay:empty', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-empty', 'reservation-empty',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  update public.ai_usage_logical_requests
  set created_at = timestamptz '2026-01-10 12:00:00+00'
  where id = v_other.result_logical_request_id;

  select * into v_summary from public.summarize_ai_usage_tts_meter(
    timestamptz '2026-01-01 00:00:00+00', timestamptz '2026-02-01 00:00:00+00'
  );
  if v_summary.logical_requests is distinct from 2
     or v_summary.observed_attempts is distinct from 1
     or v_summary.estimated_cost_cents is not null
     or v_summary.totals_partial is distinct from true then
    raise exception 'january meter count is wrong: %', v_summary;
  end if;
  select * into v_summary from public.summarize_ai_usage_tts_meter(
    timestamptz '2026-02-01 00:00:00+00', timestamptz '2026-03-01 00:00:00+00'
  );
  if v_summary.logical_requests is distinct from 0
     or v_summary.observed_attempts is distinct from 1
     or v_summary.estimated_cost_cents is distinct from 7
     or v_summary.totals_partial then
    raise exception 'february meter count is wrong: %', v_summary;
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:reserved-open', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-reserved-open', 'reservation-reserved-open',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:reserved-open', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  update public.ai_usage_logical_requests
  set created_at = timestamptz '2026-03-02 12:00:00+00'
  where id = v_issue.result_logical_request_id;
  update public.ai_usage_attempts
  set created_at = timestamptz '2026-03-02 12:00:00+00'
  where id = v_row.result_attempt_id;
  select * into v_summary from public.summarize_ai_usage_tts_meter(
    timestamptz '2026-03-01 00:00:00+00', timestamptz '2026-03-06 00:00:00+00'
  );
  if v_summary.reserved_attempts is distinct from 1
     or v_summary.pending_cost_attempts is distinct from 0
     or v_summary.totals_partial then
    raise exception 'reserved attempt without dispatch was pending: %', v_summary;
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:dispatch-open', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-dispatch-open', 'reservation-dispatch-open',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:dispatch-open', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  update public.ai_usage_logical_requests
  set created_at = timestamptz '2026-03-08 12:00:00+00'
  where id = v_issue.result_logical_request_id;
  update public.ai_usage_attempts
  set created_at = timestamptz '2026-03-08 12:00:00+00'
  where id = v_row.result_attempt_id;
  select * into v_summary from public.summarize_ai_usage_tts_meter(
    timestamptz '2026-03-06 00:00:00+00', timestamptz '2026-03-11 00:00:00+00'
  );
  if v_summary.dispatch_started_attempts is distinct from 1
     or v_summary.pending_cost_attempts is distinct from 1
     or v_summary.estimated_cost_cents is not null
     or v_summary.totals_partial is distinct from true then
    raise exception 'open dispatch hid a pending cost: %', v_summary;
  end if;

  select * into v_issue from public.issue_ai_usage_logical_request(
    'stay:observed-open', 'guest_stay_tts', 'tts', v_hash, v_host, 'property-observed-open', 'reservation-observed-open',
    pg_catalog.clock_timestamp() + interval '1 day', 'issued'
  );
  select * into v_row from public.acquire_ai_usage_logical_request(
    v_issue.result_client_usage_key, 'stay:observed-open', 'guest_stay_tts', 'tts', v_hash, 30, false
  );
  perform 1 from public.mark_ai_usage_dispatch_started(v_row.result_attempt_id, v_row.result_acquisition_token);
  perform 1 from public.mark_ai_usage_response_observed(v_row.result_attempt_id, v_row.result_acquisition_token);
  update public.ai_usage_logical_requests
  set created_at = timestamptz '2026-03-12 12:00:00+00'
  where id = v_issue.result_logical_request_id;
  update public.ai_usage_attempts
  set created_at = timestamptz '2026-03-12 12:00:00+00'
  where id = v_row.result_attempt_id;
  select * into v_summary from public.summarize_ai_usage_tts_meter(
    timestamptz '2026-03-11 00:00:00+00', timestamptz '2026-03-16 00:00:00+00'
  );
  if v_summary.observed_attempts is distinct from 1
     or v_summary.pending_cost_attempts is distinct from 1
     or v_summary.totals_partial is distinct from true then
    raise exception 'open observation hid a pending cost: %', v_summary;
  end if;

  create table if not exists public.ai_usage_events (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    created_at timestamptz not null default pg_catalog.now(),
    operation text not null
  );
  insert into public.ai_usage_events (created_at, operation)
  values (timestamptz '2026-01-18 00:00:00+00', 'tts');
  select * into v_again from public.summarize_ai_usage_tts_meter(
    timestamptz '2026-01-01 00:00:00+00', timestamptz '2026-02-01 00:00:00+00'
  );
  if v_again.logical_requests is distinct from 2 or v_again.observed_attempts is distinct from 1 then
    raise exception 'historical rows were folded into the meter';
  end if;

  update public.ai_usage_logical_requests
  set property_id = null
  where id = v_other.result_logical_request_id;
  begin
    update public.ai_usage_logical_requests
    set state = 'completed',
        billing_eligibility = 'candidate'
    where id = v_other.result_logical_request_id;
    raise exception 'candidate without property was accepted';
  exception
    when check_violation then
      null;
  end;

  raise notice 'ai-usage meter postgres sequential tests passed';
end;
$meter$;
