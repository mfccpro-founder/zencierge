export type VoiceProfileId = "elena" | "mateo" | "sarah";
export type LanguageMode = "auto" | "en" | "es";
export type ReplyLang = "en" | "es";

export type VoiceProfile = {
  id: VoiceProfileId;
  name: string;
  title: string;
  hint: string;
  openaiVoice: "nova" | "onyx" | "shimmer";
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
    hint: "Tono conversacional natural, acento suave, pensada para Florida",
    openaiVoice: "nova",
    elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM",
    gender: "female",
    rate: 0.85,
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
    openaiVoice: "onyx",
    elevenLabsVoiceId: "pNInz6obpgDQGcFmaJgB",
    gender: "male",
    rate: 0.85,
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
    hint: "Inglés nativo fluido y enérgico",
    openaiVoice: "shimmer",
    elevenLabsVoiceId: "EXAVITQu4vr4xnSDxMaL",
    gender: "female",
    rate: 0.85,
    pitch: 1,
    preview: {
      es: "¡Hola! Soy Sarah. Hablo español también, así que no te preocupes. Dime qué necesitas y lo resolvemos ya.",
      en: "Hey! I'm Sarah, your friendly American host. Super happy to help — let's get you settled in. What do you need?",
    },
  },
];

const FEMALE_HINTS =
  /female|woman|jenny|aria|emma|sara|sarah|zira|nova|ana|elena|paloma|libby|sonia|natural.*female|google us english/i;
const MALE_HINTS =
  /male|man|guy|davis|christopher|steffan|andrew|brian|adam|mateo|jorge|onyx|david|google uk english male/i;

const PREMIUM_HINT =
  /natural|neural|google|premium|enhanced|wavenet|studio|online \(natural\)|online \(neural\)|microsoft.*natural|microsoft.*neural/i;
const ROBOT_HINT =
  /compact|espeak|microsoft david -|microsoft zira desktop|microsoft mark desktop|desktop - english|speechify compact/i;

const SPANISH_VOICE_NAMES =
  /google español|microsoft sabina|microsoft helena|microsoft paulina|microsoft dalia|microsoft jorge|\bmonica\b|\bmónica\b|\bpaulina\b|\bpenelope\b|\bpenélope\b|\bsofia\b|\bsofía\b|\bsabina\b|\bhelena\b|\bdalia\b/i;

const SPANISH_FEMALE_NAMES =
  /sabina|helena|paulina|dalia|monica|mónica|penelope|penélope|sofia|sofía|google español/i;
const SPANISH_MALE_NAMES = /jorge/i;

export function getVoiceProfile(id: VoiceProfileId): VoiceProfile {
  return VOICE_PROFILES.find((profile) => profile.id === id) ?? VOICE_PROFILES[0]!;
}

export function isPremiumVoice(voice: SpeechSynthesisVoice) {
  const label = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  if (ROBOT_HINT.test(label)) return false;
  return PREMIUM_HINT.test(label);
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

  const named = spanish.filter((voice) => SPANISH_VOICE_NAMES.test(voice.name));
  const preferredLang = spanish.filter((voice) => preferredSpanishLang(voice.lang));
  const pool = named.length > 0 ? named : preferredLang.length > 0 ? preferredLang : spanish;

  const genderRx = gender === "male" ? SPANISH_MALE_NAMES : SPANISH_FEMALE_NAMES;
  const gendered = pool.filter((voice) => genderRx.test(voice.name));
  if (gendered[0]) return gendered[0];
  if (pool[0]) return pool[0];
  return spanish.find((voice) => normalizeLangTag(voice.lang).startsWith("es")) ?? spanish[0] ?? null;
}

