export type VoiceProfileId = "elena" | "mateo" | "sarah";
export type LanguageMode = "auto" | "en" | "es";
export type ReplyLang = "en" | "es";

type SpeechResultList = ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>>;

export type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

export function getSpeechRecognitionCtor(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const extra = window as unknown as {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return extra.SpeechRecognition ?? extra.webkitSpeechRecognition ?? null;
}

export type BrowserListenSession = {
  stop: () => void;
  cancel: () => void;
};

export function startBrowserSpeechListen(options: {
  lang: string;
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
}): BrowserListenSession | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    options.onError?.("Live speech is not available in this browser. Use Chrome or Edge, or type a question.");
    return null;
  }

  let closed = false;
  const recognition = new Ctor();
  recognition.lang = options.lang;
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.onresult = (event) => {
    if (closed) return;
    let interim = "";
    let finalText = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const piece = result?.[0]?.transcript ?? "";
      if (result?.isFinal) finalText += piece;
      else interim += piece;
    }
    if (interim || finalText) options.onInterim?.(interim || finalText);
    const flushed = finalText.trim();
    if (flushed) options.onFinal(flushed);
  };
  recognition.onerror = (event) => {
    const code = event?.error;
    if (code === "no-speech" || code === "aborted") return;
    if (code === "not-allowed" || code === "service-not-allowed") {
      options.onError?.("Microphone blocked. Allow mic access, or type a question.");
      return;
    }
    if (code === "network") {
      options.onError?.("Speech service unavailable. Check your connection, or type a question.");
      return;
    }
    options.onError?.("Could not transcribe speech. Try again, or type a question.");
  };
  recognition.onend = () => {
    if (!closed) options.onEnd?.();
  };
  try {
    recognition.start();
  } catch (cause) {
    options.onError?.(cause instanceof Error ? cause.message : "Could not start listening.");
    return null;
  }

  const halt = (abort: boolean) => {
    closed = true;
    try {
      if (abort && recognition.abort) recognition.abort();
      else recognition.stop();
    } catch {
      /* ignore */
    }
  };

  return {
    stop: () => halt(false),
    cancel: () => halt(true),
  };
}

export function speechLangForHint(hint: "es" | "en" | "auto"): string {
  return hint === "en" ? "en-US" : "es-US";
}

/** Auto and Spanish session modes listen in es-US so Spanish transcribes cleanly. */
export function speechRecognitionLang(mode: LanguageMode): string {
  if (mode === "en") return "en-US";
  return "es-US";
}

const ES_WORD =
  /\b(el|la|los|las|un|una|unos|unas|y|o|de|del|al|qué|que|cuál|cual|dónde|donde|cómo|como|está|están|estan|hola|buenas|buenos|días|dias|tardes|noches|gracias|por|para|con|sin|mi|tu|su|me|te|se|soy|estoy|tengo|tiene|hay|necesito|quiero|puedo|ayuda|favor|baño|bano|clave|puerta|cerca|wifi|código|codigo|elena|sí|si|no|claro|dime|cuéntame|cuentame|restaurante|comida|playa|parking|estacionamiento)\b/gi;
const EN_WORD =
  /\b(the|and|or|a|an|is|are|was|i|i'm|im|you|we|what|where's|where|how|hello|hi|hey|please|thanks|thank|need|want|can|could|would|my|me|wifi|password|door|code|help|near|nearby)\b/gi;

/** Detect language of a guest or Elena utterance. Spanish markers always win. */
export function detectUtteranceLang(text: string): ReplyLang {
  const raw = text.trim();
  if (!raw) return "es";
  if (/[áéíóúüñ¿¡]/i.test(raw)) return "es";
  const lower = raw.toLowerCase();
  if (/^(hola|buenas|buenos días|buenos dias|buenas tardes|buenas noches|gracias|por favor)\b/i.test(lower)) {
    return "es";
  }
  const esHits = lower.match(ES_WORD)?.length ?? 0;
  const enHits = lower.match(EN_WORD)?.length ?? 0;
  if (esHits > enHits) return "es";
  if (enHits > esHits) return "en";
  if (esHits > 0) return "es";
  if (enHits > 0) return "en";
  return "es";
}

