import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleGuestStayChat } from "./guest-stay-chat";
import {
  createGuestStayTtsRateLimiter,
  guestStayTtsHttpResponse,
  handleGuestStayTts,
  selectGuestStayTtsEngine,
  GUEST_STAY_TTS_TIMEOUT_MS,
  type GuestStayTtsSynthesize,
} from "./guest-stay-tts";
import { isSpeakableGuestStayReply } from "./guest-stay-speech";
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
  id: "prop-tts-1",
  name: "Palm Court",
  city: "Miami",
  timezone: "UTC",
};

const reservation: StayReservationRecord = {
  id: "res-tts-1",
  property_id: "prop-tts-1",
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
  assert(issued.status === 200 && typeof issued.body.token === "string", "tts tests need an issued stay token");
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

async function runTts(
  issued: { store: ReturnType<typeof seedStore>; token: string },
  extra: Partial<Parameters<typeof handleGuestStayTts>[0]> & { message?: string; body?: unknown; ipKey?: string },
) {
  const tracked = trackingSynthesize();
  const result = await handleGuestStayTts({
    body: extra.body ?? { token: issued.token, message: extra.message ?? "Hello" },
    store: issued.store,
    now,
    ipKey: extra.ipKey ?? "ip-a",
    ipLimiter: extra.ipLimiter ?? createGuestStayTtsRateLimiter(),
    tokenLimiter: extra.tokenLimiter ?? createGuestStayTtsRateLimiter(),
    providerReady: extra.providerReady ?? (() => true),
    synthesize: extra.synthesize ?? tracked.synthesize,
    contentLength: extra.contentLength,
    isSafeSpeech: extra.isSafeSpeech,
    timeoutMs: extra.timeoutMs,
    maxAudioBytes: extra.maxAudioBytes,
  });
  return { result, calls: tracked.calls };
}

export async function runGuestStayTtsTests() {
  const issued = await issueRawToken();

  const malformed = await runTts(issued, { body: { token: issued.token } });
  assert(malformed.result.kind === "json" && malformed.result.status === 400 && malformed.result.body.error === "invalid", "missing message is invalid");
  assert(malformed.calls.length === 0, "malformed body never calls provider");

  const extraKeys = await runTts(issued, {
    body: { token: issued.token, message: "Hello", reply: "ignore me", provider: "openai", apiKey: "sk", voice: "coral", model: "x" },
  });
  assert(extraKeys.result.kind === "json" && extraKeys.result.body.error === "invalid", "client cannot supply reply or provider fields");
  assert(extraKeys.calls.length === 0, "extra keys never reach provider");

  const oversized = await runTts(issued, { body: { token: issued.token, message: "Hello" }, contentLength: 5000 });
  assert(oversized.result.kind === "json" && oversized.result.status === 400 && oversized.result.body.error === "invalid", "oversized content-length is invalid");
  assert(oversized.calls.length === 0, "oversized body never calls provider");

  const hugeJson = await runTts(issued, { body: { token: issued.token, message: "a".repeat(500), pad: "x".repeat(4000) } });
  assert(hugeJson.result.kind === "json" && hugeJson.result.body.error === "invalid", "non-exact oversized JSON is invalid");
  assert(hugeJson.calls.length === 0, "padded JSON never calls provider");

  const unknown = await runTts({ store: seedStore(), token: generateStayToken() }, { message: "Hello" });
  assert(unknown.result.kind === "json" && unknown.result.status === 404 && unknown.result.body.error === "invalid", "unknown token is invalid");
  assert(unknown.calls.length === 0, "invalid stay never calls provider");

  const expiredStore = seedStore();
  const expiredToken = generateStayToken();
  expiredStore.tokens.push({
    id: "expired-tts",
    token_hash: hashStayToken(expiredToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-01T00:00:00.000Z",
    revoked_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
  });
  const expired = await runTts({ store: expiredStore, token: expiredToken }, { message: "Hello" });
  assert(expired.result.kind === "json" && expired.result.status === 410 && expired.result.body.error === "expired", "expired stay is expired");
  assert(expired.calls.length === 0, "expired stay never calls provider");

  const revokedStore = seedStore();
  const revokedToken = generateStayToken();
  revokedStore.tokens.push({
    id: "revoked-tts",
    token_hash: hashStayToken(revokedToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-14T15:00:00.000Z",
    revoked_at: "2026-09-11T00:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
    created_by: null,
  });
  const revoked = await runTts({ store: revokedStore, token: revokedToken }, { message: "Hello" });
  assert(revoked.result.kind === "json" && revoked.result.status === 410 && revoked.result.body.error === "revoked", "revoked stay is revoked");
  assert(revoked.calls.length === 0, "revoked stay never calls provider");

  const chat = await handleGuestStayChat({
    body: { token: issued.token, message: "Hello" },
    store: issued.store,
    now,
  });
  assert(chat.status === 200 && typeof chat.body.reply === "string", "stay-chat still returns a policy reply");
  const success = await runTts(issued, { message: "Hello" });
  assert(success.result.kind === "audio" && success.result.status === 200, "active stay synthesizes MP3");
  assert(success.calls.length === 1, "one provider attempt on success");
  assert(success.calls[0]?.text === chat.body.reply, "TTS speaks the regenerated secure-policy reply");
  assert(success.calls[0]?.language === "en", "English guest message uses en");
  assert(success.result.kind === "audio" && success.result.bytes === mp3, "audio body is the synthesizer MP3");

  const spanish = await runTts(issued, { message: "Hola" });
  assert(spanish.result.kind === "audio" && spanish.calls[0]?.language === "es", "Spanish guest message uses es");

  const checkIn = await runTts(issued, { message: "What time is check-in?" });
  assert(checkIn.result.kind === "audio" && checkIn.result.status === 200, "check-in reply still speaks");
  assert(checkIn.calls.length === 1 && /check-in/i.test(checkIn.calls[0]?.text ?? ""), "check-in TTS uses the policy check-in reply");
  assert(checkIn.calls[0]?.language === "en", "check-in guest message uses en");

  const privateChat = await handleGuestStayChat({
    body: { token: issued.token, message: "What is the wifi password?" },
    store: issued.store,
    now,
  });
  assert(privateChat.status === 200 && typeof privateChat.body.reply === "string", "private intent still returns safe chat text");
  const privateIntent = await runTts(issued, { message: "What is the wifi password?" });
  assert(privateIntent.result.kind === "audio" && privateIntent.result.status === 200, "safe private refusal is speakable");
  assert(privateIntent.calls.length === 1, "private refusal reaches provider once");
  assert(privateIntent.calls[0]?.text === privateChat.body.reply, "TTS speaks the regenerated safe refusal only");
  assert(/for security/i.test(privateIntent.calls[0]?.text ?? ""), "private TTS speaks the security refusal");
  assert(!/\b\d{4,}\b/.test(privateIntent.calls[0]?.text ?? ""), "private TTS never includes a raw code value");

  const codePassword = await runTts(issued, { message: "Where is my code password?" });
  assert(codePassword.result.kind === "audio" && codePassword.calls.length === 1, "code password request speaks safe refusal");
  assert(/secure access section/i.test(codePassword.calls[0]?.text ?? ""), "code password refusal redirects to Access");
  assert(!/4920|miami2026|password is\s+\S+/i.test(codePassword.calls[0]?.text ?? ""), "code password TTS has no secret value");

  const entryCode = await runTts(issued, { message: "Where can I find my entry code?" });
  assert(entryCode.result.kind === "audio" && entryCode.calls.length === 1, "entry code request speaks safe refusal");
  assert(/for security/i.test(entryCode.calls[0]?.text ?? "") && /secure access section/i.test(entryCode.calls[0]?.text ?? ""), "entry code refusal is the Access redirect");

  const spanishPrivate = await runTts(issued, { message: "¿Cuál es el código de entrada?" });
  assert(spanishPrivate.result.kind === "audio" && spanishPrivate.calls[0]?.language === "es", "Spanish private request uses es");
  assert(/por seguridad/i.test(spanishPrivate.calls[0]?.text ?? "") && /secci[oó]n segura de acceso/i.test(spanishPrivate.calls[0]?.text ?? ""), "Spanish private speaks the safe Access refusal");
  assert(!/\b\d{4,}\b/.test(spanishPrivate.calls[0]?.text ?? ""), "Spanish private TTS never includes a raw code");

  const door = await runTts(issued, { message: "What is the door code?" });
  assert(door.result.kind === "audio" && door.calls.length === 1, "door code intent speaks the safe refusal");
  assert(/for security/i.test(door.calls[0]?.text ?? ""), "door code TTS is refusal-only");

  assert(!isSpeakableGuestStayReply("The door code is 4920#"), "raw door code value is not speakable");
  assert(!isSpeakableGuestStayReply("wifi password is miami2026"), "raw wifi password value is not speakable");
  assert(!isSpeakableGuestStayReply("Your access code is ABCD"), "raw access code value is not speakable");
  assert(
    isSpeakableGuestStayReply(
      "For security, I can't provide entry or access codes through voice or chat. Please use the secure Access section in your Guest Stay.",
    ),
    "canonical English private refusal remains speakable",
  );
  assert(
    isSpeakableGuestStayReply(
      "Por seguridad, no puedo dar códigos de entrada o acceso por voz ni por chat. Usa la sección segura de Acceso en tu Guest Stay.",
    ),
    "canonical Spanish private refusal remains speakable",
  );

  const unsafe = await runTts(issued, { message: "Hello", isSafeSpeech: () => false });
  assert(unsafe.result.kind === "json" && unsafe.result.body.error === "unavailable" && unsafe.calls.length === 0, "unsafe speech never contacts a provider");

  const noProvider = await runTts(issued, { message: "Hello", providerReady: () => false });
  assert(noProvider.result.kind === "json" && noProvider.result.body.error === "unavailable" && noProvider.calls.length === 0, "missing provider is unavailable");

  const http = guestStayTtsHttpResponse(success.result);
  assert(http.status === 200, "success HTTP is 200");
  assert(http.headers.get("Content-Type") === "audio/mpeg", "success is audio/mpeg");
  assert(http.headers.get("Cache-Control") === "no-store", "success is no-store");
  const headerBlob = [...http.headers.entries()].map(([key, value]) => `${key}:${value}`).join("|");
  assert(!/voice|provider|eleven|openai|marin|model/i.test(headerBlob), "no voice or provider headers");
  const audioBody = new Uint8Array(await http.arrayBuffer());
  assert(audioBody.byteLength === mp3.byteLength, "HTTP body is raw MP3");

  const errHttp = guestStayTtsHttpResponse({ kind: "json", status: 503, body: { error: "unavailable" } });
  const errJson = (await errHttp.json()) as { error?: string };
  assert(Object.keys(errJson).join(",") === "error" && errJson.error === "unavailable", "errors are generic JSON only");
  assert(errHttp.headers.get("Cache-Control") === "no-store", "error JSON is no-store");

  const ipLimiter = createGuestStayTtsRateLimiter();
  const tokenLimiterForIp = createGuestStayTtsRateLimiter();
  let ipCalls = 0;
  const ipSynth: GuestStayTtsSynthesize = async () => {
    ipCalls += 1;
    return mp3;
  };
  for (let i = 0; i < 8; i += 1) {
    const allowed = await handleGuestStayTts({
      body: { token: issued.token, message: "Hello" },
      store: issued.store,
      now,
      ipKey: "same-ip",
      ipLimiter,
      tokenLimiter: tokenLimiterForIp,
      providerReady: () => true,
      synthesize: ipSynth,
    });
    assert(allowed.kind === "audio", `IP allow ${i + 1}`);
  }
  const ipBlocked = await handleGuestStayTts({
    body: { token: issued.token, message: "Hello" },
    store: issued.store,
    now,
    ipKey: "same-ip",
    ipLimiter,
    tokenLimiter: tokenLimiterForIp,
    providerReady: () => true,
    synthesize: ipSynth,
  });
  assert(ipBlocked.kind === "json" && ipBlocked.status === 429 && ipBlocked.body.error === "unavailable", "IP limit is generic unavailable");
  assert(ipCalls === 8, "IP limit blocks the provider");

  const tokenLimiter = createGuestStayTtsRateLimiter();
  let tokenCalls = 0;
  const tokenSynth: GuestStayTtsSynthesize = async () => {
    tokenCalls += 1;
    return mp3;
  };
  for (let i = 0; i < 8; i += 1) {
    const allowed = await handleGuestStayTts({
      body: { token: issued.token, message: "Hello" },
      store: issued.store,
      now,
      ipKey: `ip-${i}`,
      ipLimiter: createGuestStayTtsRateLimiter(),
      tokenLimiter,
      providerReady: () => true,
      synthesize: tokenSynth,
    });
    assert(allowed.kind === "audio", `token allow ${i + 1}`);
  }
  const tokenBlocked = await handleGuestStayTts({
    body: { token: issued.token, message: "Hello" },
    store: issued.store,
    now,
    ipKey: "ip-other",
    ipLimiter: createGuestStayTtsRateLimiter(),
    tokenLimiter,
    providerReady: () => true,
    synthesize: tokenSynth,
  });
  assert(tokenBlocked.kind === "json" && tokenBlocked.status === 429 && tokenBlocked.body.error === "unavailable", "token-hash limit is generic unavailable");
  assert(tokenCalls === 8, "token-hash limit blocks the provider");

  let attempts = 0;
  const failing: GuestStayTtsSynthesize = async () => {
    attempts += 1;
    throw new Error("provider exploded with secret detail");
  };
  const failed = await runTts(issued, { message: "Hello", synthesize: failing });
  assert(attempts === 1, "one provider attempt maximum");
  assert(failed.result.kind === "json" && failed.result.status === 503 && failed.result.body.error === "unavailable", "provider error is generic unavailable");
  assert(!JSON.stringify(failed.result).includes("secret"), "provider details are omitted");

  const hanging: GuestStayTtsSynthesize = async ({ signal }) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 50);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
    return mp3;
  };
  const timedOut = await runTts(issued, { message: "Hello", synthesize: hanging, timeoutMs: 1 });
  assert(timedOut.result.kind === "json" && timedOut.result.body.error === "unavailable", "provider timeout is unavailable");
  assert(GUEST_STAY_TTS_TIMEOUT_MS === 8_000, "guest-only synthesis timeout is 8 seconds");

  let timeoutAttempts = 0;
  const timeoutOnce: GuestStayTtsSynthesize = async ({ signal }) => {
    timeoutAttempts += 1;
    await new Promise<void>((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          reject(new Error("aborted"));
        },
        { once: true },
      );
    });
    return mp3;
  };
  const abortedOnce = await runTts(issued, { message: "Hello", synthesize: timeoutOnce, timeoutMs: 8 });
  assert(timeoutAttempts === 1, "timeout does not retry the provider");
  assert(abortedOnce.result.kind === "json" && abortedOnce.result.body.error === "unavailable", "timeout/abort is generic unavailable");

  const jsonAudio: GuestStayTtsSynthesize = async () => new TextEncoder().encode('{"ok":true}');
  const jsonRejected = await runTts(issued, { message: "Hello", synthesize: jsonAudio });
  assert(jsonRejected.result.kind === "json" && jsonRejected.result.body.error === "unavailable", "JSON bytes are unavailable");
  assert(guestStayTtsHttpResponse(jsonRejected.result).headers.get("Content-Type") !== "audio/mpeg", "invalid server bytes are never audio/mpeg");

  const id3Only = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const id3Rejected = await runTts(issued, { message: "Hello", synthesize: async () => id3Only });
  assert(id3Rejected.result.kind === "json", "ID3 without MPEG is unavailable");
  assert(guestStayTtsHttpResponse(id3Rejected.result).headers.get("Content-Type") !== "audio/mpeg", "ID3-only bytes are never audio/mpeg");

  const randomRejected = await runTts(issued, { message: "Hello", synthesize: async () => new Uint8Array(64) });
  assert(randomRejected.result.kind === "json", "random bytes are unavailable");

  const truncatedRejected = await runTts(issued, { message: "Hello", synthesize: async () => new Uint8Array([0xff, 0xfb]) });
  assert(truncatedRejected.result.kind === "json", "truncated MPEG header is unavailable");

  const id3Mpeg = new Uint8Array([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0xff, 0xfb, 0x90, 0x00,
  ]);
  const id3Ok = await runTts(issued, { message: "Hello", synthesize: async () => id3Mpeg });
  assert(id3Ok.result.kind === "audio", "valid ID3 plus MPEG frame is accepted");

  const tooBig: GuestStayTtsSynthesize = async () => new Uint8Array(32);
  const oversizedAudio = await runTts(issued, { message: "Hello", synthesize: tooBig, maxAudioBytes: 8 });
  assert(oversizedAudio.result.kind === "json" && oversizedAudio.result.body.error === "unavailable", "oversized audio is unavailable");

  assert(selectGuestStayTtsEngine({ elevenLabs: true, openai: true }) === "elevenlabs", "ElevenLabs is preferred when configured");
  assert(selectGuestStayTtsEngine({ elevenLabs: false, openai: true }) === "openai", "OpenAI is the fallback engine");
  assert(selectGuestStayTtsEngine({ elevenLabs: false, openai: false }) === null, "neither engine is unavailable");

  const ttsSource = readFileSync(join(process.cwd(), "src/lib/guest-stay-tts.ts"), "utf8");
  const routeSource = readFileSync(join(process.cwd(), "src/app/api/guest/stay-tts/route.ts"), "utf8");
  const chatSource = readFileSync(join(process.cwd(), "src/lib/guest-stay-chat.ts"), "utf8");
  const chatRouteSource = readFileSync(join(process.cwd(), "src/app/api/guest/stay-chat/route.ts"), "utf8");
  const synthesizeSource = readFileSync(join(process.cwd(), "src/lib/tts-synthesize.ts"), "utf8");
  const cardSource = readFileSync(join(process.cwd(), "src/components/guest/guest-elena-text-card.tsx"), "utf8");
  const combined = `${ttsSource}\n${routeSource}`;

  assert(!/console\.(log|info|debug|error|warn)/.test(combined), "no text/token/hash/audio/provider-detail logging");
  assert(!/\/api\/tts\b/.test(combined), "stay TTS does not import /api/tts");
  assert(!/human-voice|ElenaVoiceWidget|ElenaTalkControls|useListings|ListingsProvider|localStorage|sessionStorage/.test(combined), "no host voice widgets, listings, or storage");
  assert(!/\bProperty\b/.test(combined), "no Property payloads");
  assert(!ttsSource.includes("from \"@/app/api/tts") && !routeSource.includes("from \"@/app/api/tts"), "no /api/tts module import");
  assert(ttsSource.includes("handleGuestStayChat"), "stay TTS reuses stay-chat validation and policy");
  assert(ttsSource.includes("parseGuestStayChatBody"), "stay TTS uses the exact stay-chat body contract");
  assert(ttsSource.includes("guestStayMpegLooksValid"), "stay TTS validates MPEG frames before audio/mpeg");
  assert(ttsSource.includes("GUEST_STAY_TTS_TIMEOUT_MS = 8_000"), "guest synthesis timeout is 8 seconds");
  assert(!ttsSource.includes("12_000"), "guest synthesis timeout is no longer 12 seconds");
  assert(!ttsSource.includes("input.body.reply") && !routeSource.includes("body.reply"), "client reply text is not accepted");
  assert(routeSource.includes("handleGuestStayTts"), "route uses the injectable stay TTS helper");
  assert(cardSource.includes("GUEST_STAY_AUDIO_PATH") || cardSource.includes("/api/guest/stay-tts"), "guest Elena card requests stay-tts after chat");
  assert(chatRouteSource.includes("handleGuestStayChat") && !chatRouteSource.includes("handleGuestStayTts"), "stay-chat route contract is unchanged");
  assert(chatSource.includes("engine: GUEST_STAY_CHAT_ENGINE") || chatSource.includes('engine: GUEST_STAY_CHAT_ENGINE'), "stay-chat success still names the secure-policy engine");
  assert(!/wifiPassword|doorCode|gateCode|lockbox|handbook|assignedPhoneNumber/.test(combined), "Phase 3 access fields remain absent");
  assert(!synthesizeSource.includes("from \"@/lib/human-voice\""), "tts-synthesize no longer imports the host voice client");
  assert(synthesizeSource.includes("synthesizeGuestElenaMp3"), "guest MP3 adapter lives in tts-synthesize");
  const guestFn = synthesizeSource.slice(synthesizeSource.indexOf("export async function synthesizeGuestElenaMp3"));
  assert(!guestFn.includes("eleven_v3"), "guest ElevenLabs path does not fail over models");
  assert(!guestFn.includes("OPENAI_ADVANCED_AUDIO_MODELS"), "guest OpenAI path does not fail over paid models");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-tts.test");
if (isDirectRun) {
  runGuestStayTtsTests()
    .then(() => {
      console.log("guest-stay-tts tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-stay-tts tests failed");
      process.exitCode = 1;
    });
}
