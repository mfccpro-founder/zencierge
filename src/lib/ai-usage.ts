import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AI_PRICING_SEED_RULES,
  formatUsdFromCents,
  getOpenAiActualSpendReconciliationStatus,
  resolveAiUsageEventCost,
  type AiCostClass,
  type AiPricingRule,
} from "@/lib/ai-pricing";
import { tryCreateSupabaseAdminClient } from "@/lib/supabase-admin";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("ai-usage is server-only");
}

export const AI_USAGE_BACKOFFICE_TIMEZONE = "America/New_York";
export const AI_USAGE_MONTH_PAGE_SIZE = 1000;
export const AI_USAGE_MONTH_MAX_ROWS = 50_000;

export const AI_USAGE_UNAVAILABLE_LABEL = "— / No disponible";
export const AI_USAGE_READ_UNAVAILABLE_NOTE =
  "TTS usage is unavailable. Counts and costs are not an empty month.";
export const AI_USAGE_READ_INCOMPLETE_CAP_NOTE =
  "Monthly TTS read stopped at the safety cap. Totals are incomplete and are not the full month.";
export const AI_USAGE_READ_INCOMPLETE_ERROR_NOTE =
  "A later page of TTS usage failed to load. Totals are incomplete and are not the full month.";

export const AI_USAGE_SOURCES = [
  "guest_stay_tts",
  "guest_stay_welcome_tts",
  "host_tts",
] as const;

export type AiUsageSource = (typeof AI_USAGE_SOURCES)[number];
export type AiUsageOperation = "tts" | "stt" | "llm";
export type AiUsageStatus = "success" | "failed";

export type AiUsageEventInput = {
  host_id?: string | null;
  property_id?: string | null;
  reservation_id?: string | null;
  source: AiUsageSource | string;
  provider: string;
  model: string;
  operation: AiUsageOperation;
  status: AiUsageStatus;
  input_characters?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  audio_duration_ms?: number | null;
  audio_bytes?: number | null;
  /** Ignored on write — resolved from versioned pricing rules. */
  calculated_cost_cents?: number | null;
  pricing_rule_id?: string | null;
  cost_class?: AiCostClass | null;
  request_id?: string | null;
  /** Event time for historical pricing (defaults to now). */
  priced_at?: Date;
};

export type AiUsageRecorder = (event: AiUsageEventInput) => void | Promise<void>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asNullableUuid(value: string | null | undefined): string | null {
  const id = typeof value === "string" ? value.trim() : "";
  return UUID_RE.test(id) ? id : null;
}

function asNullableText(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text : null;
}

function asNullableInt(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function zonedLocalToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  timeZone: string,
) {
  const zone = timeZone.trim() || "UTC";
  let utc = Date.UTC(year, month - 1, day, hours, minutes, 0);
  for (let i = 0; i < 4; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(utc));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value);
    let localHour = read("hour");
    if (localHour === 24) localHour = 0;
    const asIfUtc = Date.UTC(read("year"), read("month") - 1, read("day"), localHour, read("minute"));
    const wanted = Date.UTC(year, month - 1, day, hours, minutes);
    utc += wanted - asIfUtc;
  }
  return new Date(utc);
}

/** Calendar month bounds in UTC for a reporting IANA zone (DB rows stay UTC). */
export function aiUsageCalendarMonthUtcBounds(
  now = new Date(),
  timeZone = AI_USAGE_BACKOFFICE_TIMEZONE,
): { startUtc: Date; endUtc: Date; year: number; month: number; label: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const startUtc = zonedLocalToUtc(year, month, 1, 0, 0, timeZone);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const endUtc = zonedLocalToUtc(nextYear, nextMonth, 1, 0, 0, timeZone);
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    year: "numeric",
  }).format(startUtc);
  return { startUtc, endUtc, year, month, label };
}

export function sanitizeAiUsageEventRow(
  input: AiUsageEventInput,
  options?: { rules?: readonly AiPricingRule[]; at?: Date },
) {
  const priced = resolveAiUsageEventCost({
    provider: String(input.provider),
    model: String(input.model),
    operation: input.operation,
    status: input.status,
    input_characters: input.input_characters,
    input_tokens: input.input_tokens,
    output_tokens: input.output_tokens,
    at: options?.at ?? input.priced_at ?? new Date(),
    rules: options?.rules ?? AI_PRICING_SEED_RULES,
  });

  return {
    host_id: asNullableUuid(input.host_id),
    property_id: asNullableText(input.property_id),
    reservation_id: asNullableText(input.reservation_id),
    source: String(input.source).trim().slice(0, 64),
    provider: String(input.provider).trim().slice(0, 64),
    model: String(input.model).trim().slice(0, 128),
    operation: input.operation,
    status: input.status,
    input_characters: asNullableInt(input.input_characters),
    input_tokens: asNullableInt(input.input_tokens),
    output_tokens: asNullableInt(input.output_tokens),
    audio_duration_ms: asNullableInt(input.audio_duration_ms),
    audio_bytes: asNullableInt(input.audio_bytes),
    calculated_cost_cents: priced.calculated_cost_cents,
    pricing_rule_id: priced.pricing_rule_id,
    cost_class: priced.cost_class,
    request_id: asNullableText(input.request_id)?.slice(0, 128) ?? null,
  };
}