/** OpenAI TTS voices: Elena/Mateo = nova, Sarah = shimmer. Never alloy/onyx. */
export type OpenAiTtsVoice = "nova" | "shimmer";
export const FEMALE_OPENAI_VOICE = "nova" as const;
export const FEMALE_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

const MALE_BROWSER_VOICE = /raul|david|male|hombre|pablo/i;
const EXPLICIT_FEMALE_BROWSER_VOICE =
  /zira|samantha|victoria|karen|jenny|aria|sabina|helena|monica|paulina|laura|sofia|elena|maria|female|mujer/i;

export function studioVoiceForProfile(id: VoiceProfileId): OpenAiTtsVoice {
  return id === "sarah" ? "shimmer" : "nova";
}

export function isMaleBrowserVoiceName(name: string) {
  return MALE_BROWSER_VOICE.test(name);
}

export function isExplicitFemaleBrowserVoiceName(name: string) {
  return EXPLICIT_FEMALE_BROWSER_VOICE.test(name) && !MALE_BROWSER_VOICE.test(name);
}

export type VoiceProfile = {
  id: VoiceProfileId;
  name: string;
  title: string;
  hint: string;
  openaiVoice: OpenAiTtsVoice;
  elevenLabsVoiceId: string;
  gender: "female";
  rate: number;
  pitch: number;
  preview: { en: string; es: string };
};

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "elena",
    name: "Elena",
    title: "Warm & Bilingual (Miami Hostess)",
    hint: "Firm, clear projection with air",
    openaiVoice: FEMALE_OPENAI_VOICE,
    elevenLabsVoiceId: FEMALE_ELEVENLABS_VOICE_ID,
    gender: "female",
    rate: 1,
    pitch: 1,
    preview: {
      es: "Hola. Soy Elena, tu anfitriona en Miami. Estoy aquí para lo que necesites. El Wi-Fi, el estacionamiento, o simplemente sentirte en casa. Dime, ¿cómo te ayudo?",
      en: "Hi. I'm Elena, your Miami hostess. I'm right here if you need Wi-Fi, parking, or just a warm welcome. How can I help you?",
    },
  },
  {
    id: "mateo",
    name: "Mateo",
    title: "Luxury Concierge",
    hint: "Studio female voice (nova)",
    openaiVoice: FEMALE_OPENAI_VOICE,
    elevenLabsVoiceId: FEMALE_ELEVENLABS_VOICE_ID,
    gender: "female",
    rate: 1,
    pitch: 1,
    preview: {
      es: "Buenas noches. Soy Mateo, concierge de lujo. Será un placer atenderle con calma y discreción. ¿En qué puedo servirle?",
      en: "Good evening. This is Mateo, your luxury concierge. It would be my pleasure to assist you. Calmly, and with care. How may I help?",
    },
  },
  {
    id: "sarah",
    name: "Sarah",
    title: "Friendly American Host",
    hint: "Fluent, energetic native English",
    openaiVoice: "shimmer",
    elevenLabsVoiceId: FEMALE_ELEVENLABS_VOICE_ID,
    gender: "female",
    rate: 1,
    pitch: 1,
    preview: {
      es: "¡Hola! Soy Sarah. Hablo español también, así que no te preocupes. Dime qué necesitas y lo resolvemos ya.",
      en: "Hey! I'm Sarah, your friendly American host. Super happy to help — let's get you settled in. What do you need?",
    },
  },
];

export function getVoiceProfile(id: VoiceProfileId): VoiceProfile {
  return VOICE_PROFILES.find((profile) => profile.id === id) ?? VOICE_PROFILES[0]!;
}

export class AutoplayBlockedError extends Error {
  constructor() {
    super("autoplay-blocked");
    this.name = "AutoplayBlockedError";
  }
}

export function isAutoplayBlocked(cause: unknown) {
  if (cause instanceof AutoplayBlockedError) return true;
  const name = cause instanceof DOMException ? cause.name : cause instanceof Error ? cause.name : "";
  const message = cause instanceof Error ? cause.message : String(cause);
  return name === "NotAllowedError" || /not allowed|user didn't interact|autoplay/i.test(message);
}

