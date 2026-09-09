import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  classifySquarePaymentStatus,
  handleSquareWebhook,
  squareWebhookConfig,
  verifySquareWebhookSignature,
  type SquareWebhookConfig,
} from "./square-webhook";
import type { ProviderSubscriptionWebhookInput } from "./subscription-webhooks";

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