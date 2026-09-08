import { WebhooksHelper } from "square";
import type { SubscriptionWebhookInput } from "@/lib/subscription-webhooks";
import { planFromUsdAmount } from "@/lib/zencierge-plans";

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
  input: SubscriptionWebhookInput,
) => Promise<unknown>;

type SquareWebhookEnvironment = {
  SQUARE_WEBHOOK_SIGNATURE_KEY?: string;
  SQUARE_WEBHOOK_NOTIFICATION_URL?: string;
};

const PAYMENT_EVENT_TYPES = new Set(["payment.created", "payment.updated"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

  const amountMoney =
    payment && isRecord(payment.amount_money)
      ? payment.amount_money
      : payment && isRecord(payment.amountMoney)
        ? payment.amountMoney
        : null;
  const amountUsd = centsToUsd(amountMoney?.amount);

  try {
    await input.applyEvent({
      type:
        disposition === "succeeded"
          ? "payment.succeeded"
          : "payment.failed",
      email:
        stringValue(payment?.buyer_email_address) ??
        stringValue(payment?.buyerEmailAddress),
      planId: planFromUsdAmount(amountUsd),
      amountUsd,
      paymentId,
      squareCustomerId:
        stringValue(payment?.customer_id) ??
        stringValue(payment?.customerId),
      occurredAt:
        stringValue(payment?.created_at) ??
        stringValue(payment?.createdAt),
    });
  } catch {
    return {
      status: 503,
      body: { error: "Square webhook processing unavailable" },
    };
  }

  return { status: 200, body: { received: true } };
}