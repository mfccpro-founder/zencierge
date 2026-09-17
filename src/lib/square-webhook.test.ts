import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifySquarePaymentStatus,
  handleSquareWebhook,
  squareWebhookConfig,
  verifySquareWebhookSignature,
  type SquareWebhookConfig,
} from "./square-webhook";
import { SquareSubscriptionStatusWebhookRpcError } from "./square-billing-supabase-stores";
import type { ProviderSubscriptionWebhookInput } from "./subscription-webhooks";
import type { SquareSubscriptionStatusWebhookRpcArgs } from "./square-billing-supabase-stores";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const CONFIG = {
  ready: true,
  signatureKey: "test-signature-key",
  notificationUrl: "https://example.com/api/webhooks/square",
} satisfies SquareWebhookConfig;

function paymentBody(
  status: string,
  extras: Record<string, unknown> = {},
  eventId: unknown = "square-event-1",
) {
  return JSON.stringify({
    event_id: eventId,
    type: "payment.updated",
    data: {
      object: {
        payment: {
          id: "square-payment-1",
          status,
          amount_money: { amount: 9900, currency: "USD" },
          buyer_email_address: "host@example.com",
          customer_id: "square-customer-1",
          created_at: "2026-09-07T12:00:00.000Z",
          ...extras,
        },
      },
    },
  });
}

function subscriptionBody(
  overrides: {
    type?: string;
    eventId?: unknown;
    omitEventId?: boolean;
    omitSubscription?: boolean;
    subscription?: Record<string, unknown> | null;
  } = {},
) {
  const envelope: Record<string, unknown> = {
    type: overrides.type ?? "subscription.created",
    data: {
      object: overrides.omitSubscription
        ? {}
        : {
            subscription:
              overrides.subscription === undefined
                ? {
                    id: "sqsub_1",
                    customer_id: "sqcust_1",
                    location_id: "sqloc_1",
                    plan_variation_id: "sqvar_1",
                    status: "ACTIVE",
                    version: 1,
                    start_date: "2026-09-10",
                  }
                : overrides.subscription,
          },
    },
  };
  if (!overrides.omitEventId) {
    envelope.event_id = overrides.eventId ?? "sub-event-1";
  }
  return JSON.stringify(envelope);
}

