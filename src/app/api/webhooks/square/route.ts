import { applySubscriptionWebhook } from "@/lib/subscription-webhooks";
import { parsePlanId, planFromUsdAmount } from "@/lib/zencierge-plans";

export const dynamic = "force-dynamic";

type SquarePayment = {
  id?: string;
  status?: string;
  createdAt?: string;
  amountMoney?: { amount?: number | bigint };
  buyerEmailAddress?: string;
  customerId?: string;
};

function moneyUsd(amount: number | bigint | undefined) {
  if (amount == null) return 0;
  return Number(amount) / 100;
}

export async function POST(request: Request) {
  let payload: {
    type?: string;
    data?: { object?: { payment?: SquarePayment } };
  };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payment = payload.data?.object?.payment;
  if (!payment?.id) {
    return Response.json({ received: true, ignored: true });
  }

  const statusRaw = (payment.status ?? "").toUpperCase();
  const failed = statusRaw.includes("FAIL") || statusRaw === "CANCELED";
  const amountUsd = moneyUsd(payment.amountMoney?.amount);
  const planId = planFromUsdAmount(amountUsd);

  try {
    await applySubscriptionWebhook({
      type: failed ? "payment.failed" : "payment.succeeded",
      email: payment.buyerEmailAddress,
      planId: parsePlanId(planId),
      amountUsd,
      paymentId: payment.id,
      squareCustomerId: payment.customerId,
      occurredAt: payment.createdAt,
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Webhook failed";
    return Response.json({ error: message }, { status: 503 });
  }

  return Response.json({ received: true });
}
