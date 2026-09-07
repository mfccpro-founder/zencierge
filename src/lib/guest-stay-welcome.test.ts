import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_STAY_WELCOME_EN,
  GUEST_STAY_WELCOME_ES,
} from "./guest-stay-greeting";
import {
  GUEST_STAY_WELCOME_TTS_RATE_MAX,
  GUEST_STAY_WELCOME_TTS_TIMEOUT_MS,
  createGuestStayWelcomeTtsRateLimiter,
  guestStayWelcomeText,
  guestStayWelcomeTtsHttpResponse,
  handleGuestStayWelcomeTts,
  parseGuestStayWelcomeBody,
} from "./guest-stay-welcome";
import type { GuestStayTtsSynthesize } from "./guest-stay-tts";
import {
  createMemoryStayTokenStore,
  generateStayToken,
  hashStayToken,
  issueGuestStayLink,
  type StayPropertyRecord,
  type StayReservationRecord,
} from "./guest-stay-token";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const property: StayPropertyRecord = {
  id: "prop-welcome-1",
  name: "Palm Court",
  city: "Miami",
  timezone: "UTC",
};

const reservation: StayReservationRecord = {
  id: "res-welcome-1",
  property_id: "prop-welcome-1",
  check_in: "2026-09-10",
  check_in_time: "3:00 PM",
  check_out: "2026-09-14",
  check_out_time: "11:00 AM",
  status: "upcoming",
};

const now = new Date("2026-09-11T12:00:00.000Z");
const mp3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);

function seedStore() {
  return createMemoryStayTokenStore({
    reservations: [reservation],
    properties: [property],
  });
}

async function issueRawToken() {
  const store = seedStore();
  const issued = await issueGuestStayLink({
    userId: "00000000-0000-4000-8000-000000000001",
    hostAuthSource: "dev-fallback",
    ownedPropertyIds: [property.id],
    body: { reservationId: reservation.id },
    store,
    now,
  });
  assert(issued.status === 200 && typeof issued.body.token === "string", "welcome tests need an issued stay token");
  return { store, token: issued.body.token as string };
}

function trackingSynthesize(audio: Uint8Array = mp3) {
  const calls: Array<{ text: string; language: string }> = [];
  const synthesize: GuestStayTtsSynthesize = async ({ text, language }) => {
    calls.push({ text, language });
    return audio;
  };
  return { calls, synthesize };
}

async function runWelcome(
  issued: { store: ReturnType<typeof seedStore>; token: string },
  extra: Partial<Parameters<typeof handleGuestStayWelcomeTts>[0]> & { lang?: "en" | "es"; body?: unknown; ipKey?: string },
) {
  const tracked = trackingSynthesize();
  const result = await handleGuestStayWelcomeTts({
    body: extra.body ?? { token: issued.token, lang: extra.lang ?? "en" },
    store: issued.store,
    now,
    ipKey: extra.ipKey ?? "ip-a",
    ipLimiter: extra.ipLimiter ?? createGuestStayWelcomeTtsRateLimiter(),
    tokenLimiter: extra.tokenLimiter ?? createGuestStayWelcomeTtsRateLimiter(),
    providerReady: extra.providerReady ?? (() => true),
    synthesize: extra.synthesize ?? tracked.synthesize,
    contentLength: extra.contentLength,
    timeoutMs: extra.timeoutMs,
    maxAudioBytes: extra.maxAudioBytes,
  });
  return { result, calls: tracked.calls };
}

