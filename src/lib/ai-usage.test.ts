import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AI_PRICING_SEED_RULES,
  calculateExactCharacterCostCents,
  findEffectivePricingRule,
  getOpenAiActualSpendReconciliationStatus,
  resolveAiUsageEventCost,
} from "./ai-pricing";
import {
  aggregateAiUsageRows,
  AI_USAGE_READ_INCOMPLETE_ERROR_NOTE,
  AI_USAGE_READ_UNAVAILABLE_NOTE,
  AI_USAGE_UNAVAILABLE_LABEL,
  aiUsageCalendarMonthUtcBounds,
  aiUsageMonthKeysetOrFilter,
  aiUsageMonthReadIsComplete,
  collectAiUsageMonthPages,
  presentAiUsageCount,
  presentAiUsageTariff,
  sanitizeAiUsageEventRow,
  safeRecordAiUsageEvent,
  sliceAiUsageReadPage,
  type AiUsageStoredRow,
} from "./ai-usage";
import {
  createGuestStayTtsRateLimiter,
  handleGuestStayTts,
  type GuestStayTtsSynthesize,
} from "./guest-stay-tts";
import {
  createGuestStayWelcomeTtsRateLimiter,
  guestStayWelcomeText,
  handleGuestStayWelcomeTts,
} from "./guest-stay-welcome";
import {
  createMemoryStayTokenStore,
  issueGuestStayLink,
  type StayPropertyRecord,
  type StayReservationRecord,
} from "./guest-stay-token";
import { guestElenaMp3InputText, hostTtsInputText } from "./tts-synthesize";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function storedUsageRow(input: { id: string; created_at: string; cents: number }): AiUsageStoredRow {
  return {
    id: input.id,
    created_at: input.created_at,
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    status: "success",
    input_characters: 100,
    calculated_cost_cents: input.cents,
    pricing_rule_id: "elevenlabs_multilingual_v2_char_2026_09",
    cost_class: "exact",
    operation: "tts",
    host_id: HOST_ID,
    reservation_id: "res-usage-1",
    property_id: "prop-usage-1",
  };
}

const HOST_ID = "334119a5-44b0-4567-8184-c2c6ff83a49e";
const property: StayPropertyRecord = {
  id: "prop-usage-1",
  name: "Usage Loft",
  city: "Miami",
  timezone: "UTC",
};
const reservation: StayReservationRecord = {
  id: "res-usage-1",
  property_id: "prop-usage-1",
  check_in: "2026-09-10",
  check_in_time: "3:00 PM",
  check_out: "2026-09-14",
  check_out_time: "11:00 AM",
  status: "upcoming",
};
const now = new Date("2026-09-11T12:00:00.000Z");
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

async function issueToken() {
  const store = createMemoryStayTokenStore({
    reservations: [reservation],
    properties: [property],
  });
  const issued = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store,
    now,
  });
  assert(issued.status === 200 && typeof issued.body.token === "string", "need stay token");
  return { store, token: issued.body.token as string };
}

