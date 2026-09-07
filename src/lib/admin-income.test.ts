import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateIncomePayments,
  formatIncomeUsd,
  incomeCalendarMonthUtcBounds,
  incomeTrendMonthBounds,
  incomeYtdUtcBounds,
  normalizeIncomePaymentStatus,
  resolveIncomePlanLabel,
} from "./admin-income";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runAdminIncomeTests() {
  const month = incomeCalendarMonthUtcBounds(new Date("2026-09-05T16:00:00.000Z"), "America/New_York");
  assert(month.label.includes("September"), "September NY month label");
  assert(month.startUtc.toISOString() === "2026-09-01T04:00:00.000Z", "Sept 2026 NY month start EDT");
  assert(month.endUtc.toISOString() === "2026-10-01T04:00:00.000Z", "Sept 2026 NY month end");

  const ytd = incomeYtdUtcBounds(new Date("2026-09-05T16:00:00.000Z"), "America/New_York");
  assert(ytd.year === 2026, "YTD year");
  assert(ytd.startUtc.toISOString() === "2026-01-01T05:00:00.000Z", "2026 YTD start EST");
  assert(ytd.endUtc.toISOString() === "2027-01-01T05:00:00.000Z", "2027 YTD end boundary");

  const trend = incomeTrendMonthBounds(new Date("2026-09-05T16:00:00.000Z"), 12);
  assert(trend.length === 12, "12-month trend");
  assert(trend[0]?.label.includes("2025") || trend[0]?.month === 10, "trend reaches prior year");
  assert(trend[11]?.month === 9 && trend[11]?.year === 2026, "trend ends at current month");

  assert(normalizeIncomePaymentStatus("succeeded") === "succeeded", "succeeded status");
  assert(normalizeIncomePaymentStatus("failed") === "failed", "failed status");
  assert(normalizeIncomePaymentStatus("declined") === "failed", "declined maps to failed");

  assert(resolveIncomePlanLabel({ planId: "pro", amountUsd: 1 }).planLabel === "Pro Superhost", "plan_id wins");
  assert(resolveIncomePlanLabel({ planId: null, amountUsd: 99 }).planId === "pro", "amount fallback");
  assert(resolveIncomePlanLabel({ planId: null, amountUsd: 0 }).planId === null, "zero amount does not invent plan");

  const payments = [
    {
      id: "p1",
      userId: "334119a5-44b0-4567-8184-c2c6ff83a49e",
      hostEmail: "host@example.com",
      amountUsd: 99,
      planIdRaw: "pro",
      status: "succeeded" as const,
      statusRaw: "succeeded",
      providerPaymentId: "sq_1",
      at: "2026-09-03T15:00:00.000Z",
    },
    {
      id: "p2",
      userId: "334119a5-44b0-4567-8184-c2c6ff83a49e",
      hostEmail: "host@example.com",
      amountUsd: 99,
      planIdRaw: "pro",
      status: "failed" as const,
      statusRaw: "failed",
      providerPaymentId: "sq_2",
      at: "2026-09-04T15:00:00.000Z",
    },
    {
      id: "p3",
      userId: null,
      hostEmail: "orphan@example.com",
      amountUsd: 49,
      planIdRaw: "starter",
      status: "succeeded" as const,
      statusRaw: "succeeded",
      providerPaymentId: "sq_3",
      at: "2026-02-10T15:00:00.000Z",
    },
  ];

  const aggregated = aggregateIncomePayments({
    payments,
    monthStartUtc: month.startUtc,
    monthEndUtc: month.endUtc,
    ytdStartUtc: ytd.startUtc,
    ytdEndUtc: ytd.endUtc,
    trend,
    customerByUserId: new Map([
      ["334119a5-44b0-4567-8184-c2c6ff83a49e", { email: "host@example.com", fullName: "Host One" }],
    ]),
    transactionFilter: "succeeded",
  });

  assert(aggregated.collectedThisMonthUsd === 99, "succeeded payments included in collected month");
  assert(aggregated.failedPaymentsThisMonth === 1, "failed counted separately");
  assert(aggregated.successfulPaymentsThisMonth === 1, "successful count this month");
  assert(aggregated.collectedYtdUsd === 148, "YTD includes Feb + Sept succeeded");
  assert(aggregated.transactions.every((row) => row.status === "succeeded"), "default table is succeeded only");
  assert(aggregated.transactions.some((row) => row.providerPaymentId === "sq_1"), "real payment ids in table");
  assert(aggregated.transactions.some((row) => !row.customerLinked && row.customerLabel.includes("orphan")), "unlinked marked");
  assert(aggregated.revenueByPlan.some((row) => row.planId === "pro" && row.amountUsd === 99), "plan grouping");
  assert(aggregated.revenueByPlan.some((row) => row.planId === "starter" && row.amountUsd === 49), "starter YTD");
  assert(
    !aggregated.transactions.some((row) => row.id === "p2"),
    "failed payments excluded from succeeded transaction filter",
  );

  const failedOnly = aggregateIncomePayments({
    payments,
    monthStartUtc: month.startUtc,
    monthEndUtc: month.endUtc,
    ytdStartUtc: ytd.startUtc,
    ytdEndUtc: ytd.endUtc,
    trend,
    customerByUserId: new Map(),
    transactionFilter: "failed",
  });
  assert(failedOnly.transactions.length === 1 && failedOnly.transactions[0]?.id === "p2", "failed filter");
  assert(failedOnly.collectedThisMonthUsd === 99, "collected totals still exclude failed regardless of table filter");

  assert(formatIncomeUsd(99) === "$99.00", "USD format");

  const incomeLib = readFileSync(join(process.cwd(), "src/lib/admin-income.ts"), "utf8");
  const incomePage = readFileSync(
    join(process.cwd(), "src/app/(founder-admin)/backoffice/income/page.tsx"),
    "utf8",
  );
  const nav = readFileSync(join(process.cwd(), "src/components/admin/backoffice-nav.tsx"), "utf8");
  const billing = readFileSync(join(process.cwd(), "src/lib/admin-billing.ts"), "utf8");

  assert(!incomeLib.includes("admin-revenue-store"), "income lib does not import demo revenue store");
  assert(!incomePage.includes("admin-revenue-store"), "income page does not import demo revenue store");
  assert(incomeLib.includes("getAdminBillingSnapshot"), "MRR reused from admin-billing");
  assert(incomeLib.includes("Recurring run-rate — not cash collected"), "MRR kept distinct from cash");
  assert(incomePage.includes("getAdminIncomeSnapshot"), "page uses income snapshot");
  assert(incomePage.includes("Recurring run-rate") || incomePage.includes("mrrNote"), "page surfaces MRR note");
  assert(incomePage.includes("subscription_payments"), "page cites live payment source");
  assert(nav.includes('href: "/backoffice/income"') && nav.includes('status: "ready"'), "Income nav ready");
  assert(billing.includes("!row.complimentaryActive"), "billing MRR still excludes complimentary");
  assert(billing.includes("!row.trialActive"), "billing MRR still excludes trials");
  assert(existsSync(join(process.cwd(), "src/lib/admin-income.ts")), "admin-income module exists");

  console.log("admin-income tests passed");
}

const isDirectRun = process.argv[1]?.includes("admin-income.test");
if (isDirectRun) {
  try {
    runAdminIncomeTests();
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "admin-income tests failed");
    process.exitCode = 1;
  }
}