/**
 * Append-only usage write. Never throws. Never blocks callers with retries.
 * Does not store prompts, transcripts, audio, tokens, or secrets.
 */
export async function recordAiUsageEvent(input: AiUsageEventInput): Promise<void> {
  try {
    const admin = tryCreateSupabaseAdminClient();
    if (!admin) return;
    const row = sanitizeAiUsageEventRow(input);
    if (!row.source || !row.provider || !row.model) return;
    const { error } = await admin.from("ai_usage_events").insert(row);
    if (error) {
      console.warn("[ai-usage] insert failed", error.code ?? "unknown");
    }
  } catch {
    console.warn("[ai-usage] insert failed");
  }
}

export async function safeRecordAiUsageEvent(
  recorder: AiUsageRecorder | undefined,
  event: AiUsageEventInput,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder(event);
  } catch {
    console.warn("[ai-usage] recorder failed");
  }
}

export async function lookupPropertyHostIdForUsage(
  admin: SupabaseClient,
  propertyId: string | null | undefined,
): Promise<string | null> {
  const id = asNullableText(propertyId);
  if (!id) return null;
  try {
    const { data, error } = await admin.from("properties").select("host_id").eq("id", id).maybeSingle();
    if (error || !data) return null;
    return asNullableUuid(typeof data.host_id === "string" ? data.host_id : null);
  } catch {
    return null;
  }
}

export type GuestStayUsageAttribution = {
  property_id: string | null;
  reservation_id: string | null;
  host_id: string | null;
};

export async function resolveGuestStayUsageAttribution(input: {
  propertyId: string | null | undefined;
  reservationId: string | null | undefined;
  resolveHostId?: (propertyId: string) => Promise<string | null>;
}): Promise<GuestStayUsageAttribution> {
  const property_id = asNullableText(input.propertyId);
  const reservation_id = asNullableText(input.reservationId);
  let host_id: string | null = null;
  if (property_id && input.resolveHostId) {
    try {
      host_id = asNullableUuid(await input.resolveHostId(property_id));
    } catch {
      host_id = null;
    }
  }
  return { property_id, reservation_id, host_id };
}

export type AiUsageProviderBreakdownRow = {
  provider: string;
  requests: number;
  characters: number;
  costClassLabel: string;
  exactCostCents: number | null;
  pendingEvents: number;
};

export type AiUsageModelBreakdownRow = {
  provider: string;
  model: string;
  requests: number;
  characters: number;
  costClassLabel: string;
  exactCostCents: number | null;
  pendingEvents: number;
};

export type AiUsageExactAttributionRow = {
  id: string;
  exactCostCents: number;
  exactEvents: number;
  characters: number;
};

export type AiUsageMonthSnapshot = {
  serviceRoleReady: boolean;
  error: string | null;
  timeZone: typeof AI_USAGE_BACKOFFICE_TIMEZONE;
  monthLabel: string;
  rangeStartUtc: string;
  rangeEndUtc: string;
  ttsRequests: number;
  ttsSuccessful: number;
  ttsFailed: number;
  charactersSynthesized: number;
  byProvider: AiUsageProviderBreakdownRow[];
  byModel: AiUsageModelBreakdownRow[];
  exactTrackedCostCents: number | null;
  exactTrackedCostLabel: string;
  pendingExactPricingEvents: number;
  pendingExactPricingCharacters: number;
  totalsArePartial: boolean;
  partialTotalsNote: string | null;
  /** True when a later page or the safety cap stopped the read. Distinct from an unavailable first page. */
  readIncomplete: boolean;
  readIncompleteNote: string | null;
  /** True when the first page failed. Counts are not a valid zero. */
  readUnavailable: boolean;
  readUnavailableNote: string | null;
  costPerCustomer: AiUsageExactAttributionRow[];
  costPerStay: AiUsageExactAttributionRow[];
  openaiSpendReconciliation: string;
  costNote: string;
};

