import {
  aggregateManualExpensesForMonth,
  expenseMonthDateBounds,
  mapBusinessExpenseRow,
  sanitizeBusinessExpenseInput,
  type BusinessExpenseInput,
  type BusinessExpenseRow,
  EXPENSE_BACKOFFICE_TIMEZONE,
} from "@/lib/admin-expenses-shared";
import { getAiUsageMonthSnapshot } from "@/lib/ai-usage";
import { incomeCalendarMonthUtcBounds } from "@/lib/admin-income";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

/** Server-only Founder expenses. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("admin-expenses is server-only");
}

export type AdminExpensesSnapshot = {
  generatedAt: string;
  serviceRoleReady: boolean;
  error: string | null;
  timeZone: typeof EXPENSE_BACKOFFICE_TIMEZONE;
  monthLabel: string;
  monthYear: number;
  monthNumber: number;
  manualExpensesThisMonthUsd: number;
  payrollThisMonthUsd: number;
  contractorsThisMonthUsd: number;
  otherOperatingThisMonthUsd: number;
  isabelaExactAiCostThisMonthUsd: number | null;
  isabelaExactAiCostLabel: string;
  isabelaAiPricingPartial: boolean;
  isabelaAiPricingNote: string | null;
  expenses: BusinessExpenseRow[];
};

export async function getAdminExpensesSnapshot(now = new Date()): Promise<AdminExpensesSnapshot> {
  const month = incomeCalendarMonthUtcBounds(now, EXPENSE_BACKOFFICE_TIMEZONE);
  const { startDate, endDateExclusive } = expenseMonthDateBounds(month.year, month.month);
  const empty = (extra: Partial<AdminExpensesSnapshot> = {}): AdminExpensesSnapshot => ({
    generatedAt: now.toISOString(),
    serviceRoleReady: false,
    error: null,
    timeZone: EXPENSE_BACKOFFICE_TIMEZONE,
    monthLabel: month.label,
    monthYear: month.year,
    monthNumber: month.month,
    manualExpensesThisMonthUsd: 0,
    payrollThisMonthUsd: 0,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostThisMonthUsd: null,
    isabelaExactAiCostLabel: "—",
    isabelaAiPricingPartial: false,
    isabelaAiPricingNote: null,
    expenses: [],
    ...extra,
  });

  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return empty({
      error: "SUPABASE_SERVICE_ROLE_KEY is not configured. Cannot read business_expenses.",
    });
  }

  const [expensesResult, aiUsage] = await Promise.all([
    admin
      .from("business_expenses")
      .select(
        "id, expense_date, category, vendor, description, amount_usd, currency, recurring, recurrence_note, source, created_by, created_at, updated_at",
      )
      .gte("expense_date", startDate)
      .lt("expense_date", endDateExclusive)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false }),
    getAiUsageMonthSnapshot(now),
  ]);

  if (expensesResult.error) {
    return empty({
      serviceRoleReady: true,
      error: expensesResult.error.message.includes("business_expenses")
        ? "business_expenses table is missing. Apply migration 20260906001500_business_expenses.sql."
        : expensesResult.error.message,
      isabelaExactAiCostThisMonthUsd:
        aiUsage.exactTrackedCostCents == null ? null : aiUsage.exactTrackedCostCents / 100,
      isabelaExactAiCostLabel: aiUsage.exactTrackedCostLabel,
      isabelaAiPricingPartial: aiUsage.totalsArePartial,
      isabelaAiPricingNote: aiUsage.totalsArePartial
        ? "AI cost partially priced — OpenAI (and any other pending) usage awaits exact metering."
        : null,
    });
  }

  const expenses = ((expensesResult.data ?? []) as Record<string, unknown>[])
    .map(mapBusinessExpenseRow)
    .filter((row): row is BusinessExpenseRow => Boolean(row));

  const totals = aggregateManualExpensesForMonth(expenses);
  const exactUsd =
    aiUsage.exactTrackedCostCents == null ? null : aiUsage.exactTrackedCostCents / 100;

  return {
    ...empty({
      serviceRoleReady: true,
      error: aiUsage.error,
      ...totals,
      expenses,
      isabelaExactAiCostThisMonthUsd: exactUsd,
      isabelaExactAiCostLabel: aiUsage.exactTrackedCostLabel,
      isabelaAiPricingPartial: aiUsage.totalsArePartial,
      isabelaAiPricingNote: aiUsage.totalsArePartial
        ? "AI cost partially priced — OpenAI (and any other pending) usage awaits exact metering."
        : null,
    }),
  };
}

export async function createBusinessExpense(input: {
  body: BusinessExpenseInput;
  actorUserId: string;
}): Promise<{ ok: true; row: BusinessExpenseRow } | { ok: false; status: number; error: string }> {
  const parsed = sanitizeBusinessExpenseInput(input.body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return { ok: false, status: 503, error: "Service role unavailable" };
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from("business_expenses")
    .insert({
      ...parsed.row,
      currency: "USD",
      created_by: input.actorUserId,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select(
      "id, expense_date, category, vendor, description, amount_usd, currency, recurring, recurrence_note, source, created_by, created_at, updated_at",
    )
    .single();
  if (error || !data) {
    return {
      ok: false,
      status: 503,
      error: error?.message.includes("business_expenses")
        ? "business_expenses table is missing. Apply the migration."
        : error?.message ?? "Insert failed",
    };
  }
  const row = mapBusinessExpenseRow(data as Record<string, unknown>);
  if (!row) return { ok: false, status: 500, error: "Inserted row unreadable" };
  return { ok: true, row };
}

export async function updateBusinessExpense(input: {
  id: string;
  body: BusinessExpenseInput;
}): Promise<{ ok: true; row: BusinessExpenseRow } | { ok: false; status: number; error: string }> {
  const id = input.id.trim();
  if (!id) return { ok: false, status: 400, error: "id required" };
  const parsed = sanitizeBusinessExpenseInput(input.body);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return { ok: false, status: 503, error: "Service role unavailable" };
  const { data, error } = await admin
    .from("business_expenses")
    .update({
      ...parsed.row,
      currency: "USD",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(
      "id, expense_date, category, vendor, description, amount_usd, currency, recurring, recurrence_note, source, created_by, created_at, updated_at",
    )
    .maybeSingle();
  if (error) return { ok: false, status: 503, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Expense not found" };
  const row = mapBusinessExpenseRow(data as Record<string, unknown>);
  if (!row) return { ok: false, status: 500, error: "Updated row unreadable" };
  return { ok: true, row };
}

export async function deleteBusinessExpense(
  idRaw: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const id = idRaw.trim();
  if (!id) return { ok: false, status: 400, error: "id required" };
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) return { ok: false, status: 503, error: "Service role unavailable" };
  const { data, error } = await admin.from("business_expenses").delete().eq("id", id).select("id").maybeSingle();
  if (error) return { ok: false, status: 503, error: error.message };
  if (!data) return { ok: false, status: 404, error: "Expense not found" };
  return { ok: true };
}

export {
  BUSINESS_EXPENSE_CATEGORIES,
  BUSINESS_EXPENSE_CATEGORY_LABELS,
  formatExpenseUsd,
  sanitizeBusinessExpenseInput,
  aggregateManualExpensesForMonth,
  expenseMonthDateBounds,
  isBusinessExpenseCategory,
  parseExpenseAmountUsd,
  parseExpenseDate,
} from "@/lib/admin-expenses-shared";