async function runSquareWebhookTests() {
  const ready = squareWebhookConfig({
    SQUARE_WEBHOOK_SIGNATURE_KEY: " secret ",
    SQUARE_WEBHOOK_NOTIFICATION_URL:
      "https://example.com/api/webhooks/square",
  });
  assert(ready.ready, "complete HTTPS webhook config is ready");
  if (ready.ready) {
    assert(ready.signatureKey === "secret", "signature key trimmed");
    assert(
      ready.notificationUrl ===
        "https://example.com/api/webhooks/square",
      "exact notification URL retained",
    );
  }

  assert(
    !squareWebhookConfig({
      SQUARE_WEBHOOK_NOTIFICATION_URL:
        "https://example.com/api/webhooks/square",
    }).ready,
    "missing signature key fails closed",
  );
  assert(
    !squareWebhookConfig({
      SQUARE_WEBHOOK_SIGNATURE_KEY: "secret",
    }).ready,
    "missing notification URL fails closed",
  );
  assert(
    !squareWebhookConfig({
      SQUARE_WEBHOOK_SIGNATURE_KEY: "secret",
      SQUARE_WEBHOOK_NOTIFICATION_URL:
        "http://example.com/api/webhooks/square",
    }).ready,
    "non-HTTPS notification URL fails closed",
  );

  assert(
    classifySquarePaymentStatus("COMPLETED") === "succeeded",
    "COMPLETED succeeds",
  );
  assert(
    classifySquarePaymentStatus("FAILED") === "failed",
    "FAILED fails",
  );
  assert(
    classifySquarePaymentStatus("CANCELED") === "failed",
    "CANCELED fails",
  );
  for (const status of ["APPROVED", "PENDING", "", "UNKNOWN"]) {
    assert(
      classifySquarePaymentStatus(status) === "ignored",
      `${status || "empty"} does not succeed`,
    );
  }

  const signedBody = paymentBody("COMPLETED");
  const signature = createHmac("sha256", CONFIG.signatureKey)
    .update(CONFIG.notificationUrl + signedBody)
    .digest("base64");
  assert(
    await verifySquareWebhookSignature({
      requestBody: signedBody,
      signatureHeader: signature,
      signatureKey: CONFIG.signatureKey,
      notificationUrl: CONFIG.notificationUrl,
    }),
    "installed Square SDK validates exact raw body",
  );

  const applied: ProviderSubscriptionWebhookInput[] = [];
  let verifiedBody = "";
  const valid = await handleSquareWebhook({
    rawBody: signedBody,
    signatureHeader: "valid-signature",
    config: CONFIG,
    verifySignature: async (input) => {
      verifiedBody = input.requestBody;
      return true;
    },
    applyEvent: async (event) => {
      applied.push(event);
    },
  });
  assert(valid.status === 200, "valid completed webhook accepted");
  assert(verifiedBody === signedBody, "raw body passed without alteration");
  assert(applied.length === 1, "completed payment applied exactly once");
  assert(
    applied[0]?.type === "payment.succeeded",
    "COMPLETED maps to succeeded",
  );
  assert(applied[0]?.provider === "square", "Square provider retained");
  assert(
    applied[0]?.eventId === "square-event-1",
    "Square event_id retained",
  );
  assert(applied[0]?.amountUsd === 99, "Square cents mapped to USD");
  assert(applied[0]?.paymentId === "square-payment-1", "payment id retained");
  assert(
    applied[0]?.squareCustomerId === "square-customer-1",
    "customer id retained",
  );

  const trimmedEvents: ProviderSubscriptionWebhookInput[] = [];
  await handleSquareWebhook({
    rawBody: paymentBody(
      "COMPLETED",
      {},
      " square-event-trimmed ",
    ),
    signatureHeader: "valid-signature",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async (event) => {
      trimmedEvents.push(event);
    },
  });
  assert(
    trimmedEvents[0]?.eventId === "square-event-trimmed",
    "Square event_id is trimmed",
  );

  for (const eventId of [undefined, null, 42, "", "   "]) {
    let applyCalls = 0;
    const rawBody =
      eventId === undefined
        ? JSON.stringify({
            type: "payment.updated",
            data: {
              object: {
                payment: {
                  id: "square-payment-1",
                  status: "COMPLETED",
                  amount_money: {
                    amount: 9900,
                    currency: "USD",
                  },
                },
              },
            },
          })
        : paymentBody("COMPLETED", {}, eventId);
    const missingEvent = await handleSquareWebhook({
      rawBody,
      signatureHeader: "valid-signature",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async () => {
        applyCalls += 1;
      },
    });
    assert(
      missingEvent.status === 400,
      `${String(eventId)} Square event_id is rejected`,
    );
    assert(
      applyCalls === 0,
      `${String(eventId)} Square event_id cannot apply`,
    );
  }

  for (const status of ["APPROVED", "PENDING", "", "UNKNOWN"]) {
    let writes = 0;
    const ignored = await handleSquareWebhook({
      rawBody: paymentBody(status),
      signatureHeader: "valid-signature",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async () => {
        writes += 1;
      },
    });
    assert(ignored.status === 200, `${status || "empty"} acknowledged`);
    assert(
      ignored.body.ignored === true && writes === 0,
      `${status || "empty"} produces no write`,
    );
  }

  for (const status of ["FAILED", "CANCELED"]) {
    const events: ProviderSubscriptionWebhookInput[] = [];
    await handleSquareWebhook({
      rawBody: paymentBody(status),
      signatureHeader: "valid-signature",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async (event) => {
        events.push(event);
      },
    });
    assert(
      events.length === 1 && events[0]?.type === "payment.failed",
      `${status} maps to one failed event`,
    );
  }

  let unauthorizedWrites = 0;
  const invalidSignature = await handleSquareWebhook({
    rawBody: paymentBody("COMPLETED"),
    signatureHeader: "invalid",
    config: CONFIG,
    verifySignature: async () => false,
    applyEvent: async () => {
      unauthorizedWrites += 1;
    },
  });
  assert(invalidSignature.status === 403, "invalid signature rejected");
  assert(unauthorizedWrites === 0, "invalid signature cannot write");

  let missingHeaderVerifierCalls = 0;
  const missingHeader = await handleSquareWebhook({
    rawBody: paymentBody("COMPLETED"),
    signatureHeader: null,
    config: CONFIG,
    verifySignature: async () => {
      missingHeaderVerifierCalls += 1;
      return true;
    },
    applyEvent: async () => undefined,
  });
  assert(missingHeader.status === 403, "missing signature rejected");
  assert(
    missingHeaderVerifierCalls === 0,
    "missing signature does not call verifier",
  );

  let unconfiguredWrites = 0;
  const unconfigured = await handleSquareWebhook({
    rawBody: paymentBody("COMPLETED"),
    signatureHeader: "signature",
    config: {
      ready: false,
      error: "Square webhook is not configured",
    },
    verifySignature: async () => true,
    applyEvent: async () => {
      unconfiguredWrites += 1;
    },
  });
  assert(unconfigured.status === 503, "missing config fails closed");
  assert(unconfiguredWrites === 0, "missing config cannot write");

  const invalidJsonBeforeAuth = await handleSquareWebhook({
    rawBody: "{invalid",
    signatureHeader: "invalid",
    config: CONFIG,
    verifySignature: async () => false,
    applyEvent: async () => undefined,
  });
  assert(
    invalidJsonBeforeAuth.status === 403,
    "signature checked before JSON parsing",
  );

  const invalidJsonAfterAuth = await handleSquareWebhook({
    rawBody: "{invalid",
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
  });
  assert(
    invalidJsonAfterAuth.status === 400,
    "authenticated malformed JSON rejected",
  );

  const unsupported = await handleSquareWebhook({
    rawBody: JSON.stringify({
      event_id: "square-event-unsupported",
      type: "customer.updated",
      data: {
        object: {
          payment: {
            id: "square-payment-1",
            status: "COMPLETED",
          },
        },
      },
    }),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => {
      throw new Error("unsupported event must not write");
    },
  });
  assert(
    unsupported.status === 200 &&
      unsupported.body.reason === "unsupported_event_type",
    "unsupported event ignored",
  );

  const minimizedResponse = await handleSquareWebhook({
    rawBody: paymentBody("COMPLETED"),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => ({
      processed: false,
      replayed: true,
      userId: "private-user",
      planId: "pro",
      status: "active",
      skippedSubscription: true,
      secret: "private-secret",
      arbitrary: "private-value",
    }),
  });
  assert(
    minimizedResponse.status === 200 &&
      minimizedResponse.body.received === true &&
      minimizedResponse.body.processed === false &&
      minimizedResponse.body.replayed === true,
    "Square response exposes only replay metadata",
  );
  for (const key of [
    "userId",
    "planId",
    "status",
    "skippedSubscription",
    "secret",
    "arbitrary",
  ]) {
    assert(
      !(key in minimizedResponse.body),
      `Square response omits ${key}`,
    );
  }

  const subscriptionCalls: SquareSubscriptionStatusWebhookRpcArgs[] = [];
  const createdBody = subscriptionBody();
  const created = await handleSquareWebhook({
    rawBody: createdBody,
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => {
      throw new Error("payment apply must not run for subscription.created");
    },
    applySubscriptionStatus: async (args) => {
      subscriptionCalls.push(args);
      return {
        processed: true,
        replayed: false,
        skipped_subscription: false,
        resolved_user_id: "user-should-not-leak",
        subscription_status: "active",
      };
    },
    squareEnvironment: "sandbox",
    enrichPaymentCorrelation: async () => {
      throw new Error("enrichment must not run for subscription events");
    },
  });
  assert(created.status === 200, "subscription.created applied");
  assert(created.body.received === true, "created received");
  assert(created.body.processed === true, "created processed");
  assert(created.body.replayed === false, "created not replayed");
  assert(created.body.skipped_subscription === false, "created not skipped");
  assert(!("resolved_user_id" in created.body), "created omits user id");
  assert(!("subscription_status" in created.body), "created omits subscription status");
  assert(
    JSON.stringify(created.body).includes("user-should-not-leak") === false,
    "raw payload/PII not returned",
  );
  assert(subscriptionCalls.length === 1, "created RPC once");
  assert(
    subscriptionCalls[0]?.p_event_type === "subscription.created",
    "created event type",
  );
  assert(
    subscriptionCalls[0]?.p_payload_sha256 ===
      createHash("sha256").update(createdBody, "utf8").digest("hex"),
    "exact raw-body SHA-256",
  );
  assert(
    subscriptionCalls[0]?.p_payload_sha256 !==
      createHash("sha256")
        .update(JSON.stringify(JSON.parse(createdBody)), "utf8")
        .digest("hex") ||
      createHash("sha256").update(createdBody, "utf8").digest("hex") ===
        createHash("sha256")
          .update(JSON.stringify(JSON.parse(createdBody)), "utf8")
          .digest("hex"),
    "hash uses rawBody string",
  );
  assert(subscriptionCalls[0]?.p_square_environment === "sandbox", "sandbox env");
  assert(subscriptionCalls[0]?.p_provider === "square", "provider square");

  const deactivatedCalls: SquareSubscriptionStatusWebhookRpcArgs[] = [];
  const updated = await handleSquareWebhook({
    rawBody: subscriptionBody({
      type: "subscription.updated",
      subscription: {
        id: "sqsub_1",
        customerId: "sqcust_1",
        locationId: "sqloc_1",
        planVariationId: "sqvar_1",
        status: "DEACTIVATED",
        version: 4,
      },
    }),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => {
      throw new Error("payment apply must not run for subscription.updated");
    },
    applySubscriptionStatus: async (args) => {
      deactivatedCalls.push(args);
      return {
        processed: true,
        replayed: false,
        skipped_subscription: false,
        resolved_user_id: null,
        subscription_status: "inactive",
      };
    },
    squareEnvironment: "production",
  });
  assert(updated.status === 200, "subscription.updated DEACTIVATED applied");
  assert(
    deactivatedCalls[0]?.p_square_subscription_status === "DEACTIVATED",
    "updated status is DEACTIVATED",
  );
  assert(
    deactivatedCalls[0]?.p_event_type === "subscription.updated",
    "updated event type",
  );
  assert(
    deactivatedCalls[0]?.p_square_environment === "production",
    "updated uses configured production environment",
  );

  for (const status of [
    "ACTIVE",
    "PENDING",
    "PAUSED",
    "DEACTIVATED",
    "COMPLETED",
    "CANCELED",
  ]) {
    const calls: SquareSubscriptionStatusWebhookRpcArgs[] = [];
    const result = await handleSquareWebhook({
      rawBody: subscriptionBody({
        type: "subscription.updated",
        subscription: {
          id: "sqsub_1",
          customer_id: "sqcust_1",
          location_id: "sqloc_1",
          plan_variation_id: "sqvar_1",
          status,
          version: 2,
        },
      }),
      signatureHeader: "valid",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async () => undefined,
      applySubscriptionStatus: async (args) => {
        calls.push(args);
        return {
          processed: true,
          replayed: false,
          skipped_subscription: false,
          resolved_user_id: null,
          subscription_status: status,
        };
      },
      squareEnvironment: "sandbox",
    });
    assert(result.status === 200, `${status} accepted`);
    assert(calls[0]?.p_square_subscription_status === status, `${status} passed through`);
  }

  let missingEventRpc = 0;
  const missingEvent = await handleSquareWebhook({
    rawBody: subscriptionBody({ omitEventId: true }),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      missingEventRpc += 1;
      throw new Error("unreachable");
    },
    squareEnvironment: "sandbox",
  });
  assert(missingEvent.status === 400, "missing event_id rejected");
  assert(missingEventRpc === 0, "missing event_id makes zero RPC calls");

  let missingObjectRpc = 0;
  const missingObject = await handleSquareWebhook({
    rawBody: subscriptionBody({ omitSubscription: true }),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      missingObjectRpc += 1;
      throw new Error("unreachable");
    },
    squareEnvironment: "sandbox",
  });
  assert(missingObject.status === 400, "missing subscription object rejected");
  assert(missingObjectRpc === 0, "missing subscription makes zero RPC calls");

  const correlationKeys = [
    "id",
    "customer_id",
    "location_id",
    "plan_variation_id",
  ] as const;
  for (const key of correlationKeys) {
    let rpcCalls = 0;
    const subscription: Record<string, unknown> = {
      id: "sqsub_1",
      customer_id: "sqcust_1",
      location_id: "sqloc_1",
      plan_variation_id: "sqvar_1",
      status: "ACTIVE",
      version: 1,
    };
    delete subscription[key];
    const result = await handleSquareWebhook({
      rawBody: subscriptionBody({ subscription }),
      signatureHeader: "valid",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async () => undefined,
      applySubscriptionStatus: async () => {
        rpcCalls += 1;
        throw new Error("unreachable");
      },
      squareEnvironment: "sandbox",
    });
    assert(result.status === 400, `missing ${key} rejected`);
    assert(rpcCalls === 0, `missing ${key} makes zero RPC calls`);
  }

  for (const [label, version] of [
    ["missing", undefined],
    ["fractional", 1.5],
    ["negative", -1],
    ["unsafe-integer", Number.MAX_SAFE_INTEGER + 1],
  ] as const) {
    let rpcCalls = 0;
    const subscription: Record<string, unknown> = {
      id: "sqsub_1",
      customer_id: "sqcust_1",
      location_id: "sqloc_1",
      plan_variation_id: "sqvar_1",
      status: "ACTIVE",
    };
    if (label !== "missing") subscription.version = version;
    const result = await handleSquareWebhook({
      rawBody: subscriptionBody({ subscription }),
      signatureHeader: "valid",
      config: CONFIG,
      verifySignature: async () => true,
      applyEvent: async () => undefined,
      applySubscriptionStatus: async () => {
        rpcCalls += 1;
        throw new Error("unreachable");
      },
      squareEnvironment: "sandbox",
    });
    assert(result.status === 400, `${label} version rejected`);
    assert(rpcCalls === 0, `${label} version makes zero RPC calls`);
  }

  let unsupportedStatusRpc = 0;
  const unsupportedStatus = await handleSquareWebhook({
    rawBody: subscriptionBody({
      subscription: {
        id: "sqsub_1",
        customer_id: "sqcust_1",
        location_id: "sqloc_1",
        plan_variation_id: "sqvar_1",
        status: "UNKNOWN",
        version: 1,
      },
    }),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      unsupportedStatusRpc += 1;
      throw new Error("unreachable");
    },
    squareEnvironment: "sandbox",
  });
  assert(unsupportedStatus.status === 400, "unsupported status rejected");
  assert(unsupportedStatusRpc === 0, "unsupported status makes zero RPC calls");

  const replayed = await handleSquareWebhook({
    rawBody: subscriptionBody(),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => ({
      processed: false,
      replayed: true,
      skipped_subscription: true,
      resolved_user_id: null,
      subscription_status: null,
    }),
    squareEnvironment: "sandbox",
  });
  assert(replayed.status === 200 && replayed.body.replayed === true, "replayed RPC is 200");

  const skipped = await handleSquareWebhook({
    rawBody: subscriptionBody(),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => ({
      processed: true,
      replayed: false,
      skipped_subscription: true,
      resolved_user_id: null,
      subscription_status: null,
    }),
    squareEnvironment: "sandbox",
  });
  assert(
    skipped.status === 200 && skipped.body.skipped_subscription === true,
    "skipped_subscription RPC is 200",
  );

  const zb001 = await handleSquareWebhook({
    rawBody: subscriptionBody(),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      throw new SquareSubscriptionStatusWebhookRpcError("ZB001");
    },
    squareEnvironment: "sandbox",
  });
  assert(zb001.status === 400, "ZB001 maps to 400");

  const zb002 = await handleSquareWebhook({
    rawBody: subscriptionBody(),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      throw new SquareSubscriptionStatusWebhookRpcError("ZB002");
    },
    squareEnvironment: "sandbox",
  });
  assert(zb002.status === 409, "ZB002 maps to 409");

  const zb003 = await handleSquareWebhook({
    rawBody: subscriptionBody(),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      throw new SquareSubscriptionStatusWebhookRpcError("ZB003");
    },
    squareEnvironment: "sandbox",
  });
  assert(zb003.status === 503, "ZB003 maps to 503");

  const genericRpc = await handleSquareWebhook({
    rawBody: subscriptionBody(),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      throw new Error("db down");
    },
    squareEnvironment: "sandbox",
  });
  assert(genericRpc.status === 503, "generic RPC failure maps to 503");

  let signedSubscriptionRpc = 0;
  const badSignature = await handleSquareWebhook({
    rawBody: subscriptionBody(),
    signatureHeader: "invalid",
    config: CONFIG,
    verifySignature: async () => false,
    applyEvent: async () => undefined,
    applySubscriptionStatus: async () => {
      signedSubscriptionRpc += 1;
      throw new Error("unreachable");
    },
    squareEnvironment: "sandbox",
  });
  assert(badSignature.status === 403, "bad signature rejected");
  assert(signedSubscriptionRpc === 0, "bad signature makes zero subscription RPC calls");

  const invoiceIgnored = await handleSquareWebhook({
    rawBody: JSON.stringify({
      event_id: "inv-1",
      type: "invoice.created",
      data: { object: { invoice: { id: "inv" } } },
    }),
    signatureHeader: "valid",
    config: CONFIG,
    verifySignature: async () => true,
    applyEvent: async () => {
      throw new Error("invoice must not write payment path");
    },
    applySubscriptionStatus: async () => {
      throw new Error("invoice must not write subscription path");
    },
    squareEnvironment: "sandbox",
  });
  assert(
    invoiceIgnored.status === 200 &&
      invoiceIgnored.body.reason === "unsupported_event_type",
    "invoice remains ignored",
  );

  const route = readFileSync(
    join(process.cwd(), "src/app/api/webhooks/square/route.ts"),
    "utf8",
  );
  const envExample = readFileSync(
    join(process.cwd(), ".env.example"),
    "utf8",
  );
  assert(route.includes("request.text()"), "route reads exact raw body");
  assert(!route.includes("request.json()"), "route never parses before HMAC");
  assert(
    route.includes("x-square-hmacsha256-signature"),
    "route reads Square signature header",
  );
  assert(
    route.includes("enrichSubscriptionPaymentSquareCorrelation"),
    "route wires fail-soft payment enrichment",
  );
  assert(
    route.includes("applySquareSubscriptionStatusWebhookRpc"),
    "route wires subscription status RPC",
  );
  assert(
    route.includes("applySubscriptionWebhook"),
    "route still wires payment applyEvent",
  );
  assert(
    envExample.includes("SQUARE_WEBHOOK_SIGNATURE_KEY") &&
      envExample.includes("SQUARE_WEBHOOK_NOTIFICATION_URL"),
    "required Square webhook configuration documented",
  );

  console.log("square webhook security microblock tests passed");
}

runSquareWebhookTests().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "square webhook tests failed",
  );
  process.exitCode = 1;
});