-- Adds only the two persisted fields required by the restricted housekeeping
-- mobile demo. Existing RLS, FORCE RLS, grants, ownership, and transitions stay unchanged.
begin;

alter table public.guest_service_requests
  add column if not exists accepted_at timestamptz,
  add column if not exists report_note text;

alter table public.guest_service_requests
  drop constraint if exists guest_service_requests_report_note_check;

alter table public.guest_service_requests
  add constraint guest_service_requests_report_note_check
  check (report_note is null or (char_length(report_note) between 1 and 300));

commit;
