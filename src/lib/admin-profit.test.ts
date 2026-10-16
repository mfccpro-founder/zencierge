import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  computeAdminProfit,
  formatProfitMarginPercent,
  formatProfitUsd,
  presentIsabelaAiCost,
  presentOperatingMargin,
  presentOperatingResult,
  presentProfitAmount,
  presentProfitMargin,
  PROFIT_PENDING_AI_EXPLANATION,
  PROFIT_PROVISIONAL_MARGIN_LABEL,
  PROFIT_PROVISIONAL_RESULT_LABEL,
  PROFIT_UNAVAILABLE_LABEL,
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
  assert(partial.profitPartialNote === PROFIT_PENDING_AI_EXPLANATION, "pending note explains the missing AI cost");
  assert(partial.isabelaAiCostUsedUsd === 20, "uses exact tracked portion");
  assert(partial.netOperatingProfitUsd === 880, "still computes with known AI portion");
  const partialResult = presentOperatingResult({
    unavailable: false,
    pricingPartial: true,
    readIncomplete: false,
    amount: partial.netOperatingProfitUsd,
  });
  assert(partialResult.label === PROFIT_PROVISIONAL_RESULT_LABEL, "known-plus-pending AI is a provisional subtotal");
  assert(partialResult.value === "$880.00", "provisional subtotal keeps the calculated amount");
  assert(!partialResult.label.includes("Net Operating Profit"), "a partial AI month is not labeled complete profit");
  const partialMargin = presentOperatingMargin({
    unavailable: false,
    pricingPartial: true,
    readIncomplete: false,
    margin: partial.operatingMarginPercent,
  });
  assert(partialMargin.label === PROFIT_PROVISIONAL_MARGIN_LABEL, "pending AI marks the margin provisional");
  assert(partialMargin.value === "88.0%", "provisional margin keeps the calculated percent");

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
  assert(pendingNoExact.netOperatingProfitUsd === 500, "pending-only AI keeps the current formula");
  assert(pendingNoExact.profitPartialNote === PROFIT_PENDING_AI_EXPLANATION, "pending-only AI explains that the result can change");
  assert(pendingNoExact.isabelaReadIncomplete === false, "unknown cost is not an incomplete read");
  const pendingResult = presentOperatingResult({
    unavailable: false,
    pricingPartial: true,
    readIncomplete: false,
    amount: pendingNoExact.netOperatingProfitUsd,
  });
  assert(pendingResult.label === PROFIT_PROVISIONAL_RESULT_LABEL, "unknown AI cost presents a provisional subtotal");
  assert(pendingResult.value === "$500.00", "unknown AI cost still shows the calculated subtotal");
  const pendingMargin = presentOperatingMargin({
    unavailable: false,
    pricingPartial: true,
    readIncomplete: false,
    margin: pendingNoExact.operatingMarginPercent,
  });
  assert(pendingMargin.label === PROFIT_PROVISIONAL_MARGIN_LABEL, "unknown AI cost marks the margin provisional");
  assert(pendingMargin.value === "100.0%", "unknown AI cost keeps the calculated margin");
  assert(
    presentIsabelaAiCost({
      readUnavailable: false,
      pricingPartial: true,
      profitPartial: false,
      exactAiCostUsd: null,
      exactAiCostLabel: "—",
    }) === "— · Partial",
    "pending-only TTS shows — · Partial even when profit itself is not partial",
  );
  assert(
    presentIsabelaAiCost({
      readUnavailable: false,
      pricingPartial: true,
      profitPartial: true,
      exactAiCostUsd: 20,
      exactAiCostLabel: "$20.00",
    }) === "$20.00 · Partial",
    "mixed known and unknown TTS shows the known subtotal as partial",
  );
  assert(
    presentIsabelaAiCost({
      readUnavailable: false,
      pricingPartial: false,
      profitPartial: false,
      exactAiCostUsd: null,
      exactAiCostLabel: "—",
    }) === "$0.00",
    "a valid read with no TTS events stays $0.00",
  );

  const incompleteRead = computeAdminProfit({
    collectedThisMonthUsd: 1000,
    mrrUsd: 0,
    payrollThisMonthUsd: 100,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: 20,
    isabelaAiPricingPartial: false,
    isabelaReadIncomplete: true,
  });
  assert(incompleteRead.profitIsPartial === true, "incomplete TTS read marks profit partial");
  assert(incompleteRead.profitExactnessLabel === "Partial", "incomplete read is not an exact profit");
  assert(incompleteRead.isabelaAiPricingPartial === false, "incomplete read stays distinct from unknown cost");
  assert(
    incompleteRead.profitPartialNote != null && /incomplete/i.test(incompleteRead.profitPartialNote),
    "profit note says the month total is incomplete",
  );
  assert(incompleteRead.netOperatingProfitUsd === 880, "incomplete read still shows the known portion");
  assert(incompleteRead.isabelaReadUnavailable === false, "a later page stays partial, not unavailable");
  assert(
    presentProfitAmount({
      unavailable: false,
      partial: true,
      amount: incompleteRead.netOperatingProfitUsd,
    }) === "$880.00 · Partial",
    "a later page keeps the partial profit presentation",
  );

  const completeEmpty = computeAdminProfit({
    collectedThisMonthUsd: 1000,
    mrrUsd: 40,
    payrollThisMonthUsd: 100,
    contractorsThisMonthUsd: 10,
    otherOperatingThisMonthUsd: 5,
    isabelaExactAiCostUsd: null,
    isabelaAiPricingPartial: false,
    isabelaReadUnavailable: false,
  });
  assert(completeEmpty.isabelaAiCostUsedUsd === 0, "a complete empty month is a valid zero AI cost");
  assert(completeEmpty.netOperatingProfitUsd === 885, "a complete empty month still calculates profit");
  assert(completeEmpty.profitUnavailableNote == null, "a complete empty month is not unavailable");
  assert(
    presentProfitAmount({
      unavailable: false,
      partial: false,
      amount: completeEmpty.netOperatingProfitUsd,
    }) === "$885.00",
    "a complete empty month presents the calculated profit",
  );
  const emptyResult = presentOperatingResult({
    unavailable: false,
    pricingPartial: false,
    readIncomplete: false,
    amount: completeEmpty.netOperatingProfitUsd,
  });
  assert(emptyResult.label === "Net Operating Profit", "a complete empty month stays net operating profit");
  assert(emptyResult.value === "$885.00", "a complete empty month keeps the valid zero in the profit");
  const knownResult = presentOperatingResult({
    unavailable: false,
    pricingPartial: false,
    readIncomplete: false,
    amount: exact.netOperatingProfitUsd,
  });
  assert(knownResult.label === "Net Operating Profit", "a complete known-cost month stays net operating profit");
  assert(knownResult.value === "$625.00", "a complete known-cost month keeps its profit");
  const knownMargin = presentOperatingMargin({
    unavailable: false,
    pricingPartial: false,
    readIncomplete: false,
    margin: exact.operatingMarginPercent,
  });
  assert(knownMargin.label === "Operating Margin %", "a complete known-cost month keeps the margin label");
  assert(knownMargin.value === "62.5%", "a complete known-cost month keeps its margin");

  const unavailableRead = computeAdminProfit({
    collectedThisMonthUsd: 1000,
    mrrUsd: 40,
    payrollThisMonthUsd: 100,
    contractorsThisMonthUsd: 10,
    otherOperatingThisMonthUsd: 5,
    isabelaExactAiCostUsd: null,
    isabelaAiPricingPartial: false,
    isabelaReadUnavailable: true,
  });
  assert(unavailableRead.isabelaAiCostUsedUsd == null, "unavailable AI cost is not replaced with zero");
  assert(unavailableRead.totalOperatingCostsUsd == null, "total operating costs stay unavailable");
  assert(unavailableRead.netOperatingProfitUsd == null, "net operating profit stays unavailable");
  assert(unavailableRead.operatingMarginPercent == null, "margin stays unavailable");
  assert(unavailableRead.collectedThisMonthUsd === 1000, "collected income stays visible");
  assert(unavailableRead.mrrUsd === 40, "MRR stays visible");
  assert(unavailableRead.payrollThisMonthUsd === 100, "payroll stays visible");
  assert(unavailableRead.contractorsThisMonthUsd === 10, "contractors stay visible");
  assert(unavailableRead.otherOperatingThisMonthUsd === 5, "other operating expenses stay visible");
  assert(unavailableRead.manualOperatingCostsUsd === 115, "known manual costs stay numeric");
  assert(unavailableRead.profitIsPartial === false, "an unavailable read is not labeled partial");
  assert(unavailableRead.profitPartialNote == null, "an unavailable read does not use the partial note");
  assert(
    unavailableRead.profitUnavailableNote != null &&
      !/later page/i.test(unavailableRead.profitUnavailableNote),
    "unavailable profit note does not say a later page",
  );
  assert(
    presentProfitAmount({
      unavailable: true,
      partial: false,
      amount: unavailableRead.netOperatingProfitUsd,
    }) === PROFIT_UNAVAILABLE_LABEL,
    "net operating profit presents as unavailable",
  );
  assert(
    presentProfitAmount({
      unavailable: true,
      partial: false,
      amount: unavailableRead.totalOperatingCostsUsd,
    }) === PROFIT_UNAVAILABLE_LABEL,
    "total operating costs present as unavailable",
  );
  assert(
    presentProfitMargin({
      unavailable: true,
      partial: false,
      margin: unavailableRead.operatingMarginPercent,
    }) === PROFIT_UNAVAILABLE_LABEL,
    "margin presents as unavailable",
  );
  const failedResult = presentOperatingResult({
    unavailable: true,
    pricingPartial: true,
    readIncomplete: false,
    amount: unavailableRead.netOperatingProfitUsd,
  });
  assert(failedResult.value === PROFIT_UNAVAILABLE_LABEL, "a failed read stays No disponible");
  assert(failedResult.label === "Net Operating Profit", "a failed read is not a provisional subtotal");
  const failedMargin = presentOperatingMargin({
    unavailable: true,
    pricingPartial: true,
    readIncomplete: false,
    margin: unavailableRead.operatingMarginPercent,
  });
  assert(failedMargin.value === PROFIT_UNAVAILABLE_LABEL, "a failed read keeps the margin unavailable");
  assert(failedMargin.label === "Operating Margin %", "a failed read does not mark the margin provisional");
  assert(
    presentProfitAmount({
      unavailable: false,
      partial: false,
      amount: unavailableRead.collectedThisMonthUsd,
    }) === "$1,000.00",
    "known income keeps its amount",
  );
  assert(unavailableRead.payrollThisMonthUsd === 100, "known payroll keeps its amount");
  assert(
    unavailableRead.payrollThisMonthUsd != null && formatProfitUsd(unavailableRead.payrollThisMonthUsd) === "$100.00",
    "known payroll still formats as dollars",
  );

  const emptyBooks = computeAdminProfit({
    collectedThisMonthUsd: 0,
    mrrUsd: 0,
    payrollThisMonthUsd: 0,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: null,
    isabelaAiPricingPartial: false,
  });
  assert(emptyBooks.netOperatingProfitUsd === 0, "a valid empty month still calculates profit");
  assert(emptyBooks.operatingMarginPercent == null, "a valid empty month has no margin");
  assert(
    presentProfitAmount({ unavailable: false, partial: false, amount: emptyBooks.collectedThisMonthUsd }) === "$0.00",
    "a valid empty collected month displays zero",
  );
  assert(
    presentProfitMargin({ unavailable: false, partial: false, margin: emptyBooks.operatingMarginPercent }) === "—",
    "a valid empty collected month does not use the unavailable margin label",
  );

  const failedIncome = computeAdminProfit({
    collectedThisMonthUsd: null,
    mrrUsd: 49,
    payrollThisMonthUsd: 10,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: 5,
    isabelaAiPricingPartial: false,
  });
  assert(failedIncome.collectedThisMonthUsd == null, "failed payments stay null");
  assert(failedIncome.mrrUsd === 49, "valid MRR stays beside failed payments");
  assert(failedIncome.netOperatingProfitUsd == null, "missing income blocks profit");
  assert(failedIncome.operatingMarginPercent == null, "missing income blocks margin");
  assert(failedIncome.profitIsPartial === false, "a missing source is not a partial profit");
  assert(
    presentProfitAmount({ unavailable: true, partial: false, amount: failedIncome.netOperatingProfitUsd }) ===
      PROFIT_UNAVAILABLE_LABEL,
    "missing income presents profit as unavailable",
  );
  assert(
    presentProfitMargin({ unavailable: true, partial: false, margin: failedIncome.operatingMarginPercent }) ===
      PROFIT_UNAVAILABLE_LABEL,
    "missing income presents margin as unavailable",
  );

  const failedExpenses = computeAdminProfit({
    collectedThisMonthUsd: 1000,
    mrrUsd: null,
    payrollThisMonthUsd: null,
    contractorsThisMonthUsd: null,
    otherOperatingThisMonthUsd: null,
    isabelaExactAiCostUsd: 5,
    isabelaAiPricingPartial: false,
  });
  assert(failedExpenses.mrrUsd == null, "a failed subscription read keeps MRR null");
  assert(failedExpenses.collectedThisMonthUsd === 1000, "known income stays beside a failed ledger");
  assert(failedExpenses.manualOperatingCostsUsd == null, "a failed ledger is not a zero cost subtotal");
  assert(failedExpenses.totalOperatingCostsUsd == null, "a failed ledger blocks the cost subtotal");
  assert(failedExpenses.netOperatingProfitUsd == null, "missing expenses block profit");
  assert(
    presentProfitAmount({ unavailable: true, partial: false, amount: failedExpenses.payrollThisMonthUsd }) ===
      PROFIT_UNAVAILABLE_LABEL,
    "missing payroll presents as unavailable",
  );

  assert(partial.totalOperatingCostsUsd === 120, "partial AI still produces a cost subtotal");
  assert(
    presentProfitAmount({
      unavailable: false,
      partial: partial.isabelaAiPricingPartial,
      amount: partial.totalOperatingCostsUsd,
    }) === "$120.00 · Partial",
    "unknown TTS costs label the calculated cost subtotal as partial",
  );

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
  assert(page.includes("presentIsabelaAiCost"), "profit page uses one AI cost label for the card and breakdown");
  assert(page.includes("aiValueLabel"), "monthly breakdown reuses the AI cost label");
  assert(page.includes("MRR"), "MRR shown separately");
  assert(page.includes("presentOperatingResult"), "profit page presents the operating result");
  assert(page.includes("presentOperatingMargin"), "profit page presents the operating margin");
  assert(page.includes("PROFIT_PENDING_AI_EXPLANATION"), "profit page explains missing AI costs");
  assert(page.includes("presentProfitAmount"), "profit page presents unavailable amounts");
  assert(page.includes("profitUnavailableNote"), "profit page shows the unavailable notice");
  assert(page.includes("isabelaReadUnavailable"), "profit page receives the unavailable read");
  assert(page.includes("PROFIT_UNAVAILABLE_LABEL"), "profit page uses the unavailable label");
  assert(page.includes("knownAmount(snapshot.collectedThisMonthUsd)"), "collected income uses the unavailable amount label");
  assert(page.includes("knownAmount(snapshot.payrollThisMonthUsd)"), "payroll uses the unavailable amount label");
  assert(page.includes("snapshot.isabelaAiPricingPartial"), "unknown TTS costs mark a calculated cost subtotal partial");
  assert(
    /sourcesUnavailable[\s\S]*Not calculated[\s\S]*isabelaAiPricingPartial[\s\S]*PROFIT_PENDING_AI_EXPLANATION[\s\S]*collectedThisMonthUsd != null && snapshot\.collectedThisMonthUsd > 0[\s\S]*No collected income this month/.test(
      page,
    ),
    "the empty-income sentence is only reached after a successful read",
  );
  assert(!page.includes("formatProfitUsd(snapshot.netOperatingProfitUsd)"), "unavailable profit is not formatted as zero");
  assert(!page.includes("formatProfitUsd(snapshot.totalOperatingCostsUsd)"), "unavailable total costs are not formatted as zero");

  const layout = readFileSync(join(root, "src/app/(founder-admin)/backoffice/layout.tsx"), "utf8");
  assert(layout.includes("isSuperAdmin"), "SuperAdmin can access via layout");
  assert(layout.includes('redirect("/dashboard")'), "normal hosts cannot access");

  const nav = readFileSync(join(root, "src/components/admin/backoffice-nav.tsx"), "utf8");
  assert(/href: "\/backoffice\/profit"[\s\S]*?status: "ready"/.test(nav), "Profit nav ready");
  assert(!nav.includes('label: "Properties"'), "Properties not primary nav");

  assert(existsSync(join(root, "src/lib/admin-profit-shared.ts")), "shared formula module exists");

  const formula = readFileSync(join(root, "src/lib/admin-profit-shared.ts"), "utf8");
  assert(!formula.includes("organization/costs"), "profit formula does not read OpenAI costs");
  assert(!formula.includes("readOpenAiBackOfficeCosts"), "profit formula does not take reconciled spend");
  const reconciledFailure = computeAdminProfit({
    collectedThisMonthUsd: 500,
    mrrUsd: 0,
    payrollThisMonthUsd: 0,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: null,
    isabelaAiPricingPartial: true,
  });
  assert(reconciledFailure.netOperatingProfitUsd === 500, "a costs-read failure is not an input to profit");
  assert(reconciledFailure.isabelaAiCostUsedUsd === 0, "pending tariff still follows the existing formula");
  assert(page.includes("readOpenAiBackOfficeCosts"), "profit page reads reconciled spend on its own");
  assert(page.includes("OpenAiReconciledSpendCard"), "profit page shows reconciled spend outside the formula");
  assert(!domain.includes("readOpenAiBackOfficeCosts"), "profit snapshot does not fold reconciled spend into the formula");

  console.log("admin-profit tests passed");
}

runAdminProfitTests();
