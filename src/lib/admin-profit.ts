import {
  BUSINESS_EXPENSE_CATEGORY_LABELS,
  type BusinessExpenseCategory,
  type BusinessExpenseRow,
} from "@/lib/admin-expenses-shared";
import { getAdminExpensesSnapshot } from "@/lib/admin-expenses";
import { getAdminIncomeSnapshot } from "@/lib/admin-income";
import {
  computeAdminProfit,
  formatProfitMarginPercent,
  formatProfitUsd,
  PROFIT_BACKOFFICE_TIMEZONE,
  type AdminProfitComputed,
  type ProfitOpexCategoryLine,
} from "@/lib/admin-profit-shared";

/** Server-only Founder profit. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("admin-profit is server-only");
}

export type AdminProfitSnapshot = AdminProfitComputed & {
  generatedAt: string;
  serviceRoleReady: boolean;
  error: string | null;
  timeZone: typeof PROFIT_BACKOFFICE_TIMEZONE;
  monthLabel: string;
  isabelaExactAiCostLabel: string;
  mrrNote: string;
};

function buildOtherOpexLines(expenses: BusinessExpenseRow[]): ProfitOpexCategoryLine[] {
  const totals = new Map<BusinessExpenseCategory, number>();
  for (const row of expenses) {
    if (row.category === "payroll" || row.category === "contractor") continue;
    totals.set(row.category, (totals.get(row.category) ?? 0) + row.amountUsd);
  }
  return [...totals.entries()]
    .map(([category, amountUsd]) => ({
      category,
      label: BUSINESS_EXPENSE_CATEGORY_LABELS[category],
      amountUsd,
    }))
    .sort((a, b) => b.amountUsd - a.amountUsd || a.label.localeCompare(b.label));
}

export async function getAdminProfitSnapshot(now = new Date()): Promise<AdminProfitSnapshot> {
  const [income, expenses] = await Promise.all([
    getAdminIncomeSnapshot({ now, transactionFilter: "succeeded" }),
    getAdminExpensesSnapshot(now),
  ]);

  const computed = computeAdminProfit({
    collectedThisMonthUsd: income.collectedThisMonthUsd,
    mrrUsd: income.mrrUsd,
    payrollThisMonthUsd: expenses.payrollThisMonthUsd,
    contractorsThisMonthUsd: expenses.contractorsThisMonthUsd,
    otherOperatingThisMonthUsd: expenses.otherOperatingThisMonthUsd,
    isabelaExactAiCostUsd: expenses.isabelaExactAiCostThisMonthUsd,
    isabelaAiPricingPartial: expenses.isabelaAiPricingPartial,
    otherOpexLines: buildOtherOpexLines(expenses.expenses),
  });

  const errors = [income.error, expenses.error].filter(Boolean);
  return {
    ...computed,
    generatedAt: now.toISOString(),
    serviceRoleReady: income.serviceRoleReady && expenses.serviceRoleReady,
    error: errors.length ? errors.join(" · ") : null,
    timeZone: PROFIT_BACKOFFICE_TIMEZONE,
    monthLabel: income.monthLabel || expenses.monthLabel,
    isabelaExactAiCostLabel: expenses.isabelaExactAiCostLabel,
    mrrNote: income.mrrNote,
  };
}

export {
  computeAdminProfit,
  formatProfitMarginPercent,
  formatProfitUsd,
  PROFIT_BACKOFFICE_TIMEZONE,
};
