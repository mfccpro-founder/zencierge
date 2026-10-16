import Stripe from "stripe";
import { requireHostAuthContext } from "@/lib/supabase-route";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  createStripeSandboxAccessStore,
  resolveStripeSandboxAccess,
} from "@/lib/stripe-sandbox-access";

export const dynamic = "force-dynamic";

const CORRELATED_CHECKOUT_ID = "90982e91-2796-4183-8d97-17041931928d";
const STRIPE_SANDBOX_PROJECT_URL = "https://ygipnetialejzuazfjcn.supabase.co";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== STRIPE_SANDBOX_PROJECT_URL) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const auth = await requireHostAuthContext();
  if (auth.source !== "supabase-auth" || !auth.user) {
    const reason =
      auth.authBranch === "dev-host-cookie"
        ? "local-preview-session"
        : auth.authBranch === "pending"
          ? "pending-host-session"
          : auth.authFailure ?? "unverified-session";
    return Response.json(
      { error: "Unauthorized", reason },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { data: hostSubscription, error: hostSubscriptionError } = await auth.supabase
    .from("host_subscriptions")
    .select("square_subscription_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const key = process.env.STRIPE_SANDBOX_SECRET_KEY?.trim() ?? "";
  if (!key.startsWith("sk_test_")) {
    return Response.json({
      authenticated: true,
      checkoutOwnerMatch: false,
      configured: false,
      featureFlagEnabled: false,
      reason: "not-configured",
    });
  }

  try {
    const store = createStripeSandboxAccessStore(createSupabaseAdminClient());
    const snapshot = await store.load(auth.user.id);
    const checkoutOwnerMatch = snapshot.checkouts.some(
      (checkout) => checkout.id === CORRELATED_CHECKOUT_ID && checkout.user_id === auth.user.id,
    );
    const squareSubscriptionId = hostSubscriptionError
      ? null
      : ((hostSubscription?.square_subscription_id as string | null | undefined) ?? null);
    const result = await resolveStripeSandboxAccess({
      nodeEnv: "development",
      enabled: "true",
      authenticated: true,
      userId: auth.user.id,
      squareSubscriptionId,
      store,
      stripe: new Stripe(key),
    });

    return Response.json(
      {
        authenticated: true,
        checkoutOwnerMatch,
        configured: true,
        featureFlagEnabled:
          process.env.STRIPE_SANDBOX_ACCESS_ENABLED?.trim().toLowerCase() === "true",
        hostSubscriptionLookup: hostSubscriptionError ? "unavailable" : "ok",
        squareSubscriptionPresent: Boolean(squareSubscriptionId?.trim()),
        eligible: result.granted,
        reason: result.granted ? "eligible" : result.reason,
        planId: result.granted ? result.planId : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        authenticated: true,
        checkoutOwnerMatch: false,
        configured: true,
        featureFlagEnabled: false,
        eligible: false,
        reason: "diagnostic-unavailable",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
