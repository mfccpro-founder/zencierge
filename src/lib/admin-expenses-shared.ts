export const EXPENSE_BACKOFFICE_TIMEZONE = "America/New_York";

export const BUSINESS_EXPENSE_CATEGORIES = [
  "payroll",
  "contractor",
  "hosting",
  "software",
  "payment_processing",
  "marketing",
  "legal_accounting",
  "other",
] as const;

export type BusinessExpenseCategory = (typeof BUSINESS_EXPENSE_CATEGORIES)[number];

export const BUSINESS_EXPENSE_CATEGORY_LABELS: Record<BusinessExpenseCategory, string> = {
  payroll: "Payroll",
  contractor: "Contractor",
  hosting: "Hosting",
  software: "Software",
  payment_processing: "Payment Processing",
  marketing: "Marketing",
  legal_accounting: "Legal / Accounting",
  other: "Other",
};

export type BusinessExpenseRow = {
  id: string;
  expenseDate: string;
  category: BusinessExpenseCategory;
  categoryLabel: string;
  vendor: string;
  description: string;
  amountUsd: number;
  currency: string;
  recurring: boolean;
  recurrenceNote: string | null;
  source: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BusinessExpenseInput = {
  expenseDate: unknown;
  category: unknown;
  vendor: unknown;
  description?: unknown;
  amountUsd: unknown;
  recurring?: unknown;
  recurrenceNote?: unknown;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isBusinessExpenseCategory(value: unknown): value is BusinessExpenseCategory {
  return typeof value === "string" && (BUSINESS_EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function parseExpenseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = DATE_RE.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return trimmed;
}

export function parseExpenseAmountUsd(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function sanitizeBusinessExpenseInput(input: BusinessExpenseInput):
  | {
      ok: true;
      row: {
        expense_date: string;
        category: BusinessExpenseCategory;
        vendor: string;
        description: string;
        amount_usd: number;
        recurring: boolean;
        recurrence_note: string | null;
        source: "manual";
      };
    }
  | { ok: false; error: string } {
  const expenseDate = parseExpenseDate(input.expenseDate);
  if (!expenseDate) return { ok: false, error: "expense_date must be YYYY-MM-DD" };
  if (!isBusinessExpenseCategory(input.category)) {
    return { ok: false, error: "category is invalid" };
  }
  const vendor = typeof input.vendor === "string" ? input.vendor.trim() : "";
  if (!vendor || vendor.length > 200) return { ok: false, error: "vendor is required" };
  const description =
    typeof input.description === "string" ? input.description.trim().slice(0, 2000) : "";
  const amountUsd = parseExpenseAmountUsd(input.amountUsd);
  if (amountUsd == null) return { ok: false, error: "amount_usd must be greater than 0" };
  const recurring = Boolean(input.recurring);
  const recurrenceNoteRaw =
    typeof input.recurrenceNote === "string" ? input.recurrenceNote.trim().slice(0, 200) : "";
  return {
    ok: true,
    row: {
      expense_date: expenseDate,
      category: input.category,
      vendor,
      description,
      amount_usd: amountUsd,
      recurring,
      recurrence_note: recurring && recurrenceNoteRaw ? recurrenceNoteRaw : null,
      source: "manual",
    },
  };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function expenseMonthDateBounds(
  year: number,
  month: number,
): { startDate: string; endDateExclusive: string } {
  const startDate = `${year}-${pad2(month)}-01`;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return { startDate, endDateExclusive: `${nextYear}-${pad2(nextMonth)}-01` };
}

export function mapBusinessExpenseRow(row: Record<string, unknown>): BusinessExpenseRow | null {
  const id = typeof row.id === "string" ? row.id : null;
  const expenseDate = typeof row.expense_date === "string" ? row.expense_date.slice(0, 10) : null;
  if (!id || !expenseDate || !isBusinessExpenseCategory(row.category)) return null;
  const amount = Number(row.amount_usd);
  if (!Number.isFinite(amount)) return null;
  return {
    id,
    expenseDate,
    category: row.category,
    categoryLabel: BUSINESS_EXPENSE_CATEGORY_LABELS[row.category],
    vendor: typeof row.vendor === "string" ? row.vendor : "",
    description: typeof row.description === "string" ? row.description : "",
    amountUsd: amount,
    currency: typeof row.currency === "string" ? row.currency : "USD",
    recurring: row.recurring === true,
    recurrenceNote: typeof row.recurrence_note === "string" ? row.recurrence_note : null,
    source: typeof row.source === "string" ? row.source : "manual",
    createdBy: typeof row.created_by === "string" ? row.created_by : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

export function aggregateManualExpensesForMonth(rows: BusinessExpenseRow[]) {
  let manualExpensesThisMonthUsd = 0;
  let payrollThisMonthUsd = 0;
  let contractorsThisMonthUsd = 0;
  let otherOperatingThisMonthUsd = 0;
  for (const row of rows) {
    manualExpensesThisMonthUsd += row.amountUsd;
    if (row.category === "payroll") payrollThisMonthUsd += row.amountUsd;
    else if (row.category === "contractor") contractorsThisMonthUsd += row.amountUsd;
    else otherOperatingThisMonthUsd += row.amountUsd;
  }
  return {
    manualExpensesThisMonthUsd,
    payrollThisMonthUsd,
    contractorsThisMonthUsd,
    otherOperatingThisMonthUsd,
  };
}

export function formatExpenseUsd(amount: number): string {
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
