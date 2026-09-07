import { Readable } from "node:stream";
import OpenAI from "openai";
import { FEMALE_ELEVENLABS_VOICE_ID } from "@/lib/elena-voice-ids";

export type TtsLanguage = "en" | "es";

const TTS_ES_WORD =
  /\b(el|la|los|las|un|una|unos|unas|y|o|de|del|al|qué|que|cuál|cual|dónde|donde|cómo|como|está|están|estan|hola|buenas|buenos|días|dias|tardes|noches|gracias|por|para|con|sin|mi|tu|su|me|te|se|soy|estoy|tengo|tiene|hay|necesito|quiero|puedo|ayuda|favor|baño|bano|clave|puerta|cerca|wifi|código|codigo|elena|sí|si|no|claro|dime|cuéntame|cuentame|restaurante|comida|playa|parking|estacionamiento)\b/gi;
const TTS_EN_WORD =
  /\b(the|and|or|a|an|is|are|was|i|i'm|im|you|we|what|where's|where|how|hello|hi|hey|please|thanks|thank|need|want|can|could|would|my|me|wifi|password|door|code|help|near|nearby)\b/gi;

/** Server-safe copy of host utterance language detection (no client voice runtime). */
export function detectTtsUtteranceLang(text: string): TtsLanguage {
  const raw = text.trim();
  if (!raw) return "es";
  if (/[áéíóúüñ¿¡]/i.test(raw)) return "es";
  const lower = raw.toLowerCase();
  if (/^(hola|buenas|buenos días|buenos dias|buenas tardes|buenas noches|gracias|por favor)\b/i.test(lower)) {
    return "es";
  }
  const esHits = lower.match(TTS_ES_WORD)?.length ?? 0;
  const enHits = lower.match(TTS_EN_WORD)?.length ?? 0;
  if (esHits > enHits) return "es";
  if (enHits > esHits) return "en";
  if (esHits > 0) return "es";
  if (enHits > 0) return "en";
  return "es";
}

export type TtsEngine = "elevenlabs" | "openai-audio";
export type OpenAiAudioModel = "gpt-audio-1.5" | "gpt-4o-audio-preview";

export const OPENAI_ADVANCED_AUDIO_MODELS: readonly OpenAiAudioModel[] = [
  "gpt-audio-1.5",
  "gpt-4o-audio-preview",
];

export type TtsResult = {
  bytes: Buffer;
  contentType: string;
  engine: TtsEngine;
  model: string;
  voice: string;
  language: TtsLanguage;
};

export class AdvancedAudioTtsError extends Error {
  readonly code = "ADVANCED_AUDIO_FAILED";
  readonly attempted: string[];
  readonly voice: string;

  constructor(message: string, attempted: string[], voice: string) {
    super(message);
    this.name = "AdvancedAudioTtsError";
    this.attempted = attempted;
    this.voice = voice;
  }
}

export const OPENAI_STREAM_TTS_MODEL = "gpt-4o-mini-tts";
/** gpt-4o-mini-tts PCM is 24 kHz 16-bit signed little-endian mono. */
export const OPENAI_TTS_PCM_RATE = 24000;

export type TtsStreamResult = {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  engine: "openai-tts-stream";
  model: string;
  voice: string;
  language: TtsLanguage;
  sampleRate: number;
};

const OPENAI_SPEECH_VOICES = new Set(["nova", "shimmer", "coral", "sage", "marin", "ballad", "alloy", "ash", "verse"]);

function hospitalityVoiceInstructions(language: TtsLanguage) {
  const languageLine =
    language === "es"
      ? "The script is Spanish. Speak entirely in fluent Latin American Spanish (Miami-host cadence, not Castilian broadcast). Do not switch to English."
      : "The script is English. Speak entirely in natural American English with South Florida hospitality. Do not switch to Spanish.";

  return [
    "You are Elena, a warm boutique-stay concierge speaking aloud.",
    "Automatically match the language of the text you are given: Spanish text → speak Spanish; English text → speak English. Never mix languages. Never translate the script.",
    languageLine,
    "Sound like a real person in the room: slight smile, easy breath, human timing.",
    "Warm and grounded. Never robotic, computerized, clipped, GPS-like, or announcer-flat.",
    "Vary rhythm and pitch. Soften sentence endings. Do not put equal stress on every word.",
    "Do not pause after every comma. Do not punch list items like a countdown.",
    "If the text is urgent, add calm gravity — never panic.",
  ].join(" ");
}

