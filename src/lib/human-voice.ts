import { isPrivateNetworkHostname, publicApiUrl } from "@/lib/public-app-url";
import { FEMALE_ELEVENLABS_VOICE_ID } from "@/lib/elena-voice-ids";

export { FEMALE_ELEVENLABS_VOICE_ID };

export type VoiceProfileId = "elena" | "mateo" | "sarah" | "austin" | "sofia";
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
    const name = cause instanceof DOMException ? cause.name : "";
    if (name === "InvalidStateError") {
      options.onError?.("Already listening. Tap to stop, then try again.");
    } else {
      options.onError?.("Could not start listening. Try again, or type a question.");
    }
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
export function speechRecognitionLang(mode: LanguageMode, lastDetected?: ReplyLang): string {
  if (mode === "es") return "es-US";
  if (mode === "en") return "en-US";
  return lastDetected === "es" ? "es-US" : "en-US";
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

/** OpenAI TTS: Elena uses marin. Sarah uses shimmer. */
export type OpenAiTtsVoice = "nova" | "shimmer" | "coral" | "sage" | "marin";
export const FEMALE_OPENAI_VOICE = "marin" as const;
export const HOSPITALITY_TTS_SPEED = 1.0;

const MALE_BROWSER_VOICE = /raul|david|male|hombre|pablo/i;
const EXPLICIT_FEMALE_BROWSER_VOICE =
  /zira|samantha|victoria|karen|jenny|aria|sabina|helena|monica|paulina|laura|sofia|elena|maria|natural|neural|google|female|mujer/i;

export function studioVoiceForProfile(id: VoiceProfileId): OpenAiTtsVoice {
  return id === "sarah" || id === "austin" ? "shimmer" : "marin";
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
    hint: "Warm, conversational hospitality tone",
    openaiVoice: FEMALE_OPENAI_VOICE,
    elevenLabsVoiceId: FEMALE_ELEVENLABS_VOICE_ID,
    gender: "female",
    rate: 0.93,
    pitch: 1.04,
    preview: {
      es: "Hola. Soy Elena, tu anfitriona en Miami. Estoy aquí para lo que necesites. El Wi-Fi, el estacionamiento, o simplemente sentirte en casa. Dime, ¿cómo te ayudo?",
      en: "Hi, I'm Elena, your Miami hostess. I'm right here if you need Wi-Fi, parking, or just a warm welcome. How can I help you?",
    },
  },
  {
    id: "mateo",
    name: "Mateo",
    title: "Luxury Concierge",
    hint: "Calm luxury concierge (coral)",
    openaiVoice: FEMALE_OPENAI_VOICE,
    elevenLabsVoiceId: FEMALE_ELEVENLABS_VOICE_ID,
    gender: "female",
    rate: 0.94,
    pitch: 1.03,
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
    rate: 0.98,
    pitch: 1.05,
    preview: {
      es: "¡Hola! Soy Sarah. Hablo español también, así que no te preocupes. Dime qué necesitas y lo resolvemos ya.",
      en: "Hey! I'm Sarah, your friendly American host. Super happy to help — let's get you settled in. What do you need?",
    },
  },
  {
    id: "austin",
    name: "Austin",
    title: "Texas-friendly host",
    hint: "Clear American English, warm and direct",
    openaiVoice: "shimmer",
    elevenLabsVoiceId: FEMALE_ELEVENLABS_VOICE_ID,
    gender: "female",
    rate: 0.97,
    pitch: 1.04,
    preview: {
      es: "Hola. Soy Austin. Estoy aquí para lo que necesites en la casa: Wi-Fi, llegada o reglas locales. ¿Cómo te ayudo?",
      en: "Hi. I'm Austin, your local host. Wi-Fi, check-in, house rules — just tell me what you need.",
    },
  },
  {
    id: "sofia",
    name: "Sofia",
    title: "Bilingual Florida hostess",
    hint: "Warm coral voice, Spanish-first when needed",
    openaiVoice: FEMALE_OPENAI_VOICE,
    elevenLabsVoiceId: FEMALE_ELEVENLABS_VOICE_ID,
    gender: "female",
    rate: 0.93,
    pitch: 1.04,
    preview: {
      es: "Hola. Soy Sofía, tu anfitriona. Estoy aquí para el Wi-Fi, el parking o lo que haga falta. ¿En qué te ayudo?",
      en: "Hi. I'm Sofia, your host. I'm here for Wi-Fi, parking, or anything else you need. How can I help?",
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

function spokenListConnectors(text: string) {
  const spanish = /[áéíóúñ¿¡]|\b(?:buenos|buenas|días|tardes|noches|primero|después)\b/i.test(text);
  return spanish
    ? ["Primero,", "Después,", "Luego,", "También,", "Por último,"]
    : ["First,", "Next,", "Then,", "Also,", "Finally,"];
}

/** Shape prose for coral TTS: natural connectors, not a metronome of commas or numbered beats. */
export function paceForSpeech(text: string) {
  let paced = text.trim();
  paced = paced.replace(/\u2026/g, ". ");
  paced = paced.replace(/\.{3,}/g, ". ");
  paced = paced.replace(/\s*[—–]\s*/g, ". ");
  paced = paced.replace(/\s*;\s*/g, ". ");
  const connectors = spokenListConnectors(paced);
  let item = 0;
  paced = paced.replace(/(?:^|\s)\d{1,2}\.\s+/g, () => {
    const label = connectors[Math.min(item, connectors.length - 1)]!;
    item += 1;
    return item === 1 ? `${label} ` : ` ${label} `;
  });
  paced = paced.replace(/^(¡?Hola)!?\s+/i, "Hola, ");
  paced = paced.replace(/^(¡?Buenas noches)!?\s+/i, "Buenas noches, ");
  paced = paced.replace(/^(¡?Buenos días)!?\s+/i, "Buenos días, ");
  paced = paced.replace(/^(¡?Buenas tardes)!?\s+/i, "Buenas tardes, ");
  paced = paced.replace(/^(Good (?:morning|afternoon|evening)),?\s+/i, "$1, ");
  paced = paced.replace(/^(Hey|Hi|Hello)!?\s+/i, "$1, ");
  paced = paced.replace(/\s+y la contraseña es/gi, ", y la contraseña es");
  paced = paced.replace(/\s+and the password is/gi, ", and the password is");
  paced = paced.replace(/\s+y el check-out/gi, ", y el check-out");
  paced = paced.replace(/\s+and check-out/gi, ", and check-out");
  paced = paced.replace(/,{2,}/g, ",");
  paced = paced.replace(/\s{2,}/g, " ");
  paced = paced.replace(/\s+([.,!?])/g, "$1");
  paced = paced.replace(/\.{2,}/g, ".");
  if (!/[.!?]$/.test(paced)) paced += ".";
  return paced;
}

/**
 * Strips everything the TTS model would read literally or garble: markdown,
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
  stopPcmPlayback();
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

  utterance.pitch = 1.06;
  utterance.rate = 0.92;
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
let sharedAudioContext: AudioContext | null = null;
let speechAudioUnlocked = false;
let audioContextHoldSource: AudioBufferSourceNode | null = null;
let audioContextHoldGain: GainNode | null = null;
let pcmSession = 0;
const pcmSources: AudioBufferSourceNode[] = [];
let pcmLiveCount = 0;
let pcmStreamFinished = true;
let pcmEndedSettled = true;
let pcmPlaybackEnded: Promise<void> = Promise.resolve();
let resolvePcmPlaybackEnded: () => void = () => {};

function beginPcmEndedGate() {
  pcmStreamFinished = false;
  pcmEndedSettled = false;
  pcmPlaybackEnded = new Promise<void>((resolve) => {
    resolvePcmPlaybackEnded = resolve;
  });
}

function settlePcmEndedGate() {
  if (pcmEndedSettled) return;
  pcmEndedSettled = true;
  const resolve = resolvePcmPlaybackEnded;
  resolvePcmPlaybackEnded = () => {};
  resolve();
}

function finishPcmEndedGate() {
  pcmStreamFinished = true;
  settlePcmEndedGate();
}

function trySettlePcmPlayback(session: number, audio?: HTMLAudioElement) {
  if (session !== pcmSession) return;
  if (pcmEndedSettled) return;
  if (!pcmStreamFinished) return;
  if (pcmLiveCount > 0) return;
  if (audio) {
    audio.dataset.ttsEnded = "1";
    audio.dispatchEvent(new Event("ended"));
  }
  settlePcmEndedGate();
}

/** True while this page still has live PCM sources or an unfinished TTS stream. */
export function isSharedPcmPlaybackActive() {
  return pcmLiveCount > 0 || !pcmEndedSettled;
}

/** The element unlocked by the first user tap, if any. */
export function getUnlockedAudio() {
  return unlockedAudio;
}

export function isSpeechAudioUnlocked() {
  return speechAudioUnlocked;
}

function resumeSharedAudioContext() {
  if (typeof window === "undefined") return null;
  try {
    const Ctx =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    if (!sharedAudioContext) sharedAudioContext = new Ctx();
    if (sharedAudioContext.state === "suspended") {
      void sharedAudioContext.resume().catch(() => {});
    }
    return sharedAudioContext;
  } catch {
    return null;
  }
}

export function getSharedAudioContext() {
  return resumeSharedAudioContext();
}

function releaseAudioContextHold() {
  const source = audioContextHoldSource;
  const gain = audioContextHoldGain;
  audioContextHoldSource = null;
  audioContextHoldGain = null;
  if (source) {
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
  }
  if (gain) {
    try {
      gain.disconnect();
    } catch {
      /* ignore */
    }
  }
}

function stopPcmSourcesOnly() {
  const sources = pcmSources.splice(0, pcmSources.length);
  pcmLiveCount = 0;
  for (const source of sources) {
    try {
      source.onended = null;
    } catch {
      /* ignore */
    }
    try {
      source.stop();
    } catch {
      /* already stopped */
    }
    try {
      source.disconnect();
    } catch {
      /* ignore */
    }
  }
}

function stopPcmPlayback() {
  pcmSession += 1;
  stopPcmSourcesOnly();
  releaseAudioContextHold();
  finishPcmEndedGate();
}

/**
 * Must run inside a click/tap. Starts a looping zero-gain buffer so the
 * shared AudioContext stays running across the later /api/tts fetch.
 */
function holdSharedAudioContextFromGesture() {
  const ctx = resumeSharedAudioContext();
  if (!ctx) return;
  void ctx.resume().catch(() => {});
  try {
    const frames = Math.max(1, Math.floor((ctx.sampleRate || 24000) * 0.25));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate || 24000);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
    const previousSource = audioContextHoldSource;
    const previousGain = audioContextHoldGain;
    audioContextHoldSource = source;
    audioContextHoldGain = gain;
    if (previousSource && previousSource !== source) {
      try {
        previousSource.stop();
      } catch {
        /* already stopped */
      }
      try {
        previousSource.disconnect();
        previousGain?.disconnect();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Must run inside a click/tap so later PCM playback is allowed. */
function primeAudioContextFromGesture() {
  holdSharedAudioContextFromGesture();
}

function unlockSpeechSynthesis() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    const synth = window.speechSynthesis;
    const probe = new SpeechSynthesisUtterance(" ");
    probe.volume = 0;
    probe.rate = 1;
    synth.speak(probe);
    synth.cancel();
  } catch {
    /* ignore */
  }
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

type LegacyGetUserMedia = (
  constraints: MediaStreamConstraints,
  success: (stream: MediaStream) => void,
  error: (cause: Error) => void,
) => void;

function legacyGetUserMedia(): LegacyGetUserMedia | null {
  const nav = navigator as Navigator & {
    getUserMedia?: LegacyGetUserMedia;
    webkitGetUserMedia?: LegacyGetUserMedia;
    mozGetUserMedia?: LegacyGetUserMedia;
  };
  return nav.getUserMedia ?? nav.webkitGetUserMedia ?? nav.mozGetUserMedia ?? null;
}

/** Always attempts capture, including HTTP LAN IPs during local development. */
export async function acquireMicrophoneStream(): Promise<MediaStream> {
  const constraints: MediaStreamConstraints = {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  };
  const modern = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (modern) {
    return modern(constraints);
  }
  const legacy = legacyGetUserMedia();
  if (legacy) {
    return new Promise((resolve, reject) => {
      legacy.call(navigator, constraints, resolve, reject);
    });
  }
  throw new Error("MIC_UNAVAILABLE");
}

export function assertCanRecordAudio() {
  if (typeof window === "undefined") {
    throw new Error("MIC_UNAVAILABLE");
  }
}

export function isInsecureMicrophoneContext() {
  if (typeof window === "undefined") return false;
  if (isPrivateNetworkHostname(window.location.hostname)) return false;
  return !window.isSecureContext;
}

export function describeGetUserMediaFailure(cause: unknown): {
  kind: "insecure" | "permission" | "other";
  message: string;
} {
  const name = cause instanceof DOMException ? cause.name : "";
  const text = cause instanceof Error ? cause.message : String(cause);
  const onLan =
    typeof window !== "undefined" && isPrivateNetworkHostname(window.location.hostname);

  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    /notallowed|permission|denied|dismissed/i.test(text)
  ) {
    return {
      kind: "permission",
      message:
        "Microphone permission was denied. Allow the microphone for this site, then tap to talk again — or type a question.",
    };
  }
  if (name === "NotFoundError" || /notfound|no device/i.test(text)) {
    return {
      kind: "other",
      message: "No microphone was found on this device. Type a question instead.",
    };
  }
  if (name === "SecurityError" || text === "MIC_INSECURE") {
    return {
      kind: "insecure",
      message: onLan
        ? "This browser blocked the microphone on a local HTTP address. Allow the mic if prompted, or type a question."
        : "This browser blocked the microphone (often because the page is not HTTPS). Type a question, or open the portal over HTTPS.",
    };
  }
  if (typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia && !legacyGetUserMedia()) {
    return {
      kind: onLan ? "other" : "insecure",
      message: onLan
        ? "Could not start the microphone on this local address. Type a question, or try again after allowing the mic."
        : "This browser blocked microphone access. Type a question, or open the portal over HTTPS.",
    };
  }
  return { kind: "other", message: micErrorMessage(cause) };
}

export function micErrorMessage(cause: unknown) {
  const code = cause instanceof Error ? cause.message : String(cause);
  if (code === "MIC_INSECURE" || /secure|https/i.test(code)) {
    return "Could not start the microphone. Try again, allow the mic if asked, or type a question.";
  }
  if (code === "MIC_UNSUPPORTED") {
    return "This browser cannot record audio. Type a question instead.";
  }
  if (code === "MIC_UNAVAILABLE") {
    return "The microphone is not available right now. Type a question instead.";
  }
  return "Could not start the microphone. Check permission in your browser settings, or type a question.";
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buffer, 44).set(new Uint8Array(pcm.buffer));
  return new Blob([buffer], { type: "audio/wav" });
}

/** Direct PCM recorder when MediaRecorder is missing (common on HTTP LAN). */
export function startFallbackWavRecorder(
  stream: MediaStream,
  options: { onStop: (blob: Blob) => void },
): PushToTalkSession {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("MIC_UNSUPPORTED");
  }
  const ctx = new AudioCtx();
  void ctx.resume();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  let delivered = false;
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop());
  const tearDown = () => {
    try {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
    } catch {
      /* ignore */
    }
    void ctx.close();
  };

  const finish = (send: boolean) => {
    if (delivered) return;
    delivered = true;
    stopTracks();
    if (!send) {
      tearDown();
      return;
    }
    const length = chunks.reduce((sum, part) => sum + part.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    for (const part of chunks) {
      merged.set(part, offset);
      offset += part.length;
    }
    const rate = ctx.sampleRate || 44100;
    tearDown();
    options.onStop(encodeWav(merged, rate));
  };

  return {
    stop: () => finish(true),
    cancel: () => finish(false),
  };
}

/** Builds the recorder after getUserMedia already ran in the user-gesture callback. */
export function startPushToTalkFromStream(
  stream: MediaStream,
  options: { onStop: (blob: Blob) => void },
): PushToTalkSession {
  if (typeof MediaRecorder === "undefined") {
    return startFallbackWavRecorder(stream, options);
  }
  try {
    return startMediaRecorderFromStream(stream, options);
  } catch (cause) {
    console.warn("[voice] MediaRecorder failed, using WAV fallback", cause);
    return startFallbackWavRecorder(stream, options);
  }
}

function startMediaRecorderFromStream(
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
  const stream = await acquireMicrophoneStream();
  return startPushToTalkFromStream(stream, options);
}

export async function transcribePushToTalkBlob(blob: Blob, language?: "es" | "en"): Promise<string> {
  if (blob.size < 200) return "";
  const meta = whisperFileMeta(blob.type);
  const file = new File([blob], meta.name, { type: meta.type || blob.type || "audio/webm" });
  const form = new FormData();
  form.append("file", file);
  if (language) form.append("language", language);
  const response = await fetch(publicApiUrl("/api/transcribe"), { method: "POST", body: form });
  const payload = (await response.json().catch(() => ({}))) as { text?: string; error?: string; code?: string };
  if (!response.ok) {
    if (payload.code === "NO_API_KEY" || payload.code === "INVALID_OPENAI_KEY") {
      throw new Error("Voice transcription is not configured. Type a question instead.");
    }
    throw new Error("Could not transcribe speech. Try again, or type a question.");
  }
  return payload.text?.trim() ?? "";
}

export function unlockSpeechAudio(persistent?: HTMLAudioElement | null) {
  if (typeof window === "undefined") return null;
  try {
    const audio = persistent ?? unlockedAudio ?? (unlockedAudio = new Audio());
    audio.preload = "auto";
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    if (persistent) unlockedAudio = persistent;
    primeAudioContextFromGesture();
    unlockSpeechSynthesis();
    speechAudioUnlocked = true;
    return audio;
  } catch (cause) {
    console.error("[voice] HTMLAudio unlock failed", cause);
    speechAudioUnlocked = true;
    return persistent ?? unlockedAudio;
  }
}

/**
 * Stream 24 kHz s16le PCM from /api/tts into AudioContext.
 * Chunks are ArrayBuffer → Int16Array → Float32Array → AudioBufferSourceNode.
 * Never uses createObjectURL, decodeAudioData, or MP3.
 */
export async function loadOpenAiTtsMpeg(
  text: string,
  voice: OpenAiTtsVoice,
  target?: HTMLAudioElement | null,
  lang?: ReplyLang,
): Promise<HTMLAudioElement> {
  const audio = unlockSpeechAudio(target) ?? target ?? unlockedAudio ?? new Audio();
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.loop = false;
  audio.muted = false;
  audio.volume = 1;
  audio.dataset.ttsEnded = "";

  stopPcmPlayback();
  const session = pcmSession;

  let ttsRes: Response;
  try {
    ttsRes = await fetch(publicApiUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "audio/pcm" },
      body: JSON.stringify({
        text: paceForSpeech(sanitizeForTts(text)),
        voice,
        speed: HOSPITALITY_TTS_SPEED,
        ...(lang ? { language: lang } : {}),
        provider: "openai-audio",
        stream: true,
      }),
    });
  } catch (cause) {
    if (session === pcmSession) releaseAudioContextHold();
    console.error("[voice] /api/tts network error", cause);
    throw new Error("Could not reach /api/tts. Browser TTS was not used.");
  }

  if (session !== pcmSession) {
    try {
      await ttsRes.body?.cancel();
    } catch {
      /* ignore */
    }
    return audio;
  }

  const engine = ttsRes.headers.get("X-Tts-Engine") ?? "";
  const model = ttsRes.headers.get("X-Tts-Model") ?? "";
  const ttsVoice = ttsRes.headers.get("X-Tts-Voice") ?? voice;
  const sampleRate = Number.parseInt(ttsRes.headers.get("X-Tts-Sample-Rate") ?? "24000", 10) || 24000;
  audio.dataset.ttsEngine = engine;
  audio.dataset.ttsModel = model;
  audio.dataset.ttsVoice = ttsVoice;

  if (!ttsRes.ok) {
    if (session === pcmSession) releaseAudioContextHold();
    const detail = await ttsRes.text().catch(() => "");
    let parsed: { error?: string; attempted?: string[]; code?: string } = {};
    try {
      parsed = JSON.parse(detail) as { error?: string; attempted?: string[]; code?: string };
    } catch {
      parsed = {};
    }
    const message =
      parsed.error ||
      `Streaming TTS failed (${ttsRes.status}). Browser TTS was not used.`;
    console.error("[voice] /api/tts rejected", ttsRes.status, parsed.code, parsed.attempted, detail.slice(0, 400));
    throw new Error(message);
  }

  const contentType = ttsRes.headers.get("content-type")?.split(";")[0]?.trim() || "";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) {
    if (session === pcmSession) releaseAudioContextHold();
    throw new Error("TTS returned MP3; this client only plays streamed PCM on AudioContext.");
  }
  if (!ttsRes.body) {
    if (session === pcmSession) releaseAudioContextHold();
    throw new Error("Streaming TTS returned no body. Browser TTS was not used.");
  }

  console.info("[voice] /api/tts engine", { engine, model, voice: ttsVoice, stream: "pcm", sampleRate });
  try {
    await playPcmChunkStream(audio, ttsRes.body, sampleRate, session);
  } catch (cause) {
    if (session === pcmSession) {
      stopPcmSourcesOnly();
      releaseAudioContextHold();
    }
    throw cause;
  }
  return audio;
}

