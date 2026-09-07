-- Phase 2: versioned AI pricing rules + cost_class on usage events.
-- Do not apply from the app. Run in the Supabase SQL editor when ready.
-- Never overwrite rates — insert a new effective-dated row when pricing changes.
-- Access is server-only via the service role.

create table if not exists public.ai_pricing_rules (
  id text primary key,
  provider text not null,
  model text not null,
  operation text not null,
  unit text not null,
  rate_usd numeric(18, 10) not null,
  effective_from timestamptz not null,
  effective_to timestamptz null,
  source_note text not null,
  created_at timestamptz not null default now(),
  constraint ai_pricing_rules_operation_check check (operation in ('tts', 'stt', 'llm')),
  constraint ai_pricing_rules_unit_check check (
    unit in ('character', 'text_token', 'audio_token')
  ),
  constraint ai_pricing_rules_rate_non_negative check (rate_usd >= 0),
  constraint ai_pricing_rules_window_check check (
    effective_to is null or effective_to > effective_from
  )
);

comment on table public.ai_pricing_rules is
  'Append-only effective-dated AI pricing. Historical rates are never overwritten.';

create index if not exists ai_pricing_rules_lookup_idx
  on public.ai_pricing_rules (provider, model, operation, unit, effective_from);

alter table public.ai_pricing_rules enable row level security;

drop policy if exists "anon select ai_pricing_rules" on public.ai_pricing_rules;
drop policy if exists "anon insert ai_pricing_rules" on public.ai_pricing_rules;
drop policy if exists "anon update ai_pricing_rules" on public.ai_pricing_rules;
drop policy if exists "anon delete ai_pricing_rules" on public.ai_pricing_rules;
drop policy if exists "authenticated select ai_pricing_rules" on public.ai_pricing_rules;
drop policy if exists "authenticated insert ai_pricing_rules" on public.ai_pricing_rules;
drop policy if exists "authenticated update ai_pricing_rules" on public.ai_pricing_rules;
drop policy if exists "authenticated delete ai_pricing_rules" on public.ai_pricing_rules;

revoke all on table public.ai_pricing_rules from public;
revoke all on table public.ai_pricing_rules from anon;
revoke all on table public.ai_pricing_rules from authenticated;

grant all on table public.ai_pricing_rules to service_role;

-- Approved current rules for active / documented Zencierge paths (2026-09).
insert into public.ai_pricing_rules (
  id, provider, model, operation, unit, rate_usd, effective_from, effective_to, source_note
) values
  (
    'elevenlabs_multilingual_v2_char_2026_09',
    'elevenlabs',
    'eleven_multilingual_v2',
    'tts',
    'character',
    0.0001,
    '2026-01-01T00:00:00Z',
    null,
    'ElevenLabs API TTS v2/v3 standard: $0.10 per 1,000 characters ($0.0001/char).'
  ),
  (
    'elevenlabs_flash_char_2026_09',
    'elevenlabs',
    'eleven_flash_v2_5',
    'tts',
    'character',
    0.00005,
    '2026-01-01T00:00:00Z',
    null,
    'ElevenLabs Flash/Turbo API TTS: $0.05 per 1,000 characters. Seeded for future use; not on active Zencierge path.'
  ),
  (
    'elevenlabs_turbo_char_2026_09',
    'elevenlabs',
    'eleven_turbo_v2_5',
    'tts',
    'character',
    0.00005,
    '2026-01-01T00:00:00Z',
    null,
    'ElevenLabs Flash/Turbo API TTS: $0.05 per 1,000 characters. Seeded for future use; not on active Zencierge path.'
  ),
  (
    'openai_gpt4o_mini_tts_text_token_2026_09',
    'openai',
    'gpt-4o-mini-tts',
    'tts',
    'text_token',
    0.0000006,
    '2026-01-01T00:00:00Z',
    null,
    'OpenAI gpt-4o-mini-tts text input: $0.60 / 1M text tokens. Not applied per-event until text tokens are metered.'
  ),
  (
    'openai_gpt4o_mini_tts_audio_token_2026_09',
    'openai',
    'gpt-4o-mini-tts',
    'tts',
    'audio_token',
    0.000012,
    '2026-01-01T00:00:00Z',
    null,
    'OpenAI gpt-4o-mini-tts audio output: $12 / 1M audio tokens. Not applied per-event until audio tokens are metered.'
  )
on conflict (id) do nothing;

alter table public.ai_usage_events
  add column if not exists cost_class text;

alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_cost_class_check;

alter table public.ai_usage_events
  add constraint ai_usage_events_cost_class_check
  check (cost_class is null or cost_class in ('exact', 'pending'));

comment on column public.ai_usage_events.cost_class is
  'exact = calculated_cost_cents from a versioned character rule; pending = metered units insufficient for exact cost (e.g. OpenAI TTS chars-only).';

comment on table public.ai_usage_events is
  'Append-only measured AI usage. Phase 2: ElevenLabs character TTS may store exact cents; OpenAI TTS stays pending without audio/text token metering.';
