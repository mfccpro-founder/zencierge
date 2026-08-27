import { randomUUID } from "node:crypto";
import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { createSquareClient } from "@/lib/square-client";
import { parsePlanId, ZENCIERGE_PLANS } from "@/lib/zencierge-plans";

export async function POST(request: Request) {
  const supabase = await createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: { planId?: string; billing?: string };
  try {
    body = (await request.json()) as { planId?: string; billing?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const planId = parsePlanId(body.planId);
  if (!planId) {
    return Response.json({ error: "planId must be starter, pro, or agency" }, { status: 400 });
  }

  const annual = body.billing === "annual";
  const plan = ZENCIERGE_PLANS[planId];
  const amountCents = BigInt((annual ? plan.monthlyUsd * 10 : plan.monthlyUsd) * 100);
  const origin = new URL(request.url).origin;

  try {
    const { client, locationId } = createSquareClient();
    const label = annual
      ? `${plan.name} · annual subscription`
      : `${plan.name} · monthly subscription`;

    if (user) {
      await supabase.auth.updateUser({
        data: {
          pending_plan: planId,
          pending_billing: annual ? "annual" : "monthly",
        },
      });
    }

    const checkout = await client.checkout.paymentLinks.create({
      idempotencyKey: randomUUID(),
      quickPay: {
        name: `Zencierge ${label}`,
        priceMoney: {
          amount: amountCents,
          currency: "USD",
        },
        locationId,
      },
      checkoutOptions: {
        redirectUrl: `${origin}/api/checkout/complete?plan=${planId}`,
        askForShippingAddress: false,
      },
      prePopulatedData: user?.email
        ? {
            buyerEmail: user.email,
          }
        : undefined,
    });

    const url = checkout.paymentLink?.url;
    if (!url) {
      return Response.json({ error: "Square did not return a checkout URL" }, { status: 502 });
    }

    return Response.json({
      url,
      planId,
      amountCents: Number(amountCents),
      billing: annual ? "annual" : "monthly",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Square checkout failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
