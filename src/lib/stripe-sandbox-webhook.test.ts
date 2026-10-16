import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const Stripe = (await import("stripe")).default;
const {
  STRIPE_SANDBOX_WEBHOOK_EVENT_TYPES,
  handleStripeSandboxWebhook,
  persistStripeSandboxWebhook,
} = await import("./stripe-sandbox-webhook.ts");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const FICTIONAL_SECRET = "whsec_fictional_sandbox_secret_0001";
const CHECKOUT_URL = "https://checkout.stripe.com/c/pay/cs_test_fictional";

function payloadFor(type: string, livemode: boolean) {
  return JSON.stringify({
    id: "evt_fictional",
    object: "event",
    type,
    livemode,
    data: {
      object: {
        id: "obj_fictional",
        object: "invoice",
        url: CHECKOUT_URL,
      },
    },
  });
}

function sign(payload: string) {
  return Stripe.webhooks.generateTestHeaderString({
    payload,
    secret: FICTIONAL_SECRET,
  });
}

function receive(overrides: {
  nodeEnv?: string;
  secret?: string;
  rawBody: string;
  signature: string | null;
}) {
  return handleStripeSandboxWebhook({
    nodeEnv:
      overrides.nodeEnv === undefined && !("nodeEnv" in overrides)
        ? "development"
        : overrides.nodeEnv,
    secret: overrides.secret ?? FICTIONAL_SECRET,
    rawBody: overrides.rawBody,
    signature: overrides.signature,
  });
}

async function runStripeSandboxWebhookTests() {
  for (const type of STRIPE_SANDBOX_WEBHOOK_EVENT_TYPES) {
    const rawBody = payloadFor(type, false);
    const result = receive({ rawBody, signature: sign(rawBody) });
    const encoded = JSON.stringify(result.body);
    assert(
      result.status === 200 &&
        result.body.received === true &&
        result.body.type === type &&
        !encoded.includes(FICTIONAL_SECRET) &&
        !encoded.includes(CHECKOUT_URL) &&
        !encoded.includes("evt_fictional"),
      `${type} is recognized without echoing the payload`,
    );
  }

  const validBody = payloadFor("invoice.paid", false);
  const invalid = receive({
    rawBody: validBody,
    signature: "t=1,v1=fictionalinvalidsignature",
  });
  assert(
    invalid.status === 400 && invalid.body.error === "Invalid Stripe signature",
    "an invalid signature is rejected",
  );

  const altered = receive({
    rawBody: validBody.replace("invoice.paid", "invoice.paid "),
    signature: sign(validBody),
  });
  assert(
    altered.status === 400 && altered.body.error === "Invalid Stripe signature",
    "an altered body is rejected",
  );

  const liveBody = payloadFor("customer.subscription.updated", true);
  const live = receive({ rawBody: liveBody, signature: sign(liveBody) });
  assert(
    live.status === 400 &&
      live.body.error === "Live Stripe events are not accepted" &&
      !JSON.stringify(live.body).includes(CHECKOUT_URL),
    "a live event is rejected",
  );

  for (const nodeEnv of ["production", "test", undefined] as const) {
    const blocked = receive({
      nodeEnv,
      rawBody: validBody,
      signature: sign(validBody),
    });
    assert(
      blocked.status === 404 && blocked.body.error === "Not found",
      `the receiver is unavailable outside development (${String(nodeEnv)} -> ${blocked.status})`,
    );
  }

  const route = readFileSync(
    join(process.cwd(), "src/app/api/dev/stripe-sandbox/webhook/route.ts"),
    "utf8",
  );
  const handler = readFileSync(
    join(process.cwd(), "src/lib/stripe-sandbox-webhook.ts"),
    "utf8",
  );
  assert(
    route.includes("request.text()") &&
      !route.includes("request.json(") &&
      route.includes("STRIPE_SANDBOX_WEBHOOK_SECRET") &&
      !route.includes("console.") &&
      !route.includes("square"),
    "the route verifies the raw body and stays isolated from product billing",
  );
  assert(
    !handler.includes("process.env") &&
      !handler.includes("console.") &&
      !handler.includes("supabase") &&
      !handler.includes("from \"square\""),
    "the handler does not read the environment or sync billing",
  );

  const checkoutBody = JSON.stringify({
    id: "evt_checkout", object: "event", type: "checkout.session.completed", livemode: false,
    data: { object: { id: "cs_test_local", object: "checkout.session", client_reference_id: "11111111-1111-4111-8111-111111111111", subscription: "sub_local" } },
  });
  const invoiceBody = JSON.stringify({
    id: "evt_invoice", object: "event", type: "invoice.paid", livemode: false,
    data: { object: { id: "in_local", object: "invoice", parent: { type: "subscription_details", subscription_details: { subscription: "sub_local" } } } },
  });
  const stored: Array<Record<string, unknown>> = [];
  const persistence = {
    async register() { throw new Error("unused"); },
    async attach() { throw new Error("unused"); },
    async applyWebhook(input: Record<string, unknown>) {
      stored.push(input);
      const replayed = stored.slice(0, -1).some((item) => item.eventId === input.eventId);
      return { eventId: String(input.eventId), replayed, status: input.eventType === "invoice.paid" ? "awaiting_checkout" : "correlated" };
    },
  };

  const invoiceFirst = await persistStripeSandboxWebhook(
    { nodeEnv: "development", secret: FICTIONAL_SECRET, rawBody: invoiceBody, signature: sign(invoiceBody) },
    persistence as never,
  );
  const checkoutAfter = await persistStripeSandboxWebhook(
    { nodeEnv: "development", secret: FICTIONAL_SECRET, rawBody: checkoutBody, signature: sign(checkoutBody) },
    persistence as never,
  );
  assert(invoiceFirst.status === 200 && invoiceFirst.body.persisted === true && checkoutAfter.status === 200, "invoice-before-checkout is persisted for later correlation");
  assert(stored[0].invoiceId === "in_local" && stored[0].stripeSubscriptionId === "sub_local", "invoice SDK fields are extracted");
  assert(stored[1].stripeSessionId === "cs_test_local" && stored[1].clientReferenceId === "11111111-1111-4111-8111-111111111111", "checkout SDK fields are extracted");
  assert(typeof stored[0].payloadSha256 === "string" && String(stored[0].payloadSha256).length === 64, "raw payload SHA-256 is persisted");

  const replay = await persistStripeSandboxWebhook(
    { nodeEnv: "development", secret: FICTIONAL_SECRET, rawBody: checkoutBody, signature: sign(checkoutBody) },
    persistence as never,
  );
  assert(replay.status === 200 && replay.body.replayed === true, "signed event replay is delegated idempotently to the RPC");

  const failedPersistence = await persistStripeSandboxWebhook(
    { nodeEnv: "development", secret: FICTIONAL_SECRET, rawBody: invoiceBody, signature: sign(invoiceBody) },
    { ...persistence, async applyWebhook() { throw new Error("database unavailable"); } } as never,
  );
  assert(failedPersistence.status === 503 && failedPersistence.body.received !== true, "persistence failure is not acknowledged as success");

  console.log("Stripe Sandbox webhook recognition and persistence tests passed");
}

await runStripeSandboxWebhookTests();
