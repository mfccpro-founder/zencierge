import {
  prepareStripeSandboxCheckoutSession,
  STRIPE_SANDBOX_CHECKOUT_CANCEL_URL,
  STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL,
  type StripeSandboxCheckoutClient,
} from "./stripe-sandbox-checkout";
import {
  resolveStripeSandboxPlan,
  type StripeSandboxPlanConfiguration,
} from "./stripe-sandbox-plans";
import type { StripeSandboxPersistence } from "./stripe-sandbox-persistence";

const FORBIDDEN_CLIENT_FIELDS = ["user_id", "userId", "price_id", "priceId"];

export type StripeSandboxCheckoutBody = {
  planId?: unknown;
  billingCycle?: unknown;
  [key: string]: unknown;
};

export async function createAuthenticatedStripeSandboxCheckout(input: {
  nodeEnv: string | undefined;
  authSource: "supabase-auth" | "dev-fallback" | null;
  userId: string | null;
  body: StripeSandboxCheckoutBody;
  configuration: StripeSandboxPlanConfiguration;
  stripe: StripeSandboxCheckoutClient;
  persistence: StripeSandboxPersistence;
}) {
  if (input.nodeEnv !== "development") {
    return { status: 404, body: { error: "Not found" } };
  }
  if (input.authSource !== "supabase-auth" || !input.userId) {
    return { status: 401, body: { error: "Unauthorized" } };
  }
  if (FORBIDDEN_CLIENT_FIELDS.some((field) => field in input.body)) {
    return { status: 400, body: { error: "Invalid Stripe Sandbox checkout request" } };
  }

  let resolved;
  try {
    resolved = resolveStripeSandboxPlan(
      { planId: input.body.planId, billingCycle: input.body.billingCycle },
      "sandbox",
      input.configuration,
    );
  } catch (error) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : "Invalid Stripe Sandbox checkout request" },
    };
  }

  let local;
  try {
    local = await input.persistence.register({
      userId: input.userId,
      planId: resolved.planId,
      billingCycle: resolved.billingCycle,
      expectedPriceId: resolved.priceId,
    });
  } catch {
    return { status: 503, body: { error: "Stripe Sandbox checkout persistence failed" } };
  }

  let checkout;
  try {
    checkout = await prepareStripeSandboxCheckoutSession(
      {
        planId: resolved.planId,
        billingCycle: resolved.billingCycle,
        successUrl: STRIPE_SANDBOX_CHECKOUT_SUCCESS_URL,
        cancelUrl: STRIPE_SANDBOX_CHECKOUT_CANCEL_URL,
        idempotencyKey: local.checkoutSessionId,
      },
      "sandbox",
      input.configuration,
      input.stripe,
    );
  } catch {
    return {
      status: 503,
      body: {
        error: "Stripe Sandbox checkout is unavailable",
        attemptId: local.checkoutSessionId,
        retryable: false,
      },
    };
  }

  try {
    await input.persistence.attach({
      checkoutSessionId: local.checkoutSessionId,
      stripeSessionId: checkout.sessionId,
    });
  } catch {
    return {
      status: 503,
      body: {
        error: "Stripe Sandbox checkout persistence failed",
        attemptId: local.checkoutSessionId,
        retryable: false,
      },
    };
  }

  return {
    status: 200,
    body: {
      checkoutUrl: checkout.url,
      attemptId: local.checkoutSessionId,
      planId: checkout.planId,
      billingCycle: checkout.billingCycle,
    },
  };
}
