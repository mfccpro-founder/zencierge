export type GuestStaySpeechLang = "en" | "es";

export type GuestStaySpeechStatus = "idle" | "speaking" | "stopped" | "unavailable";

export const GUEST_STAY_SPEECH_RATE = 0.94;
export const GUEST_STAY_SPEECH_PITCH = 1.05;
export const GUEST_STAY_SPEECH_VOLUME = 1;

export const GUEST_STAY_FEMALE_VOICE_NAMES = [
  "Aria",
  "Jenny",
  "Zira",
  "Ava",
  "Samantha",
  "Victoria",
  "Karen",
  "Allison",
  "Dalia",
  "Sabina",
  "Elvira",
  "Paloma",
  "Paulina",
  "Monica",
  "Helena",
  "Marisol",
] as const;

const GUEST_STAY_MALE_VOICE_NAMES = [
  "David",
  "Mark",
  "Guy",
  "George",
  "James",
  "Daniel",
  "Richard",
  "Fred",
  "Alex",
  "Jorge",
  "Pablo",
  "Diego",
  "Carlos",
  "Raul",
  "Miguel",
  "Juan",
] as const;

export type GuestStaySpeechVoice = {
  name: string;
  lang: string;
  localService: boolean;
};

export type GuestStaySpeechUtterance = {
  text: string;
  lang: string;
  voice: GuestStaySpeechVoice | null;
  generation: number;
  rate: number;
  pitch: number;
  volume: number;
  onEnd?: (generation: number) => void;
  onError?: (generation: number) => void;
};

export type GuestStaySpeechSynth = {
  supported: boolean;
  cancel: () => void;
  getVoices: () => readonly GuestStaySpeechVoice[];
  speak: (utterance: GuestStaySpeechUtterance) => boolean;
  addEventListener?: (type: "voiceschanged", listener: () => void) => void;
};

let cachedVoices: GuestStaySpeechVoice[] | null = null;

export function resetGuestStayVoiceCache() {
  cachedVoices = null;
}

export function refreshGuestStayVoiceCache(voices: readonly GuestStaySpeechVoice[]) {
  if (voices.length > 0) cachedVoices = [...voices];
  return cachedVoices && cachedVoices.length > 0 ? cachedVoices : [];
}

export function resolveGuestStayVoices(voices: readonly GuestStaySpeechVoice[]) {
  if (voices.length > 0) {
    cachedVoices = [...voices];
    return cachedVoices;
  }
  if (cachedVoices && cachedVoices.length > 0) return cachedVoices;
  return [];
}

export function bindGuestStaySpeechVoiceRefresh(synth: {
  getVoices: () => readonly GuestStaySpeechVoice[];
  addEventListener?: (type: "voiceschanged", listener: () => void) => void;
}) {
  const load = () => {
    try {
      refreshGuestStayVoiceCache(synth.getVoices());
    } catch {
      return;
    }
  };
  load();
  synth.addEventListener?.("voiceschanged", load);
  return load;
}

export function guestStaySpeechBcp47(lang: GuestStaySpeechLang) {
  return lang === "es" ? "es-US" : "en-US";
}

function voiceLang(voice: GuestStaySpeechVoice) {
  return voice.lang.trim().toLowerCase().replace(/_/g, "-");
}

function hasNameToken(name: string, token: string) {
  return new RegExp(`(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`, "i").test(name);
}

function languageScore(tag: string, lang: GuestStaySpeechLang) {
  if (lang === "es") {
    if (tag === "es-us" || tag.startsWith("es-us-")) return 600;
    if (tag === "es-mx" || tag.startsWith("es-mx-")) return 400;
    if (tag === "es" || tag.startsWith("es-")) return 200;
    return 0;
  }
  if (tag === "en-us" || tag.startsWith("en-us-")) return 600;
  if (tag === "en" || tag.startsWith("en-")) return 300;
  return 0;
}

function genderScore(name: string) {
  if (/\bfemale\b/i.test(name) || GUEST_STAY_FEMALE_VOICE_NAMES.some((token) => hasNameToken(name, token))) {
    return 80;
  }
  if (/\bmale\b/i.test(name) || GUEST_STAY_MALE_VOICE_NAMES.some((token) => hasNameToken(name, token))) {
    return -40;
  }
  return 0;
}

function qualityScore(name: string) {
  return /\b(natural|neural|premium|enhanced)\b/i.test(name) ? 50 : 0;
}

export function scoreGuestStaySpeechVoice(voice: GuestStaySpeechVoice, lang: GuestStaySpeechLang) {
  const tag = voiceLang(voice);
  const language = languageScore(tag, lang);
  if (language === 0) return 0;
  return language + genderScore(voice.name) + qualityScore(voice.name) + (voice.localService ? 10 : 0);
}