/** Copy stream bytes into a standalone ArrayBuffer (aligned, no shared views). */
function uint8ToArrayBuffer(bytes: Uint8Array) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function concatArrayBuffers(a: ArrayBuffer, b: ArrayBuffer) {
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(new Uint8Array(a), 0);
  out.set(new Uint8Array(b), a.byteLength);
  return out.buffer;
}

/**
 * 16-bit little-endian PCM → Float32 in [-1, 1].
 * Uses DataView so byte order is correct even if a chunk starts on an odd offset.
 */
function pcm16LeArrayBufferToFloat32(buffer: ArrayBuffer) {
  const even = buffer.byteLength - (buffer.byteLength % 2);
  const view = new DataView(buffer, 0, even);
  const int16 = new Int16Array(even / 2);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    const sample = view.getInt16(i * 2, true);
    int16[i] = sample;
    float32[i] = sample / 32768;
  }
  return { int16, float32, leftoverBytes: buffer.byteLength - even };
}

function leftoverTail(buffer: ArrayBuffer, leftoverBytes: number) {
  if (leftoverBytes <= 0) return new ArrayBuffer(0);
  return buffer.slice(buffer.byteLength - leftoverBytes);
}

/** ~300 ms of 24 kHz s16le mono ≈ 14,400 bytes / 7,200 samples. */
const PCM_PREBUFFER_SEC = 0.3;
/** Target playback block after coalescing tiny network chunks. */
const PCM_BLOCK_SEC = 0.12;

