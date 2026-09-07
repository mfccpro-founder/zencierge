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
  aiUsageCalendarMonthUtcBounds,
  sanitizeAiUsageEventRow,
  safeRecordAiUsageEvent,
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
  assert(Boolean(openAiRow?.costClassLabel.includes("pending")), "OpenAI labeled pending exact metering");
  const elevenRow = aggregated.byProvider.find((row) => row.provider === "elevenlabs");
  assert(Boolean(elevenRow?.costClassLabel.includes("exact")), "ElevenLabs labeled exact");
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
  assert(usagePage.includes("Exact tracked cost") || usagePage.includes("exact tracked"), "Back Office exact cost");
  assert(usagePage.includes("Awaiting exact pricing") || usagePage.includes("awaiting exact"), "Back Office pending pricing");
  assert(usagePage.includes("ElevenLabs — exact") || usagePage.includes("costClassLabel"), "provider exact label path");
  assert(usagePage.includes("OpenAI actual spend reconciliation") || usagePage.includes("openaiSpendReconciliation"), "OpenAI reconciliation surface");
  assert(usagePage.includes("Cost per customer"), "exact per-customer section");
  assert(usagePage.includes("Cost per stay"), "exact per-stay section");
  assert(usagePage.includes("Complimentary") || usagePage.includes("COGS"), "comp still counts as COGS note");
  assert(!usagePage.includes("Pricing not configured yet"), "Phase 1 cost stub removed");
  assert(overview.includes("exactTrackedCostLabel") || overview.includes("Exact cost"), "Overview shows exact cost");
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
