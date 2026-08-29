import { createSquareCheckoutSession } from "@/lib/square-checkout";
import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { parsePlanId } from "@/lib/zencierge-plans";

export async function POST(request: Request) {
  const supabase = await createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: { planId?: string; billing?: string; email?: string };
  try {
    body = (await request.json()) as { planId?: string; billing?: string; email?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const planId = parsePlanId(body.planId);
  if (!planId) {
    return Response.json({ error: "planId must be starter, pro, portfolio, or agency" }, { status: 400 });
  }

  if (user) {
    await supabase.auth.updateUser({
      data: {
        pending_plan: planId,
        pending_billing: body.billing === "annual" ? "annual" : "monthly",
      },
    });
  }

  try {
    const session = await createSquareCheckoutSession({
      kind: "host_subscription",
      planId,
      billing: body.billing,
      email: body.email?.trim() || user?.email || null,
      userId: user?.id ?? null,
      origin: new URL(request.url).origin,
    });
    return Response.json({
      url: session.url,
      paymentLink: { url: session.url },
      planId: session.planId,
      amountCents: session.amountCents,
      billing: session.billing,
      mock: session.mock,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Square checkout failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
