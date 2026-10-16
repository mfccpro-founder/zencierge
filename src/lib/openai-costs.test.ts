import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenAiReconciledSpendCard } from "../components/admin/openai-reconciled-spend-card";
import { computeAdminProfit } from "./admin-profit-shared";
import {
  collectOpenAiOrganizationCosts,
  openAiCostsUtcWindowForNewYorkMonth,
  OPENAI_COSTS_MAX_PAGES,
  OPENAI_COSTS_SEPARATION_NOTE,
  presentOpenAiReconciledSpend,
  quoteOpenAiCostAmountValues,
  sumOpenAiCostDecimals,
  type OpenAiCostsFetch,
  type OpenAiCostsReconciliation,
} from "./openai-costs";
import { readOpenAiBackOfficeCosts } from "./openai-costs-read";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const NOW = new Date("2026-10-15T15:00:00.000Z");
const ADMIN_KEY = "sk-admin-test-secret";
const TTS_KEY = "sk-tts-test-secret";

function page(input: {
  hasMore: boolean;
  nextPage?: string | null;
  results: string;
}): string {
  return `{
    "object": "page",
    "has_more": ${input.hasMore ? "true" : "false"},
    "next_page": ${input.nextPage ? `"${input.nextPage}"` : "null"},
    "data": [{
      "object": "bucket",
      "start_time": 1736553600,
      "end_time": 1736640000,
      "results": [${input.results}]
    }]
  }`;
}

function usdResult(valueLiteral: string): string {
  return `{
    "object": "organization.costs.result",
    "amount": { "value": ${valueLiteral}, "currency": "usd" },
    "line_item": null,
    "project_id": null
  }`;
}

function fakeFetch(pages: Record<string, { status?: number; body: string }>): {
  fetchImpl: OpenAiCostsFetch;
  calls: Array<{ url: string; authorization: string; cache?: "no-store" }>;
} {
  const calls: Array<{ url: string; authorization: string; cache?: "no-store" }> = [];
  const fetchImpl: OpenAiCostsFetch = async (url, init) => {
    const authorization = init?.headers?.Authorization ?? "";
    calls.push({ url, authorization, cache: init?.cache });
    const parsed = new URL(url);
    const cursor = parsed.searchParams.get("page") ?? "";
    const match = pages[cursor];
    if (!match) return { ok: false, status: 500, text: async () => "" };
    const status = match.status ?? 200;
    return { ok: status >= 200 && status < 300, status, text: async () => match.body };
  };
  return { fetchImpl, calls };
}

function readyBase(extra: Partial<OpenAiCostsReconciliation> = {}): OpenAiCostsReconciliation {
  const window = openAiCostsUtcWindowForNewYorkMonth(NOW);
  return {
    status: "ready",
    unavailableReason: null,
    amountValue: "0.06",
    currency: "usd",
    scopeKind: "organization",
    projectId: null,
    apiKeyId: null,
    nyMonthLabel: window.nyMonthLabel,
    nyRangeStartUtc: window.nyRangeStartUtc.toISOString(),
    nyRangeEndUtc: window.nyRangeEndUtc.toISOString(),
    utcWindowStart: window.utcWindowStart.toISOString(),
    utcWindowEnd: window.utcWindowEnd.toISOString(),
    includesOpenUtcDay: window.includesOpenUtcDay,
    equivalenceNote: window.equivalenceNote,
    ...extra,
  };
}

