import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { parsePlanId, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

export type PaymentState = "al_dia" | "moroso" | "cancelado" | "sin_suscripcion";

export type AdminSubscriberRow = {
  userId: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  planId: ZenciergePlanId;
  planName: string;
  monthlyUsd: number;
  rawStatus: string;
  paymentState: PaymentState;
  lastPaymentAt: string | null;
  nextChargeAt: string | null;
  squareCustomerId: string | null;
  squareSubscriptionId: string | null;
  failedPayments: { id: string; at: string; amountUsd: number }[];
  alerts: { tag: "Failed Charge (Last 30d)" | "Overdue" | "Due within 72h" | "Data Warning"; message: string }[];
};

export type AdminBillingSnapshot = {
  generatedAt: string;
  serviceRoleReady: boolean;
  error: string | null;
  subscribers: AdminSubscriberRow[];
  metrics: {
    mrr: number;
    alDia: number;
    morosos: number;
    cancelados: number;
    sinSuscripcion: number;
    failedPayments30d: number;
  };
};

const MS_DAY = 86_400_000;

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

export function paymentStateFromRow(
  rawStatus: string | null | undefined,
  nextChargeAt: string | null,
  now = new Date(),
): PaymentState {
  const status = (rawStatus ?? "").toLowerCase();
  if (status === "canceled" || status === "cancelled") return "cancelado";
  if (status === "past_due") return "moroso";
  if (status !== "active") return "sin_suscripcion";
  if (nextChargeAt && new Date(nextChargeAt).getTime() < now.getTime()) return "moroso";
  return "al_dia";
}

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

type LoadedPayments = { rows: Record<string, unknown>[]; error: string | null };

/**
 * Tolerant loader for subscription_payments: the live schema may use
 * (user_id | subscription_id) for linking and (amount_paid, payment_status,
 * paid_at) or (amount_usd, status, created_at) for the money/status fields.
 * Tries the known variants first and falls back on schema errors, so a
 * mismatched schema degrades gracefully instead of surfacing an error banner.
 */
async function loadSubscriptionPayments(admin: AdminClient): Promise<LoadedPayments> {
  const attempts = [
    { columns: "id, user_id, subscription_id, amount_paid, payment_status, paid_at", order: "paid_at" },
    { columns: "id, user_id, subscription_id, amount_usd, status, created_at", order: "created_at" },
    { columns: "id, user_id, amount_paid, payment_status, paid_at", order: "paid_at" },
    { columns: "id, user_id, amount_usd, status, created_at", order: "created_at" },
  ];
  let lastError: string | null = null;
  for (const attempt of attempts) {
    const { data, error } = await admin
      .from("subscription_payments")
      .select(attempt.columns)
      .order(attempt.order, { ascending: false })
      .limit(500);
    if (!error) {
      return { rows: (data ?? []) as unknown as Record<string, unknown>[], error: null };
    }
    lastError = error.message;
    // Only retry with another column set when it is a schema mismatch.
    if (!/column|schema cache|does not exist/i.test(error.message)) {
      break;
    }
  }
  return { rows: [], error: lastError };
}

export async function getAdminBillingSnapshot(): Promise<AdminBillingSnapshot> {
  const now = new Date();
  const generatedAt = now.toISOString();
  const emptyMetrics = { mrr: 0, alDia: 0, morosos: 0, cancelados: 0, sinSuscripcion: 0, failedPayments30d: 0 };

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (error) {
    return {
      generatedAt,
      serviceRoleReady: false,
      error: error instanceof Error ? error.message : "Service role key is not available.",
      subscribers: [],
      metrics: emptyMetrics,
    };
  }

  const [usersResult, subsResult, paymentsLoad] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
    admin.from("host_subscriptions").select("*").order("created_at", { ascending: false }),
    loadSubscriptionPayments(admin),
  ]);

  if (usersResult.error || !usersResult.data) {
    return {
      generatedAt,
      serviceRoleReady: true,
      error: `Failed to list users: ${usersResult.error?.message ?? "no data"}`,
      subscribers: [],
      metrics: emptyMetrics,
    };
  }

  const users = usersResult.data.users;
  const subs = (subsResult.data ?? []) as Record<string, unknown>[];
  const payments = paymentsLoad.rows;
  const subsByUser = new Map(subs.map((row) => [String(row.user_id), row]));
  // Payments may reference the host directly (user_id) or through the Square
  // subscription (subscription_id → host_subscriptions.square_subscription_id).
  const subIdToUser = new Map<string, string>();
  for (const row of subs) {
    const squareSubId = row.square_subscription_id ? String(row.square_subscription_id) : null;
    if (squareSubId) subIdToUser.set(squareSubId, String(row.user_id));
  }
  const paymentsByUser = new Map<string, { id: string; at: string; amountUsd: number; status: string }[]>();
  for (const pay of payments) {
    const directId = pay.user_id ? String(pay.user_id) : null;
    const viaSubscription = pay.subscription_id ? subIdToUser.get(String(pay.subscription_id)) ?? null : null;
    const key = directId ?? viaSubscription;
    if (!key) continue;
    const list = paymentsByUser.get(key) ?? [];
    list.push({
      id: String(pay.id),
      at: String(pay.created_at ?? pay.paid_at ?? new Date(0).toISOString()),
      amountUsd: Number(pay.amount_usd ?? pay.amount_paid ?? 0),
      status: String(pay.status ?? pay.payment_status ?? ""),
    });
    paymentsByUser.set(key, list);
  }

  const rows: AdminSubscriberRow[] = users.map((user) => {
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fullName =
      [meta.full_name, meta.name, [meta.first_name, meta.last_name].filter(Boolean).join(" ")]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value.length > 0) ?? null;
    const phone =
      [user.phone, meta.phone, meta.phone_number, meta.telephone]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value.length > 0) ?? null;
    const sub = subsByUser.get(user.id);
    const planId = parsePlanId(sub?.plan_id) ?? "starter";
    const plan = ZENCIERGE_PLANS[planId];
    const nextChargeAt = sub?.current_period_end ? String(sub.current_period_end) : null;
    const paymentState = paymentStateFromRow(sub?.status as string | undefined, nextChargeAt, now);
    const userPayments = paymentsByUser.get(user.id) ?? [];
    const failedPayments = userPayments
      .filter((pay) => /fail|declin|past_due/i.test(pay.status))
      .slice(0, 5)
      .map((pay) => ({ id: pay.id, at: pay.at, amountUsd: pay.amountUsd }));

    const alerts: AdminSubscriberRow["alerts"] = [];
    const lastFailed = failedPayments[0];
    if (lastFailed && now.getTime() - new Date(lastFailed.at).getTime() < 30 * MS_DAY) {
      alerts.push({
        tag: "Failed Charge (Last 30d)",
        message: `Failed Square charge on ${formatDate(lastFailed.at)} ($${lastFailed.amountUsd}) — possible expired or declined card.`,
      });
    }
    if (paymentState === "moroso") {
      alerts.push({
        tag: "Overdue",
        message:
          nextChargeAt && new Date(nextChargeAt).getTime() < now.getTime()
            ? `Billing overdue since ${formatDate(nextChargeAt)}.`
            : "Subscription is past due per Square.",
      });
    }
    if (nextChargeAt) {
      const diff = new Date(nextChargeAt).getTime() - now.getTime();
      if (diff >= 0 && diff < 3 * MS_DAY) {
        alerts.push({
          tag: "Due within 72h",
          message: `Next charge scheduled for ${formatDate(nextChargeAt)} (due within 72 hours).`,
        });
      }
    }
    if (!sub && userPayments.length > 0) {
      alerts.push({
        tag: "Data Warning",
        message: "Payments recorded without a subscription row — check the checkout webhook.",
      });
    }

    return {
      userId: user.id,
      email: (sub?.email as string | undefined) ?? user.email ?? "(no email)",
      fullName: fullName ?? (typeof sub?.full_name === "string" && sub.full_name.trim() ? sub.full_name.trim() : (typeof sub?.name === "string" && sub.name.trim() ? sub.name.trim() : null)),
      phone,
      planId,
      planName: plan.name,
      monthlyUsd: plan.monthlyUsd,
      rawStatus: String(sub?.status ?? "inactive"),
      paymentState,
      lastPaymentAt: sub?.last_payment_at ? String(sub.last_payment_at) : (userPayments[0]?.at ?? null),
      nextChargeAt,
      squareCustomerId: sub?.square_customer_id ? String(sub.square_customer_id) : null,
      squareSubscriptionId: sub?.square_subscription_id ? String(sub.square_subscription_id) : null,
      failedPayments,
      alerts,
    };
  });

  const stateOrder: Record<PaymentState, number> = { moroso: 0, cancelado: 1, sin_suscripcion: 2, al_dia: 3 };
  rows.sort((a, b) => stateOrder[a.paymentState] - stateOrder[b.paymentState] || a.email.localeCompare(b.email));

  const activeRows = rows.filter((row) => row.paymentState === "al_dia");
  const failed30d = rows.reduce(
    (count, row) =>
      count + row.failedPayments.filter((pay) => now.getTime() - new Date(pay.at).getTime() < 30 * MS_DAY).length,
    0,
  );

  return {
    generatedAt,
    serviceRoleReady: true,
    error: paymentsLoad.error ?? subsResult.error?.message ?? null,
    subscribers: rows,
    metrics: {
      mrr: activeRows.reduce((sum, row) => sum + row.monthlyUsd, 0),
      alDia: activeRows.length,
      morosos: rows.filter((row) => row.paymentState === "moroso").length,
      cancelados: rows.filter((row) => row.paymentState === "cancelado").length,
      sinSuscripcion: rows.filter((row) => row.paymentState === "sin_suscripcion").length,
      failedPayments30d: failed30d,
    },
  };
}

export { formatDate };
