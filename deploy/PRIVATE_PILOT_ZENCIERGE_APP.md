# Robert Toca private demo on zencierge.app — review gate

## Current scope (supersedes the earlier pilot term)

- This is a private **demo**, not a six-month customer pilot.
- The intended host is Robert Toca. His email is intentionally unknown and must not be guessed.
- Do not create his Auth account until the owner supplies and confirms that email.
- Grant `pro` access for **one calendar month** only (`months: 1`), beginning when the HTTPS deployment, normal login, and core demo routes have been verified and the working access is handed over.
- Do not grant or retain a six-month complimentary window for this account.
- Pro permits at most four properties. All properties, reservations, stays, guest requests, housekeeping tasks, notes, and photos in this demo must be conspicuously fictitious and owned only by Robert's Auth UUID.
- No card, checkout, paid subscription, automatic renewal, or paid external provider is part of this demo.

Status: prepared locally; not published; no account, invitation, subscription mutation, DNS change, or purchase performed.

## Current infrastructure found

- Cloudflare account is already authenticated locally.
- Existing Pages project `zencierge-public-site` serves `zencierge.app` and `zencierge-public-site.pages.dev`. It is the four-file static public microsite and must remain intact.
- Existing Pages project `mfccpro` serves `mfccpro.pages.dev` and remains out of scope.
- No Vercel project linkage exists in this repository.
- The Cloudflare CLI confirms projects and permissions but does not expose the account's billing tier. Confirm the current Workers/Pages plan in Cloudflare Billing before approving any deployment.
- Existing Supabase environments have different purposes: the principal project contains existing business data and previously diagnosed broad legacy grants; `ygipnetialejzuazfjcn` is a sandbox containing test accounts and test data. Neither should silently become the pilot data store without a separate approval and security postflight.

## Pilot account and access

- Create a normal Supabase Auth account for Robert only after receiving his intended email. Do not create it through a public signup page and do not send an invitation until approved.
- After the working deployment and normal login are verified, grant `pro` demo access for exactly one calendar month through the founder-only complimentary route with `months: 1`. Record that server timestamp as the delivery start. Pro permits up to four properties.
- The complimentary implementation stores `complimentary_starts_at`, `complimentary_ends_at`, grantor, and grant timestamp separately from trial and paid subscription state.
- It refuses a grant when an active or past-due Square subscription could still charge. It never calls Square. Checkout also recognizes an active complimentary window and skips Square.
- No card, Checkout, automatic renewal, or automatic charge is created. Access expires at the stored UTC timestamp unless deliberately extended.
- The host enters real properties through the normal authenticated `/api/properties` route. Ownership comes from `auth.user.id`; client-supplied `host_id` is discarded and the remote property limit is enforced atomically.
- There is no public fictional-property bootstrap endpoint.
- Robert's demo dataset is created only after his Auth UUID exists, through the normal authenticated property/reservation/guest/housekeeping contracts. It must not copy Javier's records or reuse sandbox evidence.
- Use unmistakable `DEMO` labels and new reservation/task/token identifiers. Never infer that an empty or failed read means there is no prior data; stop before writes if the authenticated preflight is not exactly empty.

## Pilot safety boundary

Configure only on the pilot application deployment:

```text
ZENCIERGE_PRIVATE_PILOT_SAFE_MODE=true
ZENCIERGE_PRIVATE_PILOT_HOST_IDS=<pilot Supabase Auth UUID>
STRIPE_SANDBOX_ACCESS_ENABLED=false
```

Safe mode blocks signup, admin/back-office surfaces and APIs, MFCCPRO APIs, Checkout/Square/Stripe-dev routes, billing webhooks, and inbound telephone calls. SMS and housekeeping notification email are simulated without provider requests. Smart-lock controls are visibly simulation-only.

Do not configure Square, Stripe, Twilio, Resend, or lock-provider credentials in the pilot deployment. TTS/model credentials are optional for Isabela and remain usage-bearing services.

## HTTPS destination options using existing hosting

### Lowest incremental-infrastructure option

