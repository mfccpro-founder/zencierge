-- Verificación de solo lectura del acceso al audio TTS.
-- Sirve antes o después de crear el bucket ai-usage-tts-audio.
-- EXECUTE de describe_ai_usage_audio_object se permite al propietario esperado postgres y a service_role.
-- El propietario se informa aparte. public, anon y authenticated siguen prohibidos; se comprueba el permiso efectivo.
-- En UPDATE y ALL, un WITH CHECK nulo usa USING como expresión efectiva y no es acceso abierto por sí solo.
-- Lo que no se puede concluir queda como requiere revisión, incluidas políticas restrictivas y roles heredados.
-- Una coincidencia de texto no es un pass.
-- No inserta, no actualiza y no borra. Pendiente de revisión.

with recursive storage_table as (
  select c.oid, c.relrowsecurity
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'storage'
    and c.relname = 'objects'
    and c.relkind = 'r'
),
inherited_roles as (
  select r.oid as client_oid, r.rolname as client_name, r.oid as source_oid, 0 as depth
  from pg_catalog.pg_roles as r
  where r.rolname in ('anon', 'authenticated')
  union all
  select inherited.client_oid, inherited.client_name, member_of.roleid, inherited.depth + 1
  from inherited_roles as inherited
  join pg_catalog.pg_auth_members as member_of on member_of.member = inherited.source_oid
  where inherited.depth < 8
),
policy_roles as (
  select
    pol.polname,
    pol.polpermissive,
    pol.polcmd::text as polcmd,
    role_list.role_oid,
    case when role_list.role_oid = 0 then 'public' else role_name.rolname end as direct_role,
    pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
    pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
  from pg_catalog.pg_policy as pol
  join storage_table as storage_objects on storage_objects.oid = pol.polrelid
  cross join lateral pg_catalog.unnest(pol.polroles) as role_list(role_oid)
  left join pg_catalog.pg_roles as role_name on role_name.oid = role_list.role_oid
),
affected_policies as (
  select
    policy_role.polname,
    policy_role.polpermissive,
    policy_role.polcmd,
    policy_role.direct_role,
    affected.client_name,
    policy_role.using_expr,
    policy_role.check_expr
  from policy_roles as policy_role
  join lateral (
    select 'public'::text as client_name
    where policy_role.role_oid = 0
    union
    select role_name.rolname
    from pg_catalog.pg_roles as role_name
    where policy_role.role_oid = 0
      and role_name.rolname in ('anon', 'authenticated')
    union
    select inherited.client_name
    from inherited_roles as inherited
    where inherited.client_oid = policy_role.role_oid
      or inherited.source_oid = policy_role.role_oid
  ) as affected on true
),
grouped_policies as (
  select
    polname,
    polpermissive,
    polcmd,
    pg_catalog.string_agg(distinct direct_role, ', ' order by direct_role) as direct_roles,
    pg_catalog.string_agg(distinct client_name, ', ' order by client_name) as affected_roles,
    using_expr,
    check_expr,
    case
      when polcmd in ('a', 'w', '*') then coalesce(check_expr, using_expr)
      else check_expr
    end as effective_check,
    case polcmd
      when 'r' then 'SELECT'
      when 'a' then 'INSERT'
      when 'w' then 'UPDATE'
      when 'd' then 'DELETE'
      when '*' then 'ALL'
      else polcmd
    end as command_name
  from affected_policies
  group by polname, polpermissive, polcmd, using_expr, check_expr
),
judged_policies as (
  select
    grouped.*,
    (
      grouped.polcmd in ('r', 'd', 'w', '*')
      and (
        grouped.using_expr is null
        or pg_catalog.lower(pg_catalog.btrim(grouped.using_expr)) = 'true'
      )
    )
    or (
      grouped.polcmd in ('a', 'w', '*')
      and (
        grouped.effective_check is null
        or pg_catalog.lower(pg_catalog.btrim(grouped.effective_check)) = 'true'
      )
    ) as allows_all,
    (
      grouped.polcmd in ('r', 'd', 'w', '*')
      and grouped.using_expr is not null
      and pg_catalog.lower(pg_catalog.btrim(grouped.using_expr)) <> 'true'
    )
    or (
      grouped.polcmd in ('a', 'w', '*')
      and grouped.effective_check is not null
      and pg_catalog.lower(pg_catalog.btrim(grouped.effective_check)) <> 'true'
    ) as constrains
  from grouped_policies as grouped
),
restrictive_limits as (
  select
    permissive.polname,
    pg_catalog.string_agg(
      restrictive.polname
        || ' roles_afectados=' || restrictive.affected_roles
        || ' roles_directos=' || restrictive.direct_roles
        || ' comando=' || restrictive.command_name
        || ' using=' || coalesce(restrictive.using_expr, '(null)')
        || ' check=' || coalesce(restrictive.check_expr, '(null)')
        || ' check_efectivo=' || coalesce(restrictive.effective_check, '(null)'),
      ' || ' order by restrictive.polname
    ) as restrictive_detail
  from judged_policies as permissive
  join judged_policies as restrictive
    on restrictive.polpermissive is false
   and restrictive.constrains
   and (
     permissive.polcmd = restrictive.polcmd
     or permissive.polcmd = '*'
     or restrictive.polcmd = '*'
   )
   and exists (
     select 1
     from pg_catalog.unnest(pg_catalog.string_to_array(permissive.affected_roles, ', ')) as permissive_role(role_name)
     join pg_catalog.unnest(pg_catalog.string_to_array(restrictive.affected_roles, ', ')) as restrictive_role(role_name)
       on pg_catalog.btrim(permissive_role.role_name) = pg_catalog.btrim(restrictive_role.role_name)
   )
  where permissive.polpermissive
    and permissive.allows_all
  group by permissive.polname
),
bucket_row as (
  select "public" as is_public
  from storage.buckets
  where id = 'ai-usage-tts-audio'
),
describe_function as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.prosrc,
    p.proowner,
    owner_role.rolname as owner_name,
    l.lanname,
    pg_catalog.oidvectortypes(p.proargtypes) as identity_args
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  join pg_catalog.pg_language as l on l.oid = p.prolang
  left join pg_catalog.pg_roles as owner_role on owner_role.oid = p.proowner
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname = 'describe_ai_usage_audio_object'
),
describe_match as (
  select *
  from describe_function
  where identity_args = 'text'
),
describe_execute as (
  select
    case when acl_entry.grantee = 0 then 'public' else role_name.rolname end as role_name
  from describe_match as fn
  cross join lateral pg_catalog.aclexplode(fn.proacl) as acl_entry
  left join pg_catalog.pg_roles as role_name on role_name.oid = acl_entry.grantee
  where acl_entry.privilege_type = 'EXECUTE'
),
describe_privileges as (
  select
    fn.oid,
    fn.owner_name,
    fn.proacl is null as public_default_execute,
    exists (
      select 1 from describe_execute where role_name = 'public'
    ) as public_acl_execute,
    case
      when not exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then null
      else pg_catalog.has_function_privilege(
        (select role_oid.oid from pg_catalog.pg_roles as role_oid where role_oid.rolname = 'anon'),
        fn.oid,
        'execute'
      )
    end as anon_effective,
    case
      when not exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then null
      else pg_catalog.has_function_privilege(
        (select role_oid.oid from pg_catalog.pg_roles as role_oid where role_oid.rolname = 'authenticated'),
        fn.oid,
        'execute'
      )
    end as authenticated_effective,
    case
      when not exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then null
      else pg_catalog.has_function_privilege(
        (select role_oid.oid from pg_catalog.pg_roles as role_oid where role_oid.rolname = 'service_role'),
        fn.oid,
        'execute'
      )
    end as service_role_effective,
    case
      when not exists (select 1 from pg_catalog.pg_roles where rolname = 'postgres') then null
      else pg_catalog.has_function_privilege(
        (select role_oid.oid from pg_catalog.pg_roles as role_oid where role_oid.rolname = 'postgres'),
        fn.oid,
        'execute'
      )
    end as postgres_effective
  from describe_match as fn
),
audio_table as (
  select c.oid, c.relacl
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'ai_usage_audio_objects'
    and c.relkind = 'r'
),
audio_table_grants as (
  select
    case when acl_entry.grantee = 0 then 'public' else role_name.rolname end as role_name,
    acl_entry.privilege_type
  from audio_table as audio_objects
  cross join lateral pg_catalog.aclexplode(audio_objects.relacl) as acl_entry
  left join pg_catalog.pg_roles as role_name on role_name.oid = acl_entry.grantee
  where acl_entry.grantee = 0
    or role_name.rolname in ('public', 'anon', 'authenticated', 'service_role')
),
checks as (
  select
    'storage_rls'::text as check_id,
    case
      when not exists (select 1 from storage_table) then 'fail'
      when (select relrowsecurity from storage_table) then 'pass'
      else 'fail'
    end as status,
    'storage.objects'::text as object_name,
    case
      when not exists (select 1 from storage_table) then 'la tabla storage.objects no existe'
      when (select relrowsecurity from storage_table) then 'row level security activo'
      else 'row level security apagado'
    end as detail

  union all

  select
    'storage_policy'::text,
    'pass'::text,
    'storage.objects'::text,
    'no hay políticas permisivas que afecten a public, anon o authenticated'
  where exists (select 1 from storage_table)
    and not exists (select 1 from judged_policies where polpermissive)

  union all

  select
    'storage_policy'::text,
    case
      when judged.allows_all and limits.restrictive_detail is null then 'fail'
      else 'requiere revisión'
    end,
    judged.polname,
    case
      when judged.allows_all and limits.restrictive_detail is null then 'permite la operación. '
      else 'requiere revisión. '
    end
      || 'roles_afectados=' || judged.affected_roles
      || '. roles_directos=' || judged.direct_roles
      || '. comando=' || judged.command_name
      || '. using=' || coalesce(judged.using_expr, '(null)')
      || '. check=' || coalesce(judged.check_expr, '(null)')
      || '. check_efectivo=' || coalesce(judged.effective_check, '(null)')
      || case
        when limits.restrictive_detail is null then ''
        else '. restrictivas=' || limits.restrictive_detail
      end
  from judged_policies as judged
  left join restrictive_limits as limits on limits.polname = judged.polname
  where judged.polpermissive

  union all

  select
    'storage_policy_inventory'::text,
    'info'::text,
    pol.polname || ' ' || coalesce(pol.direct_role, '(rol desconocido)'),
    'permissive=' || pol.polpermissive::text
      || ' comando=' || case pol.polcmd
        when 'r' then 'SELECT'
        when 'a' then 'INSERT'
        when 'w' then 'UPDATE'
        when 'd' then 'DELETE'
        when '*' then 'ALL'
        else pol.polcmd
      end
      || ' using=' || coalesce(pol.using_expr, '(null)')
      || ' check=' || coalesce(pol.check_expr, '(null)')
  from policy_roles as pol

  union all

  select
    'bucket_visibility'::text,
    case
      when not exists (select 1 from bucket_row) then 'info'
      when (select is_public from bucket_row) then 'fail'
      else 'pass'
    end,
    'ai-usage-tts-audio'::text,
    case
      when not exists (select 1 from bucket_row) then 'el bucket todavía no existe'
      when (select is_public from bucket_row) then 'el bucket es público'
      else 'el bucket es privado'
    end

  union all

  select
    'describe_owner'::text,
    'info'::text,
    coalesce((select owner_name from describe_match), '(función ausente)')::text,
    case
      when not exists (select 1 from describe_match) then 'la función todavía no está aplicada'
      else 'proowner=' || coalesce((select owner_name from describe_match), '(sin rol)')
        || ' oid=' || coalesce((select proowner::text from describe_match), '(null)')
    end

  union all

  select
    'describe_execute'::text,
    case
      when not exists (select 1 from describe_function) then 'info'
      when exists (select 1 from describe_function where identity_args <> 'text') then 'fail'
      when not exists (select 1 from describe_match) then 'fail'
      when (select prosecdef is not true from describe_match) then 'fail'
      when (select lanname <> 'plpgsql' from describe_match) then 'fail'
      when not exists (
        select 1
        from describe_match as fn
        cross join lateral pg_catalog.unnest(coalesce(fn.proconfig, array[]::text[])) as cfg(value)
        where cfg.value = 'search_path=pg_catalog'
      ) then 'fail'
      when exists (
        select 1 from describe_match as fn where fn.prosrc ~* 'grant[[:space:]]'
      ) then 'fail'
      when (select owner_name is distinct from 'postgres' from describe_match) then 'fail'
      when (select public_default_execute or public_acl_execute from describe_privileges) then 'fail'
      when (select anon_effective is distinct from false from describe_privileges) then 'fail'
      when (select authenticated_effective is distinct from false from describe_privileges) then 'fail'
      when (select service_role_effective is distinct from true from describe_privileges) then 'fail'
      when (select postgres_effective is distinct from true from describe_privileges) then 'fail'
      when exists (
        select 1
        from describe_execute
        where role_name is distinct from 'postgres'
          and role_name is distinct from 'service_role'
      ) then 'requiere revisión'
      else 'pass'
    end,
    'describe_ai_usage_audio_object(text)'::text,
    case
      when not exists (select 1 from describe_function) then 'la función todavía no está aplicada'
      else 'proowner=' || coalesce((select owner_name from describe_match), '(sin rol)')
        || ' execute_roles=' || coalesce((
          select pg_catalog.string_agg(distinct role_name, ', ' order by role_name)
          from describe_execute
        ), '(ninguno)')
        || ' postgres_efectivo=' || coalesce((select postgres_effective::text from describe_privileges), 'rol_ausente')
        || ' service_role_efectivo=' || coalesce((select service_role_effective::text from describe_privileges), 'rol_ausente')
        || ' anon_efectivo=' || coalesce((select anon_effective::text from describe_privileges), 'rol_ausente')
        || ' authenticated_efectivo=' || coalesce((select authenticated_effective::text from describe_privileges), 'rol_ausente')
        || ' public_acl=' || coalesce((select (public_default_execute or public_acl_execute)::text from describe_privileges), 'desconocido')
        || ' grant_en_cuerpo=' || case
          when exists (select 1 from describe_match as fn where fn.prosrc ~* 'grant[[:space:]]') then 'true'
          else 'false'
        end
    end

  union all

  select
    'audio_object_table_privileges'::text,
    case
      when not exists (select 1 from audio_table) then 'info'
      when exists (select 1 from audio_table_grants) then 'fail'
      else 'pass'
    end,
    'ai_usage_audio_objects'::text,
    case
      when not exists (select 1 from audio_table) then 'la tabla todavía no existe'
      when exists (select 1 from audio_table_grants) then 'permiso directo: ' || (
        select pg_catalog.string_agg(role_name || ' ' || privilege_type, ', ' order by role_name, privilege_type)
        from audio_table_grants
      )
      else 'public, anon, authenticated y service_role no tienen permisos directos sobre la tabla'
    end
),
summary as (
  select
    'summary'::text as check_id,
    case
      when count(*) filter (where status = 'fail') > 0 then 'fail'
      when count(*) filter (where status = 'requiere revisión') > 0 then 'requiere revisión'
      else 'pass'
    end as status,
    'ai-usage-tts-audio-storage'::text as object_name,
    (count(*) filter (where status = 'fail'))::text || ' fail, '
      || (count(*) filter (where status = 'pass'))::text || ' pass, '
      || (count(*) filter (where status = 'requiere revisión'))::text || ' requiere revisión, '
      || (count(*) filter (where status = 'info'))::text || ' info' as detail
  from checks
)
select check_id, status, object_name, detail
from (
  select 0 as sort_group, check_id, status, object_name, detail from summary
  union all
  select
    case status
      when 'fail' then 1
      when 'requiere revisión' then 2
      when 'pass' then 3
      else 4
    end,
    check_id,
    status,
    object_name,
    detail
  from checks
) as report
order by sort_group, check_id, object_name;