export function pickNeuralVoice(
  voices: SpeechSynthesisVoice[],
  profile: VoiceProfile,
  lang: ReplyLang,
): SpeechSynthesisVoice | null {
  if (lang === "es") return pickSpanishVoice(voices, profile.gender);

  const english = voices.filter((voice) => normalizeLangTag(voice.lang).startsWith("en"));
  const premium = english.filter(isPremiumVoice);
  const pool = premium.length > 0 ? premium : english.length > 0 ? english : voices;
  const genderHint = profile.gender === "female" ? FEMALE_HINTS : MALE_HINTS;

  const scored = pool
    .map((voice) => {
      let score = 0;
      const label = `${voice.name} ${voice.lang}`;
      if (normalizeLangTag(voice.lang).startsWith("en")) score += 8;
      if (isNativeSpanishVoice(voice)) score -= 12;
      if (genderHint.test(label)) score += 4;
      if (/google/i.test(label)) score += 5;
      if (/neural|natural/i.test(label)) score += 6;
      if (/microsoft/i.test(label) && /neural|natural|online/i.test(label)) score += 5;
      if (profile.id === "sarah" && /en-US|google us english/i.test(label)) score += 3;
      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.voice ?? null;
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

export const SPEECH_RATE_EN = 0.85;
export const SPEECH_RATE_ES = 0.82;

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
  elevenKey: string;
  openaiKey: string;
  audioRef: { current: HTMLAudioElement | null };
  shouldCancel: () => boolean;
  onEngine?: (engine: "elevenlabs" | "openai" | "browser-neural") => void;
}): Promise<void> {
  const lang = detectReplyLang(options.text, options.language);
  const eleven = options.elevenKey.trim();
  const openai = options.openaiKey.trim();

  if (eleven || openai) {
    try {
      await speakStudioAudio({
        text: options.text,
        profile: options.profile,
        speed: options.speed,
        stability: options.stability,
        provider: eleven ? "elevenlabs" : "openai",
        apiKey: eleven || openai,
        audioRef: options.audioRef,
        shouldCancel: options.shouldCancel,
      });
      options.onEngine?.(eleven ? "elevenlabs" : "openai");
      return;
    } catch {
      if (options.shouldCancel()) return;
    }
  }

  options.onEngine?.("browser-neural");
  await speakBrowserNeural({
    text: options.text,
    profile: options.profile,
    lang,
    speed: options.speed,
    shouldCancel: options.shouldCancel,
  });
}

export function stopHumanVoice(audioRef: { current: HTMLAudioElement | null }) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  const audio = audioRef.current;
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audioRef.current = null;
  }
}

async function speakStudioAudio(options: {
  text: string;
  profile: VoiceProfile;
  speed: number;
  stability: number;
  provider: "elevenlabs" | "openai";
  apiKey: string;
  audioRef: { current: HTMLAudioElement | null };
  shouldCancel: () => boolean;
}) {
  const response = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: options.provider,
      apiKey: options.apiKey,
      text: options.text,
      voiceProfile: options.profile.id,
      speed: options.speed,
      stability: options.stability,
    }),
  });

  if (!response.ok) {
    throw new Error("Studio TTS unavailable");
  }

  const blob = await response.blob();
  if (options.shouldCancel()) return;

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.playbackRate = Math.min(1.05, Math.max(0.82, options.speed));
  options.audioRef.current = audio;

  await new Promise<void>((resolve, reject) => {
    audio.onended = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Audio playback failed"));
    };
    if (options.shouldCancel()) {
      URL.revokeObjectURL(url);
      resolve();
      return;
    }
    void audio.play().catch(reject);
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
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (options.shouldCancel()) return;
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();

  const voices = await waitForVoices();
  if (options.shouldCancel()) return;

  const voice = pickNeuralVoice(voices.length > 0 ? voices : currentVoices(), options.profile, options.lang);
  const spanish = options.lang === "es";
  const rate = spanish ? SPEECH_RATE_ES : SPEECH_RATE_EN;
  const utteranceLang = spanish
    ? voice && normalizeLangTag(voice.lang).startsWith("es")
      ? voice.lang.replaceAll("_", "-")
      : "es-US"
    : "en-US";

  await speakUtterance({
    text: paceForSpeech(options.text),
    voice,
    utteranceLang,
    rate,
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
    if (options.voice) utterance.voice = options.voice;
    utterance.lang = options.utteranceLang;
    utterance.rate = options.rate;
    utterance.pitch = 1;
    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => {
      if (heldUtterance === utterance) heldUtterance = null;
      resolve();
    };
    utterance.onerror = () => {
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