type UsageRow = {
  provider: string | null;
  model: string | null;
  status: string | null;
  input_characters: number | null;
  calculated_cost_cents: number | null;
  pricing_rule_id: string | null;
  cost_class: string | null;
  operation: string | null;
  host_id: string | null;
  reservation_id: string | null;
  property_id: string | null;
};

function tariffProviderName(provider: string): string {
  const p = provider.toLowerCase();
  if (p === "elevenlabs") return "ElevenLabs";
  if (p === "openai") return "OpenAI";
  return provider;
}

/** Local-tariff rows, including historical cost_class "exact", are estimates. Unknown stays unlabeled as money. */
export function presentTariffCost(input: {
  provider: string;
  tariffCents: number;
  hasTariff: boolean;
  unknownEvents: number;
}): { exactCostCents: number | null; costClassLabel: string } {
  const name = tariffProviderName(input.provider);
  if (!input.hasTariff) {
    return { exactCostCents: null, costClassLabel: `${name} — cost unknown` };
  }
  const estimated = `${name} — estimated from configured tariff`;
  return {
    exactCostCents: input.tariffCents,
    costClassLabel: input.unknownEvents > 0 ? `${estimated} · some costs unknown` : estimated,
  };
}

function emptySnapshot(
  bounds: ReturnType<typeof aiUsageCalendarMonthUtcBounds>,
  extra: Partial<AiUsageMonthSnapshot> = {},
): AiUsageMonthSnapshot {
  const openai = getOpenAiActualSpendReconciliationStatus();
  return {
    serviceRoleReady: false,
    error: null,
    timeZone: AI_USAGE_BACKOFFICE_TIMEZONE,
    monthLabel: bounds.label,
    rangeStartUtc: bounds.startUtc.toISOString(),
    rangeEndUtc: bounds.endUtc.toISOString(),
    ttsRequests: 0,
    ttsSuccessful: 0,
    ttsFailed: 0,
    charactersSynthesized: 0,
    byProvider: [],
    byModel: [],
    exactTrackedCostCents: null,
    exactTrackedCostLabel: "—",
    pendingExactPricingEvents: 0,
    pendingExactPricingCharacters: 0,
    totalsArePartial: false,
    partialTotalsNote: null,
    readIncomplete: false,
    readIncompleteNote: null,
    readUnavailable: false,
    readUnavailableNote: null,
    costPerCustomer: [],
    costPerStay: [],
    openaiSpendReconciliation: openai.label,
    costNote:
      "Tariff amounts are estimates from configured local rates, including historical rows stored as exact. Unknown costs stay unknown and are not $0. This is not a reconciled provider invoice.",
    ...extra,
  };
}

export function aggregateAiUsageRows(rows: UsageRow[]): Pick<
  AiUsageMonthSnapshot,
  | "ttsRequests"
  | "ttsSuccessful"
  | "ttsFailed"
  | "charactersSynthesized"
  | "byProvider"
  | "byModel"
  | "exactTrackedCostCents"
  | "exactTrackedCostLabel"
  | "pendingExactPricingEvents"
  | "pendingExactPricingCharacters"
  | "totalsArePartial"
  | "partialTotalsNote"
  | "costPerCustomer"
  | "costPerStay"
