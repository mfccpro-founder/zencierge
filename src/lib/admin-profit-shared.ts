export const PROFIT_BACKOFFICE_TIMEZONE = "America/New_York";

export const PROFIT_PROVISIONAL_RESULT_LABEL = "Subtotal provisional";

export const PROFIT_PROVISIONAL_MARGIN_LABEL = "Margen provisional";

export const PROFIT_PENDING_AI_EXPLANATION = "Faltan costos de IA. Este resultado puede cambiar.";

export type ProfitOpexCategoryLine = {
  category: string;
  label: string;
  amountUsd: number;
};

export type ComputeAdminProfitInput = {
  /** Null when subscription_payments could not be read. */
  collectedThisMonthUsd: number | null;
  /** Null when host_subscriptions could not be read. Not used in the formula. */
  mrrUsd: number | null;
  /** Null when business_expenses could not be read. */
  payrollThisMonthUsd: number | null;
  contractorsThisMonthUsd: number | null;
  otherOperatingThisMonthUsd: number | null;
  /** Tariff-estimate Isabela AI USD, or null when no tariff-priced events this month. */
  isabelaExactAiCostUsd: number | null;
  isabelaAiPricingPartial: boolean;
  /** True when a later TTS page or the safety cap stopped the read. */
  isabelaReadIncomplete?: boolean;
  /** True when the first TTS page failed. Profit and margin stay unavailable. */
  isabelaReadUnavailable?: boolean;
  otherOpexLines?: ProfitOpexCategoryLine[];
};

