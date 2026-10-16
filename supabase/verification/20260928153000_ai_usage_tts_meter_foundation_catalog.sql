-- Verificación de solo lectura del medidor TTS aplicado en zencierge-sandbox.
-- Migración: 20260928153000_ai_usage_tts_meter_foundation.sql
-- Consulta pg_class, pg_proc, pg_attribute y las ACL. No llama funciones del medidor.
-- No inserta, no actualiza y no borra. Pendiente de revisión.

with expected_tables(relname) as (
  values
    ('ai_usage_logical_requests'::text),
    ('ai_usage_attempts'::text),
    ('ai_usage_key_rejections'::text),
    ('ai_usage_audio_objects'::text)
),
expected_functions(proname, identity_args, service_role_execute) as (
  values
    ('ai_usage_record_key_rejection', 'text, text, text, text, text', false),
    ('issue_ai_usage_logical_request', 'text, text, text, text, uuid, text, text, timestamp with time zone, text', true),
    ('validate_ai_usage_logical_request', 'text, text, text, text, text', true),
    ('acquire_ai_usage_logical_request', 'text, text, text, text, text, integer, boolean', true),
    ('renew_ai_usage_lease', 'uuid, uuid, integer', true),
    ('mark_ai_usage_dispatch_started', 'uuid, uuid', true),
    ('mark_ai_usage_response_observed', 'uuid, uuid', true),
    ('record_ai_usage_attempt_result', 'uuid, uuid, text, integer, text, text, text, integer, integer, boolean', true),
    ('record_ai_usage_audio_delivery_failure', 'uuid, uuid, text', true),
    ('begin_ai_usage_fallback_attempt', 'uuid, uuid', true),
    ('commit_ai_usage_attempt_audio', 'uuid, uuid, text, integer, text, timestamp with time zone', true),
    ('close_ai_usage_logical_request', 'uuid, uuid, text', true),
    ('expire_ai_usage_leases', 'timestamp with time zone', true),
    ('summarize_ai_usage_tts_meter', 'timestamp with time zone, timestamp with time zone', true),
    ('mark_ai_usage_audio_for_cleanup', 'timestamp with time zone', true),
    ('list_ai_usage_audio_cleanup', '', true),
    ('acknowledge_ai_usage_audio_cleanup', 'text', true),
    ('lookup_ai_usage_replay_audio', 'text, text', true)
),
table_privileges(privilege_type) as (
  values
    ('SELECT'::text),
    ('INSERT'::text),
    ('UPDATE'::text),
    ('DELETE'::text),
    ('TRUNCATE'::text),
    ('REFERENCES'::text),
    ('TRIGGER'::text)
),
tables as (
  select c.oid, c.relname, c.relrowsecurity, c.relacl
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (select relname from expected_tables)
),
functions as (
  select
    p.oid,
    p.proname,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    pg_catalog.oidvectortypes(p.proargtypes) as identity_args,
    l.lanname
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  join pg_catalog.pg_language as l on l.oid = p.prolang
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname in (select proname from expected_functions)
),
named_roles as (
  select r.oid, r.rolname
  from pg_catalog.pg_roles as r
  where r.rolname in ('anon', 'authenticated', 'service_role')
),
table_checks as (
  select
    'table_rls'::text as check_id,
    case
      when t.oid is null then 'fail'
      when t.relrowsecurity then 'pass'
      else 'fail'
    end as status,
    e.relname as object_name,
    case
      when t.oid is null then 'la tabla no existe'
      when t.relrowsecurity then 'RLS activo'
      else 'RLS inactivo'
    end as detail
  from expected_tables as e
  left join tables as t on t.relname = e.relname

  union all

  select
    'table_privileges'::text,
    case
      when t.oid is null then 'fail'
      when forbidden.detail is null then 'pass'
      else 'fail'
    end,
    e.relname,
    case
      when t.oid is null then 'la tabla no existe'
      when forbidden.detail is null then 'public, anon, authenticated y service_role no tienen privilegios directos'
      else forbidden.detail
    end
  from expected_tables as e
  left join tables as t on t.relname = e.relname
  left join lateral (
    select pg_catalog.string_agg(item.grantee || ' ' || item.privilege_type, ', ' order by item.grantee, item.privilege_type) as detail
    from (
      select
        case when x.grantee = 0 then 'public' else role_name.rolname end as grantee,
        x.privilege_type
      from pg_catalog.aclexplode(t.relacl) as x
      left join pg_catalog.pg_roles as role_name on role_name.oid = x.grantee
      where t.oid is not null
        and (
          x.grantee = 0
          or role_name.rolname in ('anon', 'authenticated', 'service_role')
        )
      union
      select nr.rolname, tp.privilege_type
      from named_roles as nr
      cross join table_privileges as tp
      where t.oid is not null
        and pg_catalog.has_table_privilege(nr.rolname, t.oid, tp.privilege_type)
      union
      select
        case when x.grantee = 0 then 'public' else role_name.rolname end,
        x.privilege_type || ' ' || a.attname
      from pg_catalog.pg_attribute as a
      cross join lateral pg_catalog.aclexplode(a.attacl) as x
      left join pg_catalog.pg_roles as role_name on role_name.oid = x.grantee
      where t.oid is not null
        and a.attrelid = t.oid
        and a.attnum > 0
        and not a.attisdropped
        and (
          x.grantee = 0
          or role_name.rolname in ('anon', 'authenticated', 'service_role')
        )
    ) as item
  ) as forbidden on true
),
function_matches as (
  select
    e.proname,
    e.identity_args,
    e.service_role_execute,
    count(f.oid) as matches,
    bool_or(f.prosecdef) as security_definer,
    bool_or(
      exists (
        select 1
        from pg_catalog.unnest(coalesce(f.proconfig, array[]::text[])) as cfg(value)
        where cfg.value = 'search_path=pg_catalog'
      )
      and not exists (
        select 1
        from pg_catalog.unnest(coalesce(f.proconfig, array[]::text[])) as cfg(value)
        where cfg.value like 'search_path=%'
          and cfg.value <> 'search_path=pg_catalog'
      )
    ) as search_path_ok,
    bool_or(f.lanname = 'plpgsql') as language_ok,
    (array_agg(f.oid))[1] as function_oid
  from expected_functions as e
  left join functions as f
    on f.proname = e.proname
   and f.identity_args = e.identity_args
  group by e.proname, e.identity_args, e.service_role_execute
),
function_execute as (
  select
    m.proname,
    m.identity_args,
    m.service_role_execute,
    m.matches,
    m.security_definer,
    m.search_path_ok,
    m.language_ok,
    m.function_oid,
    case
      when m.function_oid is null then null
      when proc.proacl is null then true
      else coalesce((
        select pg_catalog.bool_or(x.privilege_type = 'EXECUTE')
        from pg_catalog.aclexplode(proc.proacl) as x
        where x.grantee = 0
      ), false)
    end as public_execute,
    case
      when m.function_oid is null then null
      when not exists (select 1 from named_roles where rolname = 'anon') then null
      else pg_catalog.has_function_privilege('anon', m.function_oid, 'execute')
    end as anon_execute,
    case
      when m.function_oid is null then null
      when not exists (select 1 from named_roles where rolname = 'authenticated') then null
      else pg_catalog.has_function_privilege('authenticated', m.function_oid, 'execute')
    end as authenticated_execute,
    case
      when m.function_oid is null then null
      when not exists (select 1 from named_roles where rolname = 'service_role') then null
      else pg_catalog.has_function_privilege('service_role', m.function_oid, 'execute')
    end as service_role_has_execute
  from function_matches as m
  left join pg_catalog.pg_proc as proc on proc.oid = m.function_oid
),
function_checks as (
  select
    'function'::text as check_id,
    case
      when fx.matches is distinct from 1 then 'fail'
      when fx.security_definer is not true then 'fail'
      when fx.search_path_ok is not true then 'fail'
      when fx.language_ok is not true then 'fail'
      when fx.public_execute is not false then 'fail'
      when fx.anon_execute is not false then 'fail'
      when fx.authenticated_execute is not false then 'fail'
      when fx.service_role_has_execute is distinct from fx.service_role_execute then 'fail'
      else 'pass'
    end as status,
    fx.proname || '(' || fx.identity_args || ')' as object_name,
    'matches=' || coalesce(fx.matches::text, '0')
      || ' security_definer=' || coalesce(fx.security_definer::text, 'missing')
      || ' search_path=pg_catalog=' || coalesce(fx.search_path_ok::text, 'missing')
      || ' language=plpgsql=' || coalesce(fx.language_ok::text, 'missing')
      || ' execute public=' || coalesce(fx.public_execute::text, 'missing')
      || ' anon=' || coalesce(fx.anon_execute::text, 'missing')
      || ' authenticated=' || coalesce(fx.authenticated_execute::text, 'missing')
      || ' service_role=' || coalesce(fx.service_role_has_execute::text, 'missing')
      || ' expected_service_role=' || fx.service_role_execute::text as detail
  from function_execute as fx

  union all

  select
    'function_unexpected'::text,
    'fail'::text,
    f.proname || '(' || f.identity_args || ')',
    'la firma no está en la migración'
  from functions as f
  where not exists (
    select 1
    from expected_functions as e
    where e.proname = f.proname
      and e.identity_args = f.identity_args
  )

  union all

  select
    'rejection_helper_grantee'::text,
    'info'::text,
    'ai_usage_record_key_rejection(text, text, text, text, text)',
    case
      when x.grantee = 0 then 'public'
      else role_name.rolname
    end || ' execute'
  from functions as f
  cross join lateral pg_catalog.aclexplode(f.proacl) as x
  left join pg_catalog.pg_roles as role_name on role_name.oid = x.grantee
  where f.proname = 'ai_usage_record_key_rejection'
    and f.identity_args = 'text, text, text, text, text'
    and x.privilege_type = 'EXECUTE'
),
checks as (
  select * from table_checks
  union all
  select * from function_checks
),
summary as (
  select
    'summary'::text as check_id,
    case when count(*) filter (where status = 'fail') = 0 then 'pass' else 'fail' end as status,
    'ai_usage_tts_meter'::text as object_name,
    (count(*) filter (where status = 'fail'))::text || ' fail, '
      || (count(*) filter (where status = 'pass'))::text || ' pass, '
      || (count(*) filter (where status = 'info'))::text || ' info' as detail
  from checks
)
select check_id, status, object_name, detail
from (
  select 0 as sort_group, check_id, status, object_name, detail from summary
  union all
  select case status when 'fail' then 1 when 'pass' then 2 else 3 end, check_id, status, object_name, detail from checks
) as report
order by sort_group, check_id, object_name;
