import { AI_USAGE_BACKOFFICE_TIMEZONE, aiUsageCalendarMonthUtcBounds } from "@/lib/ai-usage";

/**
 * Pure Costs API interpretation. Secrets stay in the authorized server reader.
 */

export const OPENAI_ORGANIZATION_COSTS_URL = "https://api.openai.com/v1/organization/costs";
export const OPENAI_COSTS_BUCKET_WIDTH = "1d";
export const OPENAI_COSTS_PAGE_LIMIT = 180;
export const OPENAI_COSTS_MAX_PAGES = 24;
const DAY_MS = 86_400_000;
const ZERO = BigInt(0);
const TEN = BigInt(10);

export const OPENAI_COSTS_UNAVAILABLE_LABEL = "— / No disponible";
export const OPENAI_COSTS_NOT_CONFIGURED_LABEL = "Not configured";
export const OPENAI_COSTS_SEPARATION_NOTE =
  "Separate from the Isabela estimated tariff, pending costs, and the manual ledger. Not included in Net Operating Profit.";

export type OpenAiCostsFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    redirect?: "manual";
    cache?: "no-store";
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type OpenAiCostsFailureReason =
  | "unauthorized"
  | "page_failed"
  | "missing_amount"
  | "mixed_currency"
  | "invalid_page";

export type OpenAiCostsScopeKind = "organization" | "project" | "api_key" | "project_and_api_key";

export type OpenAiCostsReconciliation = {
  status: "ready" | "not_configured" | "unavailable";
  unavailableReason: OpenAiCostsFailureReason | null;
  amountValue: string | null;
  currency: string | null;
  scopeKind: OpenAiCostsScopeKind;
  projectId: string | null;
  apiKeyId: string | null;
  nyMonthLabel: string;
  nyRangeStartUtc: string;
  nyRangeEndUtc: string;
  utcWindowStart: string;
  utcWindowEnd: string;
  includesOpenUtcDay: boolean;
  equivalenceNote: string;
};

type SignedDecimal = { sign: 1 | -1; scaled: bigint; scale: number };

type CostLine = { currency: string; amount: SignedDecimal };

type ParsedPage = {
  hasMore: boolean;
  nextPage: string | null;
  lines: CostLine[];
};

export type OpenAiCostsCollectResult =
  | { ok: true; amountValue: string; currency: string | null }
  | { ok: false; reason: Exclude<OpenAiCostsFailureReason, "unauthorized"> };

export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Exclusive end of the UTC day bucket that contains `date`. An exact midnight stays on that midnight. */
export function utcDayBucketEndExclusive(date: Date): Date {
  const start = utcDayStart(date);
  if (start.getTime() === date.getTime()) return start;
  return new Date(start.getTime() + DAY_MS);
}

export function openAiCostsUtcWindowForNewYorkMonth(now = new Date()): {
  nyMonthLabel: string;
  nyRangeStartUtc: Date;
  nyRangeEndUtc: Date;
  utcWindowStart: Date;
  utcWindowEnd: Date;
  includesOpenUtcDay: boolean;
  equivalenceNote: string;
} {
  const month = aiUsageCalendarMonthUtcBounds(now, AI_USAGE_BACKOFFICE_TIMEZONE);
  const utcWindowStart = utcDayStart(month.startUtc);
  const utcWindowEnd = utcDayBucketEndExclusive(month.endUtc);
  const todayStart = utcDayStart(now);
  const todayEnd = new Date(todayStart.getTime() + DAY_MS);
  const includesOpenUtcDay =
    utcWindowStart.getTime() < todayEnd.getTime() &&
    utcWindowEnd.getTime() > todayStart.getTime() &&
    now.getTime() < utcWindowEnd.getTime();
  const matchesMonth =
    utcWindowStart.getTime() === month.startUtc.getTime() && utcWindowEnd.getTime() === month.endUtc.getTime();
  return {
    nyMonthLabel: month.label,
    nyRangeStartUtc: month.startUtc,
    nyRangeEndUtc: month.endUtc,
    utcWindowStart,
    utcWindowEnd,
    includesOpenUtcDay,
    equivalenceNote: matchesMonth
      ? "The UTC window matches the America/New_York month bounds."
      : "UTC daily buckets cover the America/New_York month. They are not exactly that month.",
  };
}

