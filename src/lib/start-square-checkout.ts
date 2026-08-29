export async function startSquareCheckout(body: {
  kind?: "host_subscription" | "guest_addon";
  planId?: string;
  billing?: "monthly" | "annual";
  addonId?: "early_checkin" | "mid_stay_clean";
  propertyId?: string;
}) {
  const response = await fetch("/api/payments/square/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "host_subscription", ...body }),
  });
  const data = (await response.json()) as { url?: string; error?: string; mock?: boolean };
  const checkoutUrl = data.url?.trim() ?? "";
  if (!response.ok || !/^https?:\/\//i.test(checkoutUrl)) {
    throw new Error(data.error ?? "Could not start Square checkout");
  }
  window.location.href = checkoutUrl;
}