export function selectGuestStaySpeechVoice(
  voices: readonly GuestStaySpeechVoice[],
  lang: GuestStaySpeechLang,
): GuestStaySpeechVoice | null {
  if (!voices.length) return null;
  let best: GuestStaySpeechVoice | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const score = scoreGuestStaySpeechVoice(voice, lang);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

export function isSpeakableGuestStayReply(text: string) {
  const value = text.trim();
  if (!value) return false;
  if (/https?:|www\./i.test(value)) return false;
  if (/[A-Za-z0-9_-]{43,}/.test(value)) return false;
  // Block secret labels paired with a value (never speak raw codes/passwords).
  if (
    /(?:wifi\s*password|door\s*code|gate\s*code|lockbox(?:\s*code)?|access\s*code|alarm\s*code|passcode|\bpin\b|\bpassword\b|\bclave\b)\s*(?:is|:|=|es)\s*\S+/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/wifi password|door code|gate code|lockbox|access code/i.test(value)) {
    // Allow the canonical private-intent refusal that redirects to Access (no secret value).
    const safeRefusal =
      /(?:for security|por seguridad)/i.test(value) &&
      /(?:can'?t|cannot|no puedo|secure access|secci[oó]n segura)/i.test(value);
    if (!safeRefusal) return false;
  }
  return true;
}

export function shouldSpeakGuestStayText(role: "elena" | "guest", text: string) {
  return role === "elena" && isSpeakableGuestStayReply(text);
}

export function parseGuestStaySpeechLang(value: unknown): GuestStaySpeechLang {
  return value === "es" ? "es" : "en";
}

function elenaUtteranceFields() {
  return {
    rate: GUEST_STAY_SPEECH_RATE,
    pitch: GUEST_STAY_SPEECH_PITCH,
    volume: GUEST_STAY_SPEECH_VOLUME,
  };
}

export function createGuestStaySpeechEngine() {
  let generation = 0;
  let status: GuestStaySpeechStatus = "idle";
  let lastReply: { text: string; lang: GuestStaySpeechLang } | null = null;
  let utterances = 0;

  function invalidate() {
    generation += 1;
    utterances = 0;
  }

  function handleEnd(callbackGeneration: number) {
    if (callbackGeneration !== generation) return status;
    utterances = 0;
    status = "idle";
    return status;
  }

  function handleError(callbackGeneration: number) {
    if (callbackGeneration !== generation) return status;
    utterances = 0;
    status = "unavailable";
    return status;
  }

  return {
    status: () => status,
    generation: () => generation,
    lastReply: () => lastReply,
    utterances: () => utterances,
    speak(text: string, lang: GuestStaySpeechLang, synth: GuestStaySpeechSynth) {
      if (!isSpeakableGuestStayReply(text)) {
        return { started: false, status, generation };
      }
      lastReply = { text: text.trim(), lang };
      if (!synth.supported) {
        status = "unavailable";
        return { started: false, status, generation };
      }
      synth.cancel();
      utterances = 0;
      generation += 1;
      const myGen = generation;
      const voices = resolveGuestStayVoices(synth.getVoices());
      const voice = selectGuestStaySpeechVoice(voices, lang);
      const started = synth.speak({
        text: lastReply.text,
        lang: guestStaySpeechBcp47(lang),
        voice,
        generation: myGen,
        ...elenaUtteranceFields(),
        onEnd: handleEnd,
        onError: handleError,
      });
      if (!started) {
        status = "unavailable";
        return { started: false, status, generation: myGen };
      }
      utterances = 1;
      status = "speaking";
      return { started: true, status, generation: myGen };
    },
    handleEnd,
    handleError,
    stop(synth: GuestStaySpeechSynth) {
      invalidate();
      synth.cancel();
      if (status !== "unavailable") status = "stopped";
      return status;
    },
    cancelForSend(synth: GuestStaySpeechSynth) {
      invalidate();
      synth.cancel();
      if (status === "speaking") status = "idle";
      return status;
    },
    unmount(synth: GuestStaySpeechSynth) {
      invalidate();
      synth.cancel();
      return status;
    },
  };
}

function mapBrowserVoices(synth: SpeechSynthesis): GuestStaySpeechVoice[] {
  return Array.from(synth.getVoices()).map((voice) => ({
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
  }));
}

export function createBrowserGuestStaySpeechSynth(): GuestStaySpeechSynth {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (synth) {
    bindGuestStaySpeechVoiceRefresh({
      getVoices: () => {
        try {
          return mapBrowserVoices(synth);
        } catch {
          return [];
        }
      },
      addEventListener(type, listener) {
        if (typeof synth.addEventListener === "function") {
          synth.addEventListener(type, listener);
          return;
        }
        synth.onvoiceschanged = listener;
      },
    });
  }
  return {
    supported: Boolean(synth),
    cancel() {
      synth?.cancel();
    },
    getVoices() {
      try {
        return resolveGuestStayVoices(synth ? mapBrowserVoices(synth) : []);
      } catch {
        return resolveGuestStayVoices([]);
      }
    },
    speak(utterance) {
      if (!synth) return false;
      try {
        const spoken = new SpeechSynthesisUtterance(utterance.text);
        spoken.lang = utterance.lang;
        spoken.rate = utterance.rate;
        spoken.pitch = utterance.pitch;
        spoken.volume = utterance.volume;
        if (utterance.voice) {
          const match = mapBrowserVoices(synth).find(
            (voice) => voice.name === utterance.voice?.name && voice.lang === utterance.voice.lang,
          );
          if (match) {
            const native = Array.from(synth.getVoices()).find(
              (voice) => voice.name === match.name && voice.lang === match.lang,
            );
            if (native) spoken.voice = native;
          }
        }
        spoken.onend = () => utterance.onEnd?.(utterance.generation);
        spoken.onerror = () => utterance.onError?.(utterance.generation);
        synth.speak(spoken);
        return true;
      } catch {
        return false;
      }
    },
  };
}
