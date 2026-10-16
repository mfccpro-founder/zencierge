-- Host TTS meter read for Back Office totals.
-- Read-only. Does not read or write ai_usage_events.
-- Counts only source host_tts. Guest usage stays on ai_usage_events.
-- Pending attempts use the same predicate as summarize_ai_usage_tts_meter.
-- A reserved attempt that has not been dispatched is outside that predicate.
-- Characters and observed attempts use the attempt created_at month.
-- Logical requests use the request created_at month.
-- response_observed_at stays set when the result later becomes uncertain, so the attempt still counts as observed.
-- estimated_cost_cents stays null when no estimated row exists. It is not zero.
-- This read is independent of AI_USAGE_HOST_TTS_METER.
-- After this function exists, turning that write flag off keeps these requests, attempts, and costs visible.
-- Apply it on the local server connected to zencierge-sandbox before enabling the write flag there.
-- Do not enable the write flag in production.

begin;

drop function if exists public.summarize_host_tts_meter_backoffice(pg_catalog.timestamptz, pg_catalog.timestamptz);

create or replace function public.summarize_host_tts_meter_backoffice(
  p_from pg_catalog.timestamptz,
  p_to pg_catalog.timestamptz
)
returns table (
  logical_requests pg_catalog.int8,
  completed_requests pg_catalog.int8,
  failed_requests pg_catalog.int8,
  observed_attempts pg_catalog.int8,
  characters pg_catalog.int8,
  pending_cost_attempts pg_catalog.int8,
  pending_characters pg_catalog.int8,
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
    raise exception using errcode = '22023', message = 'invalid host tts meter range';
  end if;

  select count(*) into v_pending
  from public.ai_usage_attempts as a
  join public.ai_usage_logical_requests as r on r.id = a.logical_request_id
  where r.source = 'host_tts'
    and a.created_at >= p_from
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
      where r.source = 'host_tts'
        and r.created_at >= p_from
        and r.created_at < p_to
    ),
    (
      select count(*)
      from public.ai_usage_logical_requests as r
      where r.source = 'host_tts'
        and r.created_at >= p_from
        and r.created_at < p_to
        and r.state = 'completed'
    ),
    (
      select count(*)
      from public.ai_usage_logical_requests as r
      where r.source = 'host_tts'
        and r.created_at >= p_from
        and r.created_at < p_to
        and r.state = 'failed'
    ),
    (
      select count(*)
      from public.ai_usage_attempts as a
      join public.ai_usage_logical_requests as r on r.id = a.logical_request_id
      where r.source = 'host_tts'
        and a.created_at >= p_from
        and a.created_at < p_to
        and a.response_observed_at is not null
    ),
    (
      select coalesce(sum(a.input_characters), 0)::pg_catalog.int8
      from public.ai_usage_attempts as a
      join public.ai_usage_logical_requests as r on r.id = a.logical_request_id
      where r.source = 'host_tts'
        and a.created_at >= p_from
        and a.created_at < p_to
        and a.result_state = 'provider_complete'
        and a.stream_completed is true
    ),
    v_pending,
    (
      select coalesce(sum(a.input_characters), 0)::pg_catalog.int8
      from public.ai_usage_attempts as a
      join public.ai_usage_logical_requests as r on r.id = a.logical_request_id
      where r.source = 'host_tts'
        and a.created_at >= p_from
        and a.created_at < p_to
        and (
          a.result_state = 'uncertain'
          or a.cost_class = 'pending'
          or (a.result_state = 'provider_complete' and a.calculated_cost_cents is null)
          or (
            a.result_state = 'open'
            and a.dispatch_progress in ('dispatch_started', 'response_observed')
          )
        )
    ),
    (
      select sum(a.calculated_cost_cents)::pg_catalog.int8
      from public.ai_usage_attempts as a
      join public.ai_usage_logical_requests as r on r.id = a.logical_request_id
      where r.source = 'host_tts'
        and a.created_at >= p_from
        and a.created_at < p_to
        and a.cost_class = 'estimated'
        and a.calculated_cost_cents is not null
    ),
    v_pending > 0;
end;
$$;

revoke all on function public.summarize_host_tts_meter_backoffice(pg_catalog.timestamptz, pg_catalog.timestamptz) from public;
revoke all on function public.summarize_host_tts_meter_backoffice(pg_catalog.timestamptz, pg_catalog.timestamptz) from anon;
revoke all on function public.summarize_host_tts_meter_backoffice(pg_catalog.timestamptz, pg_catalog.timestamptz) from authenticated;
grant execute on function public.summarize_host_tts_meter_backoffice(pg_catalog.timestamptz, pg_catalog.timestamptz) to service_role;

comment on function public.summarize_host_tts_meter_backoffice(pg_catalog.timestamptz, pg_catalog.timestamptz) is
  'Read-only host_tts meter totals for Back Office. Requests use request created_at. Attempts, characters, and costs use attempt created_at. Observed attempts stay counted after an uncertain result. Does not read ai_usage_events. Estimated cents stay null when absent.';

commit;
