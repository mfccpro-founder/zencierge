import { NextRequest, NextResponse } from "next/server";
import { requireHostUser } from "@/lib/supabase-route";
import { applySubscriptionWebhook } from "@/lib/subscription-webhooks";
import { parsePlanId, ZENCIERGE_PLANS } from "@/lib/zencierge-plans";

export async function GET(request: NextRequest) {
  const planId = parsePlanId(request.nextUrl.searchParams.get("plan"));
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `/dashboard?payment=success&tier=${planId ?? "starter"}`);

  const auth = await requireHostUser();
  if (!auth.user) {
    return NextResponse.redirect(login);
  }

  const plan = planId ?? parsePlanId(auth.user.user_metadata?.pending_plan) ?? "starter";
  try {
    await applySubscriptionWebhook({
      type: "payment.succeeded",
      userId: auth.user.id,
      email: auth.user.email,
      planId: plan,
      amountUsd: ZENCIERGE_PLANS[plan].monthlyUsd,
      paymentId: `square-checkout-${auth.user.id}-${plan}`,
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
  return NextResponse.redirect(dashboard);
}
