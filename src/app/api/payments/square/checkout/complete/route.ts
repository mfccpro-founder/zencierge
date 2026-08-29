import { NextRequest, NextResponse } from "next/server";
import { requireHostUser } from "@/lib/supabase-route";
import { applySubscriptionWebhook } from "@/lib/subscription-webhooks";
import { parsePlanId, ZENCIERGE_PLANS } from "@/lib/zencierge-plans";
import { allowMockSquareCheckout } from "@/lib/square-checkout";
import { GUEST_ADDONS, parseGuestAddonId } from "@/lib/guest-addons";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind") === "guest_addon" ? "guest_addon" : "host_subscription";
  const mock = request.nextUrl.searchParams.get("mock") === "1";
  if (mock && !allowMockSquareCheckout()) {
    return NextResponse.json({ error: "Mock Square checkout is disabled" }, { status: 403 });
  }

  if (kind === "guest_addon") {
    const addonId = parseGuestAddonId(request.nextUrl.searchParams.get("addon")) ?? "early_checkin";
    const propertyId = request.nextUrl.searchParams.get("propertyId")?.trim() || "prop-1";
    const guest = new URL(`/guest/${encodeURIComponent(propertyId)}`, request.url);
    guest.searchParams.set("checkout", "success");
    guest.searchParams.set("addon", addonId);
    guest.searchParams.set("amount", String(GUEST_ADDONS[addonId].usd));
    if (mock) guest.searchParams.set("sandbox", "1");
    return NextResponse.redirect(guest);
  }

  const login = new URL("/login", request.url);
  login.searchParams.set("next", `/dashboard?payment=success&tier=${request.nextUrl.searchParams.get("plan") ?? "starter"}`);

  const auth = await requireHostUser();
  if (!auth.user) {
    return NextResponse.redirect(login);
  }

  const plan =
    parsePlanId(request.nextUrl.searchParams.get("plan")) ??
    parsePlanId(auth.user.user_metadata?.pending_plan) ??
    "pro";
  const billing = request.nextUrl.searchParams.get("billing") === "annual" ? "annual" : "monthly";
  const amountUsd = billing === "annual" ? ZENCIERGE_PLANS[plan].monthlyUsd * 10 : ZENCIERGE_PLANS[plan].monthlyUsd;

  try {
    await applySubscriptionWebhook({
      type: "payment.succeeded",
      userId: auth.user.id,
      email: auth.user.email,
      planId: plan,
      amountUsd,
      paymentId: `${mock ? "square-mock" : "square-checkout"}-${auth.user.id}-${plan}-${billing}`,
    });
  } catch {
    /* host_subscriptions table may not exist until schema.sql is applied */
  }

  await auth.supabase.auth.updateUser({
    data: {
      plan,
      pending_plan: null,
      pending_billing: null,
    },
  });

  const dashboard = new URL("/dashboard", request.url);
  dashboard.searchParams.set("payment", "success");
  dashboard.searchParams.set("tier", plan);
  if (mock) dashboard.searchParams.set("sandbox", "1");
  return NextResponse.redirect(dashboard);
}
