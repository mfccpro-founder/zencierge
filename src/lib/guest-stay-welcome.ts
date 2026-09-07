import {
  resolveGuestStayUsageAttribution,
  safeRecordAiUsageEvent,
  type AiUsageRecorder,
} from "@/lib/ai-usage";
import { guestStayChatReplyLooksUnsafe } from "@/lib/guest-stay-chat";
import {
  GUEST_STAY_WELCOME_EN,
  GUEST_STAY_WELCOME_ES,
} from "@/lib/guest-stay-greeting";
import { guestStayMpegLooksValid } from "@/lib/guest-stay-mp3";
import { isSpeakableGuestStayReply } from "@/lib/guest-stay-speech";
import {
  hashStayToken,
  isValidStayTokenFormat,
  stayJson,
  validateGuestStayToken,
  type StayTokenStore,
} from "@/lib/guest-stay-token";
import {
  createGuestStayTtsRateLimiter,
  createGuestStayTtsSynthesize,
  guestStayTtsProviderConfigured,
  selectGuestStayTtsEngine,
  type GuestStayTtsErrorCode,
  type GuestStayTtsRateLimiter,
  type GuestStayTtsResult,
  type GuestStayTtsSynthesize,
} from "@/lib/guest-stay-tts";
import {
  guestElenaMp3InputText,
  guestElenaMp3ProviderModel,
  isElevenLabsTtsConfigured,
  isOpenAiTtsConfigured,
} from "@/lib/tts-synthesize";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("guest-stay-welcome is server-only");
}

export const GUEST_STAY_WELCOME_TTS_MAX_BODY_BYTES = 1024;
export const GUEST_STAY_WELCOME_TTS_RATE_MAX = 3;
export const GUEST_STAY_WELCOME_TTS_RATE_WINDOW_MS = 60_000;
export const GUEST_STAY_WELCOME_TTS_TIMEOUT_MS = 8_000;
export const GUEST_STAY_WELCOME_TTS_MAX_AUDIO_BYTES = 1_500_000;

export { GUEST_STAY_WELCOME_EN, GUEST_STAY_WELCOME_ES };
export {
  createGuestStayTtsRateLimiter as createGuestStayWelcomeTtsRateLimiter,
  createGuestStayTtsSynthesize as createGuestStayWelcomeTtsSynthesize,
  guestStayTtsProviderConfigured as guestStayWelcomeTtsProviderConfigured,
};

const ALLOWED_BODY_KEYS = new Set(["token", "lang"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonError(status: number, error: GuestStayTtsErrorCode): GuestStayTtsResult {
  return { kind: "json", status, body: { error } };
}

function contentLengthRejected(contentLength: number | null | undefined) {
  if (contentLength == null) return false;
  return !Number.isFinite(contentLength) || contentLength > GUEST_STAY_WELCOME_TTS_MAX_BODY_BYTES;
}

function serializedBodyTooLarge(body: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(body), "utf8") > GUEST_STAY_WELCOME_TTS_MAX_BODY_BYTES;
  } catch {
    return true;
  }
}

export function guestStayWelcomeText(lang: "en" | "es") {
  return lang === "es" ? GUEST_STAY_WELCOME_ES : GUEST_STAY_WELCOME_EN;
}

export function parseGuestStayWelcomeBody(
  body: unknown,
): { token: string; lang: "en" | "es" } | { error: "invalid" } {
  if (!isPlainObject(body)) return { error: "invalid" };
  const keys = Object.keys(body);
  if (keys.length !== 2 || keys.some((key) => !ALLOWED_BODY_KEYS.has(key))) return { error: "invalid" };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const lang = body.lang;
  if (!isValidStayTokenFormat(token)) return { error: "invalid" };
  if (lang !== "en" && lang !== "es") return { error: "invalid" };
  return { token, lang };
}

async function runSynthesizeOnce(
  synthesize: GuestStayTtsSynthesize,
  input: { text: string; language: "en" | "es" },
  options: { timeoutMs: number; maxBytes: number },
): Promise<Uint8Array> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = synthesize({
    text: input.text,
    language: input.language,
    signal: controller.signal,
    maxBytes: options.maxBytes,
  });
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, options.timeoutMs);
  });
  try {
    const bytes = await Promise.race([work, timeout]);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > options.maxBytes) {
      throw new Error("audio-size");
    }
    if (!guestStayMpegLooksValid(bytes)) {
      throw new Error("audio-invalid");
    }
    return bytes;
  } finally {
    if (timer) clearTimeout(timer);
    void work.catch(() => undefined);
  }
}

