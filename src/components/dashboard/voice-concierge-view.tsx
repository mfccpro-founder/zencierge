"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Phone, Play, Sparkles } from "lucide-react";
import { useListings } from "@/components/dashboard/listings-provider";
import { AiReceptionistStudio } from "@/components/dashboard/ai-receptionist-studio";
import type { ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply } from "@/lib/ask-avatar";
import { useHeygenRepeatAvatar } from "@/components/dashboard/use-heygen-repeat";
import {
  VOICE_PROFILES,
  detectReplyLang,
  getVoiceProfile,
  keepAudioChannelAlive,
  resumePersistentAudio,
  speakHumanVoice,
  stopHumanVoice,
  unlockSpeechAudio,
  type LanguageMode,
  type ReplyLang,
  type VoiceProfile,
  type VoiceProfileId,
} from "@/lib/human-voice";

type HoursMode = "always" | "night";
type FloridaLine = "305" | "954";

type SimLine = {
  id: string;
  speaker: "guest" | "ai" | "system";
  text: string;
};

const FLORIDA_LINES: Record<FloridaLine, { number: string; area: string }> = {
  "305": { number: "+1 (305) 555-0199", area: "Miami-Dade · 305" },
  "954": { number: "+1 (954) 555-0144", area: "Broward · 954" },
};

/** Strict female-voice keywords per language for Web Speech API voice picking. */
const FEMALE_VOICE_HINTS: Record<ReplyLang, string[]> = {
  es: ["sabina", "helena", "monica", "paulina", "laura", "sofia", "elena", "maria", "female", "mujer"],
  en: ["zira", "samantha", "victoria", "karen", "jenny", "aria", "female"],
};
/** Male voice names are always excluded so Elena never sounds masculine. */
const MALE_VOICE_HINTS = ["david", "raul", "pablo", "jorge", "male", "guy", "hombre"];

function isFemaleVoiceName(name: string, lang: ReplyLang) {
  const lower = name.toLowerCase();
  return FEMALE_VOICE_HINTS[lang].some((hint) => lower.includes(hint));
}

function isMaleVoiceName(name: string) {
  const lower = name.toLowerCase();
  return MALE_VOICE_HINTS.some((hint) => lower.includes(hint));
}

const inputClass =
  "w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none";