export async function runOpenAiCostsTests() {
  assert(quoteOpenAiCostAmountValues(`{"value": 0.06}`) === `{"value": "0.06"}`, "amount values stay decimal strings");
  assert(sumOpenAiCostDecimals(["0.06"]) === "0.06", "official 0.06 USD stays 0.06");
  assert(sumOpenAiCostDecimals(["0.10", "0.20"]) === "0.30", "decimal sum does not use binary floating point");
  assert(
    sumOpenAiCostDecimals(["0.13080438340307526", "0.12270423340307525"]) === "0.25350861680615051",
    "long cost decimals keep their scale",
  );

  const window = openAiCostsUtcWindowForNewYorkMonth(NOW);
  assert(window.nyMonthLabel === "October 2026", "New York month is October 2026");
  assert(window.nyRangeStartUtc.toISOString() === "2026-10-01T04:00:00.000Z", "New York month starts at 04:00 UTC");
  assert(window.utcWindowStart.toISOString() === "2026-10-01T00:00:00.000Z", "UTC window starts at midnight");
  assert(window.utcWindowEnd.toISOString() === "2026-11-02T00:00:00.000Z", "UTC window ends on the next midnight after the month");
  assert(window.utcWindowStart.getTime() !== window.nyRangeStartUtc.getTime(), "UTC start is not the New York start");
  assert(window.utcWindowEnd.getTime() !== window.nyRangeEndUtc.getTime(), "UTC end is not the New York end");
  assert(window.utcWindowStart.getUTCHours() === 0 && window.utcWindowEnd.getUTCHours() === 0, "both UTC bounds are midnights");
  assert(/not exactly that month/.test(window.equivalenceNote), "the window says it is not the New York month");
  assert(window.includesOpenUtcDay === true, "the open October UTC day stays marked");

  const official = fakeFetch({
    "": { body: page({ hasMore: false, results: usdResult("0.06") }) },
  });
  const officialRead = await collectOpenAiOrganizationCosts({
    fetchImpl: official.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(officialRead.ok && officialRead.amountValue === "0.06" && officialRead.currency === "usd", "official 0.06 page sums in USD");
  assert(official.calls[0]?.authorization === `Bearer ${ADMIN_KEY}`, "admin key is sent only as a bearer token");
  assert(official.calls[0]?.cache === "no-store", "costs request is not stored in the fetch cache");
  assert(!official.calls[0]?.url.includes(ADMIN_KEY), "admin key is not placed in the URL");
  const officialUrl = new URL(official.calls[0]?.url ?? "https://example.invalid");
  assert(officialUrl.searchParams.get("bucket_width") === "1d", "costs query uses daily buckets");
  assert(!officialUrl.searchParams.has("line_items"), "costs query does not invent a model line item");
  assert(!officialUrl.searchParams.has("group_by"), "costs query does not group by model");
  assert(!officialUrl.searchParams.has("model"), "costs query has no model filter");
  assert(!officialUrl.searchParams.has("models"), "costs query has no models filter");

  const paged = fakeFetch({
    "": { body: page({ hasMore: true, nextPage: "cursor-2", results: usdResult("0.06") }) },
    "cursor-2": { body: page({ hasMore: false, results: usdResult("0.04") }) },
  });
  const pagedRead = await collectOpenAiOrganizationCosts({
    fetchImpl: paged.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(paged.calls.length === 2, "has_more follows next_page");
  assert(new URL(paged.calls[1]?.url ?? "https://example.invalid").searchParams.get("page") === "cursor-2", "second request uses next_page");
  assert(pagedRead.ok && pagedRead.amountValue === "0.10" && pagedRead.currency === "usd", "pages sum as decimal money");

  const failedPage = fakeFetch({
    "": { body: page({ hasMore: true, nextPage: "cursor-2", results: usdResult("0.06") }) },
    "cursor-2": { status: 500, body: "" },
  });
  const failedRead = await collectOpenAiOrganizationCosts({
    fetchImpl: failedPage.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(!failedRead.ok && failedRead.reason === "page_failed", "a failed later page is unavailable");
  assert(!("amountValue" in failedRead), "a failed later page does not keep the earlier sum");

  const missing = fakeFetch({
    "": {
      body: page({
        hasMore: false,
        results: `{ "object": "organization.costs.result", "amount": { "currency": "usd" } }`,
      }),
    },
  });
  const missingRead = await collectOpenAiOrganizationCosts({
    fetchImpl: missing.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(!missingRead.ok && missingRead.reason === "missing_amount", "a missing amount is unavailable");

  const mixed = fakeFetch({
    "": {
      body: page({
        hasMore: false,
        results: `${usdResult("0.06")}, { "object": "organization.costs.result", "amount": { "value": 0.01, "currency": "eur" } }`,
      }),
    },
  });
  const mixedRead = await collectOpenAiOrganizationCosts({
    fetchImpl: mixed.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(!mixedRead.ok && mixedRead.reason === "mixed_currency", "mixed currencies are unavailable");

  const incompleteCursor = fakeFetch({
    "": { body: page({ hasMore: true, results: usdResult("0.06") }) },
  });
  const incompleteCursorRead = await collectOpenAiOrganizationCosts({
    fetchImpl: incompleteCursor.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(!incompleteCursorRead.ok && incompleteCursorRead.reason === "invalid_page", "has_more without next_page is not a total");

  const empty = fakeFetch({
    "": { body: page({ hasMore: false, results: "" }) },
  });
  const emptyRead = await collectOpenAiOrganizationCosts({
    fetchImpl: empty.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(emptyRead.ok && emptyRead.amountValue === "0" && emptyRead.currency == null, "no cost lines stay zero without an invented currency");

  const loopingPages: Record<string, { body: string }> = {};
  for (let index = 0; index <= OPENAI_COSTS_MAX_PAGES; index += 1) {
    const cursor = index === 0 ? "" : `cursor-${index}`;
    loopingPages[cursor] = {
      body: page({ hasMore: true, nextPage: `cursor-${index + 1}`, results: usdResult("0.01") }),
    };
  }
  const looping = fakeFetch(loopingPages);
  const loopingRead = await collectOpenAiOrganizationCosts({
    fetchImpl: looping.fetchImpl,
    adminKey: ADMIN_KEY,
    startTimeUnix: 1,
    endTimeUnix: 2,
  });
  assert(!loopingRead.ok, "a cursor that never ends is not presented as a partial total");

  let unauthorizedCalls = 0;
  const unauthorized = await readOpenAiBackOfficeCosts({
    now: NOW,
    env: { OPENAI_ADMIN_KEY: ADMIN_KEY, OPENAI_API_KEY: TTS_KEY },
    authorize: () => false,
    fetchImpl: async () => {
      unauthorizedCalls += 1;
      return { ok: true, status: 200, text: async () => "" };
    },
  });
  assert(unauthorizedCalls === 0, "unauthorized Back Office read does not call costs");
  assert(unauthorized.status === "unavailable" && unauthorized.unavailableReason === "unauthorized", "unauthorized spend is unavailable");
  assert(!JSON.stringify(unauthorized).includes(ADMIN_KEY), "unauthorized result does not contain the admin key");

  let unconfiguredCalls = 0;
  const unconfigured = await readOpenAiBackOfficeCosts({
    now: NOW,
    env: { OPENAI_API_KEY: TTS_KEY },
    authorize: () => true,
    fetchImpl: async () => {
      unconfiguredCalls += 1;
      return { ok: true, status: 200, text: async () => "" };
    },
  });
  assert(unconfiguredCalls === 0, "missing admin key does not call costs");
  assert(unconfigured.status === "not_configured", "missing admin key is not configured");
  assert(unconfigured.scopeKind === "organization", "without scope ids the reach is the organization");
  assert(unconfigured.amountValue == null, "not configured spend is not zero");
  const unconfiguredView = presentOpenAiReconciledSpend(unconfigured);
  assert(unconfiguredView.scopeLabel.includes("Organization"), "card says the scope is the organization");
  assert(unconfiguredView.equivalenceNote.includes("not exactly"), "card separates the UTC window from New York");
  assert(unconfiguredView.separationNote === OPENAI_COSTS_SEPARATION_NOTE, "card stays separate from the tariff");

  const scoped = fakeFetch({
    "": { body: page({ hasMore: false, results: usdResult("0.06") }) },
  });
  const scopedRead = await readOpenAiBackOfficeCosts({
    now: NOW,
    env: {
      OPENAI_ADMIN_KEY: ADMIN_KEY,
      OPENAI_API_KEY: TTS_KEY,
      OPENAI_COSTS_PROJECT_ID: "proj_zencierge",
      OPENAI_COSTS_API_KEY_ID: "key_zencierge",
    },
    authorize: () => true,
    fetchImpl: scoped.fetchImpl,
  });
  assert(scopedRead.status === "ready" && scopedRead.amountValue === "0.06" && scopedRead.currency === "usd", "authorized read returns the decimal total");
  assert(scopedRead.scopeKind === "project_and_api_key", "optional ids narrow the declared scope");
  const scopedUrl = scoped.calls[0]?.url ?? "";
  assert(scopedUrl.includes("project_ids=proj_zencierge"), "project id is the project filter");
  assert(scopedUrl.includes("api_key_ids=key_zencierge"), "api key id is the key filter");
  assert(!scopedUrl.includes(TTS_KEY), "the TTS key is not a cost filter");
  assert(!scopedUrl.includes(ADMIN_KEY), "the admin key is not a cost filter");
  assert(!scopedUrl.includes("line_items"), "scoped read still does not invent a model filter");
  const startTime = new URL(scopedUrl).searchParams.get("start_time");
  const endTime = new URL(scopedUrl).searchParams.get("end_time");
  assert(startTime === String(Math.floor(window.utcWindowStart.getTime() / 1000)), "request starts at the UTC midnight window");
  assert(endTime === String(Math.floor(window.utcWindowEnd.getTime() / 1000)), "request ends at the UTC midnight window");
  assert(startTime !== String(Math.floor(window.nyRangeStartUtc.getTime() / 1000)), "request does not use the New York offset as start_time");
  assert(Number(startTime) % 86400 === 0 && Number(endTime) % 86400 === 0, "request bounds are whole UTC days");
  assert(!JSON.stringify(scopedRead).includes(ADMIN_KEY), "ready result does not contain the admin key");
  const scopedView = presentOpenAiReconciledSpend(scopedRead);
  assert(scopedView.value === "0.06 USD", "ready spend shows the amount and currency");
  assert(scopedView.utcWindowLabel.includes(window.utcWindowStart.toISOString()), "card shows the UTC window");
  assert(scopedView.nyMonthLabel.includes("October 2026"), "card shows the New York month separately");

  const failedLive = await readOpenAiBackOfficeCosts({
    now: NOW,
    env: { OPENAI_ADMIN_KEY: ADMIN_KEY },
    authorize: () => true,
    fetchImpl: fakeFetch({
      "": { body: page({ hasMore: true, nextPage: "cursor-2", results: usdResult("0.06") }) },
      "cursor-2": { status: 500, body: "" },
    }).fetchImpl,
  });
  assert(failedLive.status === "unavailable" && failedLive.amountValue == null, "live page failure stays unavailable");
  assert(presentOpenAiReconciledSpend(failedLive).value === "— / No disponible", "unavailable spend is not a partial total");

  const profit = computeAdminProfit({
    collectedThisMonthUsd: 500,
    mrrUsd: 0,
    payrollThisMonthUsd: 0,
    contractorsThisMonthUsd: 0,
    otherOperatingThisMonthUsd: 0,
    isabelaExactAiCostUsd: null,
    isabelaAiPricingPartial: true,
  });
  assert(profit.netOperatingProfitUsd === 500, "profit formula ignores an unavailable reconciled spend");
  assert(presentOpenAiReconciledSpend(readyBase()).separationNote.includes("Not included in Net Operating Profit"), "presented spend stays outside profit");

  const root = process.cwd();
  const reader = readFileSync(join(root, "src/lib/openai-costs-read.ts"), "utf8");
  const pure = readFileSync(join(root, "src/lib/openai-costs.ts"), "utf8");
  const card = readFileSync(join(root, "src/components/admin/openai-reconciled-spend-card.tsx"), "utf8");
  const formula = readFileSync(join(root, "src/lib/admin-profit-shared.ts"), "utf8");
  const profitPage = readFileSync(join(root, "src/app/(founder-admin)/backoffice/profit/page.tsx"), "utf8");
  const expensesPage = readFileSync(join(root, "src/app/(founder-admin)/backoffice/payroll-expenses/page.tsx"), "utf8");
  const usagePage = readFileSync(join(root, "src/app/(founder-admin)/backoffice/isabela-usage/page.tsx"), "utf8");
  const expensesLib = readFileSync(join(root, "src/lib/admin-expenses.ts"), "utf8");
  const envExample = readFileSync(join(root, ".env.example"), "utf8");
  const costsCall = reader.indexOf("await collectOpenAiOrganizationCosts");
  assert(reader.indexOf("if (!allowed)") < costsCall, "authorization runs before the costs request");
  assert(reader.indexOf("if (!adminKey)") < costsCall, "missing admin key returns before the costs request");
  assert(reader.includes("requireHostUser") && reader.includes("isSuperAdmin"), "default authorization is the Back Office founder gate");
  assert(!reader.includes("OPENAI_API_KEY"), "reader does not use the TTS key");
  assert(!pure.includes("OPENAI_ADMIN_KEY") && !pure.includes("OPENAI_API_KEY"), "pure costs module does not read secrets");
  assert(!card.includes("OPENAI_ADMIN_KEY") && !card.includes("openai-costs-read"), "card cannot see the admin key");
  assert(!card.includes("use client"), "card is not a client component");
  assert(!formula.includes("readOpenAiBackOfficeCosts"), "profit formula does not accept reconciled spend");
  assert(profitPage.includes("OpenAiReconciledSpendCard"), "profit page has its own reconciled card");
  assert(
    profitPage.indexOf("Monthly breakdown") < profitPage.indexOf("<OpenAiReconciledSpendCard"),
    "profit card sits outside the monthly calculation",
  );
  assert(profitPage.includes("is not included in this formula"), "profit copy keeps reconciled spend out of the formula");
  assert(expensesPage.includes("OpenAiReconciledSpendCard"), "expenses page has its own reconciled card");
  assert(usagePage.includes("OpenAiReconciledSpendCard"), "Isabela Usage has its own reconciled card");
  assert(usagePage.includes("Estimated tariff cost"), "Isabela Usage still shows the estimated tariff");
  assert(!expensesLib.includes("openai-costs"), "manual expenses do not absorb reconciled spend");
  assert(envExample.includes("# OPENAI_COSTS_PROJECT_ID="), "project id stays optional in the env example");
  assert(envExample.includes("# OPENAI_COSTS_API_KEY_ID="), "api key id stays optional in the env example");
  assert(envExample.includes("# OPENAI_ADMIN_KEY="), "admin key stays commented in the env example");

  const longAmount = "0.001000800000000000000000000000";
  const longReconciliation = readyBase({ amountValue: longAmount });
  const longView = presentOpenAiReconciledSpend(longReconciliation);
  assert(longReconciliation.amountValue === longAmount, "internal amount keeps every stored digit");
  assert(longView.value === "0.0010008 USD", "trailing decimal zeros are hidden without rounding");
  assert(presentOpenAiReconciledSpend(readyBase({ amountValue: "0.06" })).value === "0.06 USD", "a significant trailing digit stays");
  assert(presentOpenAiReconciledSpend(readyBase({ amountValue: "0.10" })).value === "0.1 USD", "one trailing fractional zero is hidden");
  assert(presentOpenAiReconciledSpend(readyBase({ amountValue: "10.00" })).value === "10 USD", "an integer amount drops a zero fraction");
  assert(presentOpenAiReconciledSpend(readyBase({ amountValue: "-1.2300" })).value === "-1.23 USD", "a negative amount keeps its sign and significant digits");
  assert(longView.scopeLabel.includes("Organization"), "trimmed spend still shows the scope");
  assert(longView.equivalenceNote.includes("not exactly"), "trimmed spend still separates the UTC window from New York");
  assert(longView.openDayNote?.includes("has not closed") === true, "trimmed spend still warns that the UTC day is open");
  const longHtml = renderToStaticMarkup(
    createElement(OpenAiReconciledSpendCard, { reconciliation: longReconciliation }),
  );
  assert(longHtml.includes("0.0010008 USD"), "rendered card hides trailing decimal zeros");
  assert(!longHtml.includes(longAmount), "rendered card does not repeat the untrimmed fraction");
  assert(longHtml.includes("Organization (no project or API key filter)"), "rendered trimmed card keeps the scope");
  assert(longHtml.includes("not exactly that month"), "rendered trimmed card keeps the month warning");
  assert(longHtml.includes("has not closed"), "rendered trimmed card keeps the open-day warning");

  const readyHtml = renderToStaticMarkup(createElement(OpenAiReconciledSpendCard, { reconciliation: readyBase() }));
  assert(readyHtml.includes("OpenAI reconciled spend"), "rendered card titles the reconciled spend");
  assert(readyHtml.includes("0.06 USD"), "rendered card shows the decimal amount and currency");
  assert(readyHtml.includes("Organization (no project or API key filter)"), "rendered card states organization scope");
  assert(readyHtml.includes("UTC window:"), "rendered card labels the UTC window");
  assert(readyHtml.includes("New York month:"), "rendered card labels the New York month separately");
  assert(readyHtml.includes("not exactly that month"), "rendered card says the windows are not the same month");
  assert(readyHtml.includes("Not included in Net Operating Profit"), "rendered card stays outside profit");
  assert(!readyHtml.includes(ADMIN_KEY), "rendered card does not contain the admin key");

  const unavailableHtml = renderToStaticMarkup(
    createElement(OpenAiReconciledSpendCard, {
      reconciliation: readyBase({ status: "unavailable", unavailableReason: "page_failed", amountValue: null, currency: null }),
    }),
  );
  assert(unavailableHtml.includes("— / No disponible"), "rendered failure is not a partial total");
  assert(!unavailableHtml.includes("0.06"), "rendered failure does not keep an earlier amount");

  const unconfiguredHtml = renderToStaticMarkup(
    createElement(OpenAiReconciledSpendCard, { reconciliation: unconfigured }),
  );
  assert(unconfiguredHtml.includes("Not configured"), "rendered missing key is not a zero total");
  assert(unconfiguredHtml.includes("Organization (no project or API key filter)"), "rendered missing key still names the organization");

  console.log("openai-costs tests passed");
}

runOpenAiCostsTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