export async function runAiUsagePhase1Tests() {
  const bounds = aiUsageCalendarMonthUtcBounds(new Date("2026-09-05T16:00:00.000Z"), "America/New_York");
  assert(bounds.label.includes("2026"), "month label includes year");
  assert(bounds.label.includes("September"), "September label for NY wall month");
  assert(bounds.startUtc.toISOString() === "2026-09-01T04:00:00.000Z", "Sept 2026 NY month starts EDT");
  assert(bounds.endUtc.toISOString() === "2026-10-01T04:00:00.000Z", "Sept 2026 NY month ends at Oct start EDT");

  assert(
    calculateExactCharacterCostCents({ inputCharacters: 1000, rateUsdPerCharacter: 0.0001 }) === 10,
    "1,000 chars ElevenLabs multilingual v2 = $0.10 exact",
  );
  assert(
    calculateExactCharacterCostCents({ inputCharacters: 500, rateUsdPerCharacter: 0.0001 }) === 5,
    "500 chars = $0.05 exact",
  );

  const current = findEffectivePricingRule({
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    operation: "tts",
    unit: "character",
    at: new Date("2026-09-05T00:00:00.000Z"),
  });
  assert(current?.id === "elevenlabs_multilingual_v2_char_2026_09", "current multilingual rule");

  const historicalRules = [
    {
      ...AI_PRICING_SEED_RULES[0]!,
      id: "elevenlabs_multilingual_v2_char_legacy",
      rate_usd: 0.0002,
      effective_from: "2025-01-01T00:00:00.000Z",
      effective_to: "2026-01-01T00:00:00.000Z",
    },
    ...AI_PRICING_SEED_RULES,
  ];
  const legacy = resolveAiUsageEventCost({
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    operation: "tts",
    status: "success",
    input_characters: 1000,
    at: new Date("2025-06-01T00:00:00.000Z"),
    rules: historicalRules,
  });
  assert(legacy.cost_class === "exact", "historical event uses effective rule");
  assert(legacy.pricing_rule_id === "elevenlabs_multilingual_v2_char_legacy", "legacy rule id pinned");
  assert(legacy.calculated_cost_cents === 20, "historical rate $0.20/1k for 1000 chars");

  const currentPriced = resolveAiUsageEventCost({
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    operation: "tts",
    status: "success",
    input_characters: 1000,
    at: new Date("2026-09-05T00:00:00.000Z"),
    rules: historicalRules,
  });
  assert(currentPriced.pricing_rule_id === "elevenlabs_multilingual_v2_char_2026_09", "new rate does not rewrite old lookup");
  assert(currentPriced.calculated_cost_cents === 10, "current rate still $0.10/1k");

  const openaiPending = resolveAiUsageEventCost({
    provider: "openai",
    model: "gpt-4o-mini-tts",
    operation: "tts",
    status: "success",
    input_characters: 75,
  });
  assert(openaiPending.cost_class === "pending", "OpenAI chars-only remains pending");
  assert(openaiPending.calculated_cost_cents === null, "OpenAI cost stays NULL");
  assert(openaiPending.pricing_rule_id === null, "OpenAI does not pin a character rule");

  const sanitizedEleven = sanitizeAiUsageEventRow({
    host_id: HOST_ID,
    property_id: "prop-1",
    reservation_id: "res-1",
    source: "guest_stay_tts",
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    operation: "tts",
    status: "success",
    input_characters: 1000,
    calculated_cost_cents: 999,
    pricing_rule_id: "should-be-replaced",
    priced_at: new Date("2026-09-05T00:00:00.000Z"),
  });
  assert(sanitizedEleven.calculated_cost_cents === 10, "sanitize applies exact ElevenLabs cost");
  assert(sanitizedEleven.pricing_rule_id === "elevenlabs_multilingual_v2_char_2026_09", "sanitize pins rule id");
  assert(sanitizedEleven.cost_class === "exact", "sanitize marks exact");
  assert(!JSON.stringify(sanitizedEleven).includes("secret"), "sanitize has no secret payload");

  const sanitizedOpenAi = sanitizeAiUsageEventRow({
    source: "host_tts",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    operation: "tts",
    status: "success",
    input_characters: 75,
  });
  assert(sanitizedOpenAi.calculated_cost_cents === null, "OpenAI sanitize keeps null cost");
  assert(sanitizedOpenAi.cost_class === "pending", "OpenAI sanitize marks pending");

  const aggregated = aggregateAiUsageRows([
    {
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      status: "success",
      input_characters: 1000,
      calculated_cost_cents: 10,
      pricing_rule_id: "elevenlabs_multilingual_v2_char_2026_09",
      cost_class: "exact",
      operation: "tts",
      host_id: HOST_ID,
      reservation_id: reservation.id,
      property_id: property.id,
    },
    {
      provider: "openai",
      model: "gpt-4o-mini-tts",
      status: "success",
      input_characters: 75,
      calculated_cost_cents: null,
      pricing_rule_id: null,
      cost_class: "pending",
      operation: "tts",
      host_id: HOST_ID,
      reservation_id: reservation.id,
      property_id: property.id,
    },
  ]);
  assert(aggregated.ttsRequests === 2, "aggregates TTS requests");
  assert(aggregated.exactTrackedCostCents === 10, "exact tracked cost is ElevenLabs only");
  assert(aggregated.pendingExactPricingEvents === 1, "OpenAI counted as awaiting exact pricing");
  assert(aggregated.totalsArePartial === true, "totals marked partial when pending exists");
  assert(aggregated.exactTrackedCostLabel !== "$0.00" || aggregated.exactTrackedCostCents === 0, "pending not shown as sole zero");
  const openAiRow = aggregated.byProvider.find((row) => row.provider === "openai");
  assert(openAiRow?.exactCostCents == null, "pending OpenAI not presented as zero cost");
  assert(Boolean(openAiRow?.costClassLabel.includes("unknown")), "OpenAI labeled cost unknown");
  assert(!openAiRow?.costClassLabel.includes("$0"), "unknown OpenAI label is not a zero dollar amount");
  const elevenRow = aggregated.byProvider.find((row) => row.provider === "elevenlabs");
  assert(Boolean(elevenRow?.costClassLabel.includes("estimated")), "historical exact row is shown as an estimate");
  assert(!/exact/i.test(elevenRow?.costClassLabel ?? ""), "estimate label does not say exact");
  assert(aggregated.partialTotalsNote != null && aggregated.partialTotalsNote.includes("not shown as $0"), "unknown cost is not described as zero");
  assert(aggregated.costPerCustomer.length === 1, "exact per-customer aggregation");
  assert(aggregated.costPerCustomer[0]?.exactCostCents === 10, "customer cost excludes pending OpenAI");
  assert(aggregated.costPerStay.length === 1, "exact per-stay aggregation");
  assert(aggregated.costPerStay[0]?.exactCostCents === 10, "stay cost excludes pending OpenAI");

  const issued = await issueToken();
  const events: Array<Record<string, unknown>> = [];
  const recordUsage = async (event: Record<string, unknown>) => {
    events.push(event);
  };
  const synthesize: GuestStayTtsSynthesize = async () => mp3;

  const ok = await handleGuestStayTts({
    body: { token: issued.token, message: "Hello" },
    store: issued.store,
    now,
    ipKey: "ip-1",
    ipLimiter: createGuestStayTtsRateLimiter(),
    tokenLimiter: createGuestStayTtsRateLimiter(),
    providerReady: () => true,
    synthesize,
    recordUsage,
    resolveHostId: async () => HOST_ID,
    selectedEngine: "elevenlabs",
  });
  assert(ok.kind === "audio", "guest TTS success returns audio");
  assert(events.length === 1, "guest TTS success emits exactly one event");
  assert(events[0]?.source === "guest_stay_tts", "guest reply source");
  assert(events[0]?.host_id === HOST_ID, "complimentary-capable host still attributed");
  assert(!JSON.stringify(events[0]).includes(issued.token), "token not stored");

  const pricedEmit = sanitizeAiUsageEventRow({
    ...(events[0] as Parameters<typeof sanitizeAiUsageEventRow>[0]),
    priced_at: now,
  });
  assert(pricedEmit.cost_class === "exact", "complimentary guest ElevenLabs usage still gets exact cost");
  assert(typeof pricedEmit.calculated_cost_cents === "number", "complimentary usage has exact cents");

  events.length = 0;
  const failing: GuestStayTtsSynthesize = async () => {
    throw new Error("provider boom");
  };
  const failed = await handleGuestStayTts({
    body: { token: issued.token, message: "Hello" },
    store: issued.store,
    now,
    ipKey: "ip-2",
    ipLimiter: createGuestStayTtsRateLimiter(),
    tokenLimiter: createGuestStayTtsRateLimiter(),
    providerReady: () => true,
    synthesize: failing,
    recordUsage,
    resolveHostId: async () => HOST_ID,
    selectedEngine: "openai",
  });
  assert(failed.kind === "json" && failed.status === 503, "failed provider still returns unavailable");
  assert(events.length === 1, "failed provider emits exactly one failed event");

  events.length = 0;
  let brokenCalls = 0;
  const brokenRecorder = async () => {
    brokenCalls += 1;
    throw new Error("db down");
  };
  const stillAudio = await handleGuestStayTts({
    body: { token: issued.token, message: "Hello" },
    store: issued.store,
    now,
    ipKey: "ip-3",
    ipLimiter: createGuestStayTtsRateLimiter(),
    tokenLimiter: createGuestStayTtsRateLimiter(),
    providerReady: () => true,
    synthesize,
    recordUsage: brokenRecorder,
    selectedEngine: "openai",
  });
  assert(stillAudio.kind === "audio", "usage insert failure does not break TTS");
  assert(brokenCalls === 1, "recorder was attempted once");

  events.length = 0;
  const welcomeOk = await handleGuestStayWelcomeTts({
    body: { token: issued.token, lang: "en" },
    store: issued.store,
    now,
    ipKey: "ip-w",
    ipLimiter: createGuestStayWelcomeTtsRateLimiter(),
    tokenLimiter: createGuestStayWelcomeTtsRateLimiter(),
    providerReady: () => true,
    synthesize,
    recordUsage,
    resolveHostId: async () => HOST_ID,
    selectedEngine: "elevenlabs",
  });
  assert(welcomeOk.kind === "audio", "welcome TTS success");
  assert(events.length === 1, "welcome TTS success emits exactly one event");
  assert(events[0]?.input_characters === guestElenaMp3InputText(guestStayWelcomeText("en")).length, "welcome characters");

  const usageLib = readFileSync(join(process.cwd(), "src/lib/ai-usage.ts"), "utf8");
  const pricingLib = readFileSync(join(process.cwd(), "src/lib/ai-pricing.ts"), "utf8");
  const hostRoute = readFileSync(join(process.cwd(), "src/app/api/tts/route.ts"), "utf8");
  const transcribeRoute = readFileSync(join(process.cwd(), "src/app/api/transcribe/route.ts"), "utf8");
  const mobileStt = readFileSync(join(process.cwd(), "src/lib/guest-stay-mobile-stt.ts"), "utf8");
  const humanVoice = readFileSync(join(process.cwd(), "src/lib/human-voice.ts"), "utf8");
  const usagePage = readFileSync(
    join(process.cwd(), "src/app/(founder-admin)/backoffice/isabela-usage/page.tsx"),
    "utf8",
  );
  const overview = readFileSync(join(process.cwd(), "src/app/(founder-admin)/backoffice/page.tsx"), "utf8");
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260905234500_ai_pricing_rules.sql"),
    "utf8",
  );
  const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");

  assert(pricingLib.includes("DO NOT") || pricingLib.includes("never invent") || pricingLib.includes("Never used for token"), "OpenAI not invented from chars");
  assert(usagePage.includes("Estimated tariff"), "Back Office shows tariff estimates");
  assert(usagePage.includes("Cost unknown") || usagePage.includes("pendingExactPricing"), "Back Office shows unknown cost");
  assert(usagePage.includes("readIncomplete"), "incomplete read is separate from unknown cost");
  assert(usagePage.includes("readUnavailable"), "Isabela Usage distinguishes an unavailable read");
  assert(usagePage.includes("AI_USAGE_UNAVAILABLE_LABEL"), "Isabela Usage can show the unavailable label");
  assert(
    /readUnavailable\s*\?\s*"TTS usage is unavailable"\s*:\s*"All measured TTS this month"/.test(usagePage),
    "All measured TTS this month is only the available-read detail",
  );
  assert(overview.includes("readUnavailable"), "Overview propagates an unavailable TTS read");
  assert(overview.includes("presentAiUsageCount"), "Overview does not print a failed first page as a count");
  assert(!usagePage.includes("ElevenLabs — exact"), "page does not call the tariff exact");
  const spendCard = readFileSync(
    join(process.cwd(), "src/components/admin/openai-reconciled-spend-card.tsx"),
    "utf8",
  );
  assert(usagePage.includes("OpenAiReconciledSpendCard"), "OpenAI reconciliation is a separate card");
  assert(usagePage.includes("readOpenAiBackOfficeCosts"), "OpenAI costs are read on the server page");
  assert(spendCard.includes("OpenAI reconciled spend"), "card titles the reconciled spend");
  assert(!spendCard.includes("OPENAI_ADMIN_KEY"), "card does not read the admin key");
  assert(!spendCard.includes("use client"), "reconciled spend card stays on the server");
  assert(!usagePage.includes("snapshot.openaiSpendReconciliation"), "the tariff snapshot is not the reconciled spend");
  assert(usagePage.includes("Cost per customer"), "exact per-customer section");
  assert(usagePage.includes("Cost per stay"), "exact per-stay section");
  assert(usagePage.includes("Complimentary") || usagePage.includes("COGS"), "comp still counts as COGS note");
  assert(!usagePage.includes("Pricing not configured yet"), "Phase 1 cost stub removed");
  assert(overview.includes("Estimated tariff") || overview.includes("exactTrackedCostLabel"), "Overview shows estimated tariff");
  assert(overview.includes("readIncomplete"), "Overview marks an incomplete read");
  assert(hostRoute.includes('source: "host_tts"'), "host TTS still instrumented");
  assert(!transcribeRoute.includes("recordAiUsageEvent"), "Whisper still not Phase 2");
  assert(!mobileStt.includes("recordAiUsageEvent"), "dormant mobile STT does not emit");
  assert(!humanVoice.includes("recordAiUsageEvent"), "browser speech does not emit");
  assert(migration.includes("ai_pricing_rules"), "pricing rules migration");
  assert(migration.includes("elevenlabs_multilingual_v2_char_2026_09"), "multilingual seed rule");
  assert(migration.includes("0.0001"), "character rate seed");
  assert(migration.includes("cost_class"), "cost_class column");
  assert(envExample.includes("OPENAI_ADMIN_KEY"), "Admin key documented without inventing a value");
  assert(hostTtsInputText("x".repeat(5000)).length === 4096, "host TTS character cap");

  const openaiStatus = getOpenAiActualSpendReconciliationStatus();
  assert(typeof openaiStatus.configured === "boolean", "admin status reports configured flag");
  assert(openaiStatus.label.includes("OpenAI"), "admin status label is safe");
  assert(!openaiStatus.canAttributePerCustomerOrStay, "org spend never attributed per stay");

  let threw = false;
  await safeRecordAiUsageEvent(async () => {
    threw = true;
    throw new Error("nope");
  }, {
    source: "host_tts",
    provider: "openai",
    model: "gpt-4o-mini-tts",
    operation: "tts",
    status: "success",
    input_characters: 3,
  });
  assert(threw, "safe recorder invoked");

  const migrations = existsSync(join(process.cwd(), "supabase/migrations"))
    ? readdirSync(join(process.cwd(), "supabase/migrations"))
    : [];
  assert(migrations.includes("20260905234500_ai_pricing_rules.sql"), "Phase 2 migration present");
  assert(usageLib.includes("resolveAiUsageEventCost") || usageLib.includes("sanitizeAiUsageEventRow"), "usage applies pricing");
  assert(usageLib.includes("collectAiUsageMonthPages"), "month read pages by keyset");
  assert(usageLib.includes('order("created_at"'), "month read orders by created_at");
  assert(usageLib.includes('order("id"'), "month read orders by id");
  assert(!usageLib.includes("host_billable"), "this block does not add host billing");

  const historical = {
    provider: "elevenlabs",
    model: "eleven_multilingual_v2",
    status: "success",
    input_characters: 1000,
    calculated_cost_cents: 10,
    pricing_rule_id: "elevenlabs_multilingual_v2_char_2026_09",
    cost_class: "exact",
    operation: "tts",
    host_id: HOST_ID,
    reservation_id: reservation.id,
    property_id: property.id,
  };
  const shownHistorical = aggregateAiUsageRows([historical]);
  assert(historical.cost_class === "exact", "historical exact row is not rewritten");
  assert(
    shownHistorical.byProvider[0]?.costClassLabel === "ElevenLabs — estimated from configured tariff",
    "stored exact class is presented as a configured-tariff estimate",
  );
  assert(shownHistorical.exactTrackedCostLabel === "$0.10", "historical tariff cents still sum");
  assert(shownHistorical.totalsArePartial === false, "a fully tariffed month is not an unknown-cost month");
  assert(!("readIncomplete" in shownHistorical), "aggregation does not decide read completeness");

  const unknownOnly = aggregateAiUsageRows([
    {
      provider: "openai",
      model: "gpt-4o-mini-tts",
      status: "success",
      input_characters: 40,
      calculated_cost_cents: null,
      pricing_rule_id: null,
      cost_class: "pending",
      operation: "tts",
      host_id: HOST_ID,
      reservation_id: null,
      property_id: null,
    },
    {
      provider: "elevenlabs",
      model: "eleven_multilingual_v2",
      status: "success",
      input_characters: 12,
      calculated_cost_cents: null,
      pricing_rule_id: null,
      cost_class: "pending",
      operation: "tts",
      host_id: HOST_ID,
      reservation_id: null,
      property_id: null,
    },
  ]);
  assert(unknownOnly.exactTrackedCostLabel === "—", "unknown month is not a dollar total");
  assert(unknownOnly.exactTrackedCostCents == null, "unknown month does not become zero cents");
  assert(unknownOnly.totalsArePartial === true, "unknown costs mark the tariff total partial");
  for (const row of unknownOnly.byProvider) {
    assert(row.exactCostCents == null, `${row.provider} unknown cost stays null`);
    assert(row.costClassLabel.includes("unknown"), `${row.provider} is labeled unknown`);
    assert(!row.costClassLabel.includes("$0"), `${row.provider} unknown label is not $0`);
  }
  const unknownEleven = unknownOnly.byProvider.find((row) => row.provider === "elevenlabs");
  assert(unknownEleven?.exactCostCents !== 0, "ElevenLabs without a tariff is not coerced to $0");

  const stamp = "2026-09-11T15:00:00.000Z";
  const earlier = "2026-09-11T14:00:00.000Z";
  const stored: AiUsageStoredRow[] = [
    storedUsageRow({ id: "id-c", created_at: stamp, cents: 4 }),
    storedUsageRow({ id: "id-a", created_at: stamp, cents: 1 }),
    storedUsageRow({ id: "id-z", created_at: earlier, cents: 8 }),
    storedUsageRow({ id: "id-b", created_at: stamp, cents: 2 }),
  ];
  const cursors: Array<string | null> = [];
  const paged = await collectAiUsageMonthPages({
    pageSize: 2,
    maxRows: 20,
    fetchPage: async (cursor) => {
      cursors.push(cursor ? `${cursor.created_at}|${cursor.id}` : null);
      return { ok: true, rows: sliceAiUsageReadPage(stored, cursor, 2) };
    },
  });
  assert(aiUsageMonthReadIsComplete(paged), "short final page completes the read");
  assert(paged.rows.map((row) => row.id).join(",") === "id-z,id-a,id-b,id-c", "equal created_at stays ordered by id");
  assert(cursors[1] === `${stamp}|id-a`, "second page continues after the tied timestamp");
  assert(paged.rows.reduce((sum, row) => sum + (row.calculated_cost_cents ?? 0), 0) === 15, "pages sum every tied row once");
  const tieFilter = aiUsageMonthKeysetOrFilter({ created_at: stamp, id: "id-a" });
  assert(tieFilter.includes(`created_at.gt."${stamp}"`), "keyset filter seeks a later timestamp");
  assert(tieFilter.includes(`created_at.eq."${stamp}"`), "keyset filter keeps the same timestamp");
  assert(tieFilter.includes('id.gt."id-a"'), "keyset filter advances the id inside a timestamp");

  const cappedIds: string[] = [];
  let capFetches = 0;
  const capped = await collectAiUsageMonthPages({
    pageSize: 2,
    maxRows: 4,
    fetchPage: async (cursor) => {
      capFetches += 1;
      const page = sliceAiUsageReadPage(
        ["p1", "p2", "p3", "p4", "p5", "p6"].map((id, index) =>
          storedUsageRow({ id, created_at: `2026-09-11T15:00:0${index}.000Z`, cents: 1 }),
        ),
        cursor,
        2,
      );
      cappedIds.push(...page.map((row) => row.id));
      return { ok: true, rows: page };
    },
  });
  assert(capFetches === 2, "cap stops after the full pages that fill the limit");
  assert(capped.rows.map((row) => row.id).join(",") === "p1,p2,p3,p4", "cap keeps only the rows read");
  assert(!capped.rows.some((row) => row.id === "p5" || row.id === "p6"), "cap does not invent the unread tail");
  assert(capped.readIncomplete === true && capped.error == null, "cap is an incomplete read without a page error");
  assert(capped.readIncompleteNote?.includes("incomplete") === true, "cap note says the total is incomplete");
  assert(capped.readUnavailable === false && capped.readAvailability === "partial", "cap is partial, not unavailable");
  assert(aiUsageMonthReadIsComplete(capped) === false, "capped total is not presented as complete");

  let errorFetches = 0;
  const errored = await collectAiUsageMonthPages({
    pageSize: 2,
    maxRows: 20,
    fetchPage: async (cursor) => {
      errorFetches += 1;
      if (errorFetches === 1) {
        return {
          ok: true,
          rows: sliceAiUsageReadPage(stored, cursor, 2),
        };
      }
      return { ok: false, error: "Could not read ai_usage_events." };
    },
  });
  assert(errorFetches === 2, "a later page is attempted");
  assert(errored.rows.map((row) => row.id).join(",") === "id-z,id-a", "earlier page is kept");
  assert(errored.readIncomplete === true, "later page error marks the read incomplete");
  assert(errored.readUnavailable === false && errored.readAvailability === "partial", "later page stays a partial subtotal");
  assert(errored.error === "Could not read ai_usage_events.", "later page error is kept");
  assert(errored.readIncompleteNote === AI_USAGE_READ_INCOMPLETE_ERROR_NOTE, "later page keeps its own notice");
  assert(errored.readIncompleteNote?.includes("later page") === true, "later page notice names the failed page");
  assert(errored.readIncompleteNote !== capped.readIncompleteNote, "page error is distinct from the safety cap");
  assert(aiUsageMonthReadIsComplete(errored) === false, "partial page sum is not a complete month");
  const erroredTotal = aggregateAiUsageRows(errored.rows);
  assert(erroredTotal.exactTrackedCostCents === 9, "kept pages still have their tariff estimate");
  assert(erroredTotal.ttsRequests === 2, "later page failure keeps the recovered request count");
  assert(presentAiUsageCount(erroredTotal.ttsRequests, errored.readUnavailable) === "2", "partial subtotal stays numeric");
  assert(
    presentAiUsageTariff({
      unavailable: errored.readUnavailable,
      label: erroredTotal.exactTrackedCostLabel,
      requests: erroredTotal.ttsRequests,
      readIncomplete: errored.readIncomplete,
      totalsArePartial: erroredTotal.totalsArePartial,
    }) !== AI_USAGE_UNAVAILABLE_LABEL,
    "a later page failure does not replace the recovered tariff",
  );
  assert(errored.readIncomplete === true && erroredTotal.totalsArePartial === false, "incomplete read is not the unknown-cost flag");

  const emptyMonth = await collectAiUsageMonthPages({
    pageSize: 2,
    maxRows: 20,
    fetchPage: async () => ({ ok: true, rows: [] }),
  });
  assert(emptyMonth.readAvailability === "complete", "an empty first page is a complete read");
  assert(aiUsageMonthReadIsComplete(emptyMonth), "an empty month is complete");
  assert(emptyMonth.readUnavailable === false && emptyMonth.readIncomplete === false, "an empty month is not unavailable");
  assert(emptyMonth.rows.length === 0, "an empty month has no events");
  const emptyTotal = aggregateAiUsageRows(emptyMonth.rows);
  assert(emptyTotal.ttsRequests === 0 && emptyTotal.exactTrackedCostCents == null, "no events stay a real zero, not invented cents");
  assert(presentAiUsageCount(emptyTotal.ttsRequests, emptyMonth.readUnavailable) === "0", "a complete empty month displays zero");
  assert(
    presentAiUsageTariff({
      unavailable: false,
      label: emptyTotal.exactTrackedCostLabel,
      requests: emptyTotal.ttsRequests,
      readIncomplete: false,
      totalsArePartial: emptyTotal.totalsArePartial,
    }) === "$0.00",
    "a complete empty month displays a zero tariff",
  );

  const firstPageFailed = await collectAiUsageMonthPages({
    pageSize: 2,
    maxRows: 20,
    fetchPage: async () => ({ ok: false, error: "Could not read ai_usage_events." }),
  });
  assert(firstPageFailed.readAvailability === "unavailable", "a failed first page is unavailable");
  assert(firstPageFailed.readUnavailable === true && firstPageFailed.readIncomplete === false, "first page failure is not a partial month");
  assert(firstPageFailed.rows.length === 0, "a failed first page contributes no rows");
  assert(firstPageFailed.readUnavailableNote === AI_USAGE_READ_UNAVAILABLE_NOTE, "first page failure uses the unavailable notice");
  assert(firstPageFailed.readUnavailableNote?.includes("later page") !== true, "first page notice does not say a later page");
  assert(firstPageFailed.readIncompleteNote == null, "first page failure does not reuse the later-page note");
  assert(presentAiUsageCount(0, true) === AI_USAGE_UNAVAILABLE_LABEL, "a failed first page is not shown as zero");
  assert(
    presentAiUsageTariff({
      unavailable: true,
      label: "—",
      requests: 0,
      readIncomplete: false,
      totalsArePartial: false,
    }) === AI_USAGE_UNAVAILABLE_LABEL,
    "a failed first page does not display a zero tariff",
  );
}

const isDirectRun = process.argv[1]?.includes("ai-usage.test");
if (isDirectRun) {
  runAiUsagePhase1Tests()
    .then(() => {
      console.log("ai-usage phase1/phase2 tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "ai-usage tests failed");
      process.exitCode = 1;
    });
}
