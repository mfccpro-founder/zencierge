import { createHash } from "node:crypto";
import { WebhooksHelper } from "square";
import type { SquarePaymentEnrichmentInput } from "@/lib/square-payment-enrichment";
import { resolveSquareEnvironment } from "@/lib/square-client";
import type { ProviderSubscriptionWebhookInput } from "@/lib/subscription-webhooks";
import {
  SquareSubscriptionStatusWebhookRpcError,
  type SquareSubscriptionStatusWebhookRpcArgs,
  type SquareSubscriptionStatusWebhookRpcResult,
} from "@/lib/square-billing-supabase-stores";

export type SquarePaymentDisposition = "succeeded" | "failed" | "ignored";

export type SquareWebhookConfig =
  | {
      ready: true;
      signatureKey: string;
      notificationUrl: string;
    }
  | {
      ready: false;
      error: string;
    };

export type SquareWebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

export type SquareWebhookSignatureVerifier = (input: {
  requestBody: string;
  signatureHeader: string;
  signatureKey: string;
  notificationUrl: string;
}) => Promise<boolean>;

export type SquareWebhookEventApplier = (
  input: ProviderSubscriptionWebhookInput,
) => Promise<unknown>;

export type SquarePaymentCorrelationEnricher = (
  input: SquarePaymentEnrichmentInput,
) => Promise<unknown>;

export type SquareWebhookSubscriptionStatusApplier = (
  input: SquareSubscriptionStatusWebhookRpcArgs,
) => Promise<SquareSubscriptionStatusWebhookRpcResult>;

/** Additive payment correlation ids from an existing Square payment object. */
export function parseSquarePaymentCorrelationIds(
  payment: Record<string, unknown> | null,
): {
  squareOrderId: string | null;
  squareLocationId: string | null;
} {
  return {
    squareOrderId:
      stringValue(payment?.order_id) ?? stringValue(payment?.orderId),
    squareLocationId:
      stringValue(payment?.location_id) ?? stringValue(payment?.locationId),
  };
}

type SquareWebhookEnvironment = {
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  SQUARE_WEBHOOK_NOTIFICATION_URL?: string;
};

const PAYMENT_EVENT_TYPES = new Set(["payment.created", "payment.updated"]);
const SUBSCRIPTION_STATUS_EVENT_TYPES = new Set([
  "subscription.created",
  "subscription.updated",
]);
const SQUARE_SUBSCRIPTION_STATUSES = new Set([
  "ACTIVE",
  "PENDING",
  "PAUSED",
  "DEACTIVATED",
  "COMPLETED",
  "CANCELED",
]);
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function firstString(
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): string | null {
  if (!record) return null;
  for (const key of keys) {
    const found = stringValue(record[key]);
    if (found) return found;
  }
  return null;
}

function optionalCalendarDate(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined) return null;
  const text = stringValue(value);
  if (!text) return "invalid";
  if (!CALENDAR_DATE_PATTERN.test(text)) return "invalid";
  return text;
}

function parseNonnegativeSafeInteger(value: unknown): number | null {
  if (typeof value === "bigint") {
    if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) return null;
    return parsed;
  }
  return null;
}

function hashExactRawBody(rawBody: string): string {
  return createHash("sha256").update(rawBody, "utf8").digest("hex");
}

function invalidSubscriptionEvent(): SquareWebhookResult {
  return {
    status: 400,
    body: { error: "Invalid Square webhook event" },
  };
}

function mapSubscriptionStatusRpcError(error: unknown): SquareWebhookResult {
  if (error instanceof SquareSubscriptionStatusWebhookRpcError) {
    if (error.code === "ZB001") {
      return invalidSubscriptionEvent();
    }
    if (error.code === "ZB002") {
      return {
        status: 409,
        body: { error: "Square webhook event identity conflict" },
      };
    }
    return {
      status: 503,
      body: { error: "Square webhook processing unavailable" },
    };
  }
  return {
    status: 503,
    body: { error: "Square webhook processing unavailable" },
  };
}

function resolveConfiguredSquareEnvironment(
  override?: "sandbox" | "production",
): "sandbox" | "production" | null {
  if (override === "sandbox" || override === "production") return override;
  try {
    return resolveSquareEnvironment().name;
  } catch {
    return null;
  }
}

function replayResponseMetadata(value: unknown) {
  if (!isRecord(value)) return {};
  if (
    typeof value.processed !== "boolean" ||
    typeof value.replayed !== "boolean"
  ) {
    return {};
  }
  return {
    processed: value.processed,
    replayed: value.replayed,
  };
}

