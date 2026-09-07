import {
  resolveGuestStayUsageAttribution,
  safeRecordAiUsageEvent,
  type AiUsageRecorder,
} from "@/lib/ai-usage";
import {
  GUEST_STAY_CHAT_MAX_BODY_BYTES,
  guestStayChatReplyLooksUnsafe,
  handleGuestStayChat,
  parseGuestStayChatBody,
} from "@/lib/guest-stay-chat";
import { guestStayMpegLooksValid } from "@/lib/guest-stay-mp3";
import { isSpeakableGuestStayReply } from "@/lib/guest-stay-speech";
import { hashStayToken, stayJson, type StayTokenStore } from "@/lib/guest-stay-token";
import {
  guestElenaMp3InputText,
  guestElenaMp3ProviderModel,
  isElevenLabsTtsConfigured,
  isOpenAiTtsConfigured,
  synthesizeGuestElenaMp3,
  type TtsLanguage,
} from "@/lib/tts-synthesize";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("guest-stay-tts is server-only");
}

export const GUEST_STAY_TTS_MAX_BODY_BYTES = GUEST_STAY_CHAT_MAX_BODY_BYTES;
export const GUEST_STAY_TTS_RATE_MAX = 8;
export const GUEST_STAY_TTS_RATE_WINDOW_MS = 60_000;
export const GUEST_STAY_TTS_TIMEOUT_MS = 8_000;
export const GUEST_STAY_TTS_MAX_AUDIO_BYTES = 1_500_000;

export type GuestStayTtsErrorCode = "invalid" | "expired" | "revoked" | "unavailable";

export type GuestStayTtsSynthesize = (input: {
  text: string;
  language: TtsLanguage;
  signal: AbortSignal;
  maxBytes: number;
}) => Promise<Uint8Array>;

export type GuestStayTtsRateLimiter = {
  limited: (key: string) => boolean;
};

export type GuestStayTtsResult =
  | { kind: "audio"; status: 200; bytes: Uint8Array }
  | { kind: "json"; status: number; body: { error: GuestStayTtsErrorCode } };

function jsonError(status: number, error: GuestStayTtsErrorCode): GuestStayTtsResult {
  return { kind: "json", status, body: { error } };
}

export function createGuestStayTtsRateLimiter(
  max = GUEST_STAY_TTS_RATE_MAX,
  windowMs = GUEST_STAY_TTS_RATE_WINDOW_MS,
): GuestStayTtsRateLimiter {
  const hits = new Map<string, number[]>();
  return {
    limited(key: string) {
      const now = Date.now();
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return true;
      }
      recent.push(now);
      hits.set(key, recent);
      if (hits.size > 500) {
        const oldest = hits.keys().next().value;
        if (oldest) hits.delete(oldest);
      }
      return false;
    },
  };
}

export function selectGuestStayTtsEngine(configured: {
  elevenLabs: boolean;
  openai: boolean;
}): "elevenlabs" | "openai" | null {
  if (configured.elevenLabs) return "elevenlabs";
  if (configured.openai) return "openai";
  return null;
}

export function guestStayTtsProviderConfigured() {
  return selectGuestStayTtsEngine({
    elevenLabs: isElevenLabsTtsConfigured(),
    openai: isOpenAiTtsConfigured(),
  }) !== null;
}

export function createGuestStayTtsSynthesize(): GuestStayTtsSynthesize {
  return async ({ text, language, signal, maxBytes }) => {
    const engine = selectGuestStayTtsEngine({
      elevenLabs: isElevenLabsTtsConfigured(),
      openai: isOpenAiTtsConfigured(),
    });
    if (!engine) throw new Error("provider-unavailable");
    return synthesizeGuestElenaMp3({ text, language, engine, signal, maxBytes });
  };
}

function contentLengthRejected(contentLength: number | null | undefined) {
  if (contentLength == null) return false;
  return !Number.isFinite(contentLength) || contentLength > GUEST_STAY_TTS_MAX_BODY_BYTES;
}

function serializedBodyTooLarge(body: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(body), "utf8") > GUEST_STAY_TTS_MAX_BODY_BYTES;
  } catch {
    return true;
  }
}

function isSafeGuestStaySpeech(reply: string) {
  return isSpeakableGuestStayReply(reply) && !guestStayChatReplyLooksUnsafe(reply);
}

async function runSynthesizeOnce(
  synthesize: GuestStayTtsSynthesize,
  input: { text: string; language: TtsLanguage },
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

export async function handleGuestStayTts(input: {
  body: unknown;
  store: StayTokenStore;
  ipKey: string;
  contentLength?: number | null;
  now?: Date;
  ipLimiter: GuestStayTtsRateLimiter;
  tokenLimiter: GuestStayTtsRateLimiter;
  providerReady: () => boolean;
  synthesize: GuestStayTtsSynthesize;
  isSafeSpeech?: (reply: string) => boolean;
  timeoutMs?: number;
  maxAudioBytes?: number;
  recordUsage?: AiUsageRecorder;
  resolveHostId?: (propertyId: string) => Promise<string | null>;
  /** Test override — production selects from env keys. */
  selectedEngine?: "elevenlabs" | "openai" | null;
}): Promise<GuestStayTtsResult> {
  if (contentLengthRejected(input.contentLength)) return jsonError(400, "invalid");
  if (serializedBodyTooLarge(input.body)) return jsonError(400, "invalid");

  const parsed = parseGuestStayChatBody(input.body);
  if ("error" in parsed) return jsonError(400, "invalid");

  if (input.ipLimiter.limited(input.ipKey)) return jsonError(429, "unavailable");
  if (input.tokenLimiter.limited(hashStayToken(parsed.token))) return jsonError(429, "unavailable");

  const chat = await handleGuestStayChat({
    body: { token: parsed.token, message: parsed.message },
    store: input.store,
    now: input.now,
  });
  if (
    chat.status !== 200 ||
    typeof chat.body.reply !== "string" ||
    (chat.body.lang !== "en" && chat.body.lang !== "es")
  ) {
    const error = chat.body.error;
    if (error === "invalid" || error === "expired" || error === "revoked" || error === "unavailable") {
      return jsonError(chat.status, error);
    }
    return jsonError(503, "unavailable");
  }

  // Private-intent chat still returns the safe Access refusal; speak that refusal only when
  // it passes the disclosure/speakable guards below (never raw codes or unsafe copy).
  const reply = chat.body.reply;
  const lang = chat.body.lang;
  const safe = input.isSafeSpeech ?? isSafeGuestStaySpeech;
  if (!safe(reply)) return jsonError(503, "unavailable");

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
  const providerText = guestElenaMp3InputText(reply);
  const tokenRow = await input.store.findByHash(hashStayToken(parsed.token));
  const attribution = await resolveGuestStayUsageAttribution({
    propertyId: tokenRow?.property_id,
    reservationId: tokenRow?.reservation_id,
    resolveHostId: input.resolveHostId,
  });

  try {
    const bytes = await runSynthesizeOnce(
      input.synthesize,
      { text: reply, language: lang },
      {
        timeoutMs: input.timeoutMs ?? GUEST_STAY_TTS_TIMEOUT_MS,
        maxBytes: input.maxAudioBytes ?? GUEST_STAY_TTS_MAX_AUDIO_BYTES,
      },
    );
    await safeRecordAiUsageEvent(input.recordUsage, {
      ...attribution,
      source: "guest_stay_tts",
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
      source: "guest_stay_tts",
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

export function guestStayTtsHttpResponse(result: GuestStayTtsResult): Response {
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
