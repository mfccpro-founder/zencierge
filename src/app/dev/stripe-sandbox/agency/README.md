# Agency sandbox follow-up

Pending outside this preparation step:

- Enforce `canUseAgencyTools` at the server authorization boundary for every Agency-only operation.
- Verify that White-label Statements, Multi-Team Call Routing, and Priority 24/7 Founder Support have implemented, testable behavior before advertising them as available product capabilities.

This directory currently covers only the authenticated Stripe test Checkout preparation and the controlled 20-property limit test.

## Sandbox verification result

- Date: 2026-10-14
- Project: `ygipnetialejzuazfjcn`
- Result: PASS — initial count 0; 20 TEST properties created; property 21 rejected with HTTP 403; final count 20.
- The 20 TEST properties were retained. The test was not repeated during access-flag restoration.
