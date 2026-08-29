import { applySubscriptionWebhook, normalizeWebhookType } from "@/lib/subscription-webhooks";
import { parsePlanId } from "@/lib/zencierge-plans";

export const dynamic = "force-dynamic";

type LoosePayload = {
  type?: string;
  event?: string;
  user_id?: string;
  email?: string;
  plan_id?: string;
  amount_usd?: number;
  payment_id?: string;
  data?: {
    object?: {
      payment?: {
        id?: string;
        status?: string;
        createdAt?: string;
        amountMoney?: { amount?: number | bigint };
        buyerEmailAddress?: string;
        customerId?: string;
      };
      subscription?: {
        id?: string;
        customerId?: string;
        status?: string;
      };
    };
    user_id?: string;
    email?: string;
    plan_id?: string;
    amount_usd?: number;
    payment_id?: string;
    square_customer_id?: string;
    square_subscription_id?: string;
  };
};

function centsToUsd(amount: number | bigint | undefined) {
  if (amount == null) return 0;
  return Number(amount) / 100;
}

function parseBody(payload: LoosePayload) {
  const payment = payload.data?.object?.payment;
  const subscription = payload.data?.object?.subscription;
  const status = (payment?.status ?? "").toUpperCase();
  let type = normalizeWebhookType(payload.type ?? payload.event);
  if (!type && payment) {
    type = status.includes("FAIL") || status === "CANCELED" ? "payment.failed" : "payment.succeeded";
  }
  if (!type && subscription && /cancel/i.test(subscription.status ?? "")) {
    type = "subscription.canceled";
  }

  const amountUsd =
    payload.amount_usd ??
    payload.data?.amount_usd ??
    (payment?.amountMoney?.amount != null ? centsToUsd(payment.amountMoney.amount) : null);

  return {
    type,
    userId: payload.user_id ?? payload.data?.user_id ?? null,
    email: payload.email ?? payload.data?.email ?? payment?.buyerEmailAddress ?? null,
    planId: parsePlanId(payload.plan_id ?? payload.data?.plan_id),
    amountUsd,
    paymentId: payload.payment_id ?? payload.data?.payment_id ?? payment?.id ?? null,
    squareCustomerId:
      payload.data?.square_customer_id ?? payment?.customerId ?? subscription?.customerId ?? null,
    squareSubscriptionId: payload.data?.square_subscription_id ?? subscription?.id ?? null,
    occurredAt: payment?.createdAt ?? null,
  };
}

export async function POST(request: Request) {
  const secret = process.env.SUBSCRIPTION_WEBHOOK_SECRET?.trim();
  if (secret) {
    const header = request.headers.get("x-webhook-secret") ?? request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (header !== secret) {
      return Response.json({ error: "Unauthorized webhook" }, { status: 401 });
    }
  }

  let payload: LoosePayload;
  try {
    payload = (await request.json()) as LoosePayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseBody(payload);
  if (!parsed.type) {
    return Response.json({ error: "Unsupported event type" }, { status: 400 });
  }

  try {
    const result = await applySubscriptionWebhook({
      type: parsed.type,
      userId: parsed.userId,
      email: parsed.email,
      planId: parsed.planId,
      amountUsd: parsed.amountUsd,
      paymentId: parsed.paymentId,
      squareCustomerId: parsed.squareCustomerId,
      squareSubscriptionId: parsed.squareSubscriptionId,
      occurredAt: parsed.occurredAt,
    });
    return Response.json({ received: true, ...result });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Webhook failed";
    return Response.json({ error: message }, { status: 503 });
  }
}