> {
  const providerMap = new Map<
    string,
    {
      requests: number;
      characters: number;
      tariffCents: number;
      hasTariff: boolean;
      pendingEvents: number;
      unknownEvents: number;
    }
  >();
  const modelMap = new Map<
    string,
    {
      provider: string;
      model: string;
      requests: number;
      characters: number;
      tariffCents: number;
      hasTariff: boolean;
      pendingEvents: number;
      unknownEvents: number;
    }
  >();
  const hostMap = new Map<string, { exactCostCents: number; exactEvents: number; characters: number }>();
  const stayMap = new Map<string, { exactCostCents: number; exactEvents: number; characters: number }>();

  let ttsRequests = 0;
  let ttsSuccessful = 0;
  let ttsFailed = 0;
  let charactersSynthesized = 0;
  let exactTrackedCostCents = 0;
  let hasExactCost = false;
  let pendingExactPricingEvents = 0;
  let pendingExactPricingCharacters = 0;

  for (const row of rows) {
    if (row.operation !== "tts") continue;
    ttsRequests += 1;
    const chars =
      typeof row.input_characters === "number" && Number.isFinite(row.input_characters)
        ? Math.max(0, Math.trunc(row.input_characters))
        : 0;
    const provider = (row.provider ?? "unknown").trim() || "unknown";
    const model = (row.model ?? "unknown").trim() || "unknown";
    const costClass = row.cost_class === "exact" || row.cost_class === "pending" ? row.cost_class : null;
    const exactCents =
      costClass === "exact" &&
      typeof row.calculated_cost_cents === "number" &&
      Number.isFinite(row.calculated_cost_cents)
        ? Math.trunc(row.calculated_cost_cents)
        : null;

    if (row.status === "success") {
      ttsSuccessful += 1;
      charactersSynthesized += chars;
      if (costClass === "pending" || (costClass == null && exactCents == null && provider.toLowerCase() === "openai")) {
        pendingExactPricingEvents += 1;
        pendingExactPricingCharacters += chars;
      }
      if (exactCents != null) {
        hasExactCost = true;
        exactTrackedCostCents += exactCents;
      }
    } else if (row.status === "failed") {
      ttsFailed += 1;
    }

    const priced = exactCents != null;
    const unknown = !priced;
    const p = providerMap.get(provider) ?? {
      requests: 0,
      characters: 0,
      tariffCents: 0,
      hasTariff: false,
      pendingEvents: 0,
      unknownEvents: 0,
    };
    p.requests += 1;
    if (row.status === "success") p.characters += chars;
    if (priced && exactCents != null) {
      p.tariffCents += exactCents;
      p.hasTariff = true;
    }
    if (unknown) p.unknownEvents += 1;
    if (row.status === "success" && (costClass === "pending" || (exactCents == null && provider.toLowerCase() === "openai"))) {
      p.pendingEvents += 1;
    }
    providerMap.set(provider, p);

    const key = `${provider}::${model}`;
    const m = modelMap.get(key) ?? {
      provider,
      model,
      requests: 0,
      characters: 0,
      tariffCents: 0,
      hasTariff: false,
      pendingEvents: 0,
      unknownEvents: 0,
    };
    m.requests += 1;
    if (row.status === "success") m.characters += chars;
    if (priced && exactCents != null) {
      m.tariffCents += exactCents;
      m.hasTariff = true;
    }
    if (unknown) m.unknownEvents += 1;
    if (row.status === "success" && (costClass === "pending" || (exactCents == null && provider.toLowerCase() === "openai"))) {
      m.pendingEvents += 1;
    }
    modelMap.set(key, m);

    if (exactCents != null && row.status === "success") {
      const hostId = asNullableUuid(row.host_id);
      if (hostId) {
        const h = hostMap.get(hostId) ?? { exactCostCents: 0, exactEvents: 0, characters: 0 };
        h.exactCostCents += exactCents;
        h.exactEvents += 1;
        h.characters += chars;
        hostMap.set(hostId, h);
      }
      const stayId = asNullableText(row.reservation_id);
      if (stayId) {
        const s = stayMap.get(stayId) ?? { exactCostCents: 0, exactEvents: 0, characters: 0 };
        s.exactCostCents += exactCents;
        s.exactEvents += 1;
        s.characters += chars;
        stayMap.set(stayId, s);
      }
    }
  }

  const totalsArePartial = pendingExactPricingEvents > 0;

  return {
    ttsRequests,
    ttsSuccessful,
    ttsFailed,
    charactersSynthesized,
    exactTrackedCostCents: hasExactCost ? exactTrackedCostCents : null,
    exactTrackedCostLabel: hasExactCost ? formatUsdFromCents(exactTrackedCostCents) : "—",
    pendingExactPricingEvents,
    pendingExactPricingCharacters,
    totalsArePartial,
    partialTotalsNote: totalsArePartial
      ? "Some TTS costs are unknown. They are excluded from the tariff estimate and are not shown as $0."
      : null,
    byProvider: [...providerMap.entries()]
      .map(([provider, value]) => ({
        provider,
        requests: value.requests,
        characters: value.characters,
        pendingEvents: value.pendingEvents,
        ...presentTariffCost({
          provider,
          tariffCents: value.tariffCents,
          hasTariff: value.hasTariff,
          unknownEvents: value.unknownEvents,
        }),
      }))
      .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider)),
    byModel: [...modelMap.values()]
      .map((row) => ({
        provider: row.provider,
        model: row.model,
        requests: row.requests,
        characters: row.characters,
        pendingEvents: row.pendingEvents,
        ...presentTariffCost({
          provider: row.provider,
          tariffCents: row.tariffCents,
          hasTariff: row.hasTariff,
          unknownEvents: row.unknownEvents,
        }),
      }))
      .sort(
        (a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model),
      ),
    costPerCustomer: [...hostMap.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.exactCostCents - a.exactCostCents || a.id.localeCompare(b.id)),
    costPerStay: [...stayMap.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.exactCostCents - a.exactCostCents || a.id.localeCompare(b.id)),
  };
}