function centsToUsd(value: unknown) {
  const amount =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(amount) && amount >= 0 ? amount / 100 : 0;
}

function unavailableConfig(): SquareWebhookConfig {
  return {
    ready: false,
    error: "Square webhook is not configured",
  };
}

export function squareWebhookConfig(
  env: SquareWebhookEnvironment = {
    SQUARE_WEBHOOK_SIGNATURE_KEY:
      process.env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    SQUARE_WEBHOOK_NOTIFICATION_URL:
      process.env.SQUARE_WEBHOOK_NOTIFICATION_URL,
  },
): SquareWebhookConfig {
  const signatureKey = env.SQUARE_WEBHOOK_SIGNATURE_KEY?.trim() ?? "";
  const notificationUrl =
    env.SQUARE_WEBHOOK_NOTIFICATION_URL?.trim() ?? "";
  if (!signatureKey || !notificationUrl) return unavailableConfig();

  try {
    const parsed = new URL(notificationUrl);
    if (parsed.protocol !== "https:") return unavailableConfig();
  } catch {
    return unavailableConfig();
  }

  return {
    ready: true,
    signatureKey,
    notificationUrl,
  };
}

export function classifySquarePaymentStatus(
  status: unknown,
): SquarePaymentDisposition {
  if (typeof status !== "string") return "ignored";
  switch (status.trim().toUpperCase()) {
    case "COMPLETED":
      return "succeeded";
    case "FAILED":
    case "CANCELED":
      return "failed";
    default:
      return "ignored";
  }
}

export async function verifySquareWebhookSignature(input: {
  requestBody: string;
  signatureHeader: string;
  signatureKey: string;
  notificationUrl: string;
}) {
  return WebhooksHelper.verifySignature(input);
}

