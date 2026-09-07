import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { createSquareCheckoutSession } from "@/lib/square-checkout";
import { hasLifetimeVipAccess } from "@/lib/lifetime-vip";
import { betaPartnerTrial, isBetaFounderPartner } from "@/lib/beta-partner";
import { publicOriginFromRequest } from "@/lib/public-app-url";
import { isComplimentaryWindowOpen } from "@/lib/complimentary-access-core";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let body: {
    kind?: string;
    planId?: string;
    billing?: string;
    addonId?: string;
    propertyId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind === "guest_addon" ? "guest_addon" : "host_subscription";
  if (kind === "host_subscription" && hasLifetimeVipAccess(user)) {
    return Response.json({
      ok: true,
      lifetimeVip: true,
      planId: "enterprise",
      planName: "Founder VIP",
      monthlyUsd: 0,
      squareSkipped: true,
    });
  }
  if (kind === "host_subscription" && user && isBetaFounderPartner(user) && betaPartnerTrial(user).active) {
    return Response.json({
      ok: true,
      betaPartner: true,
      planId: "enterprise",
      planName: "Beta Founder Partner",
      monthlyUsd: 0,
      squareSkipped: true,
    });
  }
  if (kind === "host_subscription" && user) {
    const { data: sub } = await supabase
      .from("host_subscriptions")
      .select("complimentary_ends_at, plan_id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (isComplimentaryWindowOpen(sub?.complimentary_ends_at as string | null | undefined)) {
      return Response.json({
        ok: true,
        complimentary: true,
        planId: sub?.plan_id ?? body.planId ?? "starter",
        planName: "Complimentary access",
        monthlyUsd: 0,
        squareSkipped: true,
        complimentaryEndsAt: sub?.complimentary_ends_at ?? null,
      });
    }
  }
  if (kind === "host_subscription" && user) {
    try {
      await supabase.auth.updateUser({
        data: {
          pending_plan: body.planId ?? "pro",
          pending_billing: body.billing === "annual" ? "annual" : "monthly",
        },
      });
    } catch {
      /* guest or anon checkout can skip metadata */
    }
  }

  try {
    const session = await createSquareCheckoutSession({
      kind,
      planId: body.planId,
      billing: body.billing,
      addonId: body.addonId,
      propertyId: body.propertyId,
      email: user?.email ?? null,
      userId: user?.id ?? null,
      origin: publicOriginFromRequest(request),
    });
    return Response.json(session);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Square checkout failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