function elevenLabsKey() {
  return process.env.ELEVENLABS_API_KEY?.trim() || process.env.ELEVEN_API_KEY?.trim() || "";
}

export function isElevenLabsTtsConfigured() {
  return Boolean(elevenLabsKey());
}

export function isOpenAiTtsConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function elevenLabsVoiceId() {
  return process.env.ELEVENLABS_VOICE_ID?.trim() || FEMALE_ELEVENLABS_VOICE_ID;
}

function openaiClient(apiKeyOverride?: string) {
  const apiKey = apiKeyOverride?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function normalizeStability(raw: number | undefined) {
  if (!Number.isFinite(raw)) return 0.42;
  const n = raw as number;
  const unit = n > 1.5 ? n / 100 : n;
  return Math.min(Math.max(unit, 0.2), 0.75);
}

function elevenSpeed(speed: number) {
  return Math.min(Math.max(speed, 0.7), 1.15);
}

async function synthesizeElevenLabs(input: {
  text: string;
  language: TtsLanguage;
  speed: number;
  stability: number;
  apiKey?: string;
  voiceId?: string;
}): Promise<TtsResult> {
  const apiKey = input.apiKey?.trim() || elevenLabsKey();
  if (!apiKey) throw new Error("elevenlabs-missing-key");
  const voiceId = input.voiceId?.trim() || elevenLabsVoiceId();
  const models = ["eleven_v3", "eleven_multilingual_v2"] as const;

  let lastError: Error | null = null;
  for (const modelId of models) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: input.text,
        model_id: modelId,
        language_code: input.language,
        apply_text_normalization: "on",
        voice_settings: {
          stability: input.stability,
          similarity_boost: 0.82,
          style: modelId === "eleven_v3" ? 0.22 : 0.32,
          speed: elevenSpeed(input.speed),
          ...(modelId === "eleven_multilingual_v2" ? { use_speaker_boost: true } : {}),
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      lastError = new Error(`elevenlabs-${modelId}-${response.status}: ${detail.slice(0, 240)}`);
      continue;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      lastError = new Error(`elevenlabs-${modelId}-empty`);
      continue;
    }
    return {
      bytes: buffer,
      contentType: "audio/mpeg",
      engine: "elevenlabs",
      model: modelId,
      voice: voiceId,
      language: input.language,
    };
  }

  throw lastError ?? new Error("elevenlabs-failed");
}

function audioPayload(message: { audio?: { data?: string } } | undefined) {
  return message?.audio?.data?.trim() ?? "";
}

async function synthesizeOpenAiAudio(
  openai: OpenAI,
  input: { text: string; voice: string; language: TtsLanguage },
): Promise<TtsResult> {
  const voice = OPENAI_SPEECH_VOICES.has(input.voice) ? input.voice : "coral";
  const system = [
    hospitalityVoiceInstructions(input.language),
    "Read the user's message verbatim as speech. Do not add, omit, or rephrase any words. Do not answer it — speak it.",
  ].join(" ");

  const failures: string[] = [];
  for (const model of OPENAI_ADVANCED_AUDIO_MODELS) {
    try {
      const completion = await openai.chat.completions.create({
        model,
        modalities: ["text", "audio"],
        audio: { voice, format: "mp3" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: input.text },
        ],
      });
      const data = audioPayload(completion.choices[0]?.message as { audio?: { data?: string } } | undefined);
      if (!data) {
        failures.push(`${model}: no audio payload`);
        continue;
      }
      return {
        bytes: Buffer.from(data, "base64"),
        contentType: "audio/mpeg",
        engine: "openai-audio",
        model,
        voice,
        language: input.language,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      failures.push(`${model}: ${message}`);
      console.warn("[tts] advanced OpenAI audio failed", model, message);
    }
  }

  throw new AdvancedAudioTtsError(
    `Advanced OpenAI audio failed for coral (${OPENAI_ADVANCED_AUDIO_MODELS.join(", ")}). ${failures.join(" | ")}. Browser TTS was not used.`,
    [...OPENAI_ADVANCED_AUDIO_MODELS],
    voice,
  );
}

