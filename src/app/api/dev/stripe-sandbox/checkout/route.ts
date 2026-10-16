import Stripe from "stripe";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { createAuthenticatedStripeSandboxCheckout } from "@/lib/stripe-sandbox-checkout-service";
import { createStripeSandboxPersistence } from "@/lib/stripe-sandbox-persistence";
import type { StripeSandboxPlanConfiguration } from "@/lib/stripe-sandbox-plans";

export const dynamic = "force-dynamic";

const STRIPE_SANDBOX_PROJECT_URL = "https://ygipnetialejzuazfjcn.supabase.co";

function configuration(): StripeSandboxPlanConfiguration {
  return {
    STRIPE_SANDBOX_PRICE_STARTER_MONTHLY: process.env.STRIPE_SANDBOX_PRICE_STARTER_MONTHLY,
    STRIPE_SANDBOX_PRICE_STARTER_ANNUAL: process.env.STRIPE_SANDBOX_PRICE_STARTER_ANNUAL,
    STRIPE_SANDBOX_PRICE_PRO_MONTHLY: process.env.STRIPE_SANDBOX_PRICE_PRO_MONTHLY,
    STRIPE_SANDBOX_PRICE_PRO_ANNUAL: process.env.STRIPE_SANDBOX_PRICE_PRO_ANNUAL,
    STRIPE_SANDBOX_PRICE_PORTFOLIO_MONTHLY: process.env.STRIPE_SANDBOX_PRICE_PORTFOLIO_MONTHLY,
    STRIPE_SANDBOX_PRICE_PORTFOLIO_ANNUAL: process.env.STRIPE_SANDBOX_PRICE_PORTFOLIO_ANNUAL,
    STRIPE_SANDBOX_PRICE_AGENCY_MONTHLY: process.env.STRIPE_SANDBOX_PRICE_AGENCY_MONTHLY,
    STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL: process.env.STRIPE_SANDBOX_PRICE_AGENCY_ANNUAL,
  };
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STRIPE_SANDBOX_PROJECT_URL) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    return auth.error ?? Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: hostSubscription, error: hostSubscriptionError } = await auth.supabase
    .from("host_subscriptions")
    .select("square_subscription_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (hostSubscriptionError) {
    return Response.json({ error: "Stripe Sandbox preflight is unavailable" }, { status: 503 });
  }
  if (typeof hostSubscription?.square_subscription_id === "string" && hostSubscription.square_subscription_id.trim()) {
    return Response.json({ error: "Stripe Sandbox checkout is blocked for Square hosts" }, { status: 409 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid Stripe Sandbox checkout request" }, { status: 400 });
  }

  const secret = process.env.STRIPE_SANDBOX_SECRET_KEY?.trim() ?? "";
  if (!secret.startsWith("sk_test_")) {
    return Response.json({ error: "Stripe Sandbox checkout is unavailable" }, { status: 503 });
  }

  let persistence;
  try {
    persistence = createStripeSandboxPersistence(createSupabaseAdminClient());
  } catch {
    return Response.json({ error: "Stripe Sandbox checkout persistence failed" }, { status: 503 });
  }

  const result = await createAuthenticatedStripeSandboxCheckout({
    nodeEnv: process.env.NODE_ENV,
    authSource: auth.source,
    userId: auth.user?.id ?? null,
    body,
    configuration: configuration(),
    stripe: new Stripe(secret),
    persistence,
  });
  return Response.json(result.body, { status: result.status });
}