const blobUrls = new WeakMap<HTMLAudioElement, string>();

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function assignAudioSrc(audio: HTMLAudioElement, url: string) {
  const previous = blobUrls.get(audio);
  if (previous && previous !== url && previous.startsWith("blob:")) {
    URL.revokeObjectURL(previous);
  }
  blobUrls.set(audio, url);
  audio.src = url;
}

export function keepAudioChannelAlive(audio: HTMLAudioElement) {
  try {
    audio.loop = true;
    audio.volume = 0;
    audio.playbackRate = 1;
    assignAudioSrc(audio, SILENT_WAV);
    void audio.play().catch((cause) => {
      console.error("[voice] keep-alive play failed", cause);
    });
  } catch (cause) {
    console.error("[voice] keep-alive failed", cause);
  }
}

export async function resumePersistentAudio(audio: HTMLAudioElement) {
  audio.loop = false;
  audio.volume = 1;
  audio.playbackRate = 1;
  await audio.play();
}

export function paceForSpeech(text: string) {
  let paced = text.trim();
  paced = paced.replace(/\u2026/g, ". ");
  paced = paced.replace(/\.{3,}/g, ". ");
  paced = paced.replace(/\s*[—–]\s*/g, ". ");
  paced = paced.replace(/\s*;\s*/g, ". ");
  paced = paced.replace(/^(¡?Hola)!?\s+/i, "Hola. ");
  paced = paced.replace(/^(¡?Buenas noches)!?\s+/i, "Buenas noches. ");
  paced = paced.replace(/^(Hey|Hi|Hello)!?\s+/i, "$1. ");
  paced = paced.replace(/\s+y la contraseña es/gi, ". Y la contraseña es");
  paced = paced.replace(/\s+and the password is/gi, ". And the password is");
  paced = paced.replace(/\s+y el check-out/gi, ". Y el check-out");
  paced = paced.replace(/\s+and check-out/gi, ". And check-out");
  paced = paced.replace(/\s{2,}/g, " ");
  paced = paced.replace(/\s+([.,!?])/g, "$1");
  paced = paced.replace(/\.{2,}/g, ".");
  if (!/[.!?]$/.test(paced)) paced += ".";
  return paced;
}

/**
 * Strips everything tts-1 would read literally or garble: markdown,
 * code fences, emojis/symbols, URLs. Keeps natural prose for the engine.
 */
