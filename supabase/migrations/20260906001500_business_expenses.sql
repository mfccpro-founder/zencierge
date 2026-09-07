-- Founder Back Office: Zencierge company manual expenses (payroll + OpEx).
-- Do not apply from the app. Run in the Supabase SQL Editor when ready.
-- Isabela AI COGS stay in ai_usage_events — do not mirror TTS spend here.
-- Access is server-only via the service role. No anon or authenticated policies.

create table if not exists public.business_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  category text not null,
  vendor text not null,
  description text not null default '',
  amount_usd numeric(12, 2) not null,
  currency text not null default 'USD',
  recurring boolean not null default false,
  recurrence_note text null,
  source text not null default 'manual',
  created_by uuid null references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_expenses_amount_positive check (amount_usd > 0),
  constraint business_expenses_category_check check (
    category in (
      'payroll',
      'contractor',
      'hosting',
      'software',
      'payment_processing',
      'marketing',
      'legal_accounting',
      'other'
    )
  ),
  constraint business_expenses_source_check check (source in ('manual', 'square', 'provider')),
  constraint business_expenses_currency_check check (currency = 'USD')
);

comment on table public.business_expenses is
  'Zencierge company manual payroll and operating expenses. Isabela AI COGS are tracked in ai_usage_events, not here.';

create index if not exists business_expenses_expense_date_idx
  on public.business_expenses (expense_date desc);

create index if not exists business_expenses_category_date_idx
  on public.business_expenses (category, expense_date desc);

alter table public.business_expenses enable row level security;

drop policy if exists "anon select business_expenses" on public.business_expenses;
drop policy if exists "anon insert business_expenses" on public.business_expenses;
drop policy if exists "anon update business_expenses" on public.business_expenses;
drop policy if exists "anon delete business_expenses" on public.business_expenses;
drop policy if exists "authenticated select business_expenses" on public.business_expenses;
drop policy if exists "authenticated insert business_expenses" on public.business_expenses;
drop policy if exists "authenticated update business_expenses" on public.business_expenses;
drop policy if exists "authenticated delete business_expenses" on public.business_expenses;

revoke all on table public.business_expenses from public;
revoke all on table public.business_expenses from anon;
revoke all on table public.business_expenses from authenticated;

grant all on table public.business_expenses to service_role;