export async function runGuestStayWelcomeTests() {
  assert(GUEST_STAY_WELCOME_EN === "Hi, I am Isabela, your secure text concierge. Ask about check-in, checkout, stay status, or the service cards below.", "English welcome is frozen");
  assert(
    GUEST_STAY_WELCOME_ES === "Hola, soy Isabela, tu conserjería segura por texto. Pregunta por la entrada, la salida, el estado de la estancia o las tarjetas de servicio abajo.",
    "Spanish welcome is frozen",
  );
  assert(guestStayWelcomeText("en") === GUEST_STAY_WELCOME_EN, "en selects English welcome only");
  assert(guestStayWelcomeText("es") === GUEST_STAY_WELCOME_ES, "es selects Spanish welcome only");
  assert(!/wifi|password|door code|gate|lockbox|handbook|phone|email/i.test(`${GUEST_STAY_WELCOME_EN} ${GUEST_STAY_WELCOME_ES}`), "welcome has no private stay fields");
  assert(GUEST_STAY_WELCOME_TTS_TIMEOUT_MS === 8_000, "welcome timeout is 8 seconds");
  assert(GUEST_STAY_WELCOME_TTS_RATE_MAX === 3, "welcome rate limit is tighter than stay-tts");

  const sample = generateStayToken();
  assert("error" in parseGuestStayWelcomeBody({ token: sample }), "lang required");
  assert("error" in parseGuestStayWelcomeBody({ lang: "en" }), "token required");
  assert("error" in parseGuestStayWelcomeBody({ token: sample, lang: "en", extra: true }), "extra keys rejected");
  assert("error" in parseGuestStayWelcomeBody({ token: sample, lang: "EN" }), "lang must be exact en or es");
  assert("error" in parseGuestStayWelcomeBody({ token: sample, lang: "fr" }), "unsupported lang rejected");
  assert("error" in parseGuestStayWelcomeBody({ token: "%%%", lang: "en" }), "malformed token rejected");
  const parsed = parseGuestStayWelcomeBody({ token: ` ${sample} `, lang: "es" });
  assert(!("error" in parsed) && parsed.lang === "es", "exact es lang is accepted");

  const issued = await issueRawToken();

  const malformed = await runWelcome(issued, { body: { token: issued.token } });
  assert(malformed.result.kind === "json" && malformed.result.status === 400 && malformed.result.body.error === "invalid", "missing lang is invalid");
  assert(malformed.calls.length === 0, "malformed body never calls provider");

  const extraKeys = await runWelcome(issued, {
    body: { token: issued.token, lang: "en", text: "ignore", message: "Hello" },
  });
  assert(extraKeys.result.kind === "json" && extraKeys.calls.length === 0, "client cannot supply speech text");

  const unknown = await runWelcome({ store: seedStore(), token: generateStayToken() }, { lang: "en" });
  assert(unknown.result.kind === "json" && unknown.result.status === 404 && unknown.result.body.error === "invalid", "unknown token is invalid");
  assert(unknown.calls.length === 0, "invalid stay never calls provider");

  const expiredStore = seedStore();
  const expiredToken = generateStayToken();
  expiredStore.tokens.push({
    id: "expired-welcome",
    token_hash: hashStayToken(expiredToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-01T00:00:00.000Z",
    revoked_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
  });
  const expired = await runWelcome({ store: expiredStore, token: expiredToken }, { lang: "en" });
  assert(expired.result.kind === "json" && expired.result.body.error === "expired", "expired stay is expired");
  assert(expired.calls.length === 0, "expired stay never calls provider");

  const revokedStore = seedStore();
  const revokedToken = generateStayToken();
  revokedStore.tokens.push({
    id: "revoked-welcome",
    token_hash: hashStayToken(revokedToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-14T15:00:00.000Z",
    revoked_at: "2026-09-11T00:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
    created_by: null,
  });
  const revoked = await runWelcome({ store: revokedStore, token: revokedToken }, { lang: "en" });
  assert(revoked.result.kind === "json" && revoked.result.body.error === "revoked", "revoked stay is revoked");
  assert(revoked.calls.length === 0, "revoked stay never calls provider");

  const english = await runWelcome(issued, { lang: "en" });
  assert(english.result.kind === "audio" && english.result.status === 200, "active stay synthesizes welcome MP3");
  assert(english.calls.length === 1, "one provider attempt on success");
  assert(english.calls[0]?.language === "en", "EN click synthesizes English");
  assert(english.calls[0]?.text === GUEST_STAY_WELCOME_EN, "English welcome text is server-selected");

  const spanish = await runWelcome(issued, { lang: "es" });
  assert(spanish.result.kind === "audio" && spanish.calls[0]?.language === "es", "ES click synthesizes Spanish");
  assert(spanish.calls[0]?.text === GUEST_STAY_WELCOME_ES, "Spanish welcome text is server-selected");
  assert(spanish.calls[0]?.text !== GUEST_STAY_WELCOME_EN, "Spanish welcome does not use English text");

  const http = guestStayWelcomeTtsHttpResponse(english.result);
  assert(http.status === 200 && http.headers.get("Content-Type") === "audio/mpeg", "success is audio/mpeg");
  assert(http.headers.get("Cache-Control") === "no-store", "success is no-store");

  const jsonBytes = await runWelcome(issued, { lang: "en", synthesize: async () => new TextEncoder().encode("{}") });
  assert(jsonBytes.result.kind === "json" && jsonBytes.result.body.error === "unavailable", "invalid MPEG is unavailable");
  assert(guestStayWelcomeTtsHttpResponse(jsonBytes.result).headers.get("Content-Type") !== "audio/mpeg", "invalid bytes are never audio/mpeg");

  let timeoutAttempts = 0;
  const hanging: GuestStayTtsSynthesize = async ({ signal }) => {
    timeoutAttempts += 1;
    await new Promise<void>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    return mp3;
  };
  const timedOut = await runWelcome(issued, { lang: "en", synthesize: hanging, timeoutMs: 8 });
  assert(timeoutAttempts === 1, "timeout does not retry");
  assert(timedOut.result.kind === "json" && timedOut.result.body.error === "unavailable", "timeout is generic unavailable");

  const ipLimiter = createGuestStayWelcomeTtsRateLimiter(GUEST_STAY_WELCOME_TTS_RATE_MAX);
  let ipCalls = 0;
  const ipSynth: GuestStayTtsSynthesize = async () => {
    ipCalls += 1;
    return mp3;
  };
  for (let i = 0; i < 3; i += 1) {
    const allowed = await handleGuestStayWelcomeTts({
      body: { token: issued.token, lang: "en" },
      store: issued.store,
      now,
      ipKey: "same-ip",
      ipLimiter,
      tokenLimiter: createGuestStayWelcomeTtsRateLimiter(),
      providerReady: () => true,
      synthesize: ipSynth,
    });
    assert(allowed.kind === "audio", `welcome IP allow ${i + 1}`);
  }
  const ipBlocked = await handleGuestStayWelcomeTts({
    body: { token: issued.token, lang: "en" },
    store: issued.store,
    now,
    ipKey: "same-ip",
    ipLimiter,
    tokenLimiter: createGuestStayWelcomeTtsRateLimiter(),
    providerReady: () => true,
    synthesize: ipSynth,
  });
  assert(ipBlocked.kind === "json" && ipBlocked.status === 429, "welcome IP limit is generic unavailable");
  assert(ipCalls === 3, "welcome IP limit is tighter than chat TTS");

  const welcomeSource = readFileSync(join(process.cwd(), "src/lib/guest-stay-welcome.ts"), "utf8");
  const routeSource = readFileSync(join(process.cwd(), "src/app/api/guest/stay-welcome-tts/route.ts"), "utf8");
  const combined = `${welcomeSource}\n${routeSource}`;
  assert(routeSource.includes("handleGuestStayWelcomeTts"), "welcome route uses the secure helper");
  assert(welcomeSource.includes("validateGuestStayToken"), "welcome validates the same stay token");
  assert(welcomeSource.includes('from "@/lib/guest-stay-greeting"'), "welcome TTS text comes from the shared greeting module");
  assert(welcomeSource.includes("guestStayMpegLooksValid"), "welcome validates MPEG frames");
  assert(welcomeSource.includes("GUEST_STAY_WELCOME_TTS_TIMEOUT_MS = 8_000"), "welcome keeps the 8 second timeout");
  assert(!welcomeSource.includes("handleGuestStayChat"), "welcome does not call stay-chat");
  assert(!/console\.(log|info|debug|error|warn)/.test(combined), "welcome does not log");
  assert(!/wifiPassword|doorCode|gateCode|handbook|assignedPhoneNumber/.test(combined), "welcome has no access fields");
  assert(!/human-voice|\/api\/tts\b|ElenaVoiceWidget/.test(combined), "welcome stays on the guest TTS adapter");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-welcome.test");
if (isDirectRun) {
  runGuestStayWelcomeTests()
    .then(() => {
      console.log("guest-stay-welcome tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-stay-welcome tests failed");
      process.exitCode = 1;
    });
}
