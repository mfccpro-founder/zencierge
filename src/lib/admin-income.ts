import { getAdminBillingSnapshot, formatDate } from "@/lib/admin-billing";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";
import {
  parsePlanId,
  planFromUsdAmount,
  ZENCIERGE_PLANS,
  type ZenciergePlanId,
} from "@/lib/zencierge-plans";

/** Server-only Founder Income. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("admin-income is server-only");
}

export const INCOME_BACKOFFICE_TIMEZONE = "America/New_York";
export const INCOME_TREND_MONTHS = 12;

export type IncomePaymentStatus = "succeeded" | "failed" | "refunded" | "other";

export type AdminIncomeTransaction = {
  id: string;
  at: string;
  dateLabel: string;
  customerLabel: string;
  customerLinked: boolean;
  planId: string | null;
  planLabel: string;
  amountUsd: number;
  status: IncomePaymentStatus;
  statusRaw: string;
  providerPaymentId: string | null;
};

export type AdminIncomePlanRevenue = {
  planId: string;
  planName: string;
  amountUsd: number;
  paymentCount: number;
};

export type AdminIncomeMonthPoint = {
  year: number;
  month: number;
  label: string;
  startUtc: string;
  endUtc: string;
  collectedUsd: number;
  succeededCount: number;
};

export type AdminIncomeSnapshot = {
  generatedAt: string;
  serviceRoleReady: boolean;
  error: string | null;
  timeZone: typeof INCOME_BACKOFFICE_TIMEZONE;
  monthLabel: string;
  ytdLabel: string;
  rangeMonthStartUtc: string;
  rangeMonthEndUtc: string;
  rangeYtdStartUtc: string;
  rangeYtdEndUtc: string;
  collectedThisMonthUsd: number;
  collectedYtdUsd: number;
  mrrUsd: number;
  mrrNote: "Recurring run-rate — not cash collected";
  successfulPaymentsThisMonth: number;
  failedPaymentsThisMonth: number;
  revenueByPlan: AdminIncomePlanRevenue[];
  monthlyTrend: AdminIncomeMonthPoint[];
  transactions: AdminIncomeTransaction[];
  transactionFilter: "succeeded" | "failed" | "all";
};

type NormalizedPayment = {
  id: string;
  userId: string | null;
  hostEmail: string | null;
  amountUsd: number;
  planIdRaw: string | null;
  status: IncomePaymentStatus;
  statusRaw: string;
  providerPaymentId: string | null;
  at: string;
};

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
) {
  const zone = timeZone.trim() || "UTC";
  let utc = Date.UTC(year, month - 1, day, hours, minutes, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(utc));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    let localHour = read("hour");
    if (localHour === 24) localHour = 0;
    const asIfUtc = Date.UTC(read("year"), read("month") - 1, read("day"), localHour, read("minute"));
    const wanted = Date.UTC(year, month - 1, day, hours, minutes);
    utc += wanted - asIfUtc;
  }
  return new Date(utc);
}

export function incomeCalendarMonthUtcBounds(
  now = new Date(),
  timeZone = INCOME_BACKOFFICE_TIMEZONE,
): { startUtc: Date; endUtc: Date; year: number; month: number; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startUtc = zonedLocalToUtc(year, month, 1, 0, 0, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endUtc = zonedLocalToUtc(nextYear, nextMonth, 1, 0, 0, timeZone);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(startUtc);
  return { startUtc, endUtc, year, month, label };
}

export function incomeYtdUtcBounds(
  now = new Date(),
  timeZone = INCOME_BACKOFFICE_TIMEZONE,
): { startUtc: Date; endUtc: Date; year: number; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const startUtc = zonedLocalToUtc(year, 1, 1, 0, 0, timeZone);
  const endUtc = zonedLocalToUtc(year + 1, 1, 1, 0, 0, timeZone);
  return { startUtc, endUtc, year, label: String(year) };
}

export function incomeTrendMonthBounds(
  now = new Date(),
  months = INCOME_TREND_MONTHS,
  timeZone = INCOME_BACKOFFICE_TIMEZONE,
): AdminIncomeMonthPoint[] {
  const current = incomeCalendarMonthUtcBounds(now, timeZone);
  const points: AdminIncomeMonthPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    let year = current.year;
    let month = current.month - i;
    while (month <= 0) {
      month += 12;
      year -= 1;
    }
    const startUtc = zonedLocalToUtc(year, month, 1, 0, 0, timeZone);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const endUtc = zonedLocalToUtc(nextYear, nextMonth, 1, 0, 0, timeZone);
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      year: "numeric",
    }).format(startUtc);
    points.push({
      year,
      month,
      label,
      startUtc: startUtc.toISOString(),
      endUtc: endUtc.toISOString(),
      collectedUsd: 0,
      succeededCount: 0,
    });
  }
  return points;
}

export function normalizeIncomePaymentStatus(raw: string | null | undefined): IncomePaymentStatus {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "succeeded" || value === "success" || value === "paid") return "succeeded";
  if (/fail|declin|past_due/.test(value)) return "failed";
  if (value === "refunded" || value === "refund") return "refunded";
  return "other";
}

export function resolveIncomePlanLabel(input: {
  planId?: string | null;
  amountUsd: number;
}): { planId: string | null; planLabel: string } {
  const parsed = parsePlanId(input.planId);
  if (parsed) {
    return { planId: parsed, planLabel: ZENCIERGE_PLANS[parsed].name };
  }
  if (Number.isFinite(input.amountUsd) && input.amountUsd > 0) {
    const fromAmount = planFromUsdAmount(input.amountUsd) as ZenciergePlanId;
    return { planId: fromAmount, planLabel: ZENCIERGE_PLANS[fromAmount].name };
  }
  return { planId: null, planLabel: "Unknown" };
}

export function formatIncomeUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function asAmount(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeIncomeProviderPaymentId(
  row: Record<string, unknown>,
): string | null {
  const canonical =
    typeof row.provider_payment_id === "string"
      ? row.provider_payment_id.trim()
      : "";
  if (canonical) return canonical;

  const legacy =
    typeof row.gateway_payment_id === "string"
      ? row.gateway_payment_id.trim()
      : "";
  return legacy || null;
}

function normalizePaymentRow(row: Record<string, unknown>): NormalizedPayment | null {
  const id = typeof row.id === "string" ? row.id : row.id != null ? String(row.id) : "";
  if (!id) return null;
  const atRaw = row.created_at ?? row.paid_at;
  const at = typeof atRaw === "string" && atRaw.trim() ? atRaw : null;
  if (!at || Number.isNaN(Date.parse(at))) return null;
  const statusRaw = String(row.status ?? row.payment_status ?? "");
  return {
    id,
    userId: typeof row.user_id === "string" && row.user_id.trim() ? row.user_id.trim() : null,
    hostEmail:
      typeof row.host_email === "string" && row.host_email.trim()
        ? row.host_email.trim().toLowerCase()
        : null,
    amountUsd: asAmount(row.amount_usd ?? row.amount_paid),
    planIdRaw: typeof row.plan_id === "string" && row.plan_id.trim() ? row.plan_id.trim() : null,
    status: normalizeIncomePaymentStatus(statusRaw),
    statusRaw,
    providerPaymentId: normalizeIncomeProviderPaymentId(row),
    at,
  };
}

type AdminClient = NonNullable<ReturnType<typeof tryCreateSupabaseAdminClient>>;

async function loadPaymentsInRange(
  admin: AdminClient,
  fromIso: string,
  toIso: string,
): Promise<{ rows: NormalizedPayment[]; error: string | null }> {
  const attempts = [
    {
      columns:
        "id, user_id, host_email, amount_usd, amount_paid, plan_id, status, payment_status, provider_payment_id, gateway_payment_id, created_at, paid_at",
      order: "created_at",
      fromCol: "created_at",
    },
    {
      columns: "id, user_id, host_email, amount_usd, plan_id, status, provider_payment_id, created_at",
      order: "created_at",
      fromCol: "created_at",
    },
    {
      columns: "id, user_id, amount_usd, plan_id, status, provider_payment_id, created_at",
      order: "created_at",
      fromCol: "created_at",
    },
    {
      columns: "id, user_id, host_email, amount_paid, plan_id, payment_status, provider_payment_id, paid_at",
      order: "paid_at",
      fromCol: "paid_at",
    },
    {
      columns: "id, user_id, amount_usd, status, created_at",
      order: "created_at",
      fromCol: "created_at",
    },
  ];

  let lastError: string | null = null;
  for (const attempt of attempts) {
    const pageSize = 1000;
    const all: Record<string, unknown>[] = [];
    let from = 0;
    let schemaOk = true;
    while (true) {
      const { data, error } = await admin
        .from("subscription_payments")
        .select(attempt.columns)
        .gte(attempt.fromCol, fromIso)
        .lt(attempt.fromCol, toIso)
        .order(attempt.order, { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) {
        lastError = error.message;
        if (/column|schema cache|does not exist/i.test(error.message)) {
          schemaOk = false;
          break;
        }
        return { rows: [], error: lastError };
      }
      const batch = (data ?? []) as unknown as Record<string, unknown>[];
      all.push(...batch);
      if (batch.length < pageSize) break;
      from += pageSize;
      if (from > 50_000) break;
    }
    if (!schemaOk) continue;
    return {
      rows: all.map(normalizePaymentRow).filter((row): row is NormalizedPayment => Boolean(row)),
      error: null,
    };
  }
  return { rows: [], error: lastError };
}

export function aggregateIncomePayments(input: {
  payments: NormalizedPayment[];
  monthStartUtc: Date;
  monthEndUtc: Date;
  ytdStartUtc: Date;
  ytdEndUtc: Date;
  trend: AdminIncomeMonthPoint[];
  customerByUserId: Map<string, { email: string; fullName: string | null }>;
  transactionFilter: "succeeded" | "failed" | "all";
}): Pick<
  AdminIncomeSnapshot,
  | "collectedThisMonthUsd"
  | "collectedYtdUsd"
  | "successfulPaymentsThisMonth"
  | "failedPaymentsThisMonth"
  | "revenueByPlan"
  | "monthlyTrend"
  | "transactions"
> {
  const monthStart = input.monthStartUtc.getTime();
  const monthEnd = input.monthEndUtc.getTime();
  const ytdStart = input.ytdStartUtc.getTime();
  const ytdEnd = input.ytdEndUtc.getTime();

  let collectedThisMonthUsd = 0;
  let collectedYtdUsd = 0;
  let successfulPaymentsThisMonth = 0;
  let failedPaymentsThisMonth = 0;
  const planMap = new Map<string, AdminIncomePlanRevenue>();
  const trend = input.trend.map((point) => ({ ...point }));

  const transactions: AdminIncomeTransaction[] = [];

  for (const pay of input.payments) {
    const t = Date.parse(pay.at);
    if (!Number.isFinite(t)) continue;
    const inMonth = t >= monthStart && t < monthEnd;
    const inYtd = t >= ytdStart && t < ytdEnd;
    const plan = resolveIncomePlanLabel({ planId: pay.planIdRaw, amountUsd: pay.amountUsd });

    if (pay.status === "succeeded") {
      if (inMonth) {
        collectedThisMonthUsd += pay.amountUsd;
        successfulPaymentsThisMonth += 1;
      }
      if (inYtd) {
        collectedYtdUsd += pay.amountUsd;
        const key = plan.planId ?? "unknown";
        const existing = planMap.get(key) ?? {
          planId: key,
          planName: plan.planLabel,
          amountUsd: 0,
          paymentCount: 0,
        };
        existing.amountUsd += pay.amountUsd;
        existing.paymentCount += 1;
        planMap.set(key, existing);
      }
      for (const point of trend) {
        const start = Date.parse(point.startUtc);
        const end = Date.parse(point.endUtc);
        if (t >= start && t < end) {
          point.collectedUsd += pay.amountUsd;
          point.succeededCount += 1;
        }
      }
    } else if (pay.status === "failed" && inMonth) {
      failedPaymentsThisMonth += 1;
    }

    const include =
      input.transactionFilter === "all" ||
      (input.transactionFilter === "succeeded" && pay.status === "succeeded") ||
      (input.transactionFilter === "failed" && pay.status === "failed");
    if (!include) continue;

    const customer = pay.userId ? input.customerByUserId.get(pay.userId) : undefined;
    const email = customer?.email || pay.hostEmail;
    const name = customer?.fullName;
    let customerLabel: string;
    let customerLinked = Boolean(pay.userId && customer);
    if (name && email) customerLabel = `${name} · ${email}`;
    else if (email) customerLabel = email;
    else if (pay.userId) {
      customerLabel = `Unlinked user ${pay.userId.slice(0, 8)}…`;
      customerLinked = false;
    } else {
      customerLabel = "Unlinked payment";
      customerLinked = false;
    }

    transactions.push({
      id: pay.id,
      at: pay.at,
      dateLabel: formatDate(pay.at),
      customerLabel,
      customerLinked,
      planId: plan.planId,
      planLabel: plan.planLabel,
      amountUsd: pay.amountUsd,
      status: pay.status,
      statusRaw: pay.statusRaw,
      providerPaymentId: pay.providerPaymentId,
    });
  }

  transactions.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  return {
    collectedThisMonthUsd,
    collectedYtdUsd,
    successfulPaymentsThisMonth,
    failedPaymentsThisMonth,
    revenueByPlan: [...planMap.values()].sort(
      (a, b) => b.amountUsd - a.amountUsd || a.planName.localeCompare(b.planName),
    ),
    monthlyTrend: trend,
    transactions,
  };
}

export async function getAdminIncomeSnapshot(input?: {
  now?: Date;
  transactionFilter?: "succeeded" | "failed" | "all";
}): Promise<AdminIncomeSnapshot> {
  const now = input?.now ?? new Date();
  const transactionFilter = input?.transactionFilter ?? "succeeded";
  const month = incomeCalendarMonthUtcBounds(now);
  const ytd = incomeYtdUtcBounds(now);
  const trendTemplate = incomeTrendMonthBounds(now, INCOME_TREND_MONTHS);
  const trendStartIso = trendTemplate[0]?.startUtc ?? ytd.startUtc.toISOString();
  const rangeEndIso = month.endUtc.toISOString();

  const empty = (extra: Partial<AdminIncomeSnapshot> = {}): AdminIncomeSnapshot => ({
    generatedAt: now.toISOString(),
    serviceRoleReady: false,
    error: null,
    timeZone: INCOME_BACKOFFICE_TIMEZONE,
    monthLabel: month.label,
    ytdLabel: ytd.label,
    rangeMonthStartUtc: month.startUtc.toISOString(),
    rangeMonthEndUtc: month.endUtc.toISOString(),
    rangeYtdStartUtc: ytd.startUtc.toISOString(),
    rangeYtdEndUtc: ytd.endUtc.toISOString(),
    collectedThisMonthUsd: 0,
    collectedYtdUsd: 0,
    mrrUsd: 0,
    mrrNote: "Recurring run-rate — not cash collected",
    successfulPaymentsThisMonth: 0,
    failedPaymentsThisMonth: 0,
    revenueByPlan: [],
    monthlyTrend: trendTemplate,
    transactions: [],
    transactionFilter,
    ...extra,
  });

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return empty({
      error: "SUPABASE_SERVICE_ROLE_KEY is not configured. Cannot read subscription_payments.",
    });
  }

  const [billing, paymentsLoad] = await Promise.all([
    getAdminBillingSnapshot(),
    loadPaymentsInRange(admin, trendStartIso, rangeEndIso),
  ]);

  if (paymentsLoad.error && paymentsLoad.rows.length === 0) {
    return empty({
      serviceRoleReady: true,
      error: paymentsLoad.error.includes("subscription_payments")
        ? "subscription_payments is missing or unreadable."
        : paymentsLoad.error,
      mrrUsd: billing.metrics.mrr,
    });
  }

  const customerByUserId = new Map<string, { email: string; fullName: string | null }>();
  for (const row of billing.subscribers) {
    customerByUserId.set(row.userId, { email: row.email, fullName: row.fullName });
  }

  const aggregated = aggregateIncomePayments({
    payments: paymentsLoad.rows,
    monthStartUtc: month.startUtc,
    monthEndUtc: month.endUtc,
    ytdStartUtc: ytd.startUtc,
    ytdEndUtc: ytd.endUtc,
    trend: trendTemplate,
    customerByUserId,
    transactionFilter,
  });

  return {
    ...empty({
      serviceRoleReady: true,
      error: paymentsLoad.error ?? billing.error,
      mrrUsd: billing.metrics.mrr,
    }),
    ...aggregated,
  };
}

export { formatDate as formatIncomeDate };
