import { createSquareCheckoutSession } from "@/lib/square-checkout";
import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { parsePlanId } from "@/lib/zencierge-plans";

export async function POST(request: Request) {
  let body: { planId?: string; billing?: string; email?: string; name?: string };
  try {
    body = (await request.json()) as { planId?: string; billing?: string; email?: string; name?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const planId = parsePlanId(body.planId);
  if (!planId) {
    return Response.json({ error: "planId must be starter, pro, portfolio, or agency" }, { status: 400 });
  }

  const billing = body.billing === "annual" ? "annual" : "monthly";

  let user: { id: string; email?: string | null } | null = null;
  try {
    const supabase = await createSupabaseRouteClient();
    const {
      data: { user: sessionUser },
    } = await supabase.auth.getUser();
    user = sessionUser;
    if (sessionUser) {
      await supabase.auth.updateUser({
        data: {
          pending_plan: planId,
          pending_billing: billing,
        },
      });
    }
  } catch {
    /* Square checkout does not require a live Supabase session */
  }

  try {
    const session = await createSquareCheckoutSession({
      kind: "host_subscription",
      planId,
      billing,
      email: body.email?.trim() || user?.email || null,
      name: body.name?.trim() || null,
      userId: user?.id ?? null,
      origin: new URL(request.url).origin,
      forceLiveSquare: true,
    });
    const checkoutUrl = session.url;
    return Response.json({
      checkoutUrl,
      url: checkoutUrl,
      paymentLink: { url: checkoutUrl },
      planId: session.planId,
      amountCents: session.amountCents,
      billing: session.billing,
      mock: session.mock,
      sandbox: session.sandbox,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Square checkout failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
