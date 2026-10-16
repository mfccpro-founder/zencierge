-- SOURCE manifest for a host-scoped pilot migration. READ ONLY.
-- Replace the UUID below with the pilot Auth user id before manual execution.
-- Returns counts and the complimentary boundary only; it never returns business-row contents.
with params as (
  select '00000000-0000-0000-0000-000000000000'::uuid as host_id
), property_ids as (
  select p.id from public.properties p, params x where p.host_id = x.host_id
), reservation_ids as (
  select r.id from public.reservations r where r.property_id in (select id from property_ids)
), task_ids as (
  select t.id from public.housekeeping_proof_tasks t where t.property_id in (select id from property_ids)
), photo_paths as (
  select ph.storage_path from public.housekeeping_proof_photos ph where ph.task_id in (select id from task_ids)
)
select jsonb_build_object(
  'host_id', (select host_id from params),
  'host_profile', (select count(*) from public.host_profiles h, params x where h.user_id = x.host_id),
  'host_subscription', (
    select jsonb_build_object(
      'count', count(*),
      'plan_id', max(s.plan_id),
      'complimentary_starts_at', max(s.complimentary_starts_at),
      'complimentary_ends_at', max(s.complimentary_ends_at),
      'square_subscription_present', bool_or(nullif(s.square_subscription_id, '') is not null)
    ) from public.host_subscriptions s, params x where s.user_id = x.host_id
  ),
  'properties', (select count(*) from property_ids),
  'reservations', (select count(*) from reservation_ids),
  'guest_stay_tokens', (select count(*) from public.guest_stay_tokens t where t.property_id in (select id from property_ids)),
  'guest_service_requests', (select count(*) from public.guest_service_requests r where r.property_id in (select id from property_ids)),
  'housekeeping_proof_tasks', (select count(*) from task_ids),
  'housekeeping_proof_tokens', (select count(*) from public.housekeeping_proof_tokens t where t.task_id in (select id from task_ids)),
  'housekeeping_proof_photos', (select count(*) from photo_paths),
  'housekeeping_proof_storage_objects', (
    select count(*) from storage.objects o
    where o.bucket_id = 'housekeeping-proof' and o.name in (select storage_path from photo_paths)
  ),
  'legacy_housekeeping_photos', (select count(*) from public.housekeeping_photos p where p.property_id in (select id from property_ids)),
  'legacy_housekeeping_reports', (select count(*) from public.housekeeping_reports r where r.property_id in (select id from property_ids)),
  'property_supplies', (select count(*) from public.property_supplies s where s.property_id in (select id from property_ids)),
  'property_supply_logs', (select count(*) from public.property_supply_logs l where l.property_id in (select id from property_ids)),
  'captured_guests', (select count(*) from public.captured_guests g where g.property_id in (select id from property_ids)),
  'host_feature_requests', (select count(*) from public.host_feature_requests f, params x where f.host_id = x.host_id)
) as migration_manifest;
