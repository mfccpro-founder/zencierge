export type VoiceProfileId = "elena" | "mateo" | "sarah";
export type LanguageMode = "auto" | "en" | "es";
export type ReplyLang = "en" | "es";

export type VoiceProfile = {
  id: VoiceProfileId;
  name: string;
  title: string;
  hint: string;
  openaiVoice: "nova" | "alloy" | "onyx" | "shimmer";
  elevenLabsVoiceId: string;
  gender: "female" | "male";
  rate: number;
  pitch: number;
  preview: { en: string; es: string };
};

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "elena",
    name: "Elena",
    title: "Cálida & Bilingüe (Miami Hostess)",
    hint: "Proyección firme, clara y con aire",
    openaiVoice: "nova",
    elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
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
    title: "Concierge de Lujo",
    hint: "Voz profunda, educada y tranquila",
    openaiVoice: "alloy",
    elevenLabsVoiceId: "pNInz6obpgDQGcFmaJgB",
    gender: "male",
    rate: 0.92,
    pitch: 0.94,
    preview: {
      es: "Buenas noches. Soy Mateo, concierge de lujo. Será un placer atenderle con calma y discreción. ¿En qué puedo servirle?",
      en: "Good evening. This is Mateo, your luxury concierge. It would be my pleasure to assist you. Calmly, and with care. How may I help?",
    },
  },
  {
    id: "sarah",
    name: "Sarah",
    title: "Friendly American Host",
    hint: "Inglés nativo fluido y enérgico",
    openaiVoice: "nova",
    elevenLabsVoiceId: "EXAVITQu4vr4xnSDxMaL",
    gender: "female",
    rate: 0.96,
    pitch: 1.06,
    preview: {
      es: "¡Hola! Soy Sarah. Hablo español también, así que no te preocupes. Dime qué necesitas y lo resolvemos ya.",
      en: "Hey! I'm Sarah, your friendly American host. Super happy to help — let's get you settled in. What do you need?",
    },
  },
];

const FEMALE_HINTS =
  /female|woman|jenny|aria|emma|sara|sarah|zira|nova|ana|elena|paloma|libby|sonia|sabina|helena|paulina|dalia|natural.*female|google us english/i;
const MALE_HINTS =
  /male|man|guy|davis|christopher|steffan|andrew|brian|adam|mateo|jorge|onyx|david|google uk english male/i;

const PREMIUM_HINT =
  /natural|neural|google|premium|enhanced|wavenet|studio|online \(natural\)|online \(neural\)|microsoft.*natural|microsoft.*neural|google us english|google uk english|google español|google espanol/i;
const ROBOT_HINT =
  /compact|espeak|microsoft david -|microsoft zira desktop|microsoft mark desktop|desktop - english|speechify compact|android|samsung|pico|flite/i;

const SPANISH_VOICE_NAMES =
  /google español|microsoft sabina|microsoft helena|microsoft paulina|microsoft dalia|microsoft jorge|\bmonica\b|\bmónica\b|\bpaulina\b|\bpenelope\b|\bpenélope\b|\bsofia\b|\bsofía\b|\bsabina\b|\bhelena\b|\bdalia\b/i;

export function getVoiceProfile(id: VoiceProfileId): VoiceProfile {
  return VOICE_PROFILES.find((profile) => profile.id === id) ?? VOICE_PROFILES[0]!;
}

export class AutoplayBlockedError extends Error {
  constructor() {
    super("autoplay-blocked");
    this.name = "AutoplayBlockedError";
  }
}

function isAutoplayError(cause: unknown) {
  const name = cause instanceof DOMException ? cause.name : cause instanceof Error ? cause.name : "";
  const message = cause instanceof Error ? cause.message : String(cause);
  return name === "NotAllowedError" || /not allowed|user didn't interact|autoplay/i.test(message);
}

const blobUrls = new WeakMap<HTMLAudioElement, string>();
let lockedBrowserVoice: SpeechSynthesisVoice | null = null;

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

function rememberBrowserVoice(voice: SpeechSynthesisVoice | null) {
  if (voice) lockedBrowserVoice = voice;
  return voice ?? lockedBrowserVoice;
}

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

export function isPremiumVoice(voice: SpeechSynthesisVoice) {
  const label = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  if (ROBOT_HINT.test(label)) return false;
  return PREMIUM_HINT.test(label) || !voice.localService;
}

