import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  computeAdminProfit,
  formatProfitMarginPercent,
  formatProfitUsd,
} from "./admin-profit-shared";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runAdminProfitTests() {
  const root = process.cwd();

  // Exact inputs → correct profit and margin
  const exact = computeAdminProfit({
    collectedThisMonthUsd: 1000,
    mrrUsd: 500,
    payrollThisMonthUsd: 200,
    contractorsThisMonthUsd: 100,
    otherOperatingThisMonthUsd: 50,
    isabelaExactAiCostUsd: 25,
    isabelaAiPricingPartial: false,
  });
  assert(exact.mrrUsd === 500, "MRR retained for display");
  assert(exact.totalOperatingCostsUsd === 375, "total costs = payroll+contractor+other+AI once each");
  assert(exact.netOperatingProfitUsd === 625, "profit = collected − total costs");
  assert(exact.operatingMarginPercent === 62.5, "margin %");
  assert(exact.profitIsPartial === false, "exact when AI fully priced");
  assert(exact.profitExactnessLabel === "Exact", "exact label");
  assert(exact.manualOperatingCostsUsd === 350, "manual OpEx excludes AI");

  // Collected payment contributes; failed/comp do not enter formula (caller supplies succeeded-only collected)
  const withCollected = computeAdminProfit({
    collectedThisMonthUsd: 99,
    mrrUsd: 0,
    payrollThisMonthUsd: 0,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: 0,
    isabelaAiPricingPartial: false,
  });
  assert(withCollected.netOperatingProfitUsd === 99, "collected payment contributes to income/profit");

  const zeroCollected = computeAdminProfit({
    collectedThisMonthUsd: 0,
    mrrUsd: 199,
    payrollThisMonthUsd: 10,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: 0,
    isabelaAiPricingPartial: false,
  });
  assert(zeroCollected.netOperatingProfitUsd === -10, "complimentary/no cash → $0 revenue; costs still subtract");
  assert(zeroCollected.operatingMarginPercent == null, "margin undefined when collected is 0");
  assert(formatProfitMarginPercent(null) === "—", "margin dash when no collected");

  // Payroll / contractor / OpEx each once
  const once = computeAdminProfit({
    collectedThisMonthUsd: 1000,
    mrrUsd: 0,
    payrollThisMonthUsd: 100,
    contractorsThisMonthUsd: 40,
    otherOperatingThisMonthUsd: 60,
    isabelaExactAiCostUsd: 10,
    isabelaAiPricingPartial: false,
  });
  assert(once.payrollThisMonthUsd === 100, "payroll counted once");
  assert(once.contractorsThisMonthUsd === 40, "contractor counted once");
  assert(once.otherOperatingThisMonthUsd === 60, "OpEx counted once");
  assert(once.totalOperatingCostsUsd === 210, "no double-count across buckets");

  // AI COGS not double-counted (only isabelaExactAiCostUsd enters formula — never from ledger)
  const aiOnly = computeAdminProfit({
    collectedThisMonthUsd: 100,
    mrrUsd: 0,
    payrollThisMonthUsd: 0,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: 7.5,
    isabelaAiPricingPartial: false,
  });
  assert(aiOnly.isabelaAiCostUsedUsd === 7.5, "AI from Isabela exact only");
  assert(aiOnly.netOperatingProfitUsd === 92.5, "AI subtracted once");

  // Partial AI pricing marks Profit partial; uses exact tracked portion only
  const partial = computeAdminProfit({
    collectedThisMonthUsd: 1000,
    mrrUsd: 0,
    payrollThisMonthUsd: 100,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: 20,
    isabelaAiPricingPartial: true,
  });
  assert(partial.profitIsPartial === true, "partial AI marks profit partial");
  assert(partial.profitExactnessLabel === "Partial", "Partial label");
  assert(partial.profitPartialNote != null && /pending full AI pricing/i.test(partial.profitPartialNote), "pending note");
  assert(partial.isabelaAiCostUsedUsd === 20, "uses exact tracked portion");
  assert(partial.netOperatingProfitUsd === 880, "still computes with known AI portion");

  const pendingNoExact = computeAdminProfit({
    collectedThisMonthUsd: 500,
    mrrUsd: 0,
    payrollThisMonthUsd: 0,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: null,
    isabelaAiPricingPartial: true,
  });
  assert(pendingNoExact.profitIsPartial === true, "pending-only AI marks profit partial");
  assert(pendingNoExact.isabelaAiCostUsedUsd === 0, "unpriced usage not invented as positive cost");
  assert(pendingNoExact.profitPartialNote != null, "does not present as exact");

  assert(formatProfitUsd(-12.5) === "-$12.50", "negative USD format");
  assert(formatProfitUsd(12.5) === "$12.50", "positive USD format");

  const domain = readFileSync(join(root, "src/lib/admin-profit.ts"), "utf8");
  assert(domain.includes("getAdminIncomeSnapshot"), "profit reads income");
  assert(domain.includes("getAdminExpensesSnapshot"), "profit reads expenses");
  assert(domain.includes("computeAdminProfit"), "profit uses shared formula");
  assert(!domain.includes("admin-revenue-store"), "no demo revenue");
  assert(!domain.includes("from(\"business_expenses\")") || !domain.includes("ai_voice"), "does not invent AI ledger rows");

  const page = readFileSync(join(root, "src/app/(founder-admin)/backoffice/profit/page.tsx"), "utf8");
  assert(page.includes("getAdminProfitSnapshot"), "profit page uses snapshot");
  assert(!page.includes("BackOfficeComingNext"), "profit page is live");
  assert(page.includes("Partial") || page.includes("profitIsPartial"), "page surfaces partial AI");
  assert(page.includes("MRR"), "MRR shown separately");
  assert(page.includes("Net Operating Profit"), "net profit KPI");

  const layout = readFileSync(join(root, "src/app/(founder-admin)/backoffice/layout.tsx"), "utf8");
  assert(layout.includes("isSuperAdmin"), "SuperAdmin can access via layout");
  assert(layout.includes('redirect("/dashboard")'), "normal hosts cannot access");

  const nav = readFileSync(join(root, "src/components/admin/backoffice-nav.tsx"), "utf8");
  assert(/href: "\/backoffice\/profit"[\s\S]*?status: "ready"/.test(nav), "Profit nav ready");
  assert(!nav.includes('label: "Properties"'), "Properties not primary nav");

  assert(existsSync(join(root, "src/lib/admin-profit-shared.ts")), "shared formula module exists");

  console.log("admin-profit tests passed");
}

runAdminProfitTests();
