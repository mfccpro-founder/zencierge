import { requireHostUser } from "@/lib/supabase-route";
import { isFounderBillingOperator } from "@/lib/founder-billing-auth";
import { validateFounderBillingMutationRequest } from "@/lib/founder-billing-request-security";
import {
  applyComplimentaryAccess,
  loadHostSubscriptionComp,
  parseComplimentaryMonths,
  type ComplimentaryAction,
} from "@/lib/complimentary-access";
import { parsePlanId } from "@/lib/zencierge-plans";

export const dynamic = "force-dynamic";

async function requireFounder() {
  const auth = await requireHostUser();
  if (auth.error) return { error: auth.error as Response };
  if (
    !isFounderBillingOperator({
      user: auth.user,
      source: auth.source,
    })
  ) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireFounder();
  if ("error" in gate) return gate.error;

  const { id } = await context.params;
  const loaded = await loadHostSubscriptionComp(id);
  if (loaded.kind === "unavailable") {
    return Response.json({ error: loaded.error }, { status: 503 });
  }
  return Response.json({ ok: true, subscription: loaded.row });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await requireFounder();
  if ("error" in gate) return gate.error;

  const requestSecurity = validateFounderBillingMutationRequest({
    requestUrl: request.url,
    origin: request.headers.get("origin"),
    contentType: request.headers.get("content-type"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  });
  if (!requestSecurity.ok) {
    return Response.json(
      { error: requestSecurity.error },
      { status: requestSecurity.status },
    );
  }

  const { id } = await context.params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "") as ComplimentaryAction;
  if (action !== "grant" && action !== "extend" && action !== "end") {
    return Response.json({ error: "action must be grant, extend, or end" }, { status: 400 });
  }

  const result = await applyComplimentaryAccess({
    targetUserId: id,
    targetEmail: typeof body.email === "string" ? body.email : null,
    actorUserId: gate.user.id,
    action,
    planId: parsePlanId(body.planId),
    months: parseComplimentaryMonths(body.months),
    customEndsAt: typeof body.customEndsAt === "string" ? body.customEndsAt : null,
  });

  if (!result.ok) {
    return Response.json(
      { error: result.error, code: result.code ?? null },
      { status: result.status },
    );
  }

  return Response.json({ ok: true, subscription: result.row });
}
