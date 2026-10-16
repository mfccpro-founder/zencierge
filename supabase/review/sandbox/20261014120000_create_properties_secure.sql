-- REVIEW ONLY: sandbox ygipnetialejzuazfjcn.
-- Creates only public.properties and its server-only atomic create function.
-- It intentionally does not execute supabase/schema.sql or create unrelated objects.

create table public.properties (
  id text primary key,
  name text not null,
  city text not null,
  address text not null default '',
  status text not null default 'Vacant',
  revenue text not null default '$0',
  door_code text not null default '',
  smartlock text not null default '',
  wifi_network text not null default '',
  wifi_password text not null default '',
  parking text not null default '',
  gate_code text not null default '',
  check_in text not null default '',
  check_out text not null default '',
  current_guest text,
  trash text not null default '',
  handbook text not null default '',
  ai_handbook text not null default '',
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  assigned_avatar_name text not null default 'Elena',
  assigned_phone_number text not null default '',
  avatar_system_prompt text not null default '',
  host_id uuid references auth.users (id) on delete set null,
  timezone text not null default 'America/New_York'
);

create index properties_host_id_idx on public.properties (host_id);

alter table public.properties enable row level security;
alter table public.properties force row level security;

revoke all privileges on table public.properties from public;
revoke all privileges on table public.properties from anon;
revoke all privileges on table public.properties from authenticated;
grant select, insert, update, delete on table public.properties to service_role;

create function public.create_host_property_with_limit(
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_host_id::text, 734221)
  );
  select pg_catalog.count(*) into v_count
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
    v_id, v_name, v_city,
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
