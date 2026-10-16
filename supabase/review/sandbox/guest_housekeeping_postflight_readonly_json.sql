-- READ ONLY. Catalog/config verification for ygipnetialejzuazfjcn.
-- Returns exactly one diagnostic_json cell and reads no guest, reservation,
-- property, request, token, proof-task, photo-metadata, or object rows.
with relation_names(name) as (
  values
    ('guest_stay_tokens'),
    ('housekeeping_proof_tasks'),
    ('housekeeping_proof_tokens'),
    ('housekeeping_proof_photos'),
    ('guest_service_requests')
), roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
), relations as (
  select rn.name, c.oid, c.relrowsecurity, c.relforcerowsecurity
  from relation_names rn
  left join pg_catalog.pg_class c on c.oid = pg_catalog.to_regclass('public.' || rn.name)
), relation_json as (
  select jsonb_agg(jsonb_build_object(
    'name', r.name,
    'exists', r.oid is not null,
    'rls_enabled', r.relrowsecurity,
    'force_rls', r.relforcerowsecurity,
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', a.attname,
        'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
        'not_null', a.attnotnull,
        'default', pg_catalog.pg_get_expr(d.adbin, d.adrelid)
      ) order by a.attnum)
      from pg_catalog.pg_attribute a
      left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
    ), '[]'::jsonb),
    'constraints', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', con.conname,
        'type', con.contype,
        'definition', pg_catalog.pg_get_constraintdef(con.oid, true)
      ) order by con.conname)
      from pg_catalog.pg_constraint con where con.conrelid = r.oid
    ), '[]'::jsonb),
    'indexes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', ic.relname,
        'unique', ix.indisunique,
        'valid', ix.indisvalid,
        'definition', pg_catalog.pg_get_indexdef(ix.indexrelid)
      ) order by ic.relname)
      from pg_catalog.pg_index ix
      join pg_catalog.pg_class ic on ic.oid = ix.indexrelid
      where ix.indrelid = r.oid
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', p.polname,
        'command', p.polcmd,
        'permissive', p.polpermissive,
        'roles', coalesce((select jsonb_agg(
          case when role_oid = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_oid) end
          order by role_oid) from unnest(p.polroles) role_oid), '[]'::jsonb),
        'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
        'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
      ) order by p.polname)
      from pg_catalog.pg_policy p where p.polrelid = r.oid
    ), '[]'::jsonb),
    'effective_privileges', (
      select jsonb_agg(jsonb_build_object(
        'role', ro.role_name,
        'select', case when r.oid is null then null else pg_catalog.has_table_privilege(ro.role_name, r.oid, 'SELECT') end,
        'insert', case when r.oid is null then null else pg_catalog.has_table_privilege(ro.role_name, r.oid, 'INSERT') end,
        'update', case when r.oid is null then null else pg_catalog.has_table_privilege(ro.role_name, r.oid, 'UPDATE') end,
        'delete', case when r.oid is null then null else pg_catalog.has_table_privilege(ro.role_name, r.oid, 'DELETE') end,
        'truncate', case when r.oid is null then null else pg_catalog.has_table_privilege(ro.role_name, r.oid, 'TRUNCATE') end,
        'references', case when r.oid is null then null else pg_catalog.has_table_privilege(ro.role_name, r.oid, 'REFERENCES') end,
        'trigger', case when r.oid is null then null else pg_catalog.has_table_privilege(ro.role_name, r.oid, 'TRIGGER') end
      ) order by ro.role_name) from roles ro
    )
  ) order by r.name) value
  from relations r
), function_names(name, args) as (
  values
    ('issue_housekeeping_proof_link_atomic', 'text, text, text, timestamp with time zone, timestamp with time zone, text, uuid'),
    ('submit_housekeeping_proof_atomic', 'text'),
    ('review_housekeeping_proof_batch_atomic', 'text, text, text, text, uuid'),
    ('create_guest_towel_request_atomic', 'uuid, text, text'),
    ('enforce_guest_service_request_transition', '')
), function_json as (
  select jsonb_agg(jsonb_build_object(
    'name', f.name,
    'identity_arguments', f.args,
    'exists', p.oid is not null,
    'security_definer', p.prosecdef,
    'config', p.proconfig,
    'definition_md5', case when p.oid is null then null else md5(pg_catalog.pg_get_functiondef(p.oid)) end,
    'effective_execute', (
      select jsonb_agg(jsonb_build_object(
        'role', r.role_name,
        'allowed', case when p.oid is null then null else pg_catalog.has_function_privilege(r.role_name, p.oid, 'EXECUTE') end
      ) order by r.role_name) from roles r
    )
  ) order by f.name) value
  from function_names f
  left join pg_catalog.pg_proc p
    on p.oid = pg_catalog.to_regprocedure('public.' || f.name || '(' || f.args || ')')
), storage_policy_json as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.polname,
    'command', p.polcmd,
    'roles', coalesce((select jsonb_agg(
      case when role_oid = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(role_oid) end
      order by role_oid) from unnest(p.polroles) role_oid), '[]'::jsonb),
    'using', pg_catalog.pg_get_expr(p.polqual, p.polrelid),
    'with_check', pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
  ) order by p.polname), '[]'::jsonb) value
  from pg_catalog.pg_policy p
  where p.polrelid = pg_catalog.to_regclass('storage.objects')
), bucket_config as (
  select jsonb_build_object(
    'exists', count(*) = 1,
    'private', coalesce(bool_and(not public), false),
    'file_size_limit', max(file_size_limit),
    'allowed_mime_types', coalesce(jsonb_agg(to_jsonb(allowed_mime_types)) filter (where id is not null), '[]'::jsonb)
  ) value
  from storage.buckets where id = 'housekeeping-proof'
), storage_access as (
  select jsonb_agg(jsonb_build_object(
    'role', r.role_name,
    'select', pg_catalog.has_table_privilege(r.role_name, 'storage.objects', 'SELECT'),
    'insert', pg_catalog.has_table_privilege(r.role_name, 'storage.objects', 'INSERT'),
    'update', pg_catalog.has_table_privilege(r.role_name, 'storage.objects', 'UPDATE'),
    'delete', pg_catalog.has_table_privilege(r.role_name, 'storage.objects', 'DELETE')
  ) order by r.role_name) value
  from roles r
)
select jsonb_build_object(
  'expected_project_ref', 'ygipnetialejzuazfjcn',
  'catalog_and_bucket_config_only', true,
  'server_version', current_setting('server_version'),
  'current_user', current_user,
  'relations', (select value from relation_json),
  'functions', (select value from function_json),
  'bucket', (select value from bucket_config),
  'storage_objects_rls', (select jsonb_build_object(
    'enabled', c.relrowsecurity,
    'force', c.relforcerowsecurity
  ) from pg_catalog.pg_class c where c.oid = pg_catalog.to_regclass('storage.objects')),
  'storage_objects_effective_privileges', (select value from storage_access),
  'storage_objects_policies', (select value from storage_policy_json)
) as diagnostic_json;