function voiceNaturalnessScore(voice: SpeechSynthesisVoice, gender: "female" | "male") {
  const label = `${voice.name} ${voice.voiceURI} ${voice.lang}`;
  let score = 0;
  if (ROBOT_HINT.test(label)) score -= 80;
  if (/natural/i.test(label)) score += 28;
  if (/neural/i.test(label)) score += 26;
  if (/google/i.test(label)) score += 22;
  if (/wavenet|studio|online/i.test(label)) score += 16;
  if (/premium|enhanced/i.test(label)) score += 10;
  if (!voice.localService) score += 12;
  if (voice.default) score += 1;
  const genderHint = gender === "female" ? FEMALE_HINTS : MALE_HINTS;
  if (genderHint.test(label)) score += 6;
  return score;
}

function normalizeLangTag(lang: string) {
  return lang.replaceAll("_", "-").toLowerCase();
}

function isNativeSpanishVoice(voice: SpeechSynthesisVoice) {
  const lang = normalizeLangTag(voice.lang);
  if (lang.startsWith("es")) return true;
  const label = `${voice.name} ${voice.voiceURI}`;
  return SPANISH_VOICE_NAMES.test(label) || /español|spanish/i.test(label);
}

function preferredSpanishLang(lang: string) {
  const tag = normalizeLangTag(lang);
  return tag.startsWith("es-es") || tag.startsWith("es-us") || tag.startsWith("es-mx") || tag.startsWith("es-419");
}

export function pickSpanishVoice(
  voices: SpeechSynthesisVoice[],
  gender: "female" | "male" = "female",
): SpeechSynthesisVoice | null {
  const spanish = voices.filter(isNativeSpanishVoice);
  if (spanish.length === 0) return null;

  const ranked = [...spanish].sort((a, b) => {
    const langBonus = (voice: SpeechSynthesisVoice) =>
      preferredSpanishLang(voice.lang) ? 8 : 0;
    const namedBonus = (voice: SpeechSynthesisVoice) =>
      SPANISH_VOICE_NAMES.test(voice.name) ? 6 : 0;
    return (
      voiceNaturalnessScore(b, gender) +
      langBonus(b) +
      namedBonus(b) -
      (voiceNaturalnessScore(a, gender) + langBonus(a) + namedBonus(a))
    );
  });

  return rememberBrowserVoice(ranked[0] ?? lockedBrowserVoice);
}

export function pickNeuralVoice(
  voices: SpeechSynthesisVoice[],
  profile: VoiceProfile,
  lang: ReplyLang,
): SpeechSynthesisVoice | null {
  if (lang === "es") return pickSpanishVoice(voices, profile.gender);

  const english = voices.filter((voice) => normalizeLangTag(voice.lang).startsWith("en"));
  const pool = english.length > 0 ? english : voices;
  const ranked = [...pool].sort((a, b) => {
    let extraA = 0;
    let extraB = 0;
    const labelA = `${a.name} ${a.lang}`;
    const labelB = `${b.name} ${b.lang}`;
    if (isNativeSpanishVoice(a)) extraA -= 20;
    if (isNativeSpanishVoice(b)) extraB -= 20;
    if (profile.id === "sarah" && /en-US|google us english/i.test(labelA)) extraA += 4;
    if (profile.id === "sarah" && /en-US|google us english/i.test(labelB)) extraB += 4;
    return voiceNaturalnessScore(b, profile.gender) + extraB - (voiceNaturalnessScore(a, profile.gender) + extraA);
  });

  return rememberBrowserVoice(ranked[0] ?? lockedBrowserVoice);
}

let cachedVoices: SpeechSynthesisVoice[] = [];
let voicesListenerBound = false;
let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;

function captureVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  const list = window.speechSynthesis.getVoices();
  if (list.length > 0) cachedVoices = list;
  return list;
}

export function primeVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  captureVoices();
  if (voicesListenerBound) return;
  voicesListenerBound = true;
  const apply = () => {
    captureVoices();
  };
  window.speechSynthesis.addEventListener("voiceschanged", apply);
  window.speechSynthesis.onvoiceschanged = apply;
}

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve([]);
  }
  primeVoices();
  const immediate = captureVoices();
  if (immediate.length > 0) return Promise.resolve(immediate);
  if (voicesReady) return voicesReady;

  voicesReady = new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const list = captureVoices();
      if (list.length === 0) voicesReady = null;
      resolve(list);
    };
    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    window.setTimeout(finish, 800);
  });
  return voicesReady;
}

