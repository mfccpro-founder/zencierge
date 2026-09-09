import { timingSafeEqual } from "node:crypto";
import {
  normalizeWebhookType,
  type ProviderSubscriptionWebhookInput,
} from "@/lib/subscription-webhooks";
import { parsePlanId } from "@/lib/zencierge-plans";

export type GenericSubscriptionWebhookConfig =
  | {
      ready: true;
      secret: string;
    }
  | {
      ready: false;
      error: string;
    };

export type GenericSubscriptionWebhookResult = {
  status: number;
  body: Record<string, unknown>;
};

export type GenericSubscriptionWebhookEventApplier = (
  input: ProviderSubscriptionWebhookInput,
) => Promise<unknown>;

type GenericSubscriptionWebhookEnvironment = {
  SUBSCRIPTION_WEBHOOK_SECRET?: string;
};

type ParsedPayloadError =
  | "invalid_payload"
  | "unsupported_event"
  | "missing_event_id"
  | "missing_payment_id";

type ParsedPayload =
  | {
      ok: true;
      event: ProviderSubscriptionWebhookInput;
    }
  | {
      ok: false;
      error: ParsedPayloadError;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
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

function nonnegativeNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function amountFromCents(value: unknown): number | null {
  const cents = nonnegativeNumber(value);
  return cents == null ? null : cents / 100;
}

function unavailableConfig(): GenericSubscriptionWebhookConfig {
  return {
    ready: false,
    error: "Subscription webhook is not configured",
  };
}

export function genericSubscriptionWebhookConfig(
  env: GenericSubscriptionWebhookEnvironment = {
    SUBSCRIPTION_WEBHOOK_SECRET:
      process.env.SUBSCRIPTION_WEBHOOK_SECRET,
  },
): GenericSubscriptionWebhookConfig {
  const secret = env.SUBSCRIPTION_WEBHOOK_SECRET?.trim() ?? "";
  if (!secret) return unavailableConfig();
  return { ready: true, secret };
}

export function genericSubscriptionWebhookToken(input: {
  xWebhookSecret: string | null;
  authorization: string | null;
}): string | null {
  const explicit = stringValue(input.xWebhookSecret);
  if (explicit) return explicit;

  const authorization = input.authorization?.trim() ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  return match ? match[1] : null;
}

export function genericSubscriptionWebhookSecretsMatch(
  expected: string,
  received: string,
) {
  const expectedBytes = Buffer.from(expected, "utf8");
  const receivedBytes = Buffer.from(received, "utf8");
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
}

export function parseGenericSubscriptionWebhookPayload(
  payload: unknown,
): ParsedPayload {
  if (!isRecord(payload)) {
    return { ok: false, error: "invalid_payload" };
  }

  const rawType = stringValue(payload.type) ?? stringValue(payload.event);
  const type = normalizeWebhookType(rawType ?? undefined);
  if (!type) {
    return { ok: false, error: "unsupported_event" };
  }

  const eventId = stringValue(payload.event_id);
  if (!eventId) {
    return { ok: false, error: "missing_event_id" };
  }

  const data = isRecord(payload.data) ? payload.data : null;
  const object = data && isRecord(data.object) ? data.object : null;
  const payment =
    object && isRecord(object.payment) ? object.payment : null;
  const subscription =
    object && isRecord(object.subscription) ? object.subscription : null;

  const paymentId =
    stringValue(payload.payment_id) ??
    stringValue(data?.payment_id) ??
    stringValue(payment?.id);

  if (
    (type === "payment.succeeded" || type === "payment.failed") &&
    !paymentId
  ) {
    return { ok: false, error: "missing_payment_id" };
  }

  const directAmount =
    nonnegativeNumber(payload.amount_usd) ??
    nonnegativeNumber(data?.amount_usd);
  const snakeAmountMoney =
    payment && isRecord(payment.amount_money)
      ? payment.amount_money
      : null;
  const camelAmountMoney =
    payment && isRecord(payment.amountMoney)
      ? payment.amountMoney
      : null;
  const amountUsd =
    directAmount ??
    amountFromCents(snakeAmountMoney?.amount) ??
    amountFromCents(camelAmountMoney?.amount);

  return {
    ok: true,
    event: {
      provider: "generic_subscription",
      eventId,
      type,
      userId:
        stringValue(payload.user_id) ??
        stringValue(data?.user_id),
      email:
        stringValue(payload.email) ??
        stringValue(data?.email) ??
        stringValue(payment?.buyer_email_address) ??
        stringValue(payment?.buyerEmailAddress),
      planId: parsePlanId(
        stringValue(payload.plan_id) ??
          stringValue(data?.plan_id),
      ),
      amountUsd,
      paymentId,
      squareCustomerId:
        stringValue(data?.square_customer_id) ??
        stringValue(payment?.customer_id) ??
        stringValue(payment?.customerId) ??
        stringValue(subscription?.customer_id) ??
        stringValue(subscription?.customerId),
      squareSubscriptionId:
        stringValue(data?.square_subscription_id) ??
        stringValue(subscription?.id),
      occurredAt:
        stringValue(payload.occurred_at) ??
        stringValue(data?.occurred_at) ??
        stringValue(payment?.created_at) ??
        stringValue(payment?.createdAt),
    },
  };
}

function invalidPayloadResponse(
  error: ParsedPayloadError,
): GenericSubscriptionWebhookResult {
  if (error === "unsupported_event") {
    return {
      status: 400,
      body: { error: "Unsupported event type" },
    };
  }
  if (error === "missing_payment_id") {
    return {
      status: 400,
      body: { error: "payment_id is required for payment events" },
    };
  }
  if (error === "missing_event_id") {
    return {
      status: 400,
      body: {
        error: "event_id is required for subscription webhook events",
      },
    };
  }
  return {
    status: 400,
    body: { error: "Invalid webhook payload" },
  };
}

export async function handleGenericSubscriptionWebhook(input: {
  config: GenericSubscriptionWebhookConfig;
  xWebhookSecret: string | null;
  authorization: string | null;
  readBody: () => Promise<unknown>;
  applyEvent: GenericSubscriptionWebhookEventApplier;
}): Promise<GenericSubscriptionWebhookResult> {
  if (!input.config.ready) {
    return {
      status: 503,
      body: { error: "Subscription webhook is not configured" },
    };
  }

  const token = genericSubscriptionWebhookToken({
    xWebhookSecret: input.xWebhookSecret,
    authorization: input.authorization,
  });
  if (
    !token ||
    !genericSubscriptionWebhookSecretsMatch(input.config.secret, token)
  ) {
    return {
      status: 401,
      body: { error: "Unauthorized webhook" },
    };
  }

  let body: unknown;
  try {
    body = await input.readBody();
  } catch {
    return {
      status: 400,
      body: { error: "Invalid JSON" },
    };
  }

  const parsed = parseGenericSubscriptionWebhookPayload(body);
  if (!parsed.ok) return invalidPayloadResponse(parsed.error);

  try {
    const applied = await input.applyEvent(parsed.event);
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
      body: {
        error: "Subscription webhook processing unavailable",
      },
    };
  }
}