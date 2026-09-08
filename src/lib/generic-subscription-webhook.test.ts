import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  genericSubscriptionWebhookConfig,
  genericSubscriptionWebhookSecretsMatch,
  genericSubscriptionWebhookToken,
  handleGenericSubscriptionWebhook,
  parseGenericSubscriptionWebhookPayload,
  type GenericSubscriptionWebhookConfig,
} from "./generic-subscription-webhook";
import { normalizeWebhookType } from "./subscription-webhooks";
import type { SubscriptionWebhookInput } from "./subscription-webhooks";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const CONFIG = {
  ready: true,
  secret: "generic-webhook-secret",
} satisfies GenericSubscriptionWebhookConfig;

function paymentPayload(
  type: string,
  extras: Record<string, unknown> = {},
) {
  return {
    type,
    user_id: "334119a5-44b0-4567-8184-c2c6ff83a49e",
    email: "host@example.com",
    plan_id: "pro",
    amount_usd: 99,
    payment_id: "payment-1",
    ...extras,
  };
}

async function runGenericSubscriptionWebhookTests() {
  const ready = genericSubscriptionWebhookConfig({
    SUBSCRIPTION_WEBHOOK_SECRET: " secret ",
  });
  assert(ready.ready, "configured shared secret is ready");
  if (ready.ready) {
    assert(ready.secret === "secret", "configured secret is trimmed");
  }
  assert(
    !genericSubscriptionWebhookConfig({}).ready,
    "missing server secret fails closed",
  );
  assert(
    !genericSubscriptionWebhookConfig({
      SUBSCRIPTION_WEBHOOK_SECRET: "   ",
    }).ready,
    "blank server secret fails closed",
  );

  assert(
    genericSubscriptionWebhookToken({
      xWebhookSecret: " explicit ",
      authorization: "Bearer bearer-value",
    }) === "explicit",
    "x-webhook-secret takes precedence",
  );
  assert(
    genericSubscriptionWebhookToken({
      xWebhookSecret: null,
      authorization: "Bearer bearer-value",
    }) === "bearer-value",
    "Bearer token accepted",
  );
  assert(
    genericSubscriptionWebhookToken({
      xWebhookSecret: null,
      authorization: "bearer-value",
    }) === null,
    "raw Authorization secret rejected",
  );
  assert(
    genericSubscriptionWebhookToken({
      xWebhookSecret: null,
      authorization: "Basic bearer-value",
    }) === null,
    "Basic authorization rejected",
  );
  assert(
    genericSubscriptionWebhookSecretsMatch("same", "same"),
    "equal secrets accepted",
  );
  assert(
    !genericSubscriptionWebhookSecretsMatch("same", "different"),
    "different secrets rejected",
  );
  assert(
    !genericSubscriptionWebhookSecretsMatch("short", "longer-value"),
    "different-length secrets rejected",
  );

  assert(
    normalizeWebhookType("payment.succeeded") === "payment.succeeded",
    "explicit payment success supported",
  );
  assert(
    normalizeWebhookType("invoice.paid") === "payment.succeeded",
    "explicit paid invoice supported",
  );
  assert(
    normalizeWebhookType("payment.failed") === "payment.failed",
    "explicit payment failure supported",
  );
  assert(
    normalizeWebhookType("invoice.payment_failed") === "payment.failed",
    "explicit failed invoice supported",
  );
  assert(
    normalizeWebhookType("subscription.canceled") ===
      "subscription.canceled",
    "US cancellation spelling supported",
  );
  assert(
    normalizeWebhookType("subscription.cancelled") ===
      "subscription.canceled",
    "alternate cancellation spelling supported",
  );
  assert(
    normalizeWebhookType("payment.created") === null,
    "payment.created is never success",
  );
  assert(
    normalizeWebhookType("payment.updated") === null,
    "generic payment.updated unsupported",
  );

  const parsedSuccess = parseGenericSubscriptionWebhookPayload(
    paymentPayload("payment.succeeded"),
  );
  assert(parsedSuccess.ok, "valid payment payload parsed");
  if (parsedSuccess.ok) {
    assert(
      parsedSuccess.event.type === "payment.succeeded",
      "valid success retains event",
    );
    assert(
      parsedSuccess.event.paymentId === "payment-1",
      "stable payment id retained",
    );
    assert(
      parsedSuccess.event.amountUsd === 99,
      "direct USD amount retained",
    );
    assert(
      parsedSuccess.event.planId === "pro",
      "catalog plan retained",
    );
  }

  for (const value of [null, [], "payload", 1]) {
    assert(
      !parseGenericSubscriptionWebhookPayload(value).ok,
      "non-object payload rejected",
    );
  }

  const missingPaymentId =
    parseGenericSubscriptionWebhookPayload({
      type: "payment.succeeded",
      amount_usd: 99,
    });
  assert(
    !missingPaymentId.ok &&
      missingPaymentId.error === "missing_payment_id",
    "payment event requires stable payment id",
  );

  const pendingInference =
    parseGenericSubscriptionWebhookPayload({
      data: {
        object: {
          payment: {
            id: "pending-payment",
            status: "PENDING",
          },
        },
      },
    });
  assert(
    !pendingInference.ok &&
      pendingInference.error === "unsupported_event",
    "PENDING payment status is not inferred",
  );

  const approvedInference =
    parseGenericSubscriptionWebhookPayload({
      data: {
        object: {
          payment: {
            id: "approved-payment",
            status: "APPROVED",
          },
        },
      },
    });
  assert(
    !approvedInference.ok &&
      approvedInference.error === "unsupported_event",
    "APPROVED payment status is not inferred",
  );

  const cancelInference =
    parseGenericSubscriptionWebhookPayload({
      data: {
        object: {
          subscription: {
            id: "subscription-1",
            status: "cancel_requested",
          },
        },
      },
    });
  assert(
    !cancelInference.ok &&
      cancelInference.error === "unsupported_event",
    "subscription status does not infer cancellation",
  );

  const explicitCancellation =
    parseGenericSubscriptionWebhookPayload({
      type: "subscription.canceled",
      user_id: "334119a5-44b0-4567-8184-c2c6ff83a49e",
      data: {
        object: {
          subscription: {
            id: "subscription-1",
            customerId: "customer-1",
          },
        },
      },
    });
  assert(explicitCancellation.ok, "explicit cancellation accepted");
  if (explicitCancellation.ok) {
    assert(
      explicitCancellation.event.paymentId == null,
      "cancellation does not invent payment identity",
    );
    assert(
      explicitCancellation.event.squareSubscriptionId ===
        "subscription-1",
      "subscription id retained",
    );
  }

  const typePrecedence =
    parseGenericSubscriptionWebhookPayload({
      type: "unknown.event",
      event: "payment.succeeded",
      payment_id: "payment-1",
    });
  assert(
    !typePrecedence.ok &&
      typePrecedence.error === "unsupported_event",
    "type takes precedence over legacy event alias",
  );

  let unconfiguredReads = 0;
  let unconfiguredWrites = 0;
  const unconfigured = await handleGenericSubscriptionWebhook({
    config: {
      ready: false,
      error: "Subscription webhook is not configured",
    },
    xWebhookSecret: "generic-webhook-secret",
    authorization: null,
    readBody: async () => {
      unconfiguredReads += 1;
      return paymentPayload("payment.succeeded");
    },
    applyEvent: async () => {
      unconfiguredWrites += 1;
    },
  });
  assert(unconfigured.status === 503, "missing config fails closed");
  assert(
    unconfiguredReads === 0 && unconfiguredWrites === 0,
    "missing config cannot parse or write",
  );

  let unauthorizedReads = 0;
  let unauthorizedWrites = 0;
  const unauthorized = await handleGenericSubscriptionWebhook({
    config: CONFIG,
    xWebhookSecret: null,
    authorization: null,
    readBody: async () => {
      unauthorizedReads += 1;
      return paymentPayload("payment.succeeded");
    },
    applyEvent: async () => {
      unauthorizedWrites += 1;
    },
  });
  assert(unauthorized.status === 401, "missing caller token rejected");
  assert(
    unauthorizedReads === 0 && unauthorizedWrites === 0,
    "unauthorized request cannot parse or write",
  );

  const applied: SubscriptionWebhookInput[] = [];
  const accepted = await handleGenericSubscriptionWebhook({
    config: CONFIG,
    xWebhookSecret: CONFIG.secret,
    authorization: null,
    readBody: async () => paymentPayload("invoice.paid"),
    applyEvent: async (event) => {
      applied.push(event);
      return {
        ok: true,
        userId: event.userId,
        status: "active",
      };
    },
  });
  assert(accepted.status === 200, "authorized valid event accepted");
  assert(applied.length === 1, "valid event applied exactly once");
  assert(
    applied[0]?.type === "payment.succeeded",
    "invoice.paid maps to one success event",
  );

  let createdWrites = 0;
  const created = await handleGenericSubscriptionWebhook({
    config: CONFIG,
    xWebhookSecret: null,
    authorization: `Bearer ${CONFIG.secret}`,
    readBody: async () =>
      paymentPayload("payment.created", {
        status: "COMPLETED",
      }),
    applyEvent: async () => {
      createdWrites += 1;
    },
  });
  assert(created.status === 400, "payment.created rejected");
  assert(createdWrites === 0, "payment.created cannot write");

  const invalidJson = await handleGenericSubscriptionWebhook({
    config: CONFIG,
    xWebhookSecret: CONFIG.secret,
    authorization: null,
    readBody: async () => {
      throw new SyntaxError("private parser detail");
    },
    applyEvent: async () => undefined,
  });
  assert(invalidJson.status === 400, "malformed JSON rejected");
  assert(
    invalidJson.body.error === "Invalid JSON",
    "JSON error sanitized",
  );

  const processingFailure = await handleGenericSubscriptionWebhook({
    config: CONFIG,
    xWebhookSecret: CONFIG.secret,
    authorization: null,
    readBody: async () => paymentPayload("payment.failed"),
    applyEvent: async () => {
      throw new Error(
        "relation subscription_payments does not exist; secret=value",
      );
    },
  });
  assert(processingFailure.status === 503, "processing failure returned");
  assert(
    processingFailure.body.error ===
      "Subscription webhook processing unavailable",
    "processing error sanitized",
  );

  const route = readFileSync(
    join(
      process.cwd(),
      "src/app/api/webhooks/subscriptions/route.ts",
    ),
    "utf8",
  );
  const domain = readFileSync(
    join(process.cwd(), "src/lib/subscription-webhooks.ts"),
    "utf8",
  );
  const envExample = readFileSync(
    join(process.cwd(), ".env.example"),
    "utf8",
  );

  assert(
    route.includes("handleGenericSubscriptionWebhook"),
    "route delegates to hardened handler",
  );
  assert(
    !route.includes("status.includes") &&
      !route.includes("/cancel/i"),
    "route has no status inference",
  );
  assert(
    !domain.includes(
      'type === "payment.created"',
    ),
    "shared normalizer does not treat payment.created as success",
  );
  assert(
    envExample.includes(
      "Required for POST /api/webhooks/subscriptions",
    ),
    "required secret documented",
  );

  console.log(
    "generic subscription webhook security microblock tests passed",
  );
}

runGenericSubscriptionWebhookTests().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "generic subscription webhook tests failed",
  );
  process.exitCode = 1;
});