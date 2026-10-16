-- REVIEW ONLY: principal fqkxlisenfrhkermwsar.
-- Install before deploying the server route. It does not alter existing RLS/ACL.
-- jsonb_populate_record adapts to the principal's current reservation columns.

create or replace function public.save_host_reservation(
  p_host_id uuid,
  p_reservation jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id text := nullif(pg_catalog.btrim(p_reservation ->> 'id'), '');
  v_property_id text := nullif(pg_catalog.btrim(p_reservation ->> 'property_id'), '');
  v_existing_property_id text;
  v_payload jsonb;
  v_insert_columns text;
  v_insert_values text;
  v_assignments text;
  v_has_updated_at boolean;
begin
  if p_host_id is null or pg_catalog.jsonb_typeof(p_reservation) <> 'object'
     or v_id is null or v_property_id is null then
    raise exception using errcode = '22023', message = 'invalid reservation input';
  end if;

  -- Canonical identifiers are used for authorization, lookup and persistence.
  v_payload := (p_reservation - 'updated_at') || pg_catalog.jsonb_build_object(
    'id', v_id,
    'property_id', v_property_id
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_id, 927413));

  if not exists (
    select 1 from public.properties
    where id = v_property_id and host_id = p_host_id
  ) then
    raise exception using errcode = 'ZR002', message = 'property is not owned by host';
  end if;

  select property_id into v_existing_property_id
  from public.reservations
  where id = v_id
  for update;

  if found and v_existing_property_id is distinct from v_property_id then
    raise exception using errcode = 'ZR001', message = 'reservation property cannot be changed';
  end if;

  if found then
    select pg_catalog.string_agg(
      pg_catalog.format(
        '%1$I = (pg_catalog.jsonb_populate_record(null::public.reservations, $1)).%1$I',
        a.attname
      ),
      ', ' order by a.attnum
    )
    into v_assignments
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.reservations'::pg_catalog.regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = ''
      and a.attname not in ('id', 'property_id', 'updated_at')
      and v_payload ? a.attname;

    select exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.reservations'::pg_catalog.regclass
        and a.attname = 'updated_at' and a.attnum > 0 and not a.attisdropped
    ) into v_has_updated_at;
    if v_has_updated_at then
      v_assignments := pg_catalog.concat_ws(', ', v_assignments, 'updated_at = pg_catalog.now()');
    end if;

    if v_assignments is not null then
      execute pg_catalog.format(
        'update public.reservations set %s where id = $2',
        v_assignments
      ) using v_payload, v_id;
    end if;
    return v_id;
  end if;

  select
    pg_catalog.string_agg(pg_catalog.format('%I', a.attname), ', ' order by a.attnum),
    pg_catalog.string_agg(
      pg_catalog.format('(pg_catalog.jsonb_populate_record(null::public.reservations, $1)).%I', a.attname),
      ', ' order by a.attnum
    )
  into v_insert_columns, v_insert_values
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.reservations'::pg_catalog.regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and (a.attname in ('id', 'property_id') or v_payload ? a.attname);

  execute pg_catalog.format(
    'insert into public.reservations (%s)
       select %s',
    v_insert_columns,
    v_insert_values
  ) using v_payload;

  return v_id;
end;
$$;

revoke all on function public.save_host_reservation(uuid, jsonb) from public;
revoke all on function public.save_host_reservation(uuid, jsonb) from anon;
revoke all on function public.save_host_reservation(uuid, jsonb) from authenticated;
grant execute on function public.save_host_reservation(uuid, jsonb) to service_role;
