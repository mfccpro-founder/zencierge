import { publicApiUrl } from "@/lib/public-app-url";
import { PAID_BILLING_CONSENT_VERSION } from "@/lib/paid-billing-consent";

export async function startSquareCheckout(body: {
  kind?: "host_subscription" | "guest_addon";
  planId?: string;
  billing?: "monthly" | "annual";
  addonId?: "early_checkin" | "mid_stay_clean";
  propertyId?: string;
  acceptedPaidTerms: true;
}) {
  const response = await fetch(publicApiUrl("/api/payments/square/checkout"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "host_subscription", ...body, consentVersion: PAID_BILLING_CONSENT_VERSION }),
  });
  const data = (await response.json()) as { url?: string; error?: string; mock?: boolean };
  const checkoutUrl = data.url?.trim() ?? "";
  if (!response.ok || !/^https?:\/\//i.test(checkoutUrl)) {
    throw new Error(data.error ?? "Could not start Square checkout");
  }
  window.location.href = checkoutUrl;
}
