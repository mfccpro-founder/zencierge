# Robert Toca private demo — unpublished handoff checklist

No account, project, DNS record, deployment, invitation, or billing action is created by this document.

## Fixed decisions

- Public HTTPS origin: `https://pilot.zencierge.app`
- Hosting target: isolated Cloudflare Worker `zencierge-private-pilot`; the existing apex microsite remains unchanged.
- Data boundary: a dedicated Supabase Free organization/project, never the principal, sandbox, or Financial-Command-Center project.
- Identity boundary: one normal Auth account whose UUID is the only value in `ZENCIERGE_PRIVATE_PILOT_HOST_IDS`.
- Entitlement: `pro`, four-property maximum, one calendar month from working handoff. Use the existing server-side grant with `months: 1`; never substitute 30 days and never select six months.
- During that window Robert may create and edit only properties owned by his Auth UUID. Creation remains atomically capped at four.
- Expiration disables subsequent property mutations but does not delete properties, reservations, tasks, photos, or other demo records. Retention does not imply renewal or continued access; any continuation requires explicit acceptance.
- Billing: no card, checkout, Square/Stripe customer, paid subscription, renewal, or automatic conversion.
- External actions: do not configure Stripe, Square, Twilio, Resend, OpenAI, HeyGen, ElevenLabs, or lock-provider credentials. Guest answers use the local deterministic policy; messages, calls, locks, and paid voice/AI remain unavailable or visibly simulated.
- Photo boundary: use only the private `housekeeping-proof` bucket and its token-scoped upload plus host-authorized read/review routes. The legacy `housekeeping` report/upload surface is blocked in private-demo mode because it historically produced public object URLs.

## Pre-publication order

1. Obtain Robert's exact email from the owner. Do not infer it from his name.
2. Complete the Linux OpenNext build and Wrangler dry run; confirm the Worker is within Workers Free limits.
3. Create the dedicated Free Supabase organization/project only after confirming the creation screen says USD 0 and no add-ons.
4. Apply the reviewed schema in the new project, then run catalog/RLS/grant and Storage postflights.
5. Deploy a preview Worker without attaching `pilot.zencierge.app`; configure only the dedicated Supabase URL/keys, safe mode, Stripe sandbox access `false`, and a temporary technical-test UUID allowlist.
6. Verify HTTPS, login, reload persistence, Dashboard, guest stay portal, housekeeping task/photo/report/approval, invalid/expired/revoked token rejection, and cross-host isolation. Delete the technical Auth account and its explicitly tagged test graph only after a reviewed cleanup manifest.
7. Present the verified preview URL, measured bundle size, plan/cost, and remaining blockers. Do not publish the custom hostname yet.
8. After the owner supplies Robert's email, create his normal Auth account and verify the authenticated preflight is exactly empty. A failed read stops the process.
9. Do not preload, copy, seed, or migrate properties, reservations, requests, tasks, or photos into Robert's account. His first authenticated listing read must return an empty collection, and the UI must show `Agrega tu primera propiedad / Add your first property`. Only records Robert creates through the normal authenticated flows may appear afterward.
10. Attach `pilot.zencierge.app`, verify the final HTTPS origin, and perform the normal login smoke test.
11. As the final handoff action, grant `pro` with `months: 1`. Record the server-produced start/end timestamps and verify checkout remains skipped. That successful handoff timestamp starts the demo month.

## Acceptance evidence

- `getUser()` returns Robert's UUID and email; no Javier identity or records appear.
- A different authenticated UUID receives 403 from Dashboard and host API contracts.
- Reservations are accepted only for a property owned by Robert. Requests are listed and mutated only after reservation/property ownership checks. Host photo listing, reading, and approval require an owned reservation and a matching task/property; a legacy housekeeping report may not attach a reservation from another property.
- Property count is remote and never exceeds four; read failures never become zero.
- Guest access requires a valid, current stay token scoped to one reservation/property.
- Housekeeping access is token-scoped to its assigned task; submitted photo persists in the dedicated Storage bucket and host approval persists after reload.
- `/admin`, `/backoffice`, `/centro`, checkout/payment/webhook/dev billing routes and inbound providers remain blocked.
- No external message, call, lock command, AI request, voice request, checkout, or payment is emitted.
- The expiration is exactly one calendar month from the recorded working handoff and grants no access after that instant.