export async function synthesizeElenaSpeech(input: {
  text: string;
  voice?: string;
  language?: TtsLanguage | "auto";
  speed?: number;
  stability?: number;
  provider?: "auto" | "elevenlabs" | "openai" | "openai-audio";
  elevenLabsApiKey?: string;
  openaiApiKey?: string;
}): Promise<TtsResult> {
  const text = input.text.slice(0, 5000);
  const language: TtsLanguage =
    input.language === "es" || input.language === "en"
      ? input.language
      : detectTtsUtteranceLang(text);
  const speed = Number.isFinite(input.speed)
    ? Math.min(Math.max(input.speed as number, 0.85), 1.08)
    : 0.93;
  const stability = normalizeStability(input.stability);
  const voice = input.voice?.trim() || "coral";
  const provider = input.provider ?? "openai-audio";

  if (provider === "elevenlabs") {
    return synthesizeElevenLabs({
      text,
      language,
      speed,
      stability,
      apiKey: input.elevenLabsApiKey,
    });
  }

  const openai = openaiClient(input.openaiApiKey);
  if (!openai) {
    throw new AdvancedAudioTtsError(
      "OPENAI_API_KEY is missing. Advanced audio (gpt-audio-1.5 / gpt-4o-audio-preview) cannot run. Browser TTS was not used.",
      [...OPENAI_ADVANCED_AUDIO_MODELS],
      voice,
    );
  }

  return synthesizeOpenAiAudio(openai, { text, voice, language });
}

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body && typeof (body as ReadableStream<Uint8Array>).getReader === "function") {
    return body as ReadableStream<Uint8Array>;
  }
  if (body instanceof Readable) {
    return Readable.toWeb(body) as ReadableStream<Uint8Array>;
  }
  throw new Error("OpenAI speech did not return a readable stream.");
}

function resolveVoice(voice?: string) {
  const value = voice?.trim() || "coral";
  return OPENAI_SPEECH_VOICES.has(value) ? value : "coral";
}

function resolveSpeechInput(input: {
  text: string;
  voice?: string;
  language?: TtsLanguage | "auto";
  speed?: number;
}) {
  const text = hostTtsInputText(input.text);
  const language: TtsLanguage =
    input.language === "es" || input.language === "en"
      ? input.language
      : detectTtsUtteranceLang(text);
  const speed = Number.isFinite(input.speed)
    ? Math.min(Math.max(input.speed as number, 0.85), 1.08)
    : 0.93;
  return { text, language, speed, voice: resolveVoice(input.voice) };
}

/**
 * Streams raw PCM as OpenAI generates it so the browser can play the first
 * samples without waiting for the full utterance.
 */
export async function streamElenaSpeech(input: {
  text: string;
  voice?: string;
  language?: TtsLanguage | "auto";
  speed?: number;
  openaiApiKey?: string;
}): Promise<TtsStreamResult> {
  const { text, language, speed, voice } = resolveSpeechInput(input);
  const openai = openaiClient(input.openaiApiKey);
  if (!openai) {
    throw new AdvancedAudioTtsError(
      "OPENAI_API_KEY is missing. Streaming TTS cannot run. Browser TTS was not used.",
      [OPENAI_STREAM_TTS_MODEL],
      voice,
    );
  }

  const params = {
    model: OPENAI_STREAM_TTS_MODEL,
    voice,
    input: text,
    instructions: hospitalityVoiceInstructions(language),
    response_format: "pcm" as const,
    speed,
  };
  let speech = await openai.audio.speech.create({ ...params, stream_format: "audio" });
  if (!speech.ok || !speech.body) {
    speech = await openai.audio.speech.create(params);
  }

  if (!speech.ok) {
    const detail = await speech.text().catch(() => "");
    throw new AdvancedAudioTtsError(
      `Streaming OpenAI TTS failed (${speech.status}). ${detail.slice(0, 240)} Browser TTS was not used.`,
      [OPENAI_STREAM_TTS_MODEL],
      voice,
    );
  }
  if (!speech.body) {
    throw new AdvancedAudioTtsError(
      "Streaming OpenAI TTS returned no body. Browser TTS was not used.",
      [OPENAI_STREAM_TTS_MODEL],
      voice,
    );
  }

  return {
    stream: toWebStream(speech.body),
    contentType: "audio/pcm",
    engine: "openai-tts-stream",
    model: OPENAI_STREAM_TTS_MODEL,
    voice,
    language,
    sampleRate: OPENAI_TTS_PCM_RATE,
  };
}