export type HostTtsMeterMonth = {
  logicalRequests: number;
  completedRequests: number;
  failedRequests: number;
  /** Attempts with response_observed_at set, including those whose result later became uncertain. */
  observedAttempts: number;
  characters: number;
  pendingCostAttempts: number;
  pendingCharacters: number;
  estimatedCostCents: number | null;
  totalsPartial: boolean;
};

export const HOST_TTS_METER_BACKOFFICE_RPC = "summarize_host_tts_meter_backoffice";
export const HOST_TTS_METER_READ_INCOMPLETE_NOTE =
  "Host TTS meter could not be read. Totals are incomplete and are not the full month.";

type UsageAggregate = ReturnType<typeof aggregateAiUsageRows>;

/**
 * Adds host_tts meter totals to an events aggregate.
 * Metered host playback is not also written to ai_usage_events, so this adds each playback once.
 * Guest usage stays in the events aggregate. A null estimated total is not added as zero.
 * The write flag does not decide this merge. Recorded meter rows stay visible when new writes return to events.
 */
export function mergeHostTtsMeterMonth(aggregate: UsageAggregate, meter: HostTtsMeterMonth): UsageAggregate {
  const exact =
    meter.estimatedCostCents == null
      ? aggregate.exactTrackedCostCents
      : (aggregate.exactTrackedCostCents ?? 0) + meter.estimatedCostCents;
  const pendingEvents = aggregate.pendingExactPricingEvents + meter.pendingCostAttempts;
  const totalsArePartial = aggregate.totalsArePartial || meter.totalsPartial || meter.pendingCostAttempts > 0;
  return {
    ...aggregate,
    ttsRequests: aggregate.ttsRequests + meter.logicalRequests,
    ttsSuccessful: aggregate.ttsSuccessful + meter.completedRequests,
    ttsFailed: aggregate.ttsFailed + meter.failedRequests,
    charactersSynthesized: aggregate.charactersSynthesized + meter.characters,
    exactTrackedCostCents: exact,
    exactTrackedCostLabel: exact == null ? "—" : formatUsdFromCents(exact),
    pendingExactPricingEvents: pendingEvents,
    pendingExactPricingCharacters: aggregate.pendingExactPricingCharacters + meter.pendingCharacters,
    totalsArePartial,
    partialTotalsNote: totalsArePartial
      ? (aggregate.partialTotalsNote ??
        "Some TTS costs are unknown. They are excluded from the tariff estimate and are not shown as $0.")
      : null,
    byProvider: addHostTtsMeterBucket(aggregate.byProvider, meter, (row) => row.provider.toLowerCase() === "openai", {
      provider: "OpenAI",
    }),
    byModel: addHostTtsMeterBucket(
      aggregate.byModel,
      meter,
      (row) => row.provider.toLowerCase() === "openai" && row.model === "gpt-4o-mini-tts",
      { provider: "OpenAI", model: "gpt-4o-mini-tts" },
    ),
  };
}

function addHostTtsMeterBucket<T extends UsageAggregate["byProvider"][number]>(
  rows: readonly T[],
  meter: HostTtsMeterMonth,
  match: (row: T) => boolean,
  seed: Partial<T> & { provider: string },
): T[] {
  if (meter.logicalRequests === 0 && meter.pendingCostAttempts === 0 && meter.estimatedCostCents == null && meter.characters === 0) {
    return [...rows];
  }
  const next = rows.map((row) => ({ ...row }));
  let row = next.find(match);
  if (!row) {
    row = {
      requests: 0,
      characters: 0,
      pendingEvents: 0,
      exactCostCents: null,
      costClassLabel: "OpenAI — cost unknown",
      ...seed,
    } as T;
    next.push(row);
  }
  const previousExact = row.exactCostCents;
  const previousUnknown = previousExact == null ? row.requests : row.costClassLabel.includes("unknown") ? row.requests : 0;
  row.requests += meter.logicalRequests;
  row.characters += meter.characters;
  row.pendingEvents += meter.pendingCostAttempts;
  const hasTariff = previousExact != null || meter.estimatedCostCents != null;
  const tariffCents = (previousExact ?? 0) + (meter.estimatedCostCents ?? 0);
  const priced = presentTariffCost({
    provider: row.provider,
    tariffCents,
    hasTariff,
    unknownEvents: previousUnknown + (meter.estimatedCostCents == null ? meter.logicalRequests : 0),
  });
  row.exactCostCents = priced.exactCostCents;
  row.costClassLabel = priced.costClassLabel;
  return next.sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider));
}

function meterCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export async function readHostTtsMeterMonth(
  admin: { rpc: AiUsageMeterRpc },
  from: Date,
  to: Date,
): Promise<{ ok: true; summary: HostTtsMeterMonth } | { ok: false; error: string }> {
  const { data, error } = await admin.rpc(HOST_TTS_METER_BACKOFFICE_RPC, {
    p_from: from.toISOString(),
    p_to: to.toISOString(),
  });
  if (error) return { ok: false, error: "Could not read the host TTS meter." };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return { ok: false, error: "Could not read the host TTS meter." };
  const record = row as Record<string, unknown>;
  const logicalRequests = meterCount(record.logical_requests);
  const completedRequests = meterCount(record.completed_requests);
  const failedRequests = meterCount(record.failed_requests);
  const observedAttempts = meterCount(record.observed_attempts);
  const characters = meterCount(record.characters);
  const pendingCostAttempts = meterCount(record.pending_cost_attempts);
  const pendingCharacters = meterCount(record.pending_characters);
  if (
    logicalRequests == null ||
    completedRequests == null ||
    failedRequests == null ||
    observedAttempts == null ||
    characters == null ||
    pendingCostAttempts == null ||
    pendingCharacters == null
  ) {
    return { ok: false, error: "Could not read the host TTS meter." };
  }
  const estimated = record.estimated_cost_cents;
  const estimatedCostCents = estimated == null ? null : meterCount(estimated);
  if (estimated != null && estimatedCostCents == null) {
    return { ok: false, error: "Could not read the host TTS meter." };
  }
  return {
    ok: true,
    summary: {
      logicalRequests,
      completedRequests,
      failedRequests,
      observedAttempts,
      characters,
      pendingCostAttempts,
      pendingCharacters,
      estimatedCostCents,
      totalsPartial: record.totals_partial === true || record.totals_partial === "t" || record.totals_partial === "true",
    },
  };
}

/**
 * Fold a host meter read into an events snapshot.
 * A failed read stays explicit and keeps the event totals. It does not replace them with zero.
 */
export function applyHostTtsMeterHistory(
  snapshot: AiUsageMonthSnapshot,
  aggregated: UsageAggregate,
  meter: { ok: true; summary: HostTtsMeterMonth } | { ok: false; error: string },
): AiUsageMonthSnapshot {
  if (!meter.ok) {
    return {
      ...snapshot,
      readIncomplete: true,
      readIncompleteNote: snapshot.readIncompleteNote
        ? `${snapshot.readIncompleteNote} ${HOST_TTS_METER_READ_INCOMPLETE_NOTE}`
        : HOST_TTS_METER_READ_INCOMPLETE_NOTE,
      error: snapshot.error ?? meter.error,
    };
  }
  const merged = mergeHostTtsMeterMonth(aggregated, meter.summary);
  return {
    ...snapshot,
    ...merged,
    exactTrackedCostLabel: merged.exactTrackedCostLabel,
  };
}