export async function handleGuestStayWelcomeTts(input: {
  body: unknown;
  store: StayTokenStore;
  ipKey: string;
  contentLength?: number | null;
  now?: Date;
  ipLimiter: GuestStayTtsRateLimiter;
  tokenLimiter: GuestStayTtsRateLimiter;
  providerReady: () => boolean;
  synthesize: GuestStayTtsSynthesize;
  timeoutMs?: number;
  maxAudioBytes?: number;
  recordUsage?: AiUsageRecorder;
  resolveHostId?: (propertyId: string) => Promise<string | null>;
  selectedEngine?: "elevenlabs" | "openai" | null;
}): Promise<GuestStayTtsResult> {
  if (contentLengthRejected(input.contentLength)) return jsonError(400, "invalid");
  if (serializedBodyTooLarge(input.body)) return jsonError(400, "invalid");

  const parsed = parseGuestStayWelcomeBody(input.body);
  if ("error" in parsed) return jsonError(400, "invalid");

  if (input.ipLimiter.limited(input.ipKey)) return jsonError(429, "unavailable");
  if (input.tokenLimiter.limited(hashStayToken(parsed.token))) return jsonError(429, "unavailable");

  const stay = await validateGuestStayToken({
    body: { token: parsed.token },
    store: input.store,
    now: input.now,
  });
  if (stay.status !== 200) {
    const error = stay.body.error;
    if (error === "invalid" || error === "expired" || error === "revoked" || error === "unavailable") {
      return jsonError(stay.status, error);
    }
    return jsonError(503, "unavailable");
  }

  const text = guestStayWelcomeText(parsed.lang);
  if (!isSpeakableGuestStayReply(text) || guestStayChatReplyLooksUnsafe(text)) {
    return jsonError(503, "unavailable");
  }

  if (!input.providerReady()) return jsonError(503, "unavailable");

  const engine =
    input.selectedEngine !== undefined
      ? input.selectedEngine
      : selectGuestStayTtsEngine({
          elevenLabs: isElevenLabsTtsConfigured(),
          openai: isOpenAiTtsConfigured(),
        }) ?? "openai";
  if (!engine) return jsonError(503, "unavailable");

  const providerModel = guestElenaMp3ProviderModel(engine);
  const providerText = guestElenaMp3InputText(text);
  const tokenRow = await input.store.findByHash(hashStayToken(parsed.token));
  const attribution = await resolveGuestStayUsageAttribution({
    propertyId: tokenRow?.property_id,
    reservationId: tokenRow?.reservation_id,
    resolveHostId: input.resolveHostId,
  });

  try {
    const bytes = await runSynthesizeOnce(
      input.synthesize,
      { text, language: parsed.lang },
      {
        timeoutMs: input.timeoutMs ?? GUEST_STAY_WELCOME_TTS_TIMEOUT_MS,
        maxBytes: input.maxAudioBytes ?? GUEST_STAY_WELCOME_TTS_MAX_AUDIO_BYTES,
      },
    );
    await safeRecordAiUsageEvent(input.recordUsage, {
      ...attribution,
      source: "guest_stay_welcome_tts",
      provider: providerModel.provider,
      model: providerModel.model,
      operation: "tts",
      status: "success",
      input_characters: providerText.length,
      audio_bytes: bytes.byteLength,
      calculated_cost_cents: null,
    });
    return { kind: "audio", status: 200, bytes };
  } catch {
    await safeRecordAiUsageEvent(input.recordUsage, {
      ...attribution,
      source: "guest_stay_welcome_tts",
      provider: providerModel.provider,
      model: providerModel.model,
      operation: "tts",
      status: "failed",
      input_characters: providerText.length,
      calculated_cost_cents: null,
    });
    return jsonError(503, "unavailable");
  }
}

export function guestStayWelcomeTtsHttpResponse(result: GuestStayTtsResult): Response {
  if (result.kind === "audio") {
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  }
  return stayJson(result.body, result.status);
}
