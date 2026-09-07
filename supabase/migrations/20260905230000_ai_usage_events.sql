-- Phase 1 Isabela usage: measured TTS units only (no cost calculation).
-- Do not apply from the app. Run in the Supabase SQL editor when ready.
-- Access is server-only via the service role. No anon or authenticated policies.

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  host_id uuid references auth.users (id) on delete set null,
  property_id text null,
  reservation_id text null,
  source text not null,
  provider text not null,
  model text not null,
  operation text not null,
  status text not null,
  input_characters integer null,
  input_tokens integer null,
  output_tokens integer null,
  audio_duration_ms integer null,
  audio_bytes integer null,
  calculated_cost_cents integer null,
  pricing_rule_id text null,
  request_id text null,
  constraint ai_usage_events_status_check check (status in ('success', 'failed')),
  constraint ai_usage_events_operation_check check (operation in ('tts', 'stt', 'llm'))
);

comment on table public.ai_usage_events is
  'Append-only measured AI usage. Phase 1: TTS units only; calculated_cost_cents stays null until pricing is configured.';

create index if not exists ai_usage_events_created_at_idx
  on public.ai_usage_events (created_at);

create index if not exists ai_usage_events_host_id_created_at_idx
  on public.ai_usage_events (host_id, created_at)
  where host_id is not null;

create index if not exists ai_usage_events_source_created_at_idx
  on public.ai_usage_events (source, created_at);

create index if not exists ai_usage_events_provider_model_created_at_idx
  on public.ai_usage_events (provider, model, created_at);

alter table public.ai_usage_events enable row level security;

drop policy if exists "anon select ai_usage_events" on public.ai_usage_events;
drop policy if exists "anon insert ai_usage_events" on public.ai_usage_events;
drop policy if exists "anon update ai_usage_events" on public.ai_usage_events;
drop policy if exists "anon delete ai_usage_events" on public.ai_usage_events;
drop policy if exists "authenticated select ai_usage_events" on public.ai_usage_events;
drop policy if exists "authenticated insert ai_usage_events" on public.ai_usage_events;
drop policy if exists "authenticated update ai_usage_events" on public.ai_usage_events;
drop policy if exists "authenticated delete ai_usage_events" on public.ai_usage_events;

revoke all on table public.ai_usage_events from public;
revoke all on table public.ai_usage_events from anon;
revoke all on table public.ai_usage_events from authenticated;

grant all on table public.ai_usage_events to service_role;