function concatFloat32(a: Float32Array, b: Float32Array): Float32Array {
  if (!a.length) return b.length ? b : a;
  if (!b.length) return a;
  const out = new Float32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out as Float32Array;
}

function takeFloat32Prefix(source: Float32Array, count: number) {
  const n = Math.max(0, Math.min(count, source.length));
  const prefix = source.slice(0, n) as Float32Array;
  const rest = source.slice(n) as Float32Array;
  return { prefix, rest };
}

function schedulePcmBuffer(
  ctx: AudioContext,
  float32: Float32Array,
  sampleRate: number,
  nextTime: number,
  session: number,
  audio: HTMLAudioElement,
) {
  if (float32.length === 0) {
    return { source: null as AudioBufferSourceNode | null, nextTime };
  }
  const audioBuffer = ctx.createBuffer(1, float32.length, sampleRate);
  audioBuffer.getChannelData(0).set(float32);
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  // Monotonic queue: never start before the previous buffer's scheduled end.
  // If we underrun (nextTime already passed), start now — that is a gap, not overlap.
  const startAt = nextTime > ctx.currentTime ? nextTime : ctx.currentTime;
  pcmSources.push(source);
  pcmLiveCount += 1;
  source.onended = () => {
    if (session !== pcmSession) return;
    const index = pcmSources.indexOf(source);
    if (index >= 0) pcmSources.splice(index, 1);
    pcmLiveCount = Math.max(0, pcmLiveCount - 1);
    trySettlePcmPlayback(session, audio);
  };
  source.start(startAt);
  return { source, nextTime: startAt + audioBuffer.duration };
}

