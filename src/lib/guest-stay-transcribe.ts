import OpenAI, { toFile } from "openai";
import {
  isValidStayTokenFormat,
  validateGuestStayToken,
  type StayErrorCode,
  type StayTokenStore,
} from "@/lib/guest-stay-token";
import { isOpenAiTtsConfigured } from "@/lib/tts-synthesize";

/** Server-only module. Do not import from Client Components. */
if (typeof window !== "undefined") {
  throw new Error("guest-stay-transcribe is server-only");
}

export const GUEST_STAY_TRANSCRIBE_MAX_BYTES = 3 * 1024 * 1024;
export const GUEST_STAY_TRANSCRIBE_MAX_DURATION_MS = 20_000;
export const GUEST_STAY_TRANSCRIBE_MIN_BYTES = 200;
export const GUEST_STAY_TRANSCRIBE_RATE_MAX = 12;
export const GUEST_STAY_TRANSCRIBE_RATE_WINDOW_MS = 60_000;
export const GUEST_STAY_TRANSCRIBE_TIMEOUT_MS = 20_000;
/** Preferred beta model; OpenAI auto-detects spoken EN/ES when language is omitted. */
export const GUEST_STAY_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";

export const GUEST_STAY_TRANSCRIBE_ALLOWED_MIME = [
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
] as const;

export type GuestStayTranscribeErrorCode =
  | "invalid"
  | "expired"
  | "revoked"
  | "unavailable"
  | "unsupported";

export type GuestStayTranscribeResult =
  | { kind: "ok"; status: 200; transcript: string }
  | { kind: "json"; status: number; body: { error: GuestStayTranscribeErrorCode } };

export type GuestStayTranscribeProvider = (input: {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  signal: AbortSignal;
}) => Promise<string>;

export type GuestStayTranscribeRateLimiter = {
  limited: (key: string) => boolean;
};

function jsonError(status: number, error: GuestStayTranscribeErrorCode): GuestStayTranscribeResult {
  return { kind: "json", status, body: { error } };
}

export function guestStayTranscribeProviderConfigured() {
  return isOpenAiTtsConfigured();
}

export function createGuestStayTranscribeRateLimiter(
  max = GUEST_STAY_TRANSCRIBE_RATE_MAX,
  windowMs = GUEST_STAY_TRANSCRIBE_RATE_WINDOW_MS,
): GuestStayTranscribeRateLimiter {
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

export function normalizeGuestStayTranscribeMime(raw: string | null | undefined) {
  const base = (raw ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!base) return "";
  if (base === "audio/mp3") return "audio/mpeg";
  if (base === "audio/x-m4a") return "audio/m4a";
  return base;
}

export function guestStayTranscribeMimeAllowed(mime: string) {
  const normalized = normalizeGuestStayTranscribeMime(mime);
  return (GUEST_STAY_TRANSCRIBE_ALLOWED_MIME as readonly string[]).includes(normalized);
}

export function guestStayTranscribeFilename(mime: string) {
  const normalized = normalizeGuestStayTranscribeMime(mime);
  if (normalized.includes("mp4") || normalized.includes("m4a") || normalized.includes("aac")) return "audio.mp4";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "audio.mp3";
  if (normalized.includes("wav")) return "audio.wav";
  if (normalized.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}

function openaiClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

export function createGuestStayTranscribeProvider(): GuestStayTranscribeProvider {
  return async ({ bytes, mimeType, filename, signal }) => {
    const openai = openaiClient();
    if (!openai) throw new Error("provider-unavailable");
    const file = await toFile(Buffer.from(bytes), filename, {
      type: normalizeGuestStayTranscribeMime(mimeType) || "application/octet-stream",
    });
    const result = await openai.audio.transcriptions.create(
      {
        model: GUEST_STAY_TRANSCRIBE_MODEL,
        file,
        // Intentionally omit `language` so EN/ES are detected automatically.
      },
      { signal },
    );
    return (result.text ?? "").trim();
  };
}

export async function handleGuestStayTranscribe(input: {
  token: unknown;
  audioBytes: Uint8Array | null;
  mimeType: string | null | undefined;
  filename?: string | null;
  store: StayTokenStore;
  providerReady: () => boolean;
  transcribe: GuestStayTranscribeProvider;
  ipLimiter: GuestStayTranscribeRateLimiter;
  tokenLimiter: GuestStayTranscribeRateLimiter;
  ipKey: string;
  now?: Date;
  signal?: AbortSignal;
}): Promise<GuestStayTranscribeResult> {
  if (!isValidStayTokenFormat(input.token)) return jsonError(400, "invalid");
  const token = input.token;

  if (input.ipLimiter.limited(input.ipKey) || input.tokenLimiter.limited(token)) {
    return jsonError(429, "unavailable");
  }

  if (!input.audioBytes) return jsonError(400, "invalid");
  if (input.audioBytes.byteLength < GUEST_STAY_TRANSCRIBE_MIN_BYTES) return jsonError(400, "invalid");
  if (input.audioBytes.byteLength > GUEST_STAY_TRANSCRIBE_MAX_BYTES) return jsonError(400, "invalid");

  const mime = normalizeGuestStayTranscribeMime(input.mimeType);
  if (!guestStayTranscribeMimeAllowed(mime)) return jsonError(400, "unsupported");

  const validated = await validateGuestStayToken({
    body: { token },
    store: input.store,
    now: input.now,
  });
  if (validated.status !== 200 || validated.body.error) {
    const error = (validated.body.error as StayErrorCode | undefined) ?? "invalid";
    return jsonError(validated.status, error);
  }

  if (!input.providerReady()) return jsonError(503, "unavailable");

  const controller = new AbortController();
  const outer = input.signal;
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), GUEST_STAY_TRANSCRIBE_TIMEOUT_MS);

  try {
    const transcript = await input.transcribe({
      bytes: input.audioBytes,
      mimeType: mime,
      filename: input.filename?.trim() || guestStayTranscribeFilename(mime),
      signal: controller.signal,
    });
    if (!transcript) return jsonError(400, "invalid");
    return { kind: "ok", status: 200, transcript: transcript.slice(0, 500) };
  } catch {
    return jsonError(503, "unavailable");
  } finally {
    clearTimeout(timer);
    if (outer) outer.removeEventListener("abort", onAbort);
  }
}
