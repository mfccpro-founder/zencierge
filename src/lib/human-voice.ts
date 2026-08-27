export type VoiceProfileId = "elena" | "mateo" | "sarah";
export type LanguageMode = "auto" | "en" | "es";
export type ReplyLang = "en" | "es";

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
    title: "Cálida & Bilingüe (Miami Hostess)",
    hint: "Proyección firme, clara y con aire",
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
    title: "Concierge de Lujo",
    hint: "Voz femenina de estudio (nova)",
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
    hint: "Inglés nativo fluido y enérgico",
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

function isAutoplayError(cause: unknown) {
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
        text: paceForSpeech(options.text),
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
  lang: ReplyLang;
  onStart?: () => void;
  onEnd?: () => void;
}): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const synth = window.speechSynthesis;
  synth.cancel();

  const utterance = new SpeechSynthesisUtterance(options.text);
  utterance.lang = options.lang === "en" ? "en-US" : "es-ES";
  const voices = synth.getVoices();
  const prefix = options.lang === "en" ? "en" : "es";
  const female =
    voices.find(
      (item) =>
        item.lang.toLowerCase().startsWith(prefix) && isExplicitFemaleBrowserVoiceName(item.name),
    ) ?? voices.find((item) => isExplicitFemaleBrowserVoiceName(item.name));

  if (!female || isMaleBrowserVoiceName(female.name)) {
    synth.cancel();
    options.onEnd?.();
    return false;
  }

  utterance.voice = female;
  const chosen = utterance.voice?.name ?? "";
  if (!chosen || isMaleBrowserVoiceName(chosen) || !isExplicitFemaleBrowserVoiceName(chosen)) {
    synth.cancel();
    options.onEnd?.();
    return false;
  }

  utterance.pitch = 1.2;
  utterance.rate = 1;
  utterance.onstart = () => options.onStart?.();
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onEnd?.();
  synth.speak(utterance);
  return true;
}

export function isFatalTtsNetworkError(cause: unknown) {
  if (cause instanceof AutoplayBlockedError) return false;
  const message = cause instanceof Error ? cause.message : String(cause);
  return /failed to fetch|network|tts-network|Studio TTS unavailable|Load failed/i.test(message);
}

let unlockedAudio: HTMLAudioElement | null = null;

/** Call from the first user tap so later MP3 playback is allowed. */
export function unlockSpeechAudio(persistent?: HTMLAudioElement | null) {
  if (typeof window === "undefined") return;
  const audio = persistent ?? unlockedAudio ?? (unlockedAudio = new Audio());
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  if (persistent) unlockedAudio = persistent;

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
}

/** Fetch OpenAI MP3 from /api/tts and play it with HTMLAudioElement — never speechSynthesis. */
export async function playOpenAiTtsMpeg(text: string, voice: OpenAiTtsVoice): Promise<HTMLAudioElement> {
  const ttsRes = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, voice }),
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
  const audio = new Audio(url);
  audio.setAttribute("playsinline", "true");
  audio.preload = "auto";
  audio.volume = 1;
  try {
    await audio.play();
  } catch (cause) {
    URL.revokeObjectURL(url);
    if (isAutoplayError(cause)) throw new AutoplayBlockedError();
    throw cause instanceof Error ? cause : new Error("Audio playback failed");
  }
  audio.onended = () => URL.revokeObjectURL(url);
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
    if (isAutoplayError(cause)) throw new AutoplayBlockedError();
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