type AiUsageMeterRpc = (
  fn: string,
  args: Record<string, string>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

export type AiUsageReadCursor = {
  created_at: string;
  id: string;
};

export type AiUsageStoredRow = UsageRow & {
  id: string;
  created_at: string;
};

export type AiUsagePageFetch =
  | { ok: true; rows: AiUsageStoredRow[] }
  | { ok: false; error: string };

export type AiUsageReadAvailability = "complete" | "unavailable" | "partial";

export type AiUsageMonthRead = {
  rows: AiUsageStoredRow[];
  readAvailability: AiUsageReadAvailability;
  readIncomplete: boolean;
  readIncompleteNote: string | null;
  readUnavailable: boolean;
  readUnavailableNote: string | null;
  error: string | null;
};

function completeUsageRead(rows: AiUsageStoredRow[]): AiUsageMonthRead {
  return {
    rows,
    readAvailability: "complete",
    readIncomplete: false,
    readIncompleteNote: null,
    readUnavailable: false,
    readUnavailableNote: null,
    error: null,
  };
}

function unavailableUsageRead(error: string): AiUsageMonthRead {
  return {
    rows: [],
    readAvailability: "unavailable",
    readIncomplete: false,
    readIncompleteNote: null,
    readUnavailable: true,
    readUnavailableNote: AI_USAGE_READ_UNAVAILABLE_NOTE,
    error,
  };
}

function partialUsageRead(
  rows: AiUsageStoredRow[],
  note: string,
  error: string | null,
): AiUsageMonthRead {
  return {
    rows,
    readAvailability: "partial",
    readIncomplete: true,
    readIncompleteNote: note,
    readUnavailable: false,
    readUnavailableNote: null,
    error,
  };
}

/** Counters and tariff labels. A failed first page is never a numeric zero. */
export function presentAiUsageMeasure(valueLabel: string, unavailable: boolean): string {
  return unavailable ? AI_USAGE_UNAVAILABLE_LABEL : valueLabel;
}

export function presentAiUsageCount(value: number, unavailable: boolean): string {
  return presentAiUsageMeasure(value.toLocaleString("en-US"), unavailable);
}

/** A finished read with no events keeps a real zero. Unknown tariff stays "—". */
export function presentAiUsageTariff(input: {
  unavailable: boolean;
  label: string;
  requests: number;
  readIncomplete: boolean;
  totalsArePartial: boolean;
}): string {
  if (input.unavailable) return AI_USAGE_UNAVAILABLE_LABEL;
  if (!input.readIncomplete && !input.totalsArePartial && input.requests === 0 && input.label === "—") {
    return formatUsdFromCents(0);
  }
  return input.label;
}

/** Ascending (created_at, id). Equal timestamps stay ordered by id. */
export function compareAiUsageReadKey(
  a: { created_at: string; id: string },
  b: { created_at: string; id: string },
): number {
  if (a.created_at < b.created_at) return -1;
  if (a.created_at > b.created_at) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

export function quoteAiUsageFilterValue(value: string): string {
  return `"${value.replace(/["(),]/g, "")}"`;
}

/** PostgREST `or` filter: rows strictly after the cursor, including same created_at with a greater id. */
export function aiUsageMonthKeysetOrFilter(cursor: AiUsageReadCursor): string {
  const createdAt = quoteAiUsageFilterValue(cursor.created_at);
  const id = quoteAiUsageFilterValue(cursor.id);
  return `created_at.gt.${createdAt},and(created_at.eq.${createdAt},id.gt.${id})`;
}

export function sliceAiUsageReadPage<T extends AiUsageReadCursor>(
  rows: readonly T[],
  cursor: AiUsageReadCursor | null,
  pageSize: number,
): T[] {
  const sorted = [...rows].sort(compareAiUsageReadKey);
  const after = cursor ? sorted.filter((row) => compareAiUsageReadKey(row, cursor) > 0) : sorted;
  return after.slice(0, Math.max(0, pageSize));
}

export function aiUsageMonthReadIsComplete(read: {
  readIncomplete: boolean;
  readUnavailable?: boolean;
  error: string | null;
}): boolean {
  return !read.readIncomplete && read.readUnavailable !== true && read.error == null;
}

/**
 * Keyset pages until a short page. A full page at the safety cap, or an error
 * after earlier pages, stays incomplete so a partial sum is not a full month.
 */
export async function collectAiUsageMonthPages(input: {
  pageSize: number;
  maxRows: number;
  fetchPage: (cursor: AiUsageReadCursor | null) => Promise<AiUsagePageFetch>;
}): Promise<AiUsageMonthRead> {
  const pageSize = Math.max(1, Math.trunc(input.pageSize));
  const maxRows = Math.max(pageSize, Math.trunc(input.maxRows));
  const rows: AiUsageStoredRow[] = [];
  let cursor: AiUsageReadCursor | null = null;

  while (rows.length < maxRows) {
    const page = await input.fetchPage(cursor);
    if (!page.ok) {
      if (rows.length === 0) return unavailableUsageRead(page.error);
      return partialUsageRead(rows, AI_USAGE_READ_INCOMPLETE_ERROR_NOTE, page.error);
    }
    const batch = page.rows.slice(0, pageSize);
    if (batch.length === 0) return completeUsageRead(rows);
    const last = batch[batch.length - 1];
    if (!last || (cursor && compareAiUsageReadKey(last, cursor) <= 0)) {
      if (rows.length === 0) return unavailableUsageRead("Could not read ai_usage_events.");
      return partialUsageRead(rows, AI_USAGE_READ_INCOMPLETE_ERROR_NOTE, "Could not read ai_usage_events.");
    }
    rows.push(...batch);
    if (batch.length < pageSize) return completeUsageRead(rows);
    cursor = { created_at: last.created_at, id: last.id };
    if (rows.length >= maxRows) {
      return partialUsageRead(rows.slice(0, maxRows), AI_USAGE_READ_INCOMPLETE_CAP_NOTE, null);
    }
  }

  return partialUsageRead(rows.slice(0, maxRows), AI_USAGE_READ_INCOMPLETE_CAP_NOTE, null);
}

function usageReadErrorMessage(message: string): string {
  return message.includes("ai_usage_events")
    ? "ai_usage_events table is missing. Apply the Phase 1 migration."
    : "Could not read ai_usage_events.";
}

function mapUsageReadRow(raw: Record<string, unknown>): AiUsageStoredRow | null {
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const created_at = typeof raw.created_at === "string" ? raw.created_at.trim() : "";
  if (!id || !created_at) return null;
  return {
    id,
    created_at,
    provider: typeof raw.provider === "string" ? raw.provider : null,
    model: typeof raw.model === "string" ? raw.model : null,
    status: typeof raw.status === "string" ? raw.status : null,
    input_characters: typeof raw.input_characters === "number" ? raw.input_characters : null,
    calculated_cost_cents: typeof raw.calculated_cost_cents === "number" ? raw.calculated_cost_cents : null,
    pricing_rule_id: typeof raw.pricing_rule_id === "string" ? raw.pricing_rule_id : null,
    cost_class: typeof raw.cost_class === "string" ? raw.cost_class : null,
    operation: typeof raw.operation === "string" ? raw.operation : null,
    host_id: typeof raw.host_id === "string" ? raw.host_id : null,
    reservation_id: typeof raw.reservation_id === "string" ? raw.reservation_id : null,
    property_id: typeof raw.property_id === "string" ? raw.property_id : null,
  };
}

const AI_USAGE_MONTH_SELECT =
  "id, created_at, provider, model, status, input_characters, calculated_cost_cents, pricing_rule_id, cost_class, operation, host_id, reservation_id, property_id";

/** SuperAdmin Back Office read path — service role only. */
export async function getAiUsageMonthSnapshot(now = new Date()): Promise<AiUsageMonthSnapshot> {
  const bounds = aiUsageCalendarMonthUtcBounds(now, AI_USAGE_BACKOFFICE_TIMEZONE);
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return emptySnapshot(bounds, {
      error: "SUPABASE_SERVICE_ROLE_KEY is not configured. Cannot read ai_usage_events.",
      readUnavailable: true,
      readUnavailableNote: AI_USAGE_READ_UNAVAILABLE_NOTE,
      exactTrackedCostLabel: AI_USAGE_UNAVAILABLE_LABEL,
    });
  }

  try {
    const read = await collectAiUsageMonthPages({
      pageSize: AI_USAGE_MONTH_PAGE_SIZE,
      maxRows: AI_USAGE_MONTH_MAX_ROWS,
      fetchPage: async (cursor) => {
        let query = admin
          .from("ai_usage_events")
          .select(AI_USAGE_MONTH_SELECT)
          .eq("operation", "tts")
          .gte("created_at", bounds.startUtc.toISOString())
          .lt("created_at", bounds.endUtc.toISOString())
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(AI_USAGE_MONTH_PAGE_SIZE);
        if (cursor) query = query.or(aiUsageMonthKeysetOrFilter(cursor));
        const { data, error } = await query;
        if (error) return { ok: false, error: usageReadErrorMessage(error.message) };
        const mapped: AiUsageStoredRow[] = [];
        for (const raw of (data ?? []) as Record<string, unknown>[]) {
          const row = mapUsageReadRow(raw);
          if (!row) return { ok: false, error: "Could not read ai_usage_events." };
          mapped.push(row);
        }
        return { ok: true, rows: mapped };
      },
    });

    const aggregated = aggregateAiUsageRows(read.rows);
    let snapshot: AiUsageMonthSnapshot = {
      ...emptySnapshot(bounds, {
        serviceRoleReady: true,
        error: read.error,
        readIncomplete: read.readIncomplete,
        readIncompleteNote: read.readIncompleteNote,
        readUnavailable: read.readUnavailable,
        readUnavailableNote: read.readUnavailableNote,
      }),
      ...aggregated,
      readIncomplete: read.readIncomplete,
      readIncompleteNote: read.readIncompleteNote,
      readUnavailable: read.readUnavailable,
      readUnavailableNote: read.readUnavailableNote,
      error: read.error,
      exactTrackedCostLabel: read.readUnavailable
        ? AI_USAGE_UNAVAILABLE_LABEL
        : aggregated.exactTrackedCostLabel,
    };
    if (!read.readUnavailable) {
      const meter = await readHostTtsMeterMonth(admin, bounds.startUtc, bounds.endUtc);
      snapshot = applyHostTtsMeterHistory(snapshot, aggregated, meter);
    }
    return snapshot;
  } catch {
    return emptySnapshot(bounds, {
      serviceRoleReady: true,
      error: "Could not read ai_usage_events.",
      readUnavailable: true,
      readUnavailableNote: AI_USAGE_READ_UNAVAILABLE_NOTE,
      exactTrackedCostLabel: AI_USAGE_UNAVAILABLE_LABEL,
    });
  }
}

export { formatUsdFromCents, getOpenAiActualSpendReconciliationStatus };