export function resolveOpenAiCostsScope(input: {
  projectId?: string | null;
  apiKeyId?: string | null;
}): { scopeKind: OpenAiCostsScopeKind; projectId: string | null; apiKeyId: string | null } {
  const projectId = input.projectId?.trim() || null;
  const apiKeyId = input.apiKeyId?.trim() || null;
  if (projectId && apiKeyId) return { scopeKind: "project_and_api_key", projectId, apiKeyId };
  if (projectId) return { scopeKind: "project", projectId, apiKeyId: null };
  if (apiKeyId) return { scopeKind: "api_key", projectId: null, apiKeyId };
  return { scopeKind: "organization", projectId: null, apiKeyId: null };
}

export function openAiCostsScopeLabel(input: {
  scopeKind: OpenAiCostsScopeKind;
  projectId: string | null;
  apiKeyId: string | null;
}): string {
  if (input.scopeKind === "project" && input.projectId) return `Project ${input.projectId}`;
  if (input.scopeKind === "api_key" && input.apiKeyId) return `API key ${input.apiKeyId}`;
  if (input.scopeKind === "project_and_api_key" && input.projectId && input.apiKeyId) {
    return `Project ${input.projectId} · API key ${input.apiKeyId}`;
  }
  return "Organization (no project or API key filter)";
}

export function openAiOrganizationCostsUrl(input: {
  startTimeUnix: number;
  endTimeUnix: number;
  page?: string | null;
  projectId?: string | null;
  apiKeyId?: string | null;
}): string {
  const url = new URL(OPENAI_ORGANIZATION_COSTS_URL);
  url.searchParams.set("start_time", String(input.startTimeUnix));
  url.searchParams.set("end_time", String(input.endTimeUnix));
  url.searchParams.set("bucket_width", OPENAI_COSTS_BUCKET_WIDTH);
  url.searchParams.set("limit", String(OPENAI_COSTS_PAGE_LIMIT));
  if (input.page) url.searchParams.set("page", input.page);
  if (input.projectId) url.searchParams.append("project_ids", input.projectId);
  if (input.apiKeyId) url.searchParams.append("api_key_ids", input.apiKeyId);
  return url.toString();
}

export function quoteOpenAiCostAmountValues(body: string): string {
  return body.replace(/("value"\s*:\s*)(-?\d+(?:\.\d+)?)(?=\s*[,}\]])/g, '$1"$2"');
}

export function sumOpenAiCostDecimals(values: readonly string[]): string | null {
  let total: SignedDecimal | null = null;
  for (const value of values) {
    const parsed = parseDecimal(value);
    if (!parsed) return null;
    total = total ? addDecimals(total, parsed) : parsed;
  }
  return total ? formatDecimal(total) : "0";
}

