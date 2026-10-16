# Robert private demo schema order (review only)

Do not apply these files to the principal, sandbox, or MFCCPRO projects. The
destination must be the new dedicated Supabase Free project, and its project
reference must be checked in the Dashboard URL before every manual step.

Apply only after the destination is created and still contains no business
rows:

1. `supabase/review/sandbox/20261014120000_create_properties_secure.sql`
2. `supabase/review/sandbox/20261014140000_create_reservations_secure.sql`
3. `supabase/review/pilot/20261016193000_private_demo_subscription_foundation.sql`
4. `supabase/review/sandbox/20261014142000_guest_housekeeping_foundation.sql`
5. `supabase/migrations/20261014143000_guest_service_requests.sql`

The `sandbox` directory name and comments describe where those reviewed
foundations were first used; the SQL itself has no hard-coded project URL or
project reference. Stop if any preflight reports an existing object or schema
drift. Do not substitute `supabase/schema.sql` or `supabase db push`.

After application, run the read-only housekeeping/service-request catalog
postflights and a dedicated pilot catalog postflight before creating technical
test users. The two-user behavioral test must prove all four boundaries:

- each host sees and mutates only properties with their own `host_id`;
- reservations can reference only an owned property;
- service requests cannot cross reservation/property ownership;
- proof tasks and private Storage objects cannot cross host, task, reservation,
  or property boundaries.

The test starts with two empty accounts, creates tagged disposable records via
normal authenticated routes, verifies cross-account reads/writes return no data
or 403, and removes only those tagged records and Auth users after review. It
must not use Robert's identity or email and must not send email.

The final customer entitlement is a server-created `pro` complimentary row with
one calendar month, created only when working access is handed over. Expiration
blocks the Dashboard and host APIs but does not delete business rows. There is
no payment row, provider identifier, card, checkout, or renewal.
