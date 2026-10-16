-- SANDBOX ONLY: ygipnetialejzuazfjcn.
-- Narrow correction after postflight detected Supabase default privileges on
-- public.guest_service_requests. Does not alter default privileges or other objects.
begin;

revoke truncate, references, trigger
  on table public.guest_service_requests
  from service_role;

commit;
