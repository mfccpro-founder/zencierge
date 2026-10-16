-- Verificación de solo lectura de summarize_host_tts_meter_backoffice en zencierge-sandbox.
-- Migración: supabase/migrations/20260928200000_host_tts_meter_backoffice_read.sql
-- La función se localiza con to_regprocedure y esa misma OID alimenta el resto de comprobaciones.
-- current_month solo informa la lectura del mes. No exige contadores en cero.
-- El mes es el calendario America/New_York, el mismo rango que el Back Office.
-- No inserta, no actualiza, no borra y no cambia permisos.
-- No activa AI_USAGE_HOST_TTS_METER.
-- Listo para ejecutar en el SQL editor del sandbox. Pendiente de que Javier lo lance.

with expected_source as (
  select $meter_body$
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
$meter_body$::text as prosrc
),
expected as (
  select
    'TABLE(logical_requests bigint, completed_requests bigint, failed_requests bigint, observed_attempts bigint, characters bigint, pending_cost_attempts bigint, pending_characters bigint, estimated_cost_cents bigint, totals_partial boolean)'::text as result_type,
    'logical_requests bigint, completed_requests bigint, failed_requests bigint, observed_attempts bigint, characters bigint, pending_cost_attempts bigint, pending_characters bigint, estimated_cost_cents bigint, totals_partial boolean'::text as table_columns
),
target as (
  select pg_catalog.to_regprocedure(
    'public.summarize_host_tts_meter_backoffice(timestamp with time zone,timestamp with time zone)'
  ) as proc
),
named_roles as (
  select r.oid, r.rolname
  from pg_catalog.pg_roles as r
  where r.rolname in ('anon', 'authenticated', 'service_role')
),
name_count as (
  select count(*)::pg_catalog.int8 as matches
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname = 'summarize_host_tts_meter_backoffice'
),
chosen_one as (
  select
    p.oid,
    p.proname,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.prosrc,
    pg_catalog.pg_get_function_result(p.oid) as result_type,
    l.lanname,
    cols.table_columns
  from target as t
  join pg_catalog.pg_proc as p on p.oid = t.proc
  join pg_catalog.pg_language as l on l.oid = p.prolang
  left join lateral (
    select pg_catalog.string_agg(
      p.proargnames[s.idx] || ' ' || pg_catalog.format_type(p.proallargtypes[s.idx], null),
      ', ' order by s.idx
    ) as table_columns
    from pg_catalog.generate_series(1, pg_catalog.cardinality(p.proargnames)) as s(idx)
    where p.proargmodes[s.idx] = 't'::"char"
  ) as cols on true
),
definition_diff as (
  select
    c.oid,
    deployed.prosrc = migration.prosrc as source_matches,
    case
      when deployed.prosrc = migration.prosrc then null
      else (
        select min(g.i)
        from pg_catalog.generate_series(
          1,
          case
            when pg_catalog.length(deployed.prosrc) >= pg_catalog.length(migration.prosrc)
              then pg_catalog.length(deployed.prosrc)
            else pg_catalog.length(migration.prosrc)
          end
        ) as g(i)
        where pg_catalog.substr(deployed.prosrc, g.i, 1)
          is distinct from pg_catalog.substr(migration.prosrc, g.i, 1)
      )
    end as first_difference,
    pg_catalog.length(deployed.prosrc) as deployed_chars,
    pg_catalog.length(migration.prosrc) as migration_chars
  from chosen_one as c
  cross join expected_source as s
  cross join lateral (
    select pg_catalog.replace(c.prosrc, pg_catalog.chr(13), '') as prosrc
  ) as deployed
  cross join lateral (
    select pg_catalog.replace(s.prosrc, pg_catalog.chr(13), '') as prosrc
  ) as migration
),
execute_acl as (
  select
    c.oid,
    case
      when c.proacl is null then true
      else coalesce((
        select pg_catalog.bool_or(x.privilege_type = 'EXECUTE')
        from pg_catalog.aclexplode(c.proacl) as x
        where x.grantee = 0
      ), false)
    end as public_execute,
    case
      when not exists (select 1 from named_roles where rolname = 'anon') then null
      else pg_catalog.has_function_privilege('anon', c.oid, 'execute')
    end as anon_execute,
    case
      when not exists (select 1 from named_roles where rolname = 'authenticated') then null
      else pg_catalog.has_function_privilege('authenticated', c.oid, 'execute')
    end as authenticated_execute,
    case
      when not exists (select 1 from named_roles where rolname = 'service_role') then null
      else pg_catalog.has_function_privilege('service_role', c.oid, 'execute')
    end as service_role_execute,
    (
      select pg_catalog.string_agg(item.grantee || ' EXECUTE', ', ' order by item.grantee)
      from (
        select case when x.grantee = 0 then 'public' else role_name.rolname end as grantee
        from pg_catalog.aclexplode(c.proacl) as x
        left join pg_catalog.pg_roles as role_name on role_name.oid = x.grantee
        where x.privilege_type = 'EXECUTE'
      ) as item
    ) as execute_grantees
  from chosen_one as c
),
month_window as (
  select
    (
      pg_catalog.date_trunc(
        'month',
        (pg_catalog.clock_timestamp() at time zone 'America/New_York')
      ) at time zone 'America/New_York'
    ) as month_from,
    (
      (
        pg_catalog.date_trunc(
          'month',
          (pg_catalog.clock_timestamp() at time zone 'America/New_York')
        ) + pg_catalog.make_interval(months => 1)
      ) at time zone 'America/New_York'
    ) as month_to
),
current_month as (
  select
    w.month_from,
    w.month_to,
    r.logical_requests,
    r.completed_requests,
    r.failed_requests,
    r.observed_attempts,
    r.characters,
    r.pending_cost_attempts,
    r.pending_characters,
    r.estimated_cost_cents,
    r.totals_partial
  from month_window as w
  cross join lateral public.summarize_host_tts_meter_backoffice(w.month_from, w.month_to) as r
),
current_month_count as (
  select count(*)::pg_catalog.int8 as matches
  from current_month
),
checks as (
  select
    'function_count'::text as check_id,
    case
      when t.proc is not null and n.matches = 1 then 'pass'
      else 'fail'
    end as status,
    'public.summarize_host_tts_meter_backoffice(timestamp with time zone, timestamp with time zone)'::text as object_name,
    'oid=' || coalesce(t.proc::pg_catalog.oid::text, 'null')
      || ' funciones_con_ese_nombre=' || n.matches::text as detail,
    null::pg_catalog.int8 as logical_requests,
    null::pg_catalog.int8 as completed_requests,
    null::pg_catalog.int8 as failed_requests,
    null::pg_catalog.int8 as observed_attempts,
    null::pg_catalog.int8 as characters,
    null::pg_catalog.int8 as pending_cost_attempts,
    null::pg_catalog.int8 as pending_characters,
    null::pg_catalog.int8 as estimated_cost_cents,
    null::pg_catalog.bool as totals_partial
  from target as t
  cross join name_count as n

  union all

  select
    'return_table'::text,
    case
      when c.oid is null then 'fail'
      when c.result_type = e.result_type and c.table_columns = e.table_columns then 'pass'
      else 'fail'
    end,
    'public.summarize_host_tts_meter_backoffice(timestamp with time zone, timestamp with time zone)'::text,
    'result_type=' || coalesce(c.result_type, '(ausente)')
      || ' table_columns=' || coalesce(c.table_columns, '(ausente)'),
    null, null, null, null, null, null, null, null, null
  from expected as e
  left join chosen_one as c on true

  union all

  select
    'security'::text,
    case
      when c.oid is null then 'fail'
      when c.prosecdef
        and c.lanname = 'plpgsql'
        and c.proconfig = array['search_path=pg_catalog']::text[]
        then 'pass'
      else 'fail'
    end,
    'public.summarize_host_tts_meter_backoffice(timestamp with time zone, timestamp with time zone)'::text,
    'security_definer=' || coalesce(c.prosecdef::text, 'missing')
      || ' language=' || coalesce(c.lanname, 'missing')
      || ' proconfig=' || coalesce(c.proconfig::text, 'missing'),
    null, null, null, null, null, null, null, null, null
  from chosen_one as c
  right join (select 1) as anchor on true

  union all

  select
    'execute'::text,
    case
      when a.oid is null then 'fail'
      when a.public_execute is false
        and a.anon_execute is false
        and a.authenticated_execute is false
        and a.service_role_execute is true
        then 'pass'
      else 'fail'
    end,
    'public.summarize_host_tts_meter_backoffice(timestamp with time zone, timestamp with time zone)'::text,
    'public=' || coalesce(a.public_execute::text, 'missing')
      || ' anon=' || coalesce(a.anon_execute::text, 'missing')
      || ' authenticated=' || coalesce(a.authenticated_execute::text, 'missing')
      || ' service_role=' || coalesce(a.service_role_execute::text, 'missing')
      || ' grantees=' || coalesce(a.execute_grantees, '(ninguno)'),
    null, null, null, null, null, null, null, null, null
  from execute_acl as a
  right join (select 1) as anchor on true

  union all

  select
    'definition'::text,
    case
      when d.oid is null then 'fail'
      when d.source_matches then 'pass'
      else 'fail'
    end,
    'public.summarize_host_tts_meter_backoffice(timestamp with time zone, timestamp with time zone)'::text,
    case
      when d.oid is null then 'to_regprocedure no resolvió la firma'
      when d.source_matches then 'prosrc coincide con el cuerpo de la migración'
      else 'prosrc difiere en el carácter ' || coalesce(d.first_difference::text, '?')
        || ' deployed_chars=' || coalesce(d.deployed_chars::text, '?')
        || ' migration_chars=' || coalesce(d.migration_chars::text, '?')
    end,
    null, null, null, null, null, null, null, null, null
  from definition_diff as d
  right join (select 1) as anchor on true

  union all

  select
    'current_month'::text,
    'info'::text,
    'America/New_York ' || m.month_from::text || ' .. ' || m.month_to::text,
    'lectura del mes'
      || ' logical_requests=' || coalesce(m.logical_requests::text, 'null')
      || ' completed_requests=' || coalesce(m.completed_requests::text, 'null')
      || ' failed_requests=' || coalesce(m.failed_requests::text, 'null')
      || ' observed_attempts=' || coalesce(m.observed_attempts::text, 'null')
      || ' characters=' || coalesce(m.characters::text, 'null')
      || ' pending_cost_attempts=' || coalesce(m.pending_cost_attempts::text, 'null')
      || ' pending_characters=' || coalesce(m.pending_characters::text, 'null')
      || ' estimated_cost_cents=' || coalesce(m.estimated_cost_cents::text, 'null')
      || ' totals_partial=' || coalesce(m.totals_partial::text, 'null'),
    m.logical_requests,
    m.completed_requests,
    m.failed_requests,
    m.observed_attempts,
    m.characters,
    m.pending_cost_attempts,
    m.pending_characters,
    m.estimated_cost_cents,
    m.totals_partial
  from current_month as m

  union all

  select
    'current_month'::text,
    'fail'::text,
    'America/New_York'::text,
    'la lectura no devolvió una fila'::text,
    null::pg_catalog.int8,
    null::pg_catalog.int8,
    null::pg_catalog.int8,
    null::pg_catalog.int8,
    null::pg_catalog.int8,
    null::pg_catalog.int8,
    null::pg_catalog.int8,
    null::pg_catalog.int8,
    null::pg_catalog.bool
  where (select matches from current_month_count) = 0
),
summary as (
  select
    'summary'::text as check_id,
    case when count(*) filter (where status = 'fail') = 0 then 'pass' else 'fail' end as status,
    'summarize_host_tts_meter_backoffice'::text as object_name,
    (count(*) filter (where status = 'fail'))::text || ' fail, '
      || (count(*) filter (where status = 'pass'))::text || ' pass, '
      || (count(*) filter (where status = 'info'))::text || ' info' as detail,
    null::pg_catalog.int8 as logical_requests,
    null::pg_catalog.int8 as completed_requests,
    null::pg_catalog.int8 as failed_requests,
    null::pg_catalog.int8 as observed_attempts,
    null::pg_catalog.int8 as characters,
    null::pg_catalog.int8 as pending_cost_attempts,
    null::pg_catalog.int8 as pending_characters,
    null::pg_catalog.int8 as estimated_cost_cents,
    null::pg_catalog.bool as totals_partial
  from checks
)
select
  check_id,
  status,
  object_name,
  detail,
  logical_requests,
  completed_requests,
  failed_requests,
  observed_attempts,
  characters,
  pending_cost_attempts,
  pending_characters,
  estimated_cost_cents,
  totals_partial
from (
  select 0 as sort_group, summary.* from summary
  union all
  select case check_id when 'current_month' then 1 when 'definition' then 2 else 3 end, checks.* from checks
) as report
order by sort_group, check_id;
