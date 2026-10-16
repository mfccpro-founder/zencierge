import assert from "node:assert/strict";
import { hasExplicitPaidBillingConsent, PAID_BILLING_CONSENT_VERSION } from "./paid-billing-consent.ts";

assert.equal(hasExplicitPaidBillingConsent(null), false);
assert.equal(hasExplicitPaidBillingConsent({ acceptedPaidTerms: true }), false);
assert.equal(hasExplicitPaidBillingConsent({ acceptedPaidTerms: false, consentVersion: PAID_BILLING_CONSENT_VERSION }), false);
assert.equal(hasExplicitPaidBillingConsent({ acceptedPaidTerms: true, consentVersion: "old" }), false);
assert.equal(hasExplicitPaidBillingConsent({ acceptedPaidTerms: true, consentVersion: PAID_BILLING_CONSENT_VERSION }), true);
console.log("Paid billing consent tests passed");
