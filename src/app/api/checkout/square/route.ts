import { createSquareCheckoutSession } from "@/lib/square-checkout";
import { maybeCreateCheckoutBillingIntent } from "@/lib/square-checkout-billing-intent";
import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { parsePlanId } from "@/lib/zencierge-plans";
import { publicOriginFromRequest } from "@/lib/public-app-url";
import { hasExplicitPaidBillingConsent, paidBillingConsentRequiredResponse } from "@/lib/paid-billing-consent";

export async function POST(request: Request) {
  let body: { planId?: string; billing?: string; email?: string; name?: string };
  try {
    body = (await request.json()) as {
      planId?: string;
      billing?: string;
      email?: string;
      name?: string;
    };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!hasExplicitPaidBillingConsent(body)) return paidBillingConsentRequiredResponse();

  const planId = parsePlanId(body.planId);
  if (!planId) {
    return Response.json(
      { error: "planId must be starter, pro, portfolio, or agency" },
      { status: 400 },
    );
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

  // Fail-soft intent for future Web Payments enroll. Payment Link remains default.
  let intentId: string | undefined;
  if (user?.id) {
    const intentResult = await maybeCreateCheckoutBillingIntent({
      kind: "host_subscription",
      userId: user.id,
      planId,
      billingCycle: billing,
    });
    if (
      intentResult.status === "created" ||
      intentResult.status === "replayed"
    ) {
      intentId = intentResult.intentId;
    }
  }

  try {
    const session = await createSquareCheckoutSession({
      kind: "host_subscription",
      planId,
      billing,
      email: body.email?.trim() || user?.email || null,
      name: body.name?.trim() || null,
      userId: user?.id ?? null,
      origin: publicOriginFromRequest(request),
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
      ...(intentId ? { intentId } : {}),
    });
  } catch (cause) {
    const message =
      cause instanceof Error ? cause.message : "Square checkout failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