export function VoiceConciergeView() {
  const { properties } = useListings();
  const [voiceId, setVoiceId] = useState<VoiceProfileId>("elena");
  const [language, setLanguage] = useState<LanguageMode>("auto");
  const [speed, setSpeed] = useState(0.85);
  const [stability, setStability] = useState(68);
  const [floridaLine, setFloridaLine] = useState<FloridaLine>("305");
  const [emergencyNumber, setEmergencyNumber] = useState("+1 (954) 275-3544");
  const [hours, setHours] = useState<HoursMode>("always");
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "prop-1");
  const [callActive, setCallActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<SimLine[]>([]);
  const [partialAi, setPartialAi] = useState("");
  const [partialGuest, setPartialGuest] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [previewing, setPreviewing] = useState<VoiceProfileId | null>(null);
  const [engineLabel, setEngineLabel] = useState("Studio TTS");
  const [tapToListen, setTapToListen] = useState(false);
  const [responding, setResponding] = useState(false);

  const profile = getVoiceProfile(voiceId);
  const selectedProperty =
    properties.find((property) => property.id === propertyId) ?? properties[0];
  const lineMeta = FLORIDA_LINES[floridaLine];
  const studioReady = Boolean(elevenKey.trim() || openaiKey.trim());

  const idRef = useRef(0);
  const genRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const callActiveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const speedRef = useRef(0.85);
  const heygen = useHeygenRepeatAvatar();
  const abortRef = useRef<AbortController | null>(null);
  const safetyRef = useRef(0);
  const playbackStartedRef = useRef(false);
  const heygenSpeakingRef = useRef(false);

  const nextId = () => {
    idRef.current += 1;
    return `sim-${idRef.current}`;
  };

  useEffect(() => {
    callActiveRef.current = callActive;
  }, [callActive]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, partialAi, partialGuest]);

  useEffect(() => {
    const storedEleven = window.localStorage.getItem("zencierge.elevenlabsKey") ?? "";
    const storedOpenAi = window.localStorage.getItem("zencierge.openaiTtsKey") ?? "";
    if (storedEleven) setElevenKey(storedEleven);
    if (storedOpenAi) setOpenaiKey(storedOpenAi);
  }, []);

  useEffect(() => {
    return () => {
      stopHumanVoice(audioRef);
    };
  }, []);

  useEffect(() => {
    const wasSpeaking = heygenSpeakingRef.current;
    heygenSpeakingRef.current = heygen.speaking;
    if (heygen.speaking) {
      playbackStartedRef.current = true;
      if (safetyRef.current) {
        window.clearTimeout(safetyRef.current);
        safetyRef.current = 0;
      }
      setResponding(false);
      setSpeaking(true);
      return;
    }
    if (wasSpeaking) {
      setSpeaking(false);
      setResponding(false);
    }
  }, [heygen.speaking]);

  useEffect(() => {
    if (properties.length > 0 && !properties.some((item) => item.id === propertyId)) {
      setPropertyId(properties[0]!.id);
    }
  }, [properties, propertyId]);

  if (!selectedProperty) {
    return (
      <p className="text-sm text-slate-400">
        Add a property first so the concierge can use door codes and Wi-Fi.
      </p>
    );
  }

  const phase: ReceptionistPhase = thinking || responding
    ? "thinking"
    : listening
      ? "listening"
      : speaking || heygen.speaking
        ? "speaking"
        : "idle";

  const persistKeys = (eleven: string, openai: string) => {
    window.localStorage.setItem("zencierge.elevenlabsKey", eleven);
    window.localStorage.setItem("zencierge.openaiTtsKey", openai);
  };

  const stopListening = () => {
    setListening(false);
  };

  const clearSafety = () => {
    if (safetyRef.current) {
      window.clearTimeout(safetyRef.current);
      safetyRef.current = 0;
    }
  };

  const armSafety = () => {
    clearSafety();
    playbackStartedRef.current = false;
    safetyRef.current = window.setTimeout(() => {
      if (playbackStartedRef.current) return;
      console.error("[voice] 7s safety: playback never started — reset idle");
      cancelSpeech();
    }, 7000);
  };

  const markPlaybackStarted = () => {
    playbackStartedRef.current = true;
    clearSafety();
    setResponding(false);
  };

  const cancelSpeech = () => {
    genRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearSafety();
    playbackStartedRef.current = false;
    stopHumanVoice(audioRef);
    void heygen.interrupt();
    setSpeaking(false);
    setPreviewing(null);
    setPartialAi("");
    setTapToListen(false);
    setResponding(false);
    setThinking(false);
  };

  const endCall = () => {
    stopListening();
    cancelSpeech();
    void heygen.stop();
    setThinking(false);
    setPartialGuest("");
    setCallActive(false);
    setStreamReady(false);
    setLines((current) => [
      ...current,
      { id: nextId(), speaker: "system", text: "Call ended." },
    ]);
  };

  const applySpeed = (value: number) => {
    speedRef.current = value;
    setSpeed(value);
  };

  const ensureAudioUnlocked = () => {
    // Called synchronously from the click handler (Simulate inbound call) so the
    // browser treats this gesture as the unlock for all later playback.
    unlockSpeechAudio(audioRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
    unlockedRef.current = true;
  };

  const playQueuedStudio = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    stopListening();
    setTapToListen(false);
    setSpeaking(true);
    audio.loop = false;
    audio.volume = 1;
    audio.onended = () => {
      keepAudioChannelAlive(audio);
      setSpeaking(false);
    };
    try {
      await resumePersistentAudio(audio);
    } catch (cause) {
      console.error("[voice] Tocar para escuchar failed", cause);
      setSpeaking(false);
    }
  };

  const speakWithBrowserTts = (text: string, mode: LanguageMode) => {
    // Guaranteed-vocalization fallback: if Studio/HeyGen TTS is unavailable,
    // Elena still speaks the /api/avatar reply with the browser's own voice.
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    synth.resume();
    const lang = detectReplyLang(text, mode);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang === "en" ? "en-US" : "es-ES";
    const prefix = lang === "en" ? "en" : "es";
    const langVoices = synth
      .getVoices()
      .filter((item) => item.lang.toLowerCase().startsWith(prefix));
    const pool = langVoices.length ? langVoices : synth.getVoices();
    // Elena must sound female: named female voices first, then any non-male voice.
    const voice =
      pool.find((item) => isFemaleVoiceName(item.name, lang) && !isMaleVoiceName(item.name)) ??
      pool.find(
        (item) => !isMaleVoiceName(item.name) && /natural|google/i.test(item.name),
      ) ??
      pool.find((item) => !isMaleVoiceName(item.name)) ??
      pool[0];
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onstart = () => {
      if (genRef.current) markPlaybackStarted();
      setSpeaking(true);
    };
    utterance.onend = () => {
      setSpeaking(false);
      setResponding(false);
      clearSafety();
    };
    utterance.onerror = () => {
      setSpeaking(false);
      setResponding(false);
      clearSafety();
    };
    setSpeaking(true);
    synth.speak(utterance);
  };

  const speak = async (text: string, forProfile = profile) => {
    const gen = genRef.current;
    stopListening();
    setResponding(true);
    armSafety();
    try {
      const heygenOk = await heygen.start().catch((cause) => {
        console.error("[heygen] session failed; using /api/tts", cause);
        return false;
      });
      if (heygenOk) {
        const repeated = await heygen.speakRepeat(text);
        if (repeated && gen === genRef.current) {
          setEngineLabel("HeyGen · REPEAT · es");
          return;
        }
      }
      if (gen !== genRef.current) return;
      await speakHumanVoice({
        text,
        profile: forProfile,
        language,
        speed: 1,
        stability,
        elevenKey,
        openaiKey,
        audioRef,
        shouldCancel: () => gen !== genRef.current,
        onAutoplayBlocked: () => {
          if (gen === genRef.current) {
            setResponding(false);
            clearSafety();
            setTapToListen(true);
          }
        },
        onPlaybackStart: () => {
          if (gen === genRef.current) {
            markPlaybackStarted();
            setSpeaking(true);
          }
        },
        onPlaybackEnd: () => {
          if (gen !== genRef.current) return;
          setSpeaking(false);
          setResponding(false);
        },
        onEngine: (engine) => {
          setEngineLabel(engine === "elevenlabs" ? "Studio · ElevenLabs" : "Studio · OpenAI HD");
        },
      });
    } catch (cause) {
      console.error("[voice] speak failed; vocalizing with browser speech synthesis", cause);
      speakWithBrowserTts(text, language);
    } finally {
      if (!playbackStartedRef.current) setResponding(false);
    }
  };

  const streamReply = async (text: string) => {
    const gen = ++genRef.current;
    stopListening();
    setPartialAi("");
    setLines((current) => [...current, { id: nextId(), speaker: "ai", text }]);
    setResponding(true);
    armSafety();
    try {
      await speak(text);
    } catch (cause) {
      console.error("[voice] Studio TTS failed", cause);
    } finally {
      if (gen === genRef.current && !playbackStartedRef.current) {
        setResponding(false);
        setSpeaking(false);
      }
    }
  };

  const ensureVoiceSession = () => {
    if (callActiveRef.current) return;
    setCallActive(true);
    setStreamReady(true);
    setLines((current) =>
      current.length
        ? current
        : [
            {
              id: nextId(),
              speaker: "system",
              text: `Mic session · ${selectedProperty.name} · ${profile.name}`,
            },
          ],
    );
  };

  const handleGuestUtterance = (raw: string) => {
    const text = raw.trim();
    if (!text || !selectedProperty) return;
    ensureVoiceSession();
    callActiveRef.current = true;
    stopListening();
    setPartialGuest("");
    setDraft("");
    setLines((current) => [...current, { id: nextId(), speaker: "guest", text }]);

    const history = lines
      .filter((line) => line.speaker === "guest" || line.speaker === "ai")
      .slice(-6)
      .map((line) => ({ role: line.speaker === "guest" ? ("guest" as const) : ("ai" as const), text: line.text }));

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setThinking(true);
    setResponding(true);
    armSafety();
    const started = performance.now();
    void askAvatarReply({
      question: text,
      property: selectedProperty,
      properties,
      language,
      hours,
      emergencyNumber,
      openaiKey,
      history,
      signal: abort.signal,
    })
      .then((reply) => {
        if (!callActiveRef.current || abort.signal.aborted) {
          setThinking(false);
          setResponding(false);
          return;
        }
        setLatencyMs(Math.round(performance.now() - started));
        setThinking(false);
        void streamReply(reply);
      })
      .catch((cause) => {
        if (abort.signal.aborted) return;
        console.error("[voice] avatar reply failed", cause);
        setThinking(false);
        setResponding(false);
      });
  };

  const startCall = () => {
    ensureAudioUnlocked();
    const greeting = buildGreeting({
      profile,
      language,
      hours,
      property: selectedProperty,
      lineNumber: lineMeta.number,
    });
    setCallActive(true);
    setStreamReady(true);
    setLatencyMs(null);
    setLines([
      {
        id: nextId(),
        speaker: "system",
        text: `Connected · ${lineMeta.number} · ${selectedProperty.name} · ${profile.name}`,
      },
    ]);
    void streamReply(greeting);
  };

  const playPreview = async (item: VoiceProfile) => {
    ensureAudioUnlocked();
    cancelSpeech();
    setVoiceId(item.id);
    setPreviewing(item.id);
    setSpeaking(true);
    const sample =
      language === "en" ? item.preview.en : language === "es" ? item.preview.es : item.preview.es;
    const gen = genRef.current;
    await speak(sample, item);
    if (gen === genRef.current) {
      setSpeaking(false);
      setPreviewing(null);
    }
  };

  const toggleListen = () => {
    ensureAudioUnlocked();
    if (speaking || responding || heygen.speaking) cancelSpeech();
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white tracking-tight">
          AI Voice Concierge Settings
        </h2>
        <p className="text-sm text-slate-400 mt-0.5">
          Human voice profiles, Florida routing, and a live receptionist avatar grounded in
          ai_handbook.
        </p>
      </div>

      <audio ref={audioRef} className="sr-only" preload="auto" playsInline />
      <div id="ai-receptionist">
        {responding ? (
          <button
            type="button"
            onClick={() => {
              cancelSpeech();
            }}
            className="mb-3 w-full text-center text-xs font-medium text-emerald-300 hover:underline"
          >
            Elena está respondiendo... (toca para cancelar)
          </button>
        ) : null}
        {tapToListen ? (
          <button
            type="button"
            onClick={() => void playQueuedStudio()}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-bold text-slate-950 hover:bg-slate-100"
          >
            <Play className="h-4 w-4" />
            Tocar para escuchar
          </button>
        ) : null}
        <AiReceptionistStudio
          phase={phase}
          voiceName={profile.name}
          properties={properties}
          selectedProperty={selectedProperty}
          propertyId={selectedProperty.id}
          onPropertyChange={setPropertyId}
          language={language}
          onLanguageChange={setLanguage}
          callActive={callActive}
          latencyMs={latencyMs}
          streamReady={streamReady || heygen.ready}
          connectionLabel={
            heygen.ready
              ? "HeyGen REPEAT · es · voz femenina"
              : streamReady
                ? "Audio stream ready · /api/tts nova"
                : "Standby · no media session"
          }
          lines={lines}
          partialAi={partialAi}
          partialGuest={partialGuest}
          draft={draft}
          onDraftChange={setDraft}
          onSimulateCall={startCall}
          onEndCall={endCall}
          onSend={handleGuestUtterance}
          onListen={toggleListen}
          onStopSpeech={cancelSpeech}
          listening={listening}
          speaking={speaking || heygen.speaking}
          transcriptRef={scrollRef}
          videoRef={heygen.videoRef}
          videoReady={heygen.ready}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-6">
          <section className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5 text-emerald-400" />
                <h3 className="font-semibold text-white">Human voice profiles</h3>
              </div>
              <span className="text-[11px] font-medium text-slate-400 bg-slate-950 border border-slate-800 px-2 py-1 rounded-full">
                {engineLabel}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {VOICE_PROFILES.map((item) => {
                const active = voiceId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border px-4 py-3 transition-all ${
                      active
                        ? "bg-emerald-500/15 border-emerald-500/40"
                        : "bg-slate-950/50 border-slate-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setVoiceId(item.id)}
                        className="text-left flex-1"
                      >
                        <div className="text-sm font-semibold text-white">
                          {item.name}{" "}
                          <span className="text-slate-400 font-medium">— {item.title}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1">{item.hint}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void playPreview(item)}
                        disabled={previewing === item.id}
                        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                        {previewing === item.id ? "Playing…" : "Preview"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">Language</label>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as LanguageMode)}
                className={inputClass}
              >
                <option value="auto">Bilingüe Inglés/Español automático</option>
                <option value="en">Solo Inglés</option>
                <option value="es">Solo Español</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SliderField
                label="Speaking Speed"
                value={speed}
                min={0.75}
                max={0.95}
                step={0.01}
                display={`${speed.toFixed(2)}×`}
                onChange={applySpeed}
              />
              <SliderField
                label="Voice stability"
                value={stability}
                min={40}
                max={90}
                step={1}
                display={`${stability}%`}
                onChange={setStability}
              />
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-amber-300" />
                  <p className="text-sm font-semibold text-white">Studio TTS</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKeys((value) => !value)}
                  className="text-slate-400 hover:text-white"
                  aria-label={showKeys ? "Hide API keys" : "Show API keys"}
                >
                  {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Audio is always generated as MP3 by /api/tts (OpenAI tts-1-hd or ElevenLabs). Keys in
                .env.local or pasted here.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1.5">
                    ElevenLabs API Key
                  </label>
                  <input
                    type={showKeys ? "text" : "password"}
                    value={elevenKey}
                    autoComplete="off"
                    onChange={(event) => {
                      setElevenKey(event.target.value);
                      persistKeys(event.target.value, openaiKey);
                    }}
                    placeholder="xi-… or sk_…"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-400 block mb-1.5">
                    OpenAI TTS API Key
                  </label>
                  <input
                    type={showKeys ? "text" : "password"}
                    value={openaiKey}
                    autoComplete="off"
                    onChange={(event) => {
                      setOpenaiKey(event.target.value);
                      persistKeys(elevenKey, event.target.value);
                    }}
                    placeholder="sk-…"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
              </div>
              <p className="text-[11px] text-emerald-400/80">
                {studioReady
                  ? "Studio audio enabled. Previews and test calls use /api/tts MP3."
                  : "Uses ELEVENLABS_API_KEY or OPENAI_API_KEY from the server if no key is pasted here."}
              </p>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Phone className="h-5 w-5 text-sky-400" />
                <h3 className="font-semibold text-white">Phone routing</h3>
              </div>
              <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2.5 py-1 rounded-full font-medium">
                Twilio SIP Connected
              </span>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">Florida virtual number</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(Object.keys(FLORIDA_LINES) as FloridaLine[]).map((key) => {
                  const item = FLORIDA_LINES[key];
                  const active = floridaLine === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setFloridaLine(key)}
                      className={`text-left rounded-xl border px-4 py-3 transition-all ${
                        active
                          ? "bg-sky-500/10 border-sky-500/40"
                          : "bg-slate-950/50 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="text-sm font-mono font-bold text-white">{item.number}</div>
                      <div className="text-[11px] text-slate-500 mt-1">{item.area}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">
                Host emergency forwarding
              </label>
              <input
                value={emergencyNumber}
                onChange={(event) => setEmergencyNumber(event.target.value)}
                className={`${inputClass} font-mono`}
                aria-label="Emergency forwarding number"
              />
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                Instant transfer on severe incidents: water leaks, broken locks, lockouts.
              </p>
            </div>

            <div>
              <p className="text-xs font-medium text-slate-400 mb-2">AI coverage hours</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setHours("always")}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                    hours === "always"
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  24/7
                </button>
                <button
                  type="button"
                  onClick={() => setHours("night")}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                    hours === "night"
                      ? "bg-violet-500/15 border-violet-500/40 text-violet-300"
                      : "bg-slate-950/50 border-slate-800 text-slate-300 hover:border-slate-700"
                  }`}
                >
                  Nocturno (10 PM–8 AM)
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-slate-400">{label}</label>
        <span className="text-[11px] font-mono text-slate-500">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-emerald-400"
      />
    </div>
  );
}

function nightNote(hours: HoursMode, lang: ReplyLang) {
  if (hours !== "night") return "";
  return lang === "es"
    ? " Por cierto, estás en la línea nocturna. Aquí estoy, con calma, a cualquier hora."
    : " And just so you know, this is the overnight line. I'm here, unhurried, whenever you need me.";
}

function buildGreeting({
  profile,
  language,
  hours,
  property,
  lineNumber,
}: {
  profile: VoiceProfile;
  language: LanguageMode;
  hours: HoursMode;
  property: Property;
  lineNumber: string;
}) {
  const lang: ReplyLang =
    language === "en" ? "en" : language === "es" ? "es" : profile.id === "sarah" ? "en" : "es";
  const night = nightNote(hours, lang);

  if (profile.id === "mateo") {
    return lang === "es"
      ? `Buenas noches. Soy tu conserje en ${property.name}, ${property.address}, ${property.city}. Qué gusto atenderle. Está usted en la ${lineNumber}.${night} Deme un momento. ¿En qué puedo servirle?`
      : `Good evening. This is your concierge for ${property.name}, ${property.address}, ${property.city}. A pleasure to greet you on ${lineNumber}.${night} Take your time. How may I help?`;
  }

  if (profile.id === "sarah") {
    return lang === "es"
      ? `Hola. Soy Sarah, tu host en ${property.name}, ${property.address}, ${property.city}. Qué bueno que llamas. Estás en la ${lineNumber}.${night} Dime, ¿qué necesitas?`
      : `Hey. I'm Sarah, your host at ${property.name}, ${property.address}, ${property.city}. So glad you called. You're on ${lineNumber}.${night} What's going on? I'm here.`;
  }

  return lang === "es"
    ? `Hola. Qué gusto escucharte. Soy Elena, tu anfitriona de ${property.name}, en ${property.address}, ${property.city}. Llamas al ${lineNumber}.${night} Cuéntame. ¿En qué te ayudo hoy?`
    : `Hi there. So nice to hear from you. I'm Elena, your host at ${property.name}, ${property.address}, ${property.city}. You're on ${lineNumber}.${night} Tell me. What can I do for you?`;
}
