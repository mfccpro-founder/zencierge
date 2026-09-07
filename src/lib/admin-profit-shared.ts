export const PROFIT_BACKOFFICE_TIMEZONE = "America/New_York";

export type ProfitOpexCategoryLine = {
  category: string;
  label: string;
  amountUsd: number;
};

export type ComputeAdminProfitInput = {
  collectedThisMonthUsd: number;
  mrrUsd: number;
  payrollThisMonthUsd: number;
  contractorsThisMonthUsd: number;
  otherOperatingThisMonthUsd: number;
  /** Exact Isabela AI USD, or null when no exact-priced events this month. */
  isabelaExactAiCostUsd: number | null;
  isabelaAiPricingPartial: boolean;
  otherOpexLines?: ProfitOpexCategoryLine[];
};

export type AdminProfitComputed = {
  collectedThisMonthUsd: number;
  mrrUsd: number;
  payrollThisMonthUsd: number;
  contractorsThisMonthUsd: number;
  otherOperatingThisMonthUsd: number;
  /** AI dollars used in the formula (exact tracked portion only; 0 when none exact). */
  isabelaAiCostUsedUsd: number;
  isabelaExactAiCostUsd: number | null;
  isabelaAiPricingPartial: boolean;
  profitIsPartial: boolean;
  profitExactnessLabel: "Exact" | "Partial";
  profitPartialNote: string | null;
  /** payroll + contractors + other OpEx (manual ledger once each). */
  manualOperatingCostsUsd: number;
  /** manual OpEx + exact Isabela AI portion. */
  totalOperatingCostsUsd: number;
  netOperatingProfitUsd: number;
  /** null when collected is 0. */
  operatingMarginPercent: number | null;
  otherOpexLines: ProfitOpexCategoryLine[];
};

/**
 * Net Operating Profit =
 *   Collected Income
 *   − Payroll
 *   − Contractors
 *   − Other Operating Expenses
 *   − Isabela exact AI COGS (tracked portion only)
 *
 * Contractors are shown separately but counted once in total costs.
 * AI never comes from business_expenses.
 * MRR is never used in the profit formula.
 */
export function computeAdminProfit(input: ComputeAdminProfitInput): AdminProfitComputed {
  const collectedThisMonthUsd = roundUsd(input.collectedThisMonthUsd);
  const mrrUsd = roundUsd(input.mrrUsd);
  const payrollThisMonthUsd = roundUsd(input.payrollThisMonthUsd);
  const contractorsThisMonthUsd = roundUsd(input.contractorsThisMonthUsd);
  const otherOperatingThisMonthUsd = roundUsd(input.otherOperatingThisMonthUsd);
  const isabelaExactAiCostUsd =
    input.isabelaExactAiCostUsd == null ? null : roundUsd(input.isabelaExactAiCostUsd);
  const isabelaAiCostUsedUsd = isabelaExactAiCostUsd ?? 0;
  const profitIsPartial = input.isabelaAiPricingPartial === true;
  const manualOperatingCostsUsd = roundUsd(
    payrollThisMonthUsd + contractorsThisMonthUsd + otherOperatingThisMonthUsd,
  );
  const totalOperatingCostsUsd = roundUsd(manualOperatingCostsUsd + isabelaAiCostUsedUsd);
  const netOperatingProfitUsd = roundUsd(collectedThisMonthUsd - totalOperatingCostsUsd);
  const operatingMarginPercent =
    collectedThisMonthUsd > 0
      ? Math.round((netOperatingProfitUsd / collectedThisMonthUsd) * 10000) / 100
      : null;

  return {
    collectedThisMonthUsd,
    mrrUsd,
    payrollThisMonthUsd,
    contractorsThisMonthUsd,
    otherOperatingThisMonthUsd,
    isabelaAiCostUsedUsd,
    isabelaExactAiCostUsd,
    isabelaAiPricingPartial: profitIsPartial,
    profitIsPartial,
    profitExactnessLabel: profitIsPartial ? "Partial" : "Exact",
    profitPartialNote: profitIsPartial
      ? "Pending full AI pricing — Net Operating Profit and margin use exact tracked Isabela cost only; unpriced usage is not treated as $0."
      : null,
    manualOperatingCostsUsd,
    totalOperatingCostsUsd,
    netOperatingProfitUsd,
    operatingMarginPercent,
    otherOpexLines: (input.otherOpexLines ?? []).map((line) => ({
      ...line,
      amountUsd: roundUsd(line.amountUsd),
    })),
  };
}

export function formatProfitUsd(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (amount < 0) return `-$${formatted}`;
  return `$${formatted}`;
}

export function formatProfitMarginPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function roundUsd(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