export const SPEECH_RATE_EN = 0.94;
export const SPEECH_RATE_ES = 0.9;

/** Insert breath pauses the synthesizer will honor. */
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

export function detectReplyLang(question: string, mode: LanguageMode): ReplyLang {
  if (mode === "en") return "en";
  if (mode === "es") return "es";
  if (
    /[áéíóúüñ¿¡]/i.test(question) ||
    /\b(cuál|cual|dónde|donde|cómo|como|está|estan|están|hola|gracias|clave|huésped|huesped|baño|puerta|estaciono|estacionamiento|ayuda|puedo|necesito|cerca|súper|mercado|anfitrión)\b/i.test(
      question,
    )
  ) {
    return "es";
  }
  return "en";
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
  onEngine?: (engine: "elevenlabs" | "openai" | "browser-neural") => void;
  onAutoplayBlocked?: () => void;
  fallbackToBrowser?: boolean;
}): Promise<void> {
  const lang = detectReplyLang(options.text, options.language);
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
        text: options.text,
        profile: options.profile,
        speed: options.speed,
        stability: options.stability,
        provider: item.provider,
        apiKey: item.apiKey,
        audioRef: options.audioRef,
        shouldCancel: options.shouldCancel,
      });
      options.onEngine?.(item.provider === "auto" ? "elevenlabs" : item.provider);
      return;
    } catch (cause) {
      if (cause instanceof AutoplayBlockedError) {
        console.error("[voice] Studio audio ready but autoplay blocked; waiting for tap", cause);
        options.onAutoplayBlocked?.();
        return;
      }
      console.error("[voice] Studio TTS failed, will try next engine", item.provider, cause);
      if (options.shouldCancel()) return;
    }
  }

  if (options.fallbackToBrowser === false) {
    return;
  }

  options.onEngine?.("browser-neural");
  try {
    await speakBrowserNeural({
      text: options.text,
      profile: options.profile,
      lang,
      speed: options.speed,
      shouldCancel: options.shouldCancel,
    });
  } catch (cause) {
    console.error("[voice] Browser speechSynthesis fallback failed", cause);
  }
}

export function stopHumanVoice(audioRef: { current: HTMLAudioElement | null }) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  const audio = audioRef.current;
  if (audio) {
    audio.pause();
    keepAudioChannelAlive(audio);
  }
}

let speechUnlocked = false;
let unlockedAudio: HTMLAudioElement | null = null;

/** Call from the first user tap so later TTS/MP3 and speechSynthesis are allowed. */
export function unlockSpeechAudio(persistent?: HTMLAudioElement | null) {
  if (typeof window === "undefined") return;
  primeVoices();
  const audio = persistent ?? unlockedAudio ?? (unlockedAudio = new Audio());
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  if (persistent) {
    unlockedAudio = persistent;
  }

  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextCtor) {
      const ctx = new AudioContextCtor();
      void ctx.resume().catch((cause) => {
        console.error("[voice] AudioContext resume failed", cause);
      });
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.04);
    }
  } catch (cause) {
    console.error("[voice] AudioContext unlock failed", cause);
  }

  keepAudioChannelAlive(audio);

  if ("speechSynthesis" in window) {
    try {
      window.speechSynthesis.resume();
      if (!speechUnlocked) {
        const warm = new SpeechSynthesisUtterance(" ");
        if (lockedBrowserVoice) warm.voice = lockedBrowserVoice;
        warm.volume = 0;
        warm.rate = 1;
        warm.pitch = 1;
        window.speechSynthesis.speak(warm);
      }
    } catch (cause) {
      console.error("[voice] speechSynthesis unlock failed", cause);
    }
  }
  speechUnlocked = true;
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
}) {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: options.provider,
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      text: options.text,
      voiceProfile: options.profile.id,
      speed: options.speed,
      stability: options.stability,
    }),
  }).catch((cause) => {
    console.error("[voice] /api/tts network error", cause);
    throw cause;
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[voice] /api/tts rejected", response.status, detail.slice(0, 400));
    throw new Error(`Studio TTS unavailable (${response.status})`);
  }

  const blob = await response.blob();
  if (!blob.size || blob.type.includes("json")) {
    console.error("[voice] /api/tts returned empty or JSON instead of audio", blob.type, blob.size);
    throw new Error("Studio TTS unavailable");
  }
  if (options.shouldCancel()) return;

  const audio = options.audioRef.current ?? unlockedAudio;
  if (!audio) {
    throw new Error("Persistent audio element is missing");
  }

  const buffer = await blob.arrayBuffer();
  const complete = new Blob([buffer], { type: "audio/mpeg" });
  const url = URL.createObjectURL(complete);

  audio.pause();
  audio.loop = false;
  audio.preload = "auto";
  audio.volume = 1;
  audio.playbackRate = 1;
  options.audioRef.current = audio;
  assignAudioSrc(audio, url);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      audio.oncanplaythrough = null;
      audio.onloadeddata = null;
      audio.onerror = null;
    };

    audio.onended = () => {
      keepAudioChannelAlive(audio);
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      console.error("[voice] MP3 playback error");
      keepAudioChannelAlive(audio);
      reject(new Error("Audio playback failed"));
    };

    let started = false;
    const startPlayback = () => {
      if (started) return;
      started = true;
      cleanup();
      if (options.shouldCancel()) {
        keepAudioChannelAlive(audio);
        resolve();
        return;
      }
      void audio.play().catch((cause) => {
        console.error("[voice] MP3 play() blocked or failed", cause);
        if (isAutoplayError(cause)) {
          reject(new AutoplayBlockedError());
          return;
        }
        keepAudioChannelAlive(audio);
        reject(cause instanceof Error ? cause : new Error("Audio playback failed"));
      });
    };

    audio.oncanplaythrough = () => startPlayback();
    audio.load();
    if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
      startPlayback();
    }
    window.setTimeout(() => {
      if (!started && audio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        startPlayback();
      }
    }, 1200);
  });
}