export async function handleSquareWebhook(input: {
  rawBody: string;
  signatureHeader: string | null;
  config: SquareWebhookConfig;
  verifySignature: SquareWebhookSignatureVerifier;
  applyEvent: SquareWebhookEventApplier;
  applySubscriptionStatus?: SquareWebhookSubscriptionStatusApplier;
  squareEnvironment?: "sandbox" | "production";
  /**
   * Optional fail-soft enrichment after entitlement/payment processing.
   * Production route wires this; when omitted, no enrichment runs.
   * Must never throw into the webhook response path.
   */
  enrichPaymentCorrelation?: SquarePaymentCorrelationEnricher;
}): Promise<SquareWebhookResult> {
  if (!input.config.ready) {
    return {
      status: 503,
      body: { error: "Square webhook is not configured" },
    };
  }

  const signatureHeader = input.signatureHeader?.trim() ?? "";
  if (!signatureHeader) {
    return {
      status: 403,
      body: { error: "Invalid Square webhook signature" },
    };
  }

  let verified = false;
  try {
    verified = await input.verifySignature({
      requestBody: input.rawBody,
      signatureHeader,
      signatureKey: input.config.signatureKey,
      notificationUrl: input.config.notificationUrl,
    });
  } catch {
    verified = false;
  }
  if (!verified) {
    return {
      status: 403,
      body: { error: "Invalid Square webhook signature" },
    };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  if (!isRecord(payload)) {
    return { status: 400, body: { error: "Invalid JSON" } };
  }

  const eventType = stringValue(payload.type)?.toLowerCase() ?? "";
  if (!PAYMENT_EVENT_TYPES.has(eventType)) {
    if (SUBSCRIPTION_STATUS_EVENT_TYPES.has(eventType)) {
      return applySquareSubscriptionStatusEvent(eventType, payload, input);
    }
    return {
      status: 200,
      body: {
        received: true,
        ignored: true,
        reason: "unsupported_event_type",
      },
    };
  }

  const data = isRecord(payload.data) ? payload.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  const payment =
    object && isRecord(object.payment) ? object.payment : null;
  const paymentId = stringValue(payment?.id);
  if (!paymentId) {
    return {
      status: 200,
      body: {
        received: true,
        ignored: true,
        reason: "missing_payment",
      },
    };
  }

  const disposition = classifySquarePaymentStatus(payment?.status);
  if (disposition === "ignored") {
    return {
      status: 200,
      body: {
        received: true,
        ignored: true,
        reason: "non_terminal_payment_status",
      },
    };
  }

  const eventId = stringValue(payload.event_id);
  if (!eventId) {
    return {
      status: 400,
      body: { error: "Invalid Square webhook event" },
    };
  }

  const amountMoney =
    payment && isRecord(payment.amount_money)
      ? payment.amount_money
      : payment && isRecord(payment.amountMoney)
        ? payment.amountMoney
        : null;
  const amountUsd = centsToUsd(amountMoney?.amount);
  const { squareOrderId, squareLocationId } =
    parseSquarePaymentCorrelationIds(payment);

  try {
    const applied = await input.applyEvent({
      provider: "square",
      eventId,
      type:
        disposition === "succeeded"
          ? "payment.succeeded"
          : "payment.failed",
      email:
        stringValue(payment?.buyer_email_address) ??
        stringValue(payment?.buyerEmailAddress),
      amountUsd,
      paymentId,
      squareCustomerId:
        stringValue(payment?.customer_id) ??
        stringValue(payment?.customerId),
      occurredAt:
        stringValue(payment?.created_at) ??
        stringValue(payment?.createdAt),
    });

    // Fail-soft only: never alter webhook status/body based on enrichment.
    // Production route wires enrichPaymentCorrelation; omitted = no enrichment.
    if (input.enrichPaymentCorrelation) {
      try {
        await input.enrichPaymentCorrelation({
          providerPaymentId: paymentId,
          squareOrderId,
          squareLocationId,
        });
      } catch {
        // intentional: enrichment must not affect webhook return path
      }
    }

    return {
      status: 200,
      body: {
        received: true,
        ...replayResponseMetadata(applied),
      },
    };
  } catch {
    return {
      status: 503,
      body: { error: "Square webhook processing unavailable" },
    };
  }
}

async function applySquareSubscriptionStatusEvent(
  eventType: string,
  payload: Record<string, unknown>,
  input: {
    rawBody: string;
    applySubscriptionStatus?: SquareWebhookSubscriptionStatusApplier;
    squareEnvironment?: "sandbox" | "production";
  },
): Promise<SquareWebhookResult> {
  if (!input.applySubscriptionStatus) {
    return {
      status: 503,
      body: { error: "Square webhook processing unavailable" },
    };
  }

  const environment = resolveConfiguredSquareEnvironment(input.squareEnvironment);
  if (!environment) {
    return {
      status: 503,
      body: { error: "Square webhook processing unavailable" },
    };
  }

  const eventId = stringValue(payload.event_id);
  if (!eventId) {
    return invalidSubscriptionEvent();
  }

  const data = isRecord(payload.data) ? payload.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  const subscription =
    object && isRecord(object.subscription) ? object.subscription : null;
  if (!subscription) {
    return invalidSubscriptionEvent();
  }

  const subscriptionId = firstString(subscription, "id");
  const customerId = firstString(subscription, "customer_id", "customerId");
  const locationId = firstString(subscription, "location_id", "locationId");
  const planVariationId = firstString(
    subscription,
    "plan_variation_id",
    "planVariationId",
  );
  const status = firstString(subscription, "status");
  const version = parseNonnegativeSafeInteger(subscription.version);
  const startDate = optionalCalendarDate(
    subscription.start_date ?? subscription.startDate,
  );
  const chargedThroughDate = optionalCalendarDate(
    subscription.charged_through_date ?? subscription.chargedThroughDate,
  );
  const canceledDate = optionalCalendarDate(
    subscription.canceled_date ?? subscription.canceledDate,
  );

  if (
    !subscriptionId ||
    !customerId ||
    !locationId ||
    !planVariationId ||
    !status ||
    !SQUARE_SUBSCRIPTION_STATUSES.has(status) ||
    version === null ||
    startDate === "invalid" ||
    chargedThroughDate === "invalid" ||
    canceledDate === "invalid"
  ) {
    return invalidSubscriptionEvent();
  }

  const payloadSha256 = hashExactRawBody(input.rawBody);
  const args: SquareSubscriptionStatusWebhookRpcArgs = {
    p_provider: "square",
    p_event_id: eventId,
    p_event_type: eventType,
    p_payload_sha256: payloadSha256,
    p_square_environment: environment,
    p_square_subscription_id: subscriptionId,
    p_square_customer_id: customerId,
    p_square_location_id: locationId,
    p_square_plan_variation_id: planVariationId,
    p_square_subscription_status: status,
    p_square_subscription_version: version,
    p_square_start_date: startDate,
    p_square_charged_through_date: chargedThroughDate,
    p_square_canceled_date: canceledDate,
  };

  try {
    const applied = await input.applySubscriptionStatus(args);
    return {
      status: 200,
      body: {
        received: true,
        processed: applied.processed,
        replayed: applied.replayed,
        skipped_subscription: applied.skipped_subscription,
      },
    };
  } catch (error) {
    return mapSubscriptionStatusRpcError(error);
  }
}