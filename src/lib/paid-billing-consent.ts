export const PAID_BILLING_CONSENT_VERSION = "2026-10-15" as const;

export function hasExplicitPaidBillingConsent(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return body.acceptedPaidTerms === true && body.consentVersion === PAID_BILLING_CONSENT_VERSION;
}

export function paidBillingConsentRequiredResponse() {
  return Response.json(
    { error: "Explicit host acceptance is required before creating a paid Checkout or subscription." },
    { status: 409 },
  );
}
