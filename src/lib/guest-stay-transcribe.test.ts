import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_STAY_TRANSCRIBE_MAX_BYTES,
  GUEST_STAY_TRANSCRIBE_MIN_BYTES,
  GUEST_STAY_TRANSCRIBE_MODEL,
  createGuestStayTranscribeRateLimiter,
  guestStayTranscribeFilename,
  guestStayTranscribeMimeAllowed,
  handleGuestStayTranscribe,
  normalizeGuestStayTranscribeMime,
  type GuestStayTranscribeProvider,
} from "./guest-stay-transcribe";
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
  id: "prop-stt-1",
  name: "Palm Court",
  city: "Miami",
  timezone: "UTC",
};

const reservation: StayReservationRecord = {
  id: "res-stt-1",
  property_id: "prop-stt-1",
  check_in: "2026-09-10",
  check_in_time: "3:00 PM",
  check_out: "2026-09-14",
  check_out_time: "11:00 AM",
  status: "upcoming",
};

const now = new Date("2026-09-11T12:00:00.000Z");

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
  assert(issued.status === 200 && typeof issued.body.token === "string", "transcribe tests need an issued stay token");
  return { store, token: issued.body.token as string };
}

function audioBytes(size = 1024) {
  return new Uint8Array(size).fill(7);
}

function trackingProvider(text = "Where is parking?") {
  const calls: Array<{ bytes: number; mimeType: string; filename: string }> = [];
  const transcribe: GuestStayTranscribeProvider = async ({ bytes, mimeType, filename }) => {
    calls.push({ bytes: bytes.byteLength, mimeType, filename });
    return text;
  };
  return { calls, transcribe };
}

async function runTranscribe(
  issued: { store: ReturnType<typeof seedStore>; token: string },
  extra: Partial<Parameters<typeof handleGuestStayTranscribe>[0]> & {
    tokenOverride?: unknown;
    audioSize?: number;
    mimeType?: string | null;
  } = {},
) {
  const tracked = trackingProvider();
  const result = await handleGuestStayTranscribe({
    token: extra.tokenOverride ?? issued.token,
    audioBytes: extra.audioBytes === undefined ? audioBytes(extra.audioSize ?? 1024) : extra.audioBytes,
    mimeType: extra.mimeType === undefined ? "audio/webm" : extra.mimeType,
    store: issued.store,
    now,
    providerReady: extra.providerReady ?? (() => true),
    transcribe: extra.transcribe ?? tracked.transcribe,
    ipLimiter: extra.ipLimiter ?? createGuestStayTranscribeRateLimiter(),
    tokenLimiter: extra.tokenLimiter ?? createGuestStayTranscribeRateLimiter(),
    ipKey: extra.ipKey ?? "ip-a",
    signal: extra.signal,
    filename: extra.filename,
  });
  return { result, calls: tracked.calls };
}

