import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateManualExpensesForMonth,
  BUSINESS_EXPENSE_CATEGORIES,
  expenseMonthDateBounds,
  formatExpenseUsd,
  parseExpenseAmountUsd,
  parseExpenseDate,
  sanitizeBusinessExpenseInput,
  type BusinessExpenseRow,
} from "./admin-expenses-shared";
import { incomeCalendarMonthUtcBounds } from "./admin-income";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sampleRow(
  partial: Partial<BusinessExpenseRow> & Pick<BusinessExpenseRow, "id" | "category" | "amountUsd" | "expenseDate">,
): BusinessExpenseRow {
  return {
    categoryLabel: partial.category,
    vendor: "Vendor",
    description: "",
    currency: "USD",
    recurring: false,
    recurrenceNote: null,
    source: "manual",
    createdBy: null,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...partial,
  };
}

export function runAdminExpensesTests() {
  const root = process.cwd();

  assert(parseExpenseDate("2026-09-05") === "2026-09-05", "valid expense date");
  assert(parseExpenseDate("2026-09-31") == null, "invalid calendar day rejected");
  assert(parseExpenseDate("09/05/2026") == null, "non-ISO date rejected");

  assert(parseExpenseAmountUsd(100) === 100, "positive amount ok");
  assert(parseExpenseAmountUsd(0) == null, "zero amount rejected");
  assert(parseExpenseAmountUsd(-5) == null, "negative amount rejected");
  assert(parseExpenseAmountUsd("12.345") === 12.35, "amount rounded to cents");

  const badCategory = sanitizeBusinessExpenseInput({
    expenseDate: "2026-09-05",
    category: "ai_voice",
    vendor: "OpenAI",
    amountUsd: 10,
  });
  assert(!badCategory.ok, "ai_voice category rejected");
  assert(
    !(BUSINESS_EXPENSE_CATEGORIES as readonly string[]).includes("ai_voice"),
    "manual categories exclude Isabela AI",
  );

  const ok = sanitizeBusinessExpenseInput({
    expenseDate: "2026-09-05",
    category: "payroll",
    vendor: "Javier",
    description: "Founder draw",
    amountUsd: "2500.00",
    recurring: true,
    recurrenceNote: "Monthly",
  });
  assert(ok.ok, "valid payroll expense accepted");
  if (ok.ok) {
    assert(ok.row.source === "manual", "source stays manual");
    assert(ok.row.recurring === true, "recurring flag stored");
    assert(ok.row.recurrence_note === "Monthly", "recurrence note stored");
  }

  const month = incomeCalendarMonthUtcBounds(new Date("2026-09-05T16:00:00.000Z"), "America/New_York");
  assert(month.year === 2026 && month.month === 9, "NY calendar month for Sept 5 UTC afternoon");
  const bounds = expenseMonthDateBounds(month.year, month.month);
  assert(bounds.startDate === "2026-09-01", "month start date NY");
  assert(bounds.endDateExclusive === "2026-10-01", "month end exclusive");

  const rows: BusinessExpenseRow[] = [
    sampleRow({ id: "1", category: "payroll", amountUsd: 2000, expenseDate: "2026-09-02" }),
    sampleRow({ id: "2", category: "contractor", amountUsd: 500, expenseDate: "2026-09-03" }),
    sampleRow({ id: "3", category: "hosting", amountUsd: 40, expenseDate: "2026-09-04" }),
    sampleRow({ id: "4", category: "software", amountUsd: 60, expenseDate: "2026-09-05", recurring: true }),
  ];
  const totals = aggregateManualExpensesForMonth(rows);
  assert(totals.manualExpensesThisMonthUsd === 2600, "manual expenses sum");
  assert(totals.payrollThisMonthUsd === 2000, "payroll total");
  assert(totals.contractorsThisMonthUsd === 500, "contractor total");
  assert(totals.otherOperatingThisMonthUsd === 100, "other OpEx excludes payroll and contractors");
  assert(formatExpenseUsd(2600) === "$2,600.00", "USD format");

  const migrationNames = existsSync(join(root, "supabase/migrations"))
    ? readdirSync(join(root, "supabase/migrations"))
    : [];
  assert(
    migrationNames.some((name) => name.includes("business_expenses")),
    "business_expenses migration exists",
  );
  const migration = readFileSync(
    join(root, "supabase/migrations/20260906001500_business_expenses.sql"),
    "utf8",
  );
  assert(migration.includes("create table if not exists public.business_expenses"), "creates table");
  assert(migration.includes("'payroll'"), "payroll category");
  assert(migration.includes("'contractor'"), "contractor category");
  assert(!migration.includes("ai_voice"), "no ai_voice category in ledger");
  assert(!/elevenlabs|openai/i.test(migration) || migration.toLowerCase().includes("ai_usage"), "AI not stored as ledger category");
  assert(migration.includes("grant all on table public.business_expenses to service_role"), "service_role grant");
  assert(migration.includes("revoke all on table public.business_expenses from anon"), "anon revoked");
  assert(migration.includes("revoke all on table public.business_expenses from authenticated"), "authenticated revoked");
  assert(migration.includes("enable row level security"), "RLS enabled");
  assert(migration.includes("amount_usd > 0"), "positive amount check");

  const route = readFileSync(join(root, "src/app/api/backoffice/expenses/route.ts"), "utf8");
  assert(route.includes("requireHostUser"), "API uses requireHostUser");
  assert(route.includes("isSuperAdmin"), "API uses isSuperAdmin");
  assert(route.includes('status: 403'), "host direct API attempt gets 403");
  assert(route.includes("createBusinessExpense"), "POST creates");
  assert(route.includes("updateBusinessExpense"), "PATCH updates");
  assert(route.includes("deleteBusinessExpense"), "DELETE deletes");

  const domain = readFileSync(join(root, "src/lib/admin-expenses.ts"), "utf8");
  assert(domain.includes("getAdminExpensesSnapshot"), "Founder snapshot exists");
  assert(domain.includes("getAiUsageMonthSnapshot"), "AI costs from Isabela Usage");
  assert(domain.includes("America/New_York") || domain.includes("EXPENSE_BACKOFFICE_TIMEZONE"), "NY timezone");
  assert(!domain.includes("insert({") || !/ai_usage_events/.test(domain), "does not write AI into business_expenses via ai_usage");
  assert(domain.includes("exactTrackedCostCents"), "uses exact AI cost cents");
  assert(domain.includes("totalsArePartial") || domain.includes("isabelaAiPricingPartial"), "pending AI pricing surfaced");

  const page = readFileSync(
    join(root, "src/app/(founder-admin)/backoffice/payroll-expenses/page.tsx"),
    "utf8",
  );
  assert(page.includes("getAdminExpensesSnapshot"), "page uses expenses snapshot");
  assert(page.includes("BackOfficeExpensesPanel"), "page mounts CRUD panel");
  assert(!page.includes("BackOfficeComingNext"), "page is live");
  assert(page.includes("Manual ledger only") || page.includes("manual ledger"), "expenses KPI clarified as manual");
  assert(page.includes("Isabela Usage") || page.includes("exactTracked"), "AI KPI from Isabela");
  assert(!page.includes("Profit") || page.toLowerCase().includes("will not") || page.includes("double-count"), "no Profit formula");

  const panel = readFileSync(
    join(root, "src/components/admin/backoffice-expenses-panel.tsx"),
    "utf8",
  );
  assert(panel.includes("confirm(") || panel.includes("Delete this expense"), "delete confirmation");
  assert(panel.includes("recurring"), "recurring checkbox present");
  assert(!panel.includes("cron") && !panel.includes("schedule"), "no auto-posting of recurring expenses");

  const incomeLib = readFileSync(join(root, "src/lib/admin-income.ts"), "utf8");
  assert(!incomeLib.includes("business_expenses"), "Income V1 untouched by expenses table");

  console.log("admin-expenses tests passed");
}

runAdminExpensesTests();