export type GuestElenaMp3Engine = "elevenlabs" | "openai";

/** Exact max chars sent to paid guest MP3 providers (must match synthesizeGuestElenaMp3). */
export const GUEST_ELENA_MP3_MAX_CHARS = 700;
export const HOST_TTS_MAX_CHARS = 4096;

export function guestElenaMp3InputText(text: string) {
  return text.slice(0, GUEST_ELENA_MP3_MAX_CHARS);
}

export function hostTtsInputText(text: string) {
  return text.slice(0, HOST_TTS_MAX_CHARS);
}

export function guestElenaMp3ProviderModel(engine: GuestElenaMp3Engine): {
  provider: "elevenlabs" | "openai";
  model: string;
} {
  if (engine === "elevenlabs") {
    return { provider: "elevenlabs", model: "eleven_multilingual_v2" };
  }
  return { provider: "openai", model: OPENAI_STREAM_TTS_MODEL };
}

function assertAudioSize(bytes: Buffer, maxBytes: number) {
  if (!bytes.length || bytes.length > maxBytes) {
    throw new Error("audio-size");
  }
}

function guestElenaOpenAiInstructions(language: TtsLanguage) {
  const languageLine =
    language === "es"
      ? "The script is Spanish. Speak entirely in fluent Latin American Spanish (Miami-host cadence, not Castilian broadcast). Do not switch to English."
      : "The script is English. Speak entirely in natural American English with South Florida hospitality. Do not switch to Spanish.";

  return [
    "You are Elena, a warm, clear, smooth adult female hospitality concierge speaking aloud.",
    "Automatically match the language of the text you are given: Spanish text → speak Spanish; English text → speak English. Never mix languages. Never translate the script.",
    languageLine,
    "Speak the supplied text naturally and verbatim.",
    "Use a calm, warm, clear hospitality voice at a consistent moderate volume.",
    "Sound calm and welcoming, with a slightly brighter, medium-pitched voice and crisp natural pronunciation.",
    "Avoid hoarse, raspy, gravelly, breathy, or unusually deep delivery.",
    "Do not shout or scream. Do not sing, whisper, laugh, or add sound effects, dramatic noises, or extra words.",
    "An English reply remains English. A Spanish reply remains Spanish.",
    "Do not use exaggerated acting. Speak only the supplied reply. Do not add, omit, or rephrase any words.",
  ].join(" ");
}

/**
 * One paid-provider attempt that returns browser-playable MP3.
 * Does not fail over to a second provider or a second model.
 */
export async function synthesizeGuestElenaMp3(input: {
  text: string;
  language: TtsLanguage;
  engine: GuestElenaMp3Engine;
  signal?: AbortSignal;
  maxBytes: number;
}): Promise<Uint8Array> {
  const text = guestElenaMp3InputText(input.text);
  if (input.engine === "elevenlabs") {
    const apiKey = elevenLabsKey();
    if (!apiKey) throw new Error("provider-unavailable");
    const voiceId = elevenLabsVoiceId();
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    const response = await fetch(url, {
      method: "POST",
      signal: input.signal,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        language_code: input.language,
        apply_text_normalization: "on",
        voice_settings: {
          stability: 0.42,
          similarity_boost: 0.82,
          style: 0.32,
          speed: 0.93,
          use_speaker_boost: true,
        },
      }),
    });
    if (!response.ok) throw new Error("provider-failed");
    const buffer = Buffer.from(await response.arrayBuffer());
    assertAudioSize(buffer, input.maxBytes);
    return buffer;
  }

  const openai = openaiClient();
  if (!openai) throw new Error("provider-unavailable");
  const speech = await openai.audio.speech.create(
    {
      model: OPENAI_STREAM_TTS_MODEL,
      voice: "coral",
      input: text,
      instructions: guestElenaOpenAiInstructions(input.language),
      response_format: "mp3",
      speed: 1,
    },
    { signal: input.signal },
  );
  if (!speech.ok) throw new Error("provider-failed");
  const buffer = Buffer.from(await speech.arrayBuffer());
  assertAudioSize(buffer, input.maxBytes);
  return buffer;
}
