import { parsePlanId } from "@/lib/zencierge-plans";
import { recordFunnelEvent, type FunnelEventType } from "@/lib/admin-revenue-store";
import { createSupabaseRouteClient } from "@/lib/supabase-route";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { type?: string; planId?: string; source?: string };
  try {
    body = (await request.json()) as { type?: string; planId?: string; source?: string };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const planId = parsePlanId(body.planId);
  const type = body.type as FunnelEventType;
  if (!planId || (type !== "upgrade_click" && type !== "checkout_started" && type !== "paid")) {
    return Response.json({ error: "planId and type are required" }, { status: 400 });
  }

  const source =
    body.source === "landing" || body.source === "settings" || body.source === "checkout" || body.source === "webhook"
      ? body.source
      : "landing";

  let email: string | undefined;
  try {
    const supabase = await createSupabaseRouteClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email ?? undefined;
  } catch {
    email = undefined;
  }

  recordFunnelEvent({ type, planId, source, email });
  return Response.json({ ok: true });
}