- Keep the static microsite on the apex `https://zencierge.app`.
- Add a separate Cloudflare Worker application at `https://pilot.zencierge.app` in the already authenticated Cloudflare account.
- Do not attach the Next.js application to the existing Pages project or replace its four-file deployment.
- This avoids buying another hosting vendor solely for the pilot, subject to the account's current Workers plan and limits.
- Before choosing it, complete a Cloudflare-adapter preview because Next.js 16 lists Cloudflare as an unverified third-party adapter. The application also requires Node-compatible Route Handlers and Supabase Storage.

### Lower technical-risk option

- Use a separate Vercel Pro project and map `pilot.zencierge.app` to it, leaving the apex on Cloudflare Pages.
- Vercel is a verified Next.js adapter, but this adds a USD 20/month platform subscription plus possible usage. Do not create it unless the Cloudflare preview fails or the owner explicitly prefers it.

## Preserving the host's data at launch

Preferred strategy: use a dedicated Supabase project as the isolation boundary. This demo contains fictional data only; it is not automatically promoted to customer production data. Any later conversion to a customer account requires Robert's explicit acceptance and a separately reviewed retention or migration decision.

If the pilot must use the existing sandbox temporarily, launch migration must be explicit and host-scoped:

1. Freeze writes for only the pilot account.
2. Export rows selected by the pilot `host_id`, then their authorized property IDs, reservation IDs, stay tokens, service requests, proof tasks/photos, and related Storage paths.
3. Import into the launch project in dependency order while preserving IDs and timestamps.
4. Verify counts, ownership, token expiry/revocation, Storage object hashes, and signed-read behavior.
5. Point the deployment to the launch project, verify with the same Auth identity or complete an approved identity migration, then reopen writes.
6. Retain the source read-only until the owner approves retirement. Never copy unrelated sandbox or founder/back-office data.

A dedicated long-term Supabase project is therefore the cleanest isolation boundary, but it is not being created or purchased in this preparation.

Prepared catalog checks:

- `supabase/review/pilot/pilot_host_source_manifest_readonly_json.sql`
- `supabase/review/pilot/pilot_host_destination_postflight_readonly_json.sql`

Both return one JSON cell containing only counts plus plan/courtesy boundaries. They do not return property, guest, code, password, token, or photo contents. The target postflight must match every count, the plan, and the exact `complimentary_starts_at` / `complimentary_ends_at`. `square_subscription_present` must remain false. Storage objects are counted from the proof-photo paths rather than from an unscoped bucket total.

The actual transfer must remain a separate approved execution because it copies real customer data. Required order is Auth identity (prefer preserving UID), host profile/subscription, properties, reservations, stay tokens, proof tasks/tokens/photos, service requests, secondary operational rows, then the allowlisted Storage objects. No test-account rows, payment rows, Square correlation rows, admin data, or unrelated bucket objects are included.

## Explicit paid acceptance

- Complimentary access never creates Checkout, a card, a subscription, or an automatic renewal.
- Paid Checkout and direct Square subscription endpoints now require both an affirmative boolean and the current consent-contract version. Missing, false, or stale consent is rejected before provider work.
- Host plan changes display the exact monthly plan price and require a confirmation immediately before Checkout.
- Card enrollment has a separate unchecked acceptance control and the Subscribe button remains disabled until it is selected.
- Public signup likewise requires an unchecked acceptance control before it can request Checkout.
- This is an application safety gate, not a substitute for retaining the provider's Checkout/payment evidence and legally required disclosures.

## Publication gate

Before any publication, present and approve:

1. Cloudflare Billing tier and expected Worker cost.
2. Selected Supabase project and its current plan/cost.
3. Exact hostname (`pilot.zencierge.app` recommended) and DNS change.
4. Environment-variable inventory with all external-action credentials absent.
5. Schema/RLS/grant postflight for the selected Supabase project.
6. Robert's confirmed Auth email, Pro one-calendar-month start/end dates measured from working delivery, and confirmation that no Square link/subscription exists.
7. Preview results for login, three host-created properties, Isabela, guest token isolation, housekeeping evidence, reload persistence, and blocked external actions.
