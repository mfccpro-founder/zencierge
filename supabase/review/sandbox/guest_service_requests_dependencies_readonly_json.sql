-- READ ONLY. Catalogs only; no business-row reads and no changes.
-- Before running, verify the Dashboard URL contains:
-- /project/ygipnetialejzuazfjcn/
with required_relations(relation_name) as (
  values
    ('properties'::text),
    ('reservations'),
    ('guest_stay_tokens'),
    ('housekeeping_proof_tasks'),
    ('housekeeping_proof_photos'),
    ('guest_service_requests')
), relations as (
  select rr.relation_name, c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  from required_relations rr
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid
    and c.relname = rr.relation_name and c.relkind in ('r', 'p')
), columns_json as (
  select r.relation_name, coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', a.attname,
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'not_null', a.attnotnull,
    'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
  ) order by a.attnum) filter (where a.attname is not null), '[]'::pg_catalog.jsonb) value
  from relations r
  left join pg_catalog.pg_attribute a on a.attrelid = r.oid
    and a.attnum > 0 and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  group by r.relation_name
), constraints_json as (
  select r.relation_name, coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', con.conname,
    'type', con.contype,
    'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
  ) order by con.conname) filter (where con.oid is not null), '[]'::pg_catalog.jsonb) value
  from relations r
  left join pg_catalog.pg_constraint con on con.conrelid = r.oid
  group by r.relation_name
), indexes_json as (
  select r.relation_name, coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', i.relname,
    'unique', ix.indisunique,
    'valid', ix.indisvalid,
    'definition', pg_catalog.pg_get_indexdef(ix.indexrelid)
  ) order by i.relname) filter (where i.oid is not null), '[]'::pg_catalog.jsonb) value
  from relations r
  left join pg_catalog.pg_index ix on ix.indrelid = r.oid
  left join pg_catalog.pg_class i on i.oid = ix.indexrelid
  group by r.relation_name
), policies_json as (
  select r.relation_name, coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', p.polname,
    'command', p.polcmd,
    'permissive', p.polpermissive,
    'roles', coalesce((
      select pg_catalog.jsonb_agg(
        case when role_oid = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_oid) end
        order by role_oid
      ) from pg_catalog.unnest(p.polroles) role_oid
    ), '[]'::pg_catalog.jsonb),
    'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
    'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
  ) order by p.polname) filter (where p.oid is not null), '[]'::pg_catalog.jsonb) value
  from relations r
  left join pg_catalog.pg_policy p on p.polrelid = r.oid
  group by r.relation_name
), table_privileges as (
  select r.relation_name, roles.role_name,
    case when r.oid is null then null else pg_catalog.has_table_privilege(roles.role_name, r.oid, 'SELECT') end as can_select,
    case when r.oid is null then null else pg_catalog.has_table_privilege(roles.role_name, r.oid, 'INSERT') end as can_insert,
    case when r.oid is null then null else pg_catalog.has_table_privilege(roles.role_name, r.oid, 'UPDATE') end as can_update,
    case when r.oid is null then null else pg_catalog.has_table_privilege(roles.role_name, r.oid, 'DELETE') end as can_delete
  from relations r
  cross join (values ('anon'::text), ('authenticated'), ('service_role')) roles(role_name)
), required_functions(function_name, identity_arguments) as (
  values
    ('gen_random_uuid'::text, ''::text),
    ('issue_housekeeping_proof_link_atomic', 'text, text, text, timestamp with time zone, timestamp with time zone, text, uuid'),
    ('submit_housekeeping_proof_atomic', 'text'),
    ('review_housekeeping_proof_batch_atomic', 'text, text, text, text, uuid'),
    ('create_guest_towel_request_atomic', 'uuid, text, text'),
    ('enforce_guest_service_request_transition', '')
), functions as (
  select rf.function_name, rf.identity_arguments,
    p.oid, n.nspname, p.prosecdef, p.proconfig,
    case when p.oid is null then null else pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) end definition_md5
  from required_functions rf
  left join pg_catalog.pg_proc p on p.proname = rf.function_name
    and pg_catalog.pg_get_function_identity_arguments(p.oid) = rf.identity_arguments
  left join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    and (n.nspname = 'public' or (rf.function_name = 'gen_random_uuid' and n.nspname = 'pg_catalog'))
  where p.oid is null or n.oid is not null
), function_privileges as (
  select f.function_name, f.identity_arguments, roles.role_name,
    case when f.oid is null then null else pg_catalog.has_function_privilege(roles.role_name, f.oid, 'EXECUTE') end can_execute
  from functions f
  cross join (values ('anon'::text), ('authenticated'), ('service_role')) roles(role_name)
), relation_objects as (
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', r.relation_name,
    'exists', r.oid is not null,
    'kind', r.relkind,
    'rls_enabled', r.relrowsecurity,
    'force_rls', r.relforcerowsecurity,
    'columns', c.value,
    'constraints', co.value,
    'indexes', i.value,
    'policies', p.value,
    'effective_privileges', (
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(tp) - 'relation_name' order by tp.role_name)
      from table_privileges tp where tp.relation_name = r.relation_name
    )
  ) order by r.relation_name) value
  from relations r
  join columns_json c using (relation_name)
  join constraints_json co using (relation_name)
  join indexes_json i using (relation_name)
  join policies_json p using (relation_name)
), function_objects as (
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', f.function_name,
    'identity_arguments', f.identity_arguments,
    'exists', f.oid is not null,
    'schema', f.nspname,
    'security_definer', f.prosecdef,
    'config', f.proconfig,
    'definition_md5', f.definition_md5,
    'effective_execute', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'role', fp.role_name, 'allowed', fp.can_execute
      ) order by fp.role_name)
      from function_privileges fp
      where fp.function_name = f.function_name
        and fp.identity_arguments = f.identity_arguments
    )
  ) order by f.function_name) value
  from functions f
)
select pg_catalog.jsonb_build_object(
  'expected_project_ref', 'ygipnetialejzuazfjcn',
  'catalog_only', true,
  'server_version', pg_catalog.current_setting('server_version'),
  'current_user', current_user,
  'roles_exist', (
    select pg_catalog.jsonb_object_agg(wanted.role_name, roles.oid is not null order by wanted.role_name)
    from (values ('anon'::text), ('authenticated'), ('service_role')) wanted(role_name)
    left join pg_catalog.pg_roles roles on roles.rolname = wanted.role_name
  ),
  'relations', (select value from relation_objects),
  'functions', (select value from function_objects)
) as diagnostic_json;
