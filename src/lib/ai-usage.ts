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

function providerCostLabel(provider: string, pendingEvents: number, exactCents: number | null): string {
  const p = provider.toLowerCase();
  if (p === "elevenlabs") {
    return exactCents != null || pendingEvents === 0 ? "ElevenLabs — exact" : "ElevenLabs — exact (partial)";
  }
  if (p === "openai") {
    return "OpenAI — cost pending exact metering";
  }
  return pendingEvents > 0 ? `${provider} — cost pending exact metering` : `${provider} — exact`;
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
    costPerCustomer: [],
    costPerStay: [],
    openaiSpendReconciliation: openai.label,
    costNote: "Exact ElevenLabs costs only. OpenAI TTS awaits exact metering.",
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
    { requests: number; characters: number; exactCostCents: number; pendingEvents: number }
  >();
  const modelMap = new Map<
    string,
    {
      provider: string;
      model: string;
      requests: number;
      characters: number;
      exactCostCents: number;
      pendingEvents: number;
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

    const p = providerMap.get(provider) ?? {
      requests: 0,
      characters: 0,
      exactCostCents: 0,
      pendingEvents: 0,
    };
    p.requests += 1;
    if (row.status === "success") p.characters += chars;
    if (exactCents != null) p.exactCostCents += exactCents;
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
      exactCostCents: 0,
      pendingEvents: 0,
    };
    m.requests += 1;
    if (row.status === "success") m.characters += chars;
    if (exactCents != null) m.exactCostCents += exactCents;
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
      ? "Totals are partial — OpenAI (and any other pending) TTS awaits exact metering and is not shown as $0."
      : null,
    byProvider: [...providerMap.entries()]
      .map(([provider, value]) => ({
        provider,
        requests: value.requests,
        characters: value.characters,
        pendingEvents: value.pendingEvents,
        exactCostCents: value.exactCostCents > 0 || provider.toLowerCase() === "elevenlabs" ? value.exactCostCents : null,
        costClassLabel: providerCostLabel(
          provider,
          value.pendingEvents,
          value.exactCostCents > 0 ? value.exactCostCents : provider.toLowerCase() === "elevenlabs" ? value.exactCostCents : null,
        ),
      }))
      .map((row) => {
        if (row.provider.toLowerCase() === "openai") {
          return {
            ...row,
            exactCostCents: null,
            costClassLabel: "OpenAI — cost pending exact metering",
          };
        }
        if (row.provider.toLowerCase() === "elevenlabs") {
          return {
            ...row,
            exactCostCents: row.exactCostCents ?? 0,
            costClassLabel: "ElevenLabs — exact",
          };
        }
        return row;
      })
      .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider)),
    byModel: [...modelMap.values()]
      .map((row) => {
        const isOpenAi = row.provider.toLowerCase() === "openai";
        const isEleven = row.provider.toLowerCase() === "elevenlabs";
        return {
          provider: row.provider,
          model: row.model,
          requests: row.requests,
          characters: row.characters,
          pendingEvents: row.pendingEvents,
          exactCostCents: isOpenAi ? null : isEleven ? row.exactCostCents : row.exactCostCents > 0 ? row.exactCostCents : null,
          costClassLabel: isOpenAi
            ? "OpenAI — cost pending exact metering"
            : isEleven
              ? "ElevenLabs — exact"
              : row.pendingEvents > 0
                ? `${row.provider} — cost pending exact metering`
                : `${row.provider} — exact`,
        };
      })
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

/** SuperAdmin Back Office read path — service role only. */
export async function getAiUsageMonthSnapshot(now = new Date()): Promise<AiUsageMonthSnapshot> {
  const bounds = aiUsageCalendarMonthUtcBounds(now, AI_USAGE_BACKOFFICE_TIMEZONE);
  const admin = tryCreateSupabaseAdminClient();
  if (!admin) {
    return emptySnapshot(bounds, {
      error: "SUPABASE_SERVICE_ROLE_KEY is not configured. Cannot read ai_usage_events.",
    });
  }

  try {
    const { data, error } = await admin
      .from("ai_usage_events")
      .select(
        "provider, model, status, input_characters, calculated_cost_cents, pricing_rule_id, cost_class, operation, host_id, reservation_id, property_id",
      )
      .eq("operation", "tts")
      .gte("created_at", bounds.startUtc.toISOString())
      .lt("created_at", bounds.endUtc.toISOString());

    if (error) {
      return emptySnapshot(bounds, {
        serviceRoleReady: true,
        error: error.message.includes("ai_usage_events")
          ? "ai_usage_events table is missing. Apply the Phase 1 migration."
          : "Could not read ai_usage_events.",
      });
    }

    const rows = (data ?? []) as UsageRow[];
    return {
      ...emptySnapshot(bounds, { serviceRoleReady: true, error: null }),
      ...aggregateAiUsageRows(rows),
    };
  } catch {
    return emptySnapshot(bounds, {
      serviceRoleReady: true,
      error: "Could not read ai_usage_events.",
    });
  }
}

export { formatUsdFromCents, getOpenAiActualSpendReconciliationStatus };
