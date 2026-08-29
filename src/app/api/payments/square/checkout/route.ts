import { createSupabaseRouteClient } from "@/lib/supabase-route";
import { createSquareCheckoutSession } from "@/lib/square-checkout";

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
      origin: new URL(request.url).origin,
    });
    return Response.json(session);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Square checkout failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