export async function runGuestStayTranscribeTests() {
  assert(GUEST_STAY_TRANSCRIBE_MODEL === "gpt-4o-mini-transcribe", "beta uses gpt-4o-mini-transcribe");
  assert(normalizeGuestStayTranscribeMime("audio/webm;codecs=opus") === "audio/webm", "mime strips codecs");
  assert(guestStayTranscribeMimeAllowed("audio/mp4"), "mp4 allowed");
  assert(guestStayTranscribeMimeAllowed("audio/webm"), "webm allowed");
  assert(!guestStayTranscribeMimeAllowed("video/mp4"), "video rejected");
  assert(guestStayTranscribeFilename("audio/mp4") === "audio.mp4", "mp4 filename");
  assert(guestStayTranscribeFilename("audio/webm") === "audio.webm", "webm filename");

  const issued = await issueRawToken();

  const ok = await runTranscribe(issued);
  assert(ok.result.kind === "ok" && ok.result.status === 200, "valid token + audio returns ok");
  assert(ok.result.kind === "ok" && ok.result.transcript === "Where is parking?", "transcript returned");
  assert(ok.calls.length === 1, "provider called once on success");

  const invalidToken = await runTranscribe(issued, { tokenOverride: "not-a-token" });
  assert(
    invalidToken.result.kind === "json" && invalidToken.result.status === 400 && invalidToken.result.body.error === "invalid",
    "invalid token rejected",
  );
  assert(invalidToken.calls.length === 0, "invalid token never reaches provider");

  const unknown = await runTranscribe({ store: seedStore(), token: generateStayToken() });
  assert(
    unknown.result.kind === "json" && unknown.result.status === 404 && unknown.result.body.error === "invalid",
    "unknown token rejected",
  );
  assert(unknown.calls.length === 0, "unknown token never reaches provider");

  const expiredStore = seedStore();
  const expiredToken = generateStayToken();
  expiredStore.tokens.push({
    id: "expired-stt",
    token_hash: hashStayToken(expiredToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-01T00:00:00.000Z",
    revoked_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: null,
  });
  const expired = await runTranscribe({ store: expiredStore, token: expiredToken });
  assert(
    expired.result.kind === "json" && expired.result.status === 410 && expired.result.body.error === "expired",
    "expired token rejected",
  );
  assert(expired.calls.length === 0, "expired token never reaches provider");

  const revokedStore = seedStore();
  const revokedToken = generateStayToken();
  revokedStore.tokens.push({
    id: "revoked-stt",
    token_hash: hashStayToken(revokedToken),
    reservation_id: reservation.id,
    property_id: property.id,
    expires_at: "2026-09-14T15:00:00.000Z",
    revoked_at: "2026-09-11T00:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
    created_by: null,
  });
  const revoked = await runTranscribe({ store: revokedStore, token: revokedToken });
  assert(
    revoked.result.kind === "json" && revoked.result.status === 410 && revoked.result.body.error === "revoked",
    "revoked token rejected",
  );
  assert(revoked.calls.length === 0, "revoked token never reaches provider");

  const missing = await runTranscribe(issued, { audioBytes: null });
  assert(
    missing.result.kind === "json" && missing.result.status === 400 && missing.result.body.error === "invalid",
    "missing audio rejected",
  );
  assert(missing.calls.length === 0, "missing audio never reaches provider");

  const empty = await runTranscribe(issued, { audioSize: GUEST_STAY_TRANSCRIBE_MIN_BYTES - 1 });
  assert(
    empty.result.kind === "json" && empty.result.status === 400 && empty.result.body.error === "invalid",
    "empty/tiny audio rejected",
  );
  assert(empty.calls.length === 0, "empty audio never reaches provider");

  const oversized = await runTranscribe(issued, { audioSize: GUEST_STAY_TRANSCRIBE_MAX_BYTES + 1 });
  assert(
    oversized.result.kind === "json" && oversized.result.status === 400 && oversized.result.body.error === "invalid",
    "oversized audio rejected",
  );
  assert(oversized.calls.length === 0, "oversized audio never reaches provider");

  const badMime = await runTranscribe(issued, { mimeType: "application/pdf" });
  assert(
    badMime.result.kind === "json" && badMime.result.status === 400 && badMime.result.body.error === "unsupported",
    "unsupported MIME rejected",
  );
  assert(badMime.calls.length === 0, "unsupported MIME never reaches provider");

  const providerDown = await runTranscribe(issued, { providerReady: () => false });
  assert(
    providerDown.result.kind === "json" &&
      providerDown.result.status === 503 &&
      providerDown.result.body.error === "unavailable",
    "missing provider config is unavailable",
  );
  assert(providerDown.calls.length === 0, "unconfigured provider never called");

  const providerFail = await runTranscribe(issued, {
    transcribe: async () => {
      throw new Error("upstream");
    },
  });
  assert(
    providerFail.result.kind === "json" &&
      providerFail.result.status === 503 &&
      providerFail.result.body.error === "unavailable",
    "provider failure handled safely",
  );

  const emptyTranscript = await runTranscribe(issued, {
    transcribe: async () => "",
  });
  assert(
    emptyTranscript.result.kind === "json" && emptyTranscript.result.body.error === "invalid",
    "empty provider transcript is invalid",
  );

  const source = readFileSync(join(process.cwd(), "src/lib/guest-stay-transcribe.ts"), "utf8");
  assert(source.includes("gpt-4o-mini-transcribe"), "model constant present");
  assert(!source.includes('language:'), "transcription does not force a language");
  assert(source.includes("validateGuestStayToken"), "reuses guest stay token validation");
  assert(!/console\.(log|info|debug|error)/.test(source), "server helper does not log audio");

  const route = readFileSync(join(process.cwd(), "src/app/api/guest/stay-transcribe/route.ts"), "utf8");
  assert(route.includes("formData()"), "route accepts multipart form");
  assert(route.includes("handleGuestStayTranscribe"), "route uses shared handler");
  assert(route.includes('form.get("token")'), "route reads stay token from form");
  assert(!/OPENAI_API_KEY/.test(route) || route.includes("guestStayTranscribeProviderConfigured"), "route does not expose raw key handling");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-transcribe.test");
if (isDirectRun) {
  runGuestStayTranscribeTests()
    .then(() => {
      console.log("guest-stay-transcribe tests passed");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
