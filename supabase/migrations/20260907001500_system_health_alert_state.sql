-- Founder System Health Alerts V1: durable consecutive/cooldown/recovery state.
-- Do not apply from the app. Run in the Supabase SQL Editor when ready.
-- Service-role only. Not for host/guest clients.

create table if not exists public.system_health_alert_state (
  service_id text primary key,
  last_status text not null
    check (last_status in ('healthy', 'degraded', 'down', 'unknown')),
  consecutive_bad integer not null default 0
    check (consecutive_bad >= 0),
  last_alerted_at timestamptz null,
  last_alert_kind text null
    check (last_alert_kind is null or last_alert_kind in ('opened', 'escalated', 'recovered')),
  last_alert_severity text null
    check (last_alert_severity is null or last_alert_severity in ('degraded', 'down', 'recovered')),
  last_reason text not null default '',
  last_recovered_at timestamptz null,
  updated_at timestamptz not null default now()
);

comment on table public.system_health_alert_state is
  'Founder System Health alert consecutive/cooldown state. Service-role only.';

alter table public.system_health_alert_state enable row level security;

revoke all on table public.system_health_alert_state from public;
revoke all on table public.system_health_alert_state from anon;
revoke all on table public.system_health_alert_state from authenticated;

grant all on table public.system_health_alert_state to service_role;