export async function collectOpenAiOrganizationCosts(input: {
  fetchImpl: OpenAiCostsFetch;
  adminKey: string;
  startTimeUnix: number;
  endTimeUnix: number;
  projectId?: string | null;
  apiKeyId?: string | null;
}): Promise<OpenAiCostsCollectResult> {
  const seenPages = new Set<string>();
  let page: string | null = null;
  let total: SignedDecimal | null = null;
  let currency: string | null = null;
  let sawAmount = false;

  for (let pageNumber = 0; pageNumber < OPENAI_COSTS_MAX_PAGES; pageNumber += 1) {
    const pageKey = page ?? "";
    if (seenPages.has(pageKey)) return { ok: false, reason: "invalid_page" };
    seenPages.add(pageKey);

    const url = openAiOrganizationCostsUrl({
      startTimeUnix: input.startTimeUnix,
      endTimeUnix: input.endTimeUnix,
      page,
      projectId: input.projectId,
      apiKeyId: input.apiKeyId,
    });

    let response: { ok: boolean; status: number; text(): Promise<string> };
    try {
      response = await input.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${input.adminKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return { ok: false, reason: "page_failed" };
    }
    if (!response.ok || response.status < 200 || response.status >= 300) {
      return { ok: false, reason: "page_failed" };
    }

    let body = "";
    try {
      body = await response.text();
    } catch {
      return { ok: false, reason: "page_failed" };
    }

    const parsed = parseCostsPage(body);
    if (!parsed.ok) return parsed;

    for (const line of parsed.page.lines) {
      if (currency && line.currency !== currency) return { ok: false, reason: "mixed_currency" };
      currency = line.currency;
      total = total ? addDecimals(total, line.amount) : line.amount;
      sawAmount = true;
    }

    if (!parsed.page.hasMore) {
      if (!sawAmount || !total) return { ok: true, amountValue: "0", currency: null };
      return { ok: true, amountValue: formatDecimal(total), currency };
    }
    if (!parsed.page.nextPage) return { ok: false, reason: "invalid_page" };
    page = parsed.page.nextPage;
  }

  return { ok: false, reason: "invalid_page" };
}

export function presentOpenAiReconciledSpend(input: OpenAiCostsReconciliation): {
  value: string;
  scopeLabel: string;
  utcWindowLabel: string;
  nyMonthLabel: string;
  equivalenceNote: string;
  openDayNote: string | null;
  statusNote: string | null;
  separationNote: string;
} {
  const scopeLabel = openAiCostsScopeLabel(input);
  const utcWindowLabel = `${input.utcWindowStart} → ${input.utcWindowEnd}`;
  const nyMonthLabel = `${input.nyMonthLabel} · ${input.nyRangeStartUtc} → ${input.nyRangeEndUtc}`;
  let value = OPENAI_COSTS_UNAVAILABLE_LABEL;
  let statusNote: string | null = "Spend is unavailable. An incomplete sum is not shown as the total.";
  if (input.status === "not_configured") {
    value = OPENAI_COSTS_NOT_CONFIGURED_LABEL;
    statusNote = "OpenAI admin key is not configured. Spend was not requested.";
  } else if (input.status === "ready" && input.amountValue != null) {
    const amount = presentDecimalAmount(input.amountValue);
    value = input.currency ? `${amount} ${input.currency.toUpperCase()}` : amount;
    statusNote = input.currency
      ? null
      : "No cost lines were returned for this window. Missing days were not filled with zero.";
  } else if (input.unavailableReason === "unauthorized") {
    statusNote = "Back Office authorization is required. Spend was not requested.";
  } else if (input.unavailableReason === "mixed_currency") {
    statusNote = "The costs read mixed currencies. Spend is unavailable.";
  } else if (input.unavailableReason === "missing_amount") {
    statusNote = "A cost line had no amount. Spend is unavailable.";
  } else if (input.unavailableReason === "page_failed") {
    statusNote = "The costs read did not finish. Spend is unavailable.";
  } else if (input.unavailableReason === "invalid_page") {
    statusNote = "The costs read returned an incomplete page. Spend is unavailable.";
  }
  return {
    value,
    scopeLabel,
    utcWindowLabel,
    nyMonthLabel,
    equivalenceNote: input.equivalenceNote,
    openDayNote: input.includesOpenUtcDay
      ? "This window includes the current UTC day, which has not closed."
      : null,
    statusNote,
    separationNote: OPENAI_COSTS_SEPARATION_NOTE,
  };
}

export function reconciliationFromWindow(input: {
  window: ReturnType<typeof openAiCostsUtcWindowForNewYorkMonth>;
  scope: ReturnType<typeof resolveOpenAiCostsScope>;
  status: OpenAiCostsReconciliation["status"];
  unavailableReason: OpenAiCostsFailureReason | null;
  amountValue: string | null;
  currency: string | null;
}): OpenAiCostsReconciliation {
  return {
    status: input.status,
    unavailableReason: input.unavailableReason,
    amountValue: input.amountValue,
    currency: input.currency,
    scopeKind: input.scope.scopeKind,
    projectId: input.scope.projectId,
    apiKeyId: input.scope.apiKeyId,
    nyMonthLabel: input.window.nyMonthLabel,
    nyRangeStartUtc: input.window.nyRangeStartUtc.toISOString(),
    nyRangeEndUtc: input.window.nyRangeEndUtc.toISOString(),
    utcWindowStart: input.window.utcWindowStart.toISOString(),
    utcWindowEnd: input.window.utcWindowEnd.toISOString(),
    includesOpenUtcDay: input.window.includesOpenUtcDay,
    equivalenceNote: input.window.equivalenceNote,
  };
}

/** Display only. Drops trailing fractional zeros and does not round or alter the stored amount. */
function presentDecimalAmount(amountValue: string): string {
  if (!/^-?\d+\.\d+$/.test(amountValue)) return amountValue;
  const trimmed = amountValue.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return trimmed === "-0" ? "0" : trimmed;
}

function parseCostsPage(body: string): { ok: true; page: ParsedPage } | { ok: false; reason: "invalid_page" | "missing_amount" } {
  let raw: unknown;
  try {
    raw = JSON.parse(quoteOpenAiCostAmountValues(body));
  } catch {
    return { ok: false, reason: "invalid_page" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_page" };
  const record = raw as Record<string, unknown>;
  if (record.object !== "page" || !Array.isArray(record.data) || typeof record.has_more !== "boolean") {
    return { ok: false, reason: "invalid_page" };
  }
  const nextPage = typeof record.next_page === "string" && record.next_page.trim() ? record.next_page.trim() : null;
  const lines: CostLine[] = [];
  for (const bucket of record.data) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) return { ok: false, reason: "invalid_page" };
    const results = (bucket as Record<string, unknown>).results;
    if (!Array.isArray(results)) return { ok: false, reason: "invalid_page" };
    for (const result of results) {
      const line = parseCostLine(result);
      if (!line.ok) return line;
      if (line.line) lines.push(line.line);
    }
  }
  return { ok: true, page: { hasMore: record.has_more, nextPage, lines } };
}

function parseCostLine(
  result: unknown,
): { ok: true; line: CostLine | null } | { ok: false; reason: "missing_amount" | "invalid_page" } {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { ok: false, reason: "invalid_page" };
  const amount = (result as Record<string, unknown>).amount;
  if (amount == null) return { ok: false, reason: "missing_amount" };
  if (typeof amount !== "object" || Array.isArray(amount)) return { ok: false, reason: "missing_amount" };
  const record = amount as Record<string, unknown>;
  if (typeof record.value !== "string" || typeof record.currency !== "string") {
    return { ok: false, reason: "missing_amount" };
  }
  const currency = record.currency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) return { ok: false, reason: "missing_amount" };
  const parsed = parseDecimal(record.value);
  if (!parsed) return { ok: false, reason: "missing_amount" };
  return { ok: true, line: { currency, amount: parsed } };
}

function parseDecimal(raw: string): SignedDecimal | null {
  const text = raw.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole, frac = ""] = body.split(".");
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, "") || "0";
  return { sign: negative ? -1 : 1, scaled: BigInt(digits), scale: frac.length };
}

function addDecimals(left: SignedDecimal, right: SignedDecimal): SignedDecimal {
  const scale = Math.max(left.scale, right.scale);
  const sum = signedScaled(left, scale) + signedScaled(right, scale);
  return { sign: sum < ZERO ? -1 : 1, scaled: sum < ZERO ? -sum : sum, scale };
}

function signedScaled(value: SignedDecimal, scale: number): bigint {
  const magnitude = value.scaled * TEN ** BigInt(scale - value.scale);
  return value.sign < 0 ? -magnitude : magnitude;
}

function formatDecimal(value: SignedDecimal): string {
  const negative = value.sign < 0 && value.scaled !== ZERO;
  const digits = value.scaled.toString().padStart(value.scale + 1, "0");
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const whole = digits.slice(0, digits.length - value.scale);
  const frac = digits.slice(digits.length - value.scale);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
