export type VoiceProfileId = "elena" | "mateo" | "sarah";
export type LanguageMode = "auto" | "en" | "es";
export type ReplyLang = "en" | "es";

/** Fixed female studio voice — never alloy/onyx/Adam. */
export const FEMALE_OPENAI_VOICE = "nova" as const;
export const FEMALE_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export type VoiceProfile = {
  id: VoiceProfileId;
  name: string;
  title: string;
  hint: string;
  openaiVoice: typeof FEMALE_OPENAI_VOICE;
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
    openaiVoice: FEMALE_OPENAI_VOICE,
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
    keepAudioChannelAlive(audio);
  }
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
      options.onPlaybackEnd?.();
      resolve();
    };
    audio.onerror = () => {
      cleanup();
      console.error("[voice] MP3 playback error");
      keepAudioChannelAlive(audio);
      options.onPlaybackEnd?.();
      reject(new Error("Audio playback failed"));
    };

    let started = false;
    const startPlayback = () => {
      if (started) return;
      started = true;
      cleanup();
      if (options.shouldCancel()) {
        keepAudioChannelAlive(audio);
        options.onPlaybackEnd?.();
        resolve();
        return;
      }
      options.onPlaybackStart?.();
      void audio.play().catch((cause) => {
        console.error("[voice] MP3 play() blocked or failed", cause);
        if (isAutoplayError(cause)) {
          reject(new AutoplayBlockedError());
          return;
        }
        keepAudioChannelAlive(audio);
        options.onPlaybackEnd?.();
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
