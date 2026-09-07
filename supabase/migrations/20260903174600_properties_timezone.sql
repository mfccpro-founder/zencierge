-- Align public.properties.timezone with supabase/schema.sql.
-- Canonical default: America/New_York.
-- Safe if the column is missing, already populated, or present with null/blank values.
-- Do not apply from the app.

alter table public.properties
  add column if not exists timezone text;

update public.properties
set timezone = 'America/New_York'
where timezone is null or btrim(timezone) = '';

alter table public.properties
  alter column timezone set default 'America/New_York';

alter table public.properties
  alter column timezone set not null;
