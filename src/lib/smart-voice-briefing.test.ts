import {
  claimIsabelaAutoVoiceSessionSpeak,
  composeLoginBriefingSentence,
  composeSmartLoginBriefing,
  countSameDayReservationMoves,
  collectHostVoiceBriefingItems,
  hasIsabelaAutoVoiceSpokenThisSession,
  hostLocalClock,
  HOST_ISABELA_AUTO_VOICE_KEY,
  HOST_ISABELA_AUTO_VOICE_SESSION_KEY,
  LOGIN_BRIEFING_V1_LIVE_SOURCES,
  loginBriefingGreeting,
  parseHostBriefingLanguage,
  parseIsabelaAutoVoicePreference,
  parsePendingHousekeepingCount,
  resolveHostBriefingTimeZone,
  resolveLoginBriefingPeriod,
  resolveVoiceBriefingBlock,
  shouldAttemptIsabelaAutoSpeak,
  voiceBriefingGreeting,
} from "./smart-voice-briefing";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runSmartVoiceBriefingTests() {
  assert(resolveLoginBriefingPeriod(5, 0) === "morning", "05:00 morning");
  assert(resolveLoginBriefingPeriod(11, 59) === "morning", "11:59 morning");
  assert(resolveLoginBriefingPeriod(12, 0) === "afternoon", "12:00 afternoon");
  assert(resolveLoginBriefingPeriod(17, 59) === "afternoon", "17:59 afternoon");
  assert(resolveLoginBriefingPeriod(18, 0) === "evening", "18:00 evening");
  assert(resolveLoginBriefingPeriod(23, 30) === "evening", "23:30 evening");
  assert(resolveLoginBriefingPeriod(0, 0) === "evening", "00:00 evening");
  assert(resolveLoginBriefingPeriod(4, 59) === "evening", "04:59 evening");

  assert(resolveVoiceBriefingBlock(9).id === "morning_ops", "legacy morning block");
  assert(resolveVoiceBriefingBlock(14).id === "pending_arrivals", "legacy afternoon block");
  assert(resolveVoiceBriefingBlock(20).id === "checkins_incidents", "legacy evening block");
  assert(resolveVoiceBriefingBlock(2).id === "overnight_urgent", "legacy overnight block");

  assert(loginBriefingGreeting("morning", "en", "Javier") === "Good morning, Javier.", "EN morning greeting");
  assert(loginBriefingGreeting("afternoon", "en", "Javier") === "Good afternoon, Javier.", "EN afternoon greeting");
  assert(loginBriefingGreeting("evening", "en", "Javier") === "Good evening, Javier.", "EN evening greeting");
  assert(loginBriefingGreeting("morning", "es", "Javier") === "Buenos días, Javier.", "ES morning greeting");
  assert(loginBriefingGreeting("afternoon", "es", "Javier") === "Buenas tardes, Javier.", "ES afternoon greeting");
  assert(loginBriefingGreeting("evening", "es", "Javier") === "Buenas noches, Javier.", "ES evening greeting");
  assert(voiceBriefingGreeting("overnight_urgent", "es", "Javier") === "Buenas noches, Javier.", "overnight uses Buenas noches");

  assert(parseHostBriefingLanguage("es") === "es", "parse es");
  assert(parseHostBriefingLanguage("en") === "en", "parse en");
  assert(parseHostBriefingLanguage("fr") === "en", "unknown language defaults en");

  assert(
    resolveHostBriefingTimeZone({ storedTimeZone: "America/Chicago" }) === "America/Chicago",
    "stored host timezone wins",
  );
  assert(
    resolveHostBriefingTimeZone({
      storedTimeZone: "",
      propertyTimeZones: ["", "Not/AZone", "America/Denver"],
    }) === "America/Denver",
    "property timezone fallback",
  );
  assert(
    resolveHostBriefingTimeZone({ storedTimeZone: "bogus", propertyTimeZones: [] }) === "America/New_York",
    "default when no valid zone",
  );

  const nyClock = hostLocalClock("America/New_York", new Date("2026-09-05T16:30:00.000Z"));
  assert(nyClock.timeZone === "America/New_York", "clock keeps IANA zone");
  assert(Number.isFinite(nyClock.hour) && Number.isFinite(nyClock.minute), "clock parts finite");

  const moves = countSameDayReservationMoves(
    [
      { checkIn: "2026-09-05", checkOut: "2026-09-08", status: "arriving" },
      { checkIn: "2026-09-01", checkOut: "2026-09-05", status: "staying" },
      { checkIn: "2026-09-05", checkOut: "2026-09-05", status: "upcoming" },
      { checkIn: "2026-09-05", checkOut: "2026-09-06", status: "canceled" },
    ],
    "2026-09-05",
  );
  assert(moves.arrivals === 2, "two live arrivals (canceled excluded)");
  assert(moves.departures === 2, "two live departures same day");

  const morning = composeLoginBriefingSentence({
    language: "en",
    period: "morning",
    counts: { arrivals: 2, departures: 1, housekeepingPending: 1 },
  });
  assert(
    morning === "You have 1 departure, 1 cleaning pending, and 2 arrivals today.",
    "morning priority departure → housekeeping → arrival",
  );

  const afternoon = composeLoginBriefingSentence({
    language: "en",
    period: "afternoon",
    counts: { arrivals: 1, departures: 3, housekeepingPending: 2 },
  });
  assert(
    afternoon === "You have 1 arrival and 2 cleanings pending.",
    "afternoon priority arrivals before housekeeping; departures omitted",
  );

  const esAfternoon = composeLoginBriefingSentence({
    language: "es",
    period: "afternoon",
    counts: { arrivals: 1, departures: 0, housekeepingPending: 0 },
  });
  assert(
    esAfternoon === "Tienes 1 llegada pendiente y todas las limpiezas están al día.",
    "ES afternoon singular arrival + clear cleanings",
  );

  const plurals = composeLoginBriefingSentence({
    language: "en",
    period: "morning",
    counts: { arrivals: 0, departures: 2, housekeepingPending: 0 },
  });
  assert(plurals === "You have 2 departures, and all cleanings are up to date today.", "plural departures + clear hk");

  const zero = composeLoginBriefingSentence({
    language: "en",
    period: "evening",
    counts: { arrivals: 0, departures: 0, housekeepingPending: 0 },
  });
  assert(zero.includes("All clear") || zero.includes("no arrivals"), "zero counts omit fake numbers");
  assert(!/\d+\s+pending guest/i.test(zero), "no fake guest-message counts");
  assert(!/\d+\s+maintenance/i.test(zero), "no fake maintenance counts");

  const withFakeFuture = composeLoginBriefingSentence({
    language: "en",
    period: "afternoon",
    counts: { arrivals: 1, departures: 0, housekeepingPending: 0, pendingMessages: 9, maintenance: 4 },
    sources: LOGIN_BRIEFING_V1_LIVE_SOURCES,
  });
  assert(!withFakeFuture.includes("9"), "future message counts omitted without live source");
  assert(!withFakeFuture.includes("4"), "future maintenance counts omitted without live source");
  assert(withFakeFuture.includes("1 arrival"), "real arrival still shown");

  const futureEnabled = composeLoginBriefingSentence({
    language: "en",
    period: "afternoon",
    counts: { arrivals: 0, departures: 0, housekeepingPending: 0, pendingMessages: 2, maintenance: 1 },
    sources: { ...LOGIN_BRIEFING_V1_LIVE_SOURCES, guestMessages: true, maintenance: true },
  });
  assert(futureEnabled.includes("2 pending guest messages"), "architecture ready for live messages");
  assert(futureEnabled.includes("1 maintenance item"), "architecture ready for live maintenance");

  const full = composeSmartLoginBriefing({
    hostFirstName: "Javier",
    language: "en",
    timeZone: "UTC",
    counts: { arrivals: 2, departures: 1, housekeepingPending: 1 },
    now: new Date("2026-09-05T10:00:00.000Z"),
  });
  assert(full.greeting === "Good morning, Javier.", "composed greeting");
  assert(full.spokenText.startsWith("Good morning, Javier."), "spoken includes greeting");
  assert(full.spokenText.includes("1 departure"), "spoken includes departure");
  assert(full.spokenText.includes("1 cleaning pending"), "spoken includes housekeeping");
  assert(full.spokenText.includes("2 arrivals"), "spoken includes arrivals");
  assert(!full.spokenText.toLowerCase().includes("elena"), "briefing text does not say Elena");

  assert(parsePendingHousekeepingCount({ pendingHousekeepingCount: 3 }) === 3, "parse hk count");
  assert(parsePendingHousekeepingCount({ pendingHousekeepingCount: -1 }) === null, "reject negative hk");
  assert(parsePendingHousekeepingCount({ ok: true }) === null, "missing hk count");

  const emptyCollector = collectHostVoiceBriefingItems({
    properties: [],
    reservations: [],
    calls: [{ id: "seed" }],
    dateIso: "2026-09-05",
  });
  assert(emptyCollector.length === 0, "seed calls must not invent briefing items");

  assert(HOST_ISABELA_AUTO_VOICE_KEY === "zencierge.hub.isabelaAutoVoice", "auto voice preference key");
  assert(HOST_ISABELA_AUTO_VOICE_SESSION_KEY.endsWith("sessionSpoken"), "session spoken key");
  assert(parseIsabelaAutoVoicePreference("1") === "enabled", "pref 1 enabled");
  assert(parseIsabelaAutoVoicePreference("0") === "disabled", "pref 0 disabled");
  assert(parseIsabelaAutoVoicePreference(null) === "unset", "pref unset");

  assert(
    shouldAttemptIsabelaAutoSpeak({
      preference: "unset",
      sessionAlreadySpoken: false,
      listingsLoading: false,
      playbackBusy: false,
    }) === true,
    "unset preference may auto-speak once",
  );
  assert(
    shouldAttemptIsabelaAutoSpeak({
      preference: "enabled",
      sessionAlreadySpoken: false,
      listingsLoading: false,
      playbackBusy: false,
    }) === true,
    "enabled preference may auto-speak once",
  );
  assert(
    shouldAttemptIsabelaAutoSpeak({
      preference: "disabled",
      sessionAlreadySpoken: false,
      listingsLoading: false,
      playbackBusy: false,
    }) === false,
    "disabled preference blocks auto-speak",
  );
  assert(
    shouldAttemptIsabelaAutoSpeak({
      preference: "enabled",
      sessionAlreadySpoken: true,
      listingsLoading: false,
      playbackBusy: false,
    }) === false,
    "session already spoken blocks duplicate",
  );
  assert(
    shouldAttemptIsabelaAutoSpeak({
      preference: "enabled",
      sessionAlreadySpoken: false,
      listingsLoading: true,
      playbackBusy: false,
    }) === false,
    "wait until listings finish loading",
  );
  assert(
    shouldAttemptIsabelaAutoSpeak({
      preference: "enabled",
      sessionAlreadySpoken: false,
      listingsLoading: false,
      playbackBusy: true,
    }) === false,
    "busy playback blocks overlapping auto-speak",
  );

  const memory = new Map<string, string>();
  const session = {
    getItem(key: string) {
      return memory.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      memory.set(key, value);
    },
  };
  const previousSession = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
  try {
    assert(hasIsabelaAutoVoiceSpokenThisSession() === false, "session starts unspoken");
    assert(claimIsabelaAutoVoiceSessionSpeak() === true, "first claim succeeds");
    assert(hasIsabelaAutoVoiceSpokenThisSession() === true, "session marked spoken");
    assert(claimIsabelaAutoVoiceSessionSpeak() === false, "second claim rejected — no duplicate");
  } finally {
    if (previousSession === undefined) {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    } else {
      Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: previousSession });
    }
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const card = readFileSync(join(here, "../components/dashboard/smart-voice-briefing-card.tsx"), "utf8");
  assert(card.includes("claimIsabelaAutoVoiceSessionSpeak"), "card claims once-per-session auto-speak");
  assert(card.includes("shouldAttemptIsabelaAutoSpeak"), "card gates auto-speak");
  assert(card.includes('mode === "auto"'), "autoplay rejection handled in auto mode");
  assert(card.includes("setShowEnableVoice(true)"), "shows Enable Isabela Voice after autoplay block");
  assert(card.includes("Enable Isabela Voice") || card.includes("Activar voz de Isabela"), "enable CTA copy");
  assert(card.includes("writeIsabelaAutoVoicePreference(\"enabled\")"), "enable CTA persists preference");
  assert(card.includes('startSpeak("manual"'), "manual Hear briefing still works");
  assert(card.includes("[listingsLoading]"), "auto-speak effect depends on listings load, not poll tick");
  assert(!card.includes("setTick") || card.includes("60_000"), "poll tick remains for HK refresh only");
  assert(card.includes("Isabela · Smart Login Briefing"), "EN branding remains Isabela");
  assert(loginBriefingGreeting("morning", "es", "Javier") === "Buenos días, Javier.", "ES greeting still correct");
}

const isDirectRun = process.argv[1]?.includes("smart-voice-briefing.test");
if (isDirectRun) {
  try {
    runSmartVoiceBriefingTests();
    console.log("smart-voice-briefing tests passed");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "smart-voice-briefing tests failed");
    process.exitCode = 1;
  }
}
