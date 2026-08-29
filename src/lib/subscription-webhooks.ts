import { recordFunnelEvent, recordSquareCharge } from "@/lib/admin-revenue-store";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { parsePlanId, planFromUsdAmount, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

export type SubscriptionWebhookEvent = "payment.succeeded" | "payment.failed" | "subscription.canceled";

export type SubscriptionWebhookInput = {
  type: SubscriptionWebhookEvent;
  userId?: string | null;
  email?: string | null;
  planId?: ZenciergePlanId | null;
  amountUsd?: number | null;
  paymentId?: string | null;
  squareCustomerId?: string | null;
  squareSubscriptionId?: string | null;
  occurredAt?: string | null;
};

export type HostSubscriptionRow = {
  user_id: string;
  email: string | null;
  plan_id: string;
  status: string;
  monthly_usd: number;
  square_customer_id: string | null;
  square_subscription_id: string | null;
  current_period_end: string | null;
  last_payment_at: string | null;
};

export type SubscriptionPaymentRow = {
  id: string;
  user_id: string | null;
  host_email: string | null;
  amount_usd: number;
  plan_id: string | null;
  status: string;
  provider_event: string | null;
  provider_payment_id: string | null;
  created_at: string;
};

function periodEndFromNow() {
  const end = new Date();
  end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

async function resolveUserId(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId?: string | null,
  email?: string | null,
) {
  if (userId) return userId;
  const trimmed = email?.trim().toLowerCase();
  if (!trimmed) return null;
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) return null;
  return data.users.find((user) => user.email?.toLowerCase() === trimmed)?.id ?? null;
}

export async function applySubscriptionWebhook(input: SubscriptionWebhookInput) {
  const admin = createSupabaseAdminClient();
  const at = input.occurredAt ?? new Date().toISOString();
  const amountUsd = Number(input.amountUsd ?? 0);
  const planId = parsePlanId(input.planId) ?? (amountUsd > 0 ? planFromUsdAmount(amountUsd) : "starter");
  const monthlyUsd = ZENCIERGE_PLANS[planId].monthlyUsd;
  const userId = await resolveUserId(admin, input.userId, input.email);
  const email = input.email?.trim().toLowerCase() || null;

  if (input.type === "payment.succeeded" || input.type === "payment.failed") {
    const status = input.type === "payment.succeeded" ? "succeeded" : "failed";
    const paymentRow = {
      user_id: userId,
      host_email: email,
      amount_usd: amountUsd || monthlyUsd,
      currency: "USD",
      plan_id: planId,
      status,
      provider_event: input.type,
      provider_payment_id: input.paymentId ?? `${input.type}-${at}`,
    };
    const { error: payError } = await admin.from("subscription_payments").upsert(paymentRow, {
      onConflict: "provider_payment_id",
    });
    if (payError) throw payError;

    recordSquareCharge({
      at,
      amountUsd: amountUsd || monthlyUsd,
      status: status === "succeeded" ? "SUCCESS" : "FAILED",
      email: email ?? undefined,
      planId,
      squarePaymentId: paymentRow.provider_payment_id,
    });
    if (status === "succeeded") {
      recordFunnelEvent({ type: "paid", planId, source: "webhook", email: email ?? undefined, at });
    }
  }

  if (!userId) {
    return { ok: true, skippedSubscription: true, reason: "no matching auth user" };
  }

  const nextStatus =
    input.type === "payment.succeeded" ? "active" : input.type === "payment.failed" ? "past_due" : "canceled";

  const row: Record<string, unknown> = {
    user_id: userId,
    email,
    plan_id: planId,
    status: nextStatus,
    monthly_usd: monthlyUsd,
    updated_at: at,
  };
  if (input.squareCustomerId) row.square_customer_id = input.squareCustomerId;
  if (input.squareSubscriptionId) row.square_subscription_id = input.squareSubscriptionId;
  if (input.type === "payment.succeeded") {
    row.last_payment_at = at;
    row.current_period_end = periodEndFromNow();
  }

  const { error: subError } = await admin.from("host_subscriptions").upsert(row, { onConflict: "user_id" });
  if (subError) throw subError;

  return { ok: true, userId, planId, status: nextStatus };
}

export function normalizeWebhookType(raw: string | undefined): SubscriptionWebhookEvent | null {
  const type = (raw ?? "").toLowerCase();
  if (type === "payment.succeeded" || type === "payment.created" || type === "invoice.paid") {
    return "payment.succeeded";
  }
  if (type === "payment.failed" || type === "invoice.payment_failed") {
    return "payment.failed";
  }
  if (type === "subscription.canceled" || type === "subscription.cancelled") {
    return "subscription.canceled";
  }
  return null;
}