export type AdminProfitComputed = {
  collectedThisMonthUsd: number | null;
  mrrUsd: number | null;
  payrollThisMonthUsd: number | null;
  contractorsThisMonthUsd: number | null;
  otherOperatingThisMonthUsd: number | null;
  /** AI dollars used in the formula. Null when the TTS read is unavailable. */
  isabelaAiCostUsedUsd: number | null;
  isabelaExactAiCostUsd: number | null;
  isabelaAiPricingPartial: boolean;
  isabelaReadIncomplete: boolean;
  isabelaReadUnavailable: boolean;
  profitIsPartial: boolean;
  profitExactnessLabel: "Exact" | "Partial";
  profitPartialNote: string | null;
  profitUnavailableNote: string | null;
  /** payroll + contractors + other OpEx. Null when the ledger read failed. */
  manualOperatingCostsUsd: number | null;
  /** Null when TTS cost is unavailable, because the total includes that cost. */
  totalOperatingCostsUsd: number | null;
  /** Null when TTS cost is unavailable. */
  netOperatingProfitUsd: number | null;
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
 *   − Isabela estimated tariff COGS (priced portion only; unknown is not $0)
 *
 * Contractors are shown separately but counted once in total costs.
 * AI never comes from business_expenses.
 * MRR is never used in the profit formula.
 */
export function computeAdminProfit(input: ComputeAdminProfitInput): AdminProfitComputed {
  const collectedThisMonthUsd = usdOrNull(input.collectedThisMonthUsd);
  const mrrUsd = usdOrNull(input.mrrUsd);
  const payrollThisMonthUsd = usdOrNull(input.payrollThisMonthUsd);
  const contractorsThisMonthUsd = usdOrNull(input.contractorsThisMonthUsd);
  const otherOperatingThisMonthUsd = usdOrNull(input.otherOperatingThisMonthUsd);
  const isabelaExactAiCostUsd =
    input.isabelaExactAiCostUsd == null ? null : roundUsd(input.isabelaExactAiCostUsd);
  const pricingPartial = input.isabelaAiPricingPartial === true;
  const readIncomplete = input.isabelaReadIncomplete === true;
  const readUnavailable = input.isabelaReadUnavailable === true;
  const incomeMissing = collectedThisMonthUsd == null;
  const expensesMissing =
    payrollThisMonthUsd == null || contractorsThisMonthUsd == null || otherOperatingThisMonthUsd == null;
  const sourcesMissing = incomeMissing || expensesMissing || readUnavailable;
  const isabelaAiCostUsedUsd = readUnavailable ? null : (isabelaExactAiCostUsd ?? 0);
  const profitIsPartial = !sourcesMissing && (pricingPartial || readIncomplete);
  const partialNotes: string[] = [];
  if (profitIsPartial && pricingPartial) {
    partialNotes.push(PROFIT_PENDING_AI_EXPLANATION);
  }
  if (profitIsPartial && readIncomplete) {
    partialNotes.push("TTS usage read is incomplete — Net Operating Profit is not a complete month total.");
  }
  const manualOperatingCostsUsd =
    payrollThisMonthUsd == null || contractorsThisMonthUsd == null || otherOperatingThisMonthUsd == null
      ? null
      : roundUsd(payrollThisMonthUsd + contractorsThisMonthUsd + otherOperatingThisMonthUsd);
  const totalOperatingCostsUsd =
    manualOperatingCostsUsd == null || isabelaAiCostUsedUsd == null
      ? null
      : roundUsd(manualOperatingCostsUsd + isabelaAiCostUsedUsd);
  const netOperatingProfitUsd =
    collectedThisMonthUsd == null || totalOperatingCostsUsd == null
      ? null
      : roundUsd(collectedThisMonthUsd - totalOperatingCostsUsd);
  const operatingMarginPercent =
    netOperatingProfitUsd != null && collectedThisMonthUsd != null && collectedThisMonthUsd > 0
      ? Math.round((netOperatingProfitUsd / collectedThisMonthUsd) * 10000) / 100
      : null;
  const unavailableNotes: string[] = [];
  if (readUnavailable) {
    unavailableNotes.push(
      "TTS usage is unavailable. Net Operating Profit and margin are not calculated, and the missing AI cost is not treated as $0.",
    );
  }
  if (incomeMissing || expensesMissing) {
    unavailableNotes.push(
      "Collected income or operating expenses are unavailable. Net Operating Profit and margin are not calculated, and a missing amount is not treated as $0.",
    );
  }

  return {
    collectedThisMonthUsd,
    mrrUsd,
    payrollThisMonthUsd,
    contractorsThisMonthUsd,
    otherOperatingThisMonthUsd,
    isabelaAiCostUsedUsd,
    isabelaExactAiCostUsd,
    isabelaAiPricingPartial: pricingPartial,
    isabelaReadIncomplete: readIncomplete,
    isabelaReadUnavailable: readUnavailable,
    profitIsPartial,
    profitExactnessLabel: profitIsPartial ? "Partial" : "Exact",
    profitPartialNote: partialNotes.length ? partialNotes.join(" ") : null,
    profitUnavailableNote: unavailableNotes.length ? unavailableNotes.join(" ") : null,
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

export const PROFIT_UNAVAILABLE_LABEL = "— / No disponible";

/** Pending-only TTS stays "— · Partial". A valid month with no events stays $0.00. */
export function presentIsabelaAiCost(input: {
  readUnavailable: boolean;
  pricingPartial: boolean;
  profitPartial: boolean;
  exactAiCostUsd: number | null;
  exactAiCostLabel: string;
}): string {
  if (input.readUnavailable) return PROFIT_UNAVAILABLE_LABEL;
  if (input.pricingPartial && input.exactAiCostUsd == null) return "— · Partial";
  if (input.pricingPartial || input.profitPartial) {
    return input.exactAiCostLabel === "—" ? "— · Partial" : `${input.exactAiCostLabel} · Partial`;
  }
  if (input.exactAiCostUsd == null) return formatProfitUsd(0);
  return input.exactAiCostLabel;
}

export function presentProfitAmount(input: {
  unavailable: boolean;
  partial: boolean;
  amount: number | null;
}): string {
  if (input.unavailable || input.amount == null) return PROFIT_UNAVAILABLE_LABEL;
  const formatted = formatProfitUsd(input.amount);
  return input.partial ? `${formatted} · Partial` : formatted;
}

export function presentProfitMargin(input: {
  unavailable: boolean;
  partial: boolean;
  margin: number | null;
}): string {
  if (input.unavailable) return PROFIT_UNAVAILABLE_LABEL;
  const formatted = formatProfitMarginPercent(input.margin);
  if (input.partial && input.margin != null) return `${formatted} · Partial`;
  return formatted;
}

/**
 * Pending AI cost is a provisional subtotal. A failed read stays unavailable.
 * A finished month with known cost, including a valid zero, stays Net Operating Profit.
 */
export function presentOperatingResult(input: {
  unavailable: boolean;
  pricingPartial: boolean;
  readIncomplete: boolean;
  amount: number | null;
}): { label: string; value: string } {
  if (input.unavailable || input.amount == null) {
    return { label: "Net Operating Profit", value: PROFIT_UNAVAILABLE_LABEL };
  }
  if (input.pricingPartial) {
    return { label: PROFIT_PROVISIONAL_RESULT_LABEL, value: formatProfitUsd(input.amount) };
  }
  if (input.readIncomplete) {
    return { label: "Net Operating Profit (Partial)", value: `${formatProfitUsd(input.amount)} · Partial` };
  }
  return { label: "Net Operating Profit", value: formatProfitUsd(input.amount) };
}

/** Pending AI cost marks the margin provisional. A null margin stays a dash, not No disponible. */
export function presentOperatingMargin(input: {
  unavailable: boolean;
  pricingPartial: boolean;
  readIncomplete: boolean;
  margin: number | null;
}): { label: string; value: string } {
  if (input.unavailable) {
    return { label: "Operating Margin %", value: PROFIT_UNAVAILABLE_LABEL };
  }
  const formatted = formatProfitMarginPercent(input.margin);
  if (input.pricingPartial) {
    return { label: PROFIT_PROVISIONAL_MARGIN_LABEL, value: formatted };
  }
  if (input.readIncomplete && input.margin != null) {
    return { label: "Operating Margin %", value: `${formatted} · Partial` };
  }
  return { label: "Operating Margin %", value: formatted };
}

export function formatProfitMarginPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function usdOrNull(value: number | null): number | null {
  if (value == null) return null;
  return roundUsd(value);
}

function roundUsd(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