export function sanitizeForTts(input: string): string {
  let t = input;
  t = t.replace(/```[\s\S]*?```/g, ". ");
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // [text](url) → text
  t = t.replace(/https?:\/\/\S+/g, " enlace ");
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2"); // **bold** / __bold__
  t = t.replace(/(\*|_)([^*_\n]+)\1/g, "$2"); // *italic* / _italic_
  t = t.replace(/~~(.*?)~~/g, "$1");
  t = t.replace(/`+/g, "");
  t = t.replace(/^#{1,6}\s*/gm, ""); // headings
  t = t.replace(/^[\s]*[-*+•]\s+/gm, ""); // list bullets
  t = t.replace(/^[\s]*>\s?/gm, ""); // blockquotes
  // Emojis, pictographs, arrows, dingbats, variation selectors, ZWJ.
  t = t.replace(
    /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu,
    " ",
  );
  t = t.replace(/\(\s*\)/g, "");
  t = t.replace(/\s{2,}/g, " ");
  return t.trim();
}

export function detectReplyLang(question: string, mode: LanguageMode): ReplyLang {
  if (mode === "en") return "en";
  if (mode === "es") return "es";
  return detectUtteranceLang(question);
}

export async function speakHumanVoice(options: {
  text: string;
  profile: VoiceProfile;
  language: LanguageMode;
  speed: number;
  stability: number;
  elevenKey?: string;
  openaiKey?: string;
  audioRef: { current: HTMLAudioElement | null };
  shouldCancel: () => boolean;
  onEngine?: (engine: "elevenlabs" | "openai") => void;
  onAutoplayBlocked?: () => void;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}): Promise<void> {
  const eleven = options.elevenKey?.trim() ?? "";
  const openai = options.openaiKey?.trim() ?? "";
  const providers: Array<{ provider: "elevenlabs" | "openai" | "auto"; apiKey: string }> = [];
  if (eleven) providers.push({ provider: "elevenlabs", apiKey: eleven });
  if (openai) providers.push({ provider: "openai", apiKey: openai });
  if (providers.length === 0) {
    providers.push({ provider: "auto", apiKey: "" });
  }

  for (const item of providers) {
    try {
      await speakStudioAudio({
        text: paceForSpeech(sanitizeForTts(options.text)),
        profile: options.profile,
        speed: options.speed,
        stability: options.stability,
        provider: item.provider,
        apiKey: item.apiKey,
        audioRef: options.audioRef,
        shouldCancel: options.shouldCancel,
        onPlaybackStart: options.onPlaybackStart,
        onPlaybackEnd: options.onPlaybackEnd,
      });
      options.onEngine?.(item.provider === "auto" ? "elevenlabs" : item.provider);
      return;
    } catch (cause) {
      if (cause instanceof AutoplayBlockedError) {
        console.error("[voice] Studio MP3 ready but autoplay blocked; waiting for tap", cause);
        options.onAutoplayBlocked?.();
        return;
      }
      console.error("[voice] /api/tts failed", item.provider, cause);
      if (options.shouldCancel()) return;
    }
  }

  throw new Error("Studio TTS unavailable");
}

export function stopHumanVoice(audioRef: { current: HTMLAudioElement | null }) {
  const audio = audioRef.current;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Last-resort Web Speech API. Never uses the Windows default (often male).
 * If the resolved voice is male or no explicit female voice exists, cancel and stay silent.
 */
export function speakWithBrowserTts(options: {
  text: string;
  lang?: ReplyLang;
  onStart?: () => void;
  onEnd?: () => void;
}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();

  const spokenLang = detectUtteranceLang(options.text);
  const lang: ReplyLang = spokenLang === "es" ? "es" : (options.lang ?? spokenLang);
  const utterance = new SpeechSynthesisUtterance(sanitizeForTts(options.text));
  utterance.lang = lang === "es" ? "es-US" : "en-US";

  const esPrefixes = ["es-us", "es-mx", "es-419", "es-es", "es"];
  const enPrefixes = ["en-us", "en-gb", "en"];
  const prefixes = lang === "es" ? esPrefixes : enPrefixes;
  const voices = synth.getVoices();
  const langCode = (item: SpeechSynthesisVoice) => item.lang.toLowerCase().replace("_", "-");
  const findByPrefix = (predicate: (item: SpeechSynthesisVoice) => boolean) => {
    for (const prefix of prefixes) {
      const hit = voices.find((item) => langCode(item).startsWith(prefix) && predicate(item));
      if (hit) return hit;
    }
    return undefined;
  };

  const female = findByPrefix((item) => isExplicitFemaleBrowserVoiceName(item.name));
  const anyMatch = findByPrefix(() => true);
  const chosen = female && !isMaleBrowserVoiceName(female.name) ? female : anyMatch;

  if (chosen) {
    utterance.voice = chosen;
    if (lang === "es") utterance.lang = chosen.lang.startsWith("es") ? chosen.lang : "es-US";
    else utterance.lang = chosen.lang.startsWith("en") ? chosen.lang : "en-US";
  } else if (lang === "es") {
    utterance.lang = "es-US";
  }

  utterance.pitch = 1.15;
  utterance.rate = 1;
  utterance.onstart = () => options.onStart?.();
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onEnd?.();
  synth.speak(utterance);
  return true;
}

export function isFatalTtsNetworkError(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /failed to fetch|network|tts-network|Studio TTS unavailable|Load failed/i.test(message);
}

let unlockedAudio: HTMLAudioElement | null = null;

/** The element unlocked by the first user tap, if any. */
export function getUnlockedAudio() {
  return unlockedAudio;
}

/**
 * Call SYNCHRONOUSLY from the first user tap so later MP3 playback is allowed.
 * Returns the unlocked element so callers can play generated audio through it.
 */
export function isMobileWebKit() {
  if (typeof navigator === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
  );
}

const RECORDER_TYPES = ["audio/mp4", "audio/aac", "audio/webm;codecs=opus", "audio/webm", "audio/mpeg"];

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return RECORDER_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function whisperFileMeta(mimeOrType: string): { name: string; type: string } {
  const t = mimeOrType.toLowerCase();
  if (t.includes("mp4")) return { name: "audio.mp4", type: "audio/mp4" };
  if (t.includes("m4a") || t.includes("aac") || t.includes("mp4a")) return { name: "audio.m4a", type: "audio/mp4" };
  if (t.includes("mpeg") || t.includes("mp3")) return { name: "audio.mp3", type: "audio/mpeg" };
  if (t.includes("wav")) return { name: "audio.wav", type: "audio/wav" };
  if (t.includes("ogg")) return { name: "audio.ogg", type: "audio/ogg" };
  return { name: "audio.webm", type: "audio/webm" };
}

export type PushToTalkSession = {
  stop: () => void;
  cancel: () => void;
};

const STOP_TIMEOUT_MS = 3000;

export function assertCanRecordAudio() {
  if (typeof window === "undefined") {
    throw new Error("MIC_UNAVAILABLE");
  }
  if (!window.isSecureContext) {
    throw new Error("MIC_INSECURE");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("MIC_INSECURE");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MIC_UNSUPPORTED");
  }
}

export function micErrorMessage(cause: unknown) {
  const code = cause instanceof Error ? cause.message : String(cause);
  if (code === "MIC_INSECURE" || /secure|https|getUserMedia/i.test(code)) {
    return "Open this page over HTTPS (Cloudflare tunnel) to use the microphone. Safari cannot record over HTTP.";
  }
  if (code === "MIC_UNSUPPORTED") {
    return "This browser cannot record audio.";
  }
  if (code === "MIC_UNAVAILABLE") {
    return "The microphone is not available right now.";
  }
  return "Could not start the microphone. Check permission in Settings → Safari.";
}

/** Builds the recorder after getUserMedia already ran in the user-gesture callback. */
export function startPushToTalkFromStream(
  stream: MediaStream,
  options: { onStop: (blob: Blob) => void },
): PushToTalkSession {
  const mime = pickRecorderMime();
  const audioChunks: BlobPart[] = [];
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
    : new MediaRecorder(stream);
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) audioChunks.push(event.data);
  };
  // Timeslice so Safari has chunks before stop(); a single start() often yields an empty onstop blob.
  try {
    recorder.start(250);
  } catch {
    recorder.start();
  }

  const stopTracks = () => {
    try {
      recorder.stream.getTracks().forEach((track) => track.stop());
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((track) => track.stop());
  };

  let delivered = false;
  const deliverFromOnStop = () => {
    if (delivered) return;
    delivered = true;
    const audioBlob = new Blob(audioChunks, {
      type: recorder.mimeType || mime || "audio/mp4",
    });
    stopTracks();
    options.onStop(audioBlob);
  };

  recorder.onerror = () => deliverFromOnStop();
  recorder.onstop = () => deliverFromOnStop();

  const stop = () => {
    if (recorder.state === "inactive") {
      deliverFromOnStop();
      return;
    }
    window.setTimeout(() => {
      if (!delivered) deliverFromOnStop();
    }, STOP_TIMEOUT_MS);
    try {
      recorder.requestData();
    } catch {
      /* Safari */
    }
    try {
      recorder.stop();
    } catch {
      deliverFromOnStop();
    }
  };

  const cancel = () => {
    delivered = true;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      /* ignore */
    }
    stopTracks();
  };

  return { stop, cancel };
}

/** One-shot MediaRecorder clip. Never uses webkitSpeechRecognition. */
export async function startPushToTalk(options: {
  onStop: (blob: Blob) => void;
}): Promise<PushToTalkSession> {
  assertCanRecordAudio();
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) throw new Error("MIC_INSECURE");
  const stream = await media.getUserMedia({ audio: true });
  return startPushToTalkFromStream(stream, options);
}

export async function transcribePushToTalkBlob(_blob: Blob, _language?: "es" | "en"): Promise<string> {
  console.warn("[elena] Whisper /api/transcribe is unused; use startBrowserSpeechListen.");
  return "";
}

export function unlockSpeechAudio(persistent?: HTMLAudioElement | null) {
  if (typeof window === "undefined") return null;
  try {
    const audio = persistent ?? unlockedAudio ?? (unlockedAudio = new Audio());
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    if (persistent) unlockedAudio = persistent;
    try {
      const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        void ctx.resume().catch(() => {});
      }
    } catch {
      /* ignore */
    }
    if (!audio.src) assignAudioSrc(audio, SILENT_WAV);
    audio.muted = false;
    audio.volume = 0;
    void audio.play().catch(() => {});
    audio.pause();
    audio.volume = 1;
    audio.currentTime = 0;
    return audio;
  } catch (cause) {
    console.error("[voice] HTMLAudio unlock failed", cause);
    return persistent ?? unlockedAudio;
  }
}

/**
 * Fetch OpenAI MP3 from /api/tts and play it with HTMLAudioElement — never speechSynthesis.
 *
 * iOS/Safari only allows playback on an element that was already unlocked inside a
 * real user gesture. Because this runs after `await`, a freshly constructed
 * `new Audio()` is always blocked there, so callers should pass the persistent
 * element they unlocked on first tap via `target`.
 */
export async function loadOpenAiTtsMpeg(
  text: string,
  voice: OpenAiTtsVoice,
  target?: HTMLAudioElement | null,
  lang?: ReplyLang,
): Promise<HTMLAudioElement> {
  const ttsRes = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: paceForSpeech(sanitizeForTts(text)),
      voice,
      ...(lang ? { language: lang } : {}),
    }),
  }).catch((cause) => {
    console.error("[voice] /api/tts network error", cause);
    throw new Error("tts-network");
  });

  if (!ttsRes.ok) {
    const detail = await ttsRes.text().catch(() => "");
    console.error("[voice] /api/tts rejected", ttsRes.status, detail.slice(0, 400));
    throw new Error(`tts-network-${ttsRes.status}`);
  }

  const buffer = await ttsRes.arrayBuffer();
  const blob = new Blob([buffer], { type: "audio/mpeg" });
  if (!blob.size) {
    throw new Error("tts-network-empty");
  }

  const url = URL.createObjectURL(blob);
  const audio = target ?? unlockedAudio ?? new Audio();
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.preload = "auto";
  audio.loop = false;
  audio.muted = false;
  audio.volume = 1;
  audio.playbackRate = 1;
  assignAudioSrc(audio, url);
  return audio;
}

export async function playOpenAiTtsMpeg(
  text: string,
  voice: OpenAiTtsVoice,
  target?: HTMLAudioElement | null,
  lang?: ReplyLang,
): Promise<HTMLAudioElement> {
  const audio = await loadOpenAiTtsMpeg(text, voice, target, lang);
  try {
    await audio.play();
  } catch (cause) {
    if (isAutoplayBlocked(cause)) {
      console.error("[voice] audio.play NotAllowedError", cause);
      throw new AutoplayBlockedError();
    }
    throw cause instanceof Error ? cause : new Error("Audio playback failed");
  }
  return audio;
}

async function speakStudioAudio(options: {
  text: string;
  profile: VoiceProfile;
  speed: number;
  stability: number;
  provider: "elevenlabs" | "openai" | "auto";
  apiKey: string;
  audioRef: { current: HTMLAudioElement | null };
  shouldCancel: () => boolean;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
}) {
  const voice = studioVoiceForProfile(options.profile.id);
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: options.provider,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      text: options.text,
      voiceProfile: options.profile.id,
      voice,
      speed: options.speed,
      stability: options.stability,
    }),
  }).catch((cause) => {
    console.error("[voice] /api/tts network error", cause);
    throw new Error("tts-network");
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[voice] /api/tts rejected", response.status, detail.slice(0, 400));
    throw new Error(`tts-network-${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: "audio/mpeg" });
  if (!blob.size) {
    throw new Error("tts-network-empty");
  }
  if (options.shouldCancel()) return;

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.setAttribute("playsinline", "true");
  audio.preload = "auto";
  audio.volume = 1;
  options.audioRef.current = audio;
  options.onPlaybackStart?.();

  try {
    await audio.play();
  } catch (cause) {
    URL.revokeObjectURL(url);
    options.onPlaybackEnd?.();
    if (isAutoplayBlocked(cause)) throw new AutoplayBlockedError();
    throw cause instanceof Error ? cause : new Error("Audio playback failed");
  }

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      options.onPlaybackEnd?.();
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      options.onPlaybackEnd?.();
      reject(new Error("Audio playback failed"));
    };
  });
}
