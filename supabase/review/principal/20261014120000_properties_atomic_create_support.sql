-- REVIEW ONLY: principal fqkxlisenfrhkermwsar.
-- Apply before deploying the server refactor. This does not change existing ACL/RLS.

create or replace function public.create_host_property_with_limit(
  p_host_id uuid,
  p_max_properties integer,
  p_property jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_id text := nullif(pg_catalog.btrim(p_property ->> 'id'), '');
  v_name text := nullif(pg_catalog.btrim(p_property ->> 'name'), '');
  v_city text := nullif(pg_catalog.btrim(p_property ->> 'city'), '');
  v_count bigint;
begin
  if p_host_id is null or pg_catalog.jsonb_typeof(p_property) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid property input';
  end if;
  if v_id is null or v_name is null or v_city is null then
    raise exception using errcode = '22023', message = 'property id, name and city are required';
  end if;
  if p_max_properties is not null and p_max_properties < 0 then
    raise exception using errcode = '22023', message = 'invalid property limit';
  end if;

  -- Serialize create/count operations for one host. The route's preliminary
  -- count is informational; this locked count is the authoritative limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_host_id::text, 734221)
  );

  select pg_catalog.count(*)
  into v_count
  from public.properties
  where host_id = p_host_id;

  if p_max_properties is not null and v_count >= p_max_properties then
    raise exception using errcode = 'ZP001', message = 'property plan limit reached';
  end if;

  insert into public.properties (
    id, name, city, address, status, revenue, door_code, smartlock,
    wifi_network, wifi_password, parking, gate_code, check_in, check_out,
    current_guest, trash, handbook, ai_handbook, assigned_avatar_name,
    assigned_phone_number, avatar_system_prompt, timezone, host_id, updated_at
  ) values (
    v_id,
    v_name,
    v_city,
    coalesce(p_property ->> 'address', ''),
    coalesce(nullif(p_property ->> 'status', ''), 'Vacant'),
    coalesce(nullif(p_property ->> 'revenue', ''), '$0'),
    coalesce(p_property ->> 'door_code', ''),
    coalesce(p_property ->> 'smartlock', ''),
    coalesce(p_property ->> 'wifi_network', ''),
    coalesce(p_property ->> 'wifi_password', ''),
    coalesce(p_property ->> 'parking', ''),
    coalesce(p_property ->> 'gate_code', ''),
    coalesce(p_property ->> 'check_in', ''),
    coalesce(p_property ->> 'check_out', ''),
    p_property ->> 'current_guest',
    coalesce(p_property ->> 'trash', ''),
    coalesce(p_property ->> 'handbook', ''),
    coalesce(p_property ->> 'ai_handbook', ''),
    coalesce(nullif(p_property ->> 'assigned_avatar_name', ''), 'Elena'),
    coalesce(p_property ->> 'assigned_phone_number', ''),
    coalesce(p_property ->> 'avatar_system_prompt', ''),
    coalesce(nullif(p_property ->> 'timezone', ''), 'America/New_York'),
    p_host_id,
    pg_catalog.now()
  );

  return v_id;
end;
$$;

revoke all on function public.create_host_property_with_limit(uuid, integer, jsonb) from public;
revoke all on function public.create_host_property_with_limit(uuid, integer, jsonb) from anon;
revoke all on function public.create_host_property_with_limit(uuid, integer, jsonb) from authenticated;
grant execute on function public.create_host_property_with_limit(uuid, integer, jsonb) to service_role;