/**
 * Reads /api/tts as a byte stream. Odd-byte leftovers stay in `pending`.
 * Decoded samples are coalesced (~120 ms) and audible playback waits for
 * ~300 ms of audio (or end of stream if the utterance is shorter).
 */
async function playPcmChunkStream(
  audio: HTMLAudioElement,
  body: ReadableStream<Uint8Array>,
  sampleRate: number,
  session: number,
) {
  const ctx = sharedAudioContext ?? resumeSharedAudioContext();
  if (!ctx) {
    throw new Error("Web Audio is not available for streaming playback.");
  }
  if (ctx.state !== "running") {
    throw new AutoplayBlockedError();
  }

  beginPcmEndedGate();
  const reader = body.getReader();
  let pending = new ArrayBuffer(0);
  let decoded: Float32Array = new Float32Array(0);
  let nextTime = ctx.currentTime;
  let scheduledAny = false;
  const blockSamples = Math.max(1, Math.round(sampleRate * PCM_BLOCK_SEC));
  const prebufferSamples = Math.max(blockSamples, Math.round(sampleRate * PCM_PREBUFFER_SEC));

  await new Promise<void>((resolve, reject) => {
    let started = false;

    const ingestBytes = (chunkBuffer: ArrayBuffer) => {
      pending = pending.byteLength ? concatArrayBuffers(pending, chunkBuffer) : chunkBuffer;
      const { float32, leftoverBytes } = pcm16LeArrayBufferToFloat32(pending);
      pending = leftoverTail(pending, leftoverBytes);
      if (float32.length) {
        const samples = new Float32Array(float32.length);
        samples.set(float32);
        decoded = concatFloat32(decoded, samples);
      }
    };

    const markAudible = () => {
      if (started) return;
      started = true;
      releaseAudioContextHold();
      audio.dispatchEvent(new Event("playing"));
      resolve();
    };

    const scheduleReadyBlocks = (flushRemainder: boolean) => {
      if (session !== pcmSession) return;
      if (!started) {
        nextTime = ctx.currentTime;
      }
      while (decoded.length >= blockSamples) {
        const taken = takeFloat32Prefix(decoded, blockSamples);
        decoded = taken.rest;
        const scheduled = schedulePcmBuffer(ctx, taken.prefix, sampleRate, nextTime, session, audio);
        nextTime = scheduled.nextTime;
        if (scheduled.source) {
          scheduledAny = true;
          markAudible();
        }
      }
      if (flushRemainder && decoded.length > 0) {
        const taken = takeFloat32Prefix(decoded, decoded.length);
        decoded = taken.rest;
        const scheduled = schedulePcmBuffer(ctx, taken.prefix, sampleRate, nextTime, session, audio);
        nextTime = scheduled.nextTime;
        if (scheduled.source) {
          scheduledAny = true;
          markAudible();
        }
      }
    };

    void (async () => {
      try {
        while (true) {
          if (session !== pcmSession) {
            resolve();
            return;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.byteLength) continue;

          ingestBytes(uint8ToArrayBuffer(value));
          if (!started) {
            if (decoded.length >= prebufferSamples) scheduleReadyBlocks(false);
          } else {
            scheduleReadyBlocks(false);
          }
        }

        if (session !== pcmSession) {
          resolve();
          return;
        }

        scheduleReadyBlocks(true);

        if (!started || !scheduledAny) {
          throw new Error("Streaming TTS returned empty PCM. Browser TTS was not used.");
        }

        pcmStreamFinished = true;
        trySettlePcmPlayback(session, audio);
      } catch (cause) {
        if (session === pcmSession) {
          pcmStreamFinished = true;
          if (pcmLiveCount === 0) settlePcmEndedGate();
        }
        if (!started) reject(cause instanceof Error ? cause : new Error("Streaming playback failed"));
        else audio.dispatchEvent(new Event("error"));
      } finally {
        if (!started && session === pcmSession) releaseAudioContextHold();
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    })();
  });
}

export async function playOpenAiTtsMpeg(
  text: string,
  voice: OpenAiTtsVoice,
  target?: HTMLAudioElement | null,
  lang?: ReplyLang,
  waitUntilEnded = false,
): Promise<HTMLAudioElement> {
  try {
    const audio = await loadOpenAiTtsMpeg(text, voice, target, lang);
    if (waitUntilEnded) await pcmPlaybackEnded;
    return audio;
  } catch (cause) {
    finishPcmEndedGate();
    if (isAutoplayBlocked(cause)) {
      console.error("[voice] audio.play NotAllowedError", cause);
      throw new AutoplayBlockedError();
    }
    throw cause instanceof Error ? cause : new Error("Audio playback failed");
  }
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
  options.onPlaybackStart?.();
  const audio = await playOpenAiTtsMpeg(
    options.text,
    voice,
    options.audioRef.current,
    detectUtteranceLang(options.text),
  );
  audio.dataset.ttsEnded = "";
  options.audioRef.current = audio;
  if (options.shouldCancel()) return;
  if (audio.dataset.ttsEnded === "1") {
    options.onPlaybackEnd?.();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      options.onPlaybackEnd?.();
      resolve();
    };
    audio.onerror = () => {
      options.onPlaybackEnd?.();
      reject(new Error("Audio playback failed"));
    };
  });
}
