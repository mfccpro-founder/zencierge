import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const { createAuthenticatedStripeSandboxCheckout } = await import("./stripe-sandbox-checkout-service.ts");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const attemptId = "11111111-1111-4111-8111-111111111111";
const configuration = { STRIPE_SANDBOX_PRICE_PRO_MONTHLY: "price_pro_monthly" };

function fixture(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const persistence = {
    async register() { calls.push("register"); return { checkoutSessionId: attemptId, status: "registered" }; },
    async attach(input: { checkoutSessionId: string; stripeSessionId: string }) {
      calls.push("attach");
      assert(input.checkoutSessionId === attemptId && input.stripeSessionId === "cs_test_local", "attach receives protected ids");
      return { checkoutSessionId: attemptId, status: "attached" };
    },
    async applyWebhook() { throw new Error("unused"); },
  };
  const stripe = {
    prices: { async retrieve() {
      calls.push("price");
      return { id: "price_pro_monthly", livemode: false, active: true, currency: "usd", unit_amount: 9900,
        type: "recurring", billing_scheme: "per_unit", recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
        product: { id: "prod_local", name: "Zencierge Pro", active: true } };
    } },
    products: { async retrieve() { throw new Error("expanded product expected"); } },
    checkout: { sessions: { async create(params: { client_reference_id: string }, options?: { idempotencyKey?: string }) {
      calls.push("create");
      assert(calls[0] === "register", "local attempt is registered before Stripe");
      assert(params.client_reference_id === attemptId && options?.idempotencyKey === attemptId, "local UUID protects correlation and idempotency");
      return { id: "cs_test_local", url: "https://checkout.stripe.com/c/pay/cs_test_local", livemode: false };
    } } },
  };
  return { calls, input: { nodeEnv: "development", authSource: "supabase-auth", userId: "user-local", body: { planId: "pro", billingCycle: "monthly" }, configuration, stripe, persistence, ...overrides } };
}

async function run() {
  for (const auth of [{ authSource: null, userId: null }, { authSource: "dev-fallback", userId: "user-local" }]) {
    const test = fixture(auth);
    const result = await createAuthenticatedStripeSandboxCheckout(test.input as never);
    assert(result.status === 401 && test.calls.length === 0, "only a verified Supabase Auth session is accepted");
  }

  for (const body of [
    { planId: "pro", billingCycle: "monthly", user_id: "attacker" },
    { planId: "pro", billingCycle: "monthly", priceId: "price_attacker" },
    { planId: "unknown", billingCycle: "monthly" },
  ]) {
    const test = fixture({ body });
    const result = await createAuthenticatedStripeSandboxCheckout(test.input as never);
    assert(result.status === 400 && test.calls.length === 0, "client plan/identity manipulation is rejected before persistence");
  }

  const success = fixture();
  const result = await createAuthenticatedStripeSandboxCheckout(success.input as never);
  assert(result.status === 200 && success.calls.join(",") === "register,price,create,attach", "checkout follows the durable operation order");

  const stripeFailure = fixture();
  (stripeFailure.input.stripe as typeof stripeFailure.input.stripe).checkout.sessions.create = async () => { throw new Error("offline"); };
  const failed = await createAuthenticatedStripeSandboxCheckout(stripeFailure.input as never);
  assert(failed.status === 503 && failed.body.attemptId === attemptId && failed.body.retryable === false && !stripeFailure.calls.includes("attach"), "Stripe failures retain the attempt without blind retry");

  const persistenceFailure = fixture();
  persistenceFailure.input.persistence.register = async () => { throw new Error("db unavailable"); };
  const notRegistered = await createAuthenticatedStripeSandboxCheckout(persistenceFailure.input as never);
  assert(notRegistered.status === 503 && persistenceFailure.calls.length === 0, "Stripe is not called when registration fails");

  console.log("Stripe Sandbox authenticated checkout tests passed");
}

await run();
