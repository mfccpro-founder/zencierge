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
    rate: 1.08,
    pitch: 1,
    preview: {
      es: "Hola… soy Elena, tu anfitriona en Miami. Estoy aquí para lo que necesites: el Wi-Fi, el estacionamiento, o simplemente sentirte en casa. Dime, ¿cómo te ayudo?",
      en: "Hi… I'm Elena, your Miami hostess. I'm right here if you need Wi-Fi, parking, or just a warm welcome. How can I help you?",
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
    rate: 1.05,
    pitch: 1,
    preview: {
      es: "Buenas noches. Soy Mateo, concierge de lujo. Será un placer atenderle con calma y discreción. ¿En qué puedo servirle?",
      en: "Good evening. This is Mateo, your luxury concierge. It would be my pleasure to assist you — calmly, and with care. How may I help?",
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
    rate: 1.1,
    pitch: 1,
    preview: {
      es: "¡Hola! Soy Sarah. Hablo español también, así que no te preocupes. Dime qué necesitas y lo resolvemos ya.",
      en: "Hey! I'm Sarah, your friendly American host. Super happy to help — let's get you settled in. What do you need?",
    },
  },
];

const FEMALE_HINTS =
  /female|woman|jenny|aria|emma|sara|sarah|zira|nova|ana|elena|paloma|libby|sonia|natural.*female|google us english|google español/i;
const MALE_HINTS =
  /male|man|guy|davis|christopher|steffan|andrew|brian|adam|mateo|jorge|onyx|david|google uk english male/i;

const PREMIUM_HINT =
  /natural|neural|google|premium|enhanced|wavenet|studio|online \(natural\)|online \(neural\)|microsoft.*natural|microsoft.*neural/i;
const ROBOT_HINT =
  /compact|espeak|microsoft david -|microsoft zira desktop|microsoft mark desktop|desktop - english|speechify compact/i;

export function getVoiceProfile(id: VoiceProfileId): VoiceProfile {
  return VOICE_PROFILES.find((profile) => profile.id === id) ?? VOICE_PROFILES[0]!;
}

export function isPremiumVoice(voice: SpeechSynthesisVoice) {
  const label = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  if (ROBOT_HINT.test(label)) return false;
  return PREMIUM_HINT.test(label);
}

export function pickNeuralVoice(
  voices: SpeechSynthesisVoice[],
  profile: VoiceProfile,
  lang: ReplyLang,
): SpeechSynthesisVoice | null {
  const premium = voices.filter(isPremiumVoice);
  const pool = premium.length > 0 ? premium : voices;
  const wantedLang = lang === "es" ? /^es(-|_|$)/i : /^en(-|_|$)/i;
  const genderHint = profile.gender === "female" ? FEMALE_HINTS : MALE_HINTS;

  const scored = pool
    .map((voice) => {
      let score = 0;
      const label = `${voice.name} ${voice.lang}`;
      if (wantedLang.test(voice.lang)) score += 6;
      else if (lang === "es" && /^en/i.test(voice.lang)) score += 1;
      if (genderHint.test(label)) score += 4;
      if (/google/i.test(label)) score += 5;
      if (/neural|natural/i.test(label)) score += 6;
      if (/microsoft/i.test(label) && /neural|natural|online/i.test(label)) score += 5;
      if (profile.id === "elena" && /es-US|es-MX|español de estados/i.test(label)) score += 3;
      if (profile.id === "sarah" && /en-US|google us english/i.test(label)) score += 3;
      return { voice, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.voice ?? null;
}

let cachedVoices: SpeechSynthesisVoice[] = [];

export function primeVoices() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const apply = () => {
    cachedVoices = window.speechSynthesis.getVoices();
  };
  apply();
  window.speechSynthesis.addEventListener("voiceschanged", apply);
}

export function detectReplyLang(question: string, mode: LanguageMode): ReplyLang {
  if (mode === "en") return "en";
  if (mode === "es") return "es";
  if (
    /[áéíóúñ¿¡]/i.test(question) ||
    /\b(cuál|cual|dónde|donde|estaciono|clave|puerta|gracias|baño|fuga|hola|ayuda)\b/i.test(
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
  audio.playbackRate = Math.min(1.3, Math.max(0.9, options.speed));
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
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

async function speakBrowserNeural(options: {
  text: string;
  profile: VoiceProfile;
  lang: ReplyLang;
  speed: number;
  shouldCancel: () => boolean;
}) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  if (options.shouldCancel()) return;
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();

  const voice = pickNeuralVoice(currentVoices(), options.profile, options.lang);
  const rate = Math.min(1.3, Math.max(0.9, options.speed));

  await speakUtterance({
    text: options.text,
    voice,
    lang: options.lang,
    rate,
    pitch: 1,
    shouldCancel: options.shouldCancel,
  });
}

function speakUtterance(options: {
  text: string;
  voice: SpeechSynthesisVoice | null;
  lang: ReplyLang;
  rate: number;
  pitch: number;
  shouldCancel: () => boolean;
}) {
  return new Promise<void>((resolve) => {
    if (options.shouldCancel()) {
      resolve();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.lang = options.lang === "es" ? "es-US" : "en-US";
    utterance.rate = options.rate;
    utterance.pitch = options.pitch;
    if (options.voice) utterance.voice = options.voice;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}
