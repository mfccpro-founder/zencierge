-- REVIEW ONLY: principal fqkxlisenfrhkermwsar.
-- Apply only after the server refactor is deployed and verified.

alter table public.properties enable row level security;
alter table public.properties force row level security;

drop policy if exists "anon all properties" on public.properties;

revoke all privileges on table public.properties from public;
revoke all privileges on table public.properties from anon;
revoke all privileges on table public.properties from authenticated;

-- Remove any column-level grants independently of table-level grants.
revoke select (
  id, name, city, address, status, revenue, door_code, smartlock,
  wifi_network, wifi_password, parking, gate_code, check_in, check_out,
  current_guest, trash, handbook, ai_handbook, updated_at,
  assigned_avatar_name, assigned_phone_number, avatar_system_prompt,
  host_id, timezone
) on public.properties from anon, authenticated;
revoke insert (
  id, name, city, address, status, revenue, door_code, smartlock,
  wifi_network, wifi_password, parking, gate_code, check_in, check_out,
  current_guest, trash, handbook, ai_handbook, updated_at,
  assigned_avatar_name, assigned_phone_number, avatar_system_prompt,
  host_id, timezone
) on public.properties from anon, authenticated;
revoke update (
  id, name, city, address, status, revenue, door_code, smartlock,
  wifi_network, wifi_password, parking, gate_code, check_in, check_out,
  current_guest, trash, handbook, ai_handbook, updated_at,
  assigned_avatar_name, assigned_phone_number, avatar_system_prompt,
  host_id, timezone
) on public.properties from anon, authenticated;
revoke references (
  id, name, city, address, status, revenue, door_code, smartlock,
  wifi_network, wifi_password, parking, gate_code, check_in, check_out,
  current_guest, trash, handbook, ai_handbook, updated_at,
  assigned_avatar_name, assigned_phone_number, avatar_system_prompt,
  host_id, timezone
) on public.properties from anon, authenticated;

-- Server-only access. service_role bypasses RLS; no anon/authenticated policy is created.
grant select, insert, update, delete on table public.properties to service_role;

