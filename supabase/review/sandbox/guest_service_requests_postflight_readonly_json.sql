-- READ ONLY. Run only after manually confirming the Dashboard project is
-- Zencierge sandbox: ygipnetialejzuazfjcn.
-- Catalogs only; does not read guest_service_requests or any business rows.
with target as (
  select c.oid, n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'guest_service_requests' and c.relkind = 'r'
), columns_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', a.attname,
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'not_null', a.attnotnull,
    'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
  ) order by a.attnum), '[]'::jsonb) value
  from target t
  join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
), constraints_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', con.conname,
    'type', con.contype,
    'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
  ) order by con.conname), '[]'::jsonb) value
  from target t join pg_catalog.pg_constraint con on con.conrelid = t.oid
), indexes_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', i.relname,
    'definition', pg_catalog.pg_get_indexdef(ix.indexrelid)
  ) order by i.relname), '[]'::jsonb) value
  from target t
  join pg_catalog.pg_index ix on ix.indrelid = t.oid
  join pg_catalog.pg_class i on i.oid = ix.indexrelid
), policies_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.polname,
    'permissive', p.polpermissive,
    'roles', coalesce((
      select jsonb_agg(case when role_oid = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_oid) end order by role_oid)
      from unnest(p.polroles) role_oid
    ), '[]'::jsonb),
    'command', p.polcmd,
    'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
    'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
  ) order by p.polname), '[]'::jsonb) value
  from target t join pg_catalog.pg_policy p on p.polrelid = t.oid
), role_privileges as (
  select jsonb_agg(jsonb_build_object(
    'role', r.role_name,
    'select', pg_catalog.has_table_privilege(r.role_name, 'public.guest_service_requests', 'SELECT'),
    'insert', pg_catalog.has_table_privilege(r.role_name, 'public.guest_service_requests', 'INSERT'),
    'update', pg_catalog.has_table_privilege(r.role_name, 'public.guest_service_requests', 'UPDATE'),
    'delete', pg_catalog.has_table_privilege(r.role_name, 'public.guest_service_requests', 'DELETE'),
    'truncate', pg_catalog.has_table_privilege(r.role_name, 'public.guest_service_requests', 'TRUNCATE'),
    'references', pg_catalog.has_table_privilege(r.role_name, 'public.guest_service_requests', 'REFERENCES'),
    'trigger', pg_catalog.has_table_privilege(r.role_name, 'public.guest_service_requests', 'TRIGGER'),
    'create_rpc_execute', pg_catalog.has_function_privilege(r.role_name, 'public.create_guest_towel_request_atomic(uuid,text,text)', 'EXECUTE'),
    'transition_function_execute', pg_catalog.has_function_privilege(r.role_name, 'public.enforce_guest_service_request_transition()', 'EXECUTE')
  ) order by r.role_name) value
  from (values ('anon'), ('authenticated'), ('service_role')) r(role_name)
), routines_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.proname,
    'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
    'security_definer', p.prosecdef,
    'definition', pg_catalog.pg_get_functiondef(p.oid)
  ) order by p.proname), '[]'::jsonb) value
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('create_guest_towel_request_atomic', 'enforce_guest_service_request_transition')
), triggers_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', tg.tgname,
    'definition', pg_catalog.pg_get_triggerdef(tg.oid, true)
  ) order by tg.tgname), '[]'::jsonb) value
  from target t
  join pg_catalog.pg_trigger tg on tg.tgrelid = t.oid and not tg.tgisinternal
)
select jsonb_build_object(
  'expected_project_ref', 'ygipnetialejzuazfjcn',
  'catalog_only', true,
  'table', coalesce((select jsonb_build_object(
    'qualified_name', nspname || '.' || relname,
    'rls_enabled', relrowsecurity,
    'force_rls', relforcerowsecurity
  ) from target), jsonb_build_object('qualified_name', null)),
  'columns', (select value from columns_json),
  'constraints', (select value from constraints_json),
  'indexes', (select value from indexes_json),
  'policies', (select value from policies_json),
  'effective_privileges', (select value from role_privileges),
  'routines', (select value from routines_json),
  'triggers', (select value from triggers_json)
) as diagnostic_json;
