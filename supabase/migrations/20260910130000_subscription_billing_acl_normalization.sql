-- Microblock 7D1 follow-up: deterministic baseline billing ACL normalization.
-- REVOKE ALL remains compatible across PostgreSQL 10-17+ privilege sets.

begin;

-- BEGIN subscription billing ACL normalization
revoke all on table public.host_subscriptions from public;
revoke all on table public.host_subscriptions from anon;
revoke all on table public.host_subscriptions from authenticated;
revoke all on table public.host_subscriptions from service_role;
grant select on table public.host_subscriptions to authenticated;
grant truncate, references, trigger
  on table public.host_subscriptions
  to service_role;

revoke all on table public.subscription_payments from public;
revoke all on table public.subscription_payments from anon;
revoke all on table public.subscription_payments from authenticated;
revoke all on table public.subscription_payments from service_role;
grant select on table public.subscription_payments to authenticated;
grant truncate, references, trigger
  on table public.subscription_payments
  to service_role;
-- END subscription billing ACL normalization

commit;