function currentVoices(): SpeechSynthesisVoice[] {
  if (cachedVoices.length > 0) return cachedVoices;
  return captureVoices();
}

async function speakBrowserNeural(options: {
  text: string;
  profile: VoiceProfile;
  lang: ReplyLang;
  speed: number;
  shouldCancel: () => boolean;
  onStart?: () => void;
}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    console.error("[voice] speechSynthesis is not available in this browser");
    return;
  }
  if (options.shouldCancel()) return;
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();

  const voices = await waitForVoices();
  if (options.shouldCancel()) return;

  const voice = rememberBrowserVoice(
    pickNeuralVoice(voices.length > 0 ? voices : currentVoices(), options.profile, options.lang),
  );
  const spanish = options.lang === "es";
  const utteranceLang = spanish
    ? voice && normalizeLangTag(voice.lang).startsWith("es")
      ? voice.lang.replaceAll("_", "-")
      : "es-US"
    : voice && normalizeLangTag(voice.lang).startsWith("en")
      ? voice.lang.replaceAll("_", "-")
      : "en-US";

  await speakUtterance({
    text: paceForSpeech(options.text),
    voice,
    utteranceLang,
    rate: 1,
    pitch: 1,
    shouldCancel: options.shouldCancel,
    onStart: options.onStart,
  });
}

let heldUtterance: SpeechSynthesisUtterance | null = null;

function speakUtterance(options: {
  text: string;
  voice: SpeechSynthesisVoice | null;
  utteranceLang: string;
  rate: number;
  pitch: number;
  shouldCancel: () => boolean;
  onStart?: () => void;
}) {
  return new Promise<void>((resolve) => {
    if (options.shouldCancel()) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(options.text);
    heldUtterance = utterance;
    const voice = options.voice ?? lockedBrowserVoice;
    if (voice) utterance.voice = voice;
    utterance.lang = options.utteranceLang;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => {
      if (heldUtterance === utterance) heldUtterance = null;
      resolve();
    };
    utterance.onerror = (event) => {
      console.error("[voice] speechSynthesis utterance error", event.error);
      if (heldUtterance === utterance) heldUtterance = null;
      resolve();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

export function speakWithSpeechSynthesis(options: {
  text: string;
  profile: VoiceProfile;
  language: LanguageMode;
  speed: number;
  shouldCancel: () => boolean;
  onStart?: () => void;
}): Promise<void> {
  const lang = detectReplyLang(options.text, options.language);
  return speakBrowserNeural({
    text: options.text,
    profile: options.profile,
    lang,
    speed: options.speed,
    shouldCancel: options.shouldCancel,
    onStart: options.onStart,
  });
}
