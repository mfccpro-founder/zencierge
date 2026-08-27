"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Phone, Play, Sparkles } from "lucide-react";
import { useListings } from "@/components/dashboard/listings-provider";
import { AiReceptionistStudio } from "@/components/dashboard/ai-receptionist-studio";
import type { ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import type { Property } from "@/lib/dashboard-data";
import { answerGuestQuestion } from "@/lib/receptionist-replies";
import {
  VOICE_PROFILES,
  getVoiceProfile,
  primeVoices,
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

type SpeechResultList = ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>>;

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const FLORIDA_LINES: Record<FloridaLine, { number: string; area: string }> = {
  "305": { number: "+1 (305) 555-0199", area: "Miami-Dade · 305" },
  "954": { number: "+1 (954) 555-0144", area: "Broward · 954" },
};

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
  const [engineLabel, setEngineLabel] = useState("Browser Neural");

  const profile = getVoiceProfile(voiceId);
  const selectedProperty =
    properties.find((property) => property.id === propertyId) ?? properties[0];
  const lineMeta = FLORIDA_LINES[floridaLine];
  const studioReady = Boolean(elevenKey.trim() || openaiKey.trim());

  const idRef = useRef(0);
  const genRef = useRef(0);
  const recRef = useRef<SpeechRec | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const callActiveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speedRef = useRef(0.85);

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
    primeVoices();
    const storedEleven = window.localStorage.getItem("zencierge.elevenlabsKey") ?? "";
    const storedOpenAi = window.localStorage.getItem("zencierge.openaiTtsKey") ?? "";
    if (storedEleven) setElevenKey(storedEleven);
    if (storedOpenAi) setOpenaiKey(storedOpenAi);
  }, []);

  useEffect(() => {
    return () => {
      recRef.current?.stop();
      stopHumanVoice(audioRef);
    };
  }, []);

  useEffect(() => {
    if (properties.length > 0 && !properties.some((item) => item.id === propertyId)) {
      setPropertyId(properties[0].id);
    }
  }, [properties, propertyId]);

  if (!selectedProperty) {
    return (
      <p className="text-sm text-slate-400">
        Add a property first so the concierge can use door codes and Wi-Fi.
      </p>
    );
  }

  const phase: ReceptionistPhase = thinking
    ? "thinking"
    : listening
      ? "listening"
      : speaking
        ? "speaking"
        : "idle";

  const persistKeys = (eleven: string, openai: string) => {
    window.localStorage.setItem("zencierge.elevenlabsKey", eleven);
    window.localStorage.setItem("zencierge.openaiTtsKey", openai);
  };

  const stopListening = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  };

  const cancelSpeech = () => {
    genRef.current += 1;
    stopHumanVoice(audioRef);
    setSpeaking(false);
    setPreviewing(null);
    setPartialAi("");
  };

  const endCall = () => {
    stopListening();
    cancelSpeech();
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
    if (audioRef.current) {
      audioRef.current.playbackRate = value;
    }
  };

  const speak = async (text: string, forProfile = profile) => {
    const gen = genRef.current;
    await speakHumanVoice({
      text,
      profile: forProfile,
      language,
      speed: speedRef.current,
      stability,
      elevenKey,
      openaiKey,
      audioRef,
      shouldCancel: () => gen !== genRef.current,
      onEngine: (engine) => {
        setEngineLabel(
          engine === "elevenlabs"
            ? "Studio · ElevenLabs"
            : engine === "openai"
              ? "Studio · OpenAI HD"
              : "Browser Neural",
        );
      },
    });
  };

  const streamReply = async (text: string) => {
    const gen = ++genRef.current;
    setPartialAi(text);
    setSpeaking(true);

    const audio = speak(text);

    const step = Math.max(2, Math.round(4 * speedRef.current));
    for (let i = 0; i <= text.length; i += step) {
      if (gen !== genRef.current) return;
      setPartialAi(text.slice(0, Math.min(i, text.length)));
    }
    if (gen !== genRef.current) return;
    setPartialAi("");
    setLines((current) => [...current, { id: nextId(), speaker: "ai", text }]);
    await audio;
    if (gen !== genRef.current) return;
    setSpeaking(false);
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
    if (!text) return;
    ensureVoiceSession();
    callActiveRef.current = true;
    stopListening();
    setPartialGuest("");
    setDraft("");
    setLines((current) => [...current, { id: nextId(), speaker: "guest", text }]);

    const reply = answerGuestQuestion({
      question: text,
      properties,
      fallback: selectedProperty,
      language,
      hours,
      emergencyNumber,
    });
    setThinking(true);
    const started = performance.now();
    window.setTimeout(() => {
      if (!callActiveRef.current) {
        setThinking(false);
        return;
      }
      setLatencyMs(Math.round(performance.now() - started));
      setThinking(false);
      void streamReply(reply);
    }, 420);
  };

  const startCall = () => {
    unlockSpeechAudio();
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
    unlockSpeechAudio();
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
    unlockSpeechAudio();
    if (listening) {
      const leftover = partialGuest.trim();
      stopListening();
      setPartialGuest("");
      if (leftover) handleGuestUtterance(leftover);
      return;
    }

    if (speaking) cancelSpeech();
    ensureVoiceSession();
    callActiveRef.current = true;

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setLines((current) => [
        ...current,
        {
          id: nextId(),
          speaker: "system",
          text: "Live mic is not available in this browser. Use Chrome and allow the microphone, or type a question.",
        },
      ]);
      return;
    }

    const recognition = new Ctor();
    recognition.lang = language === "es" ? "es-US" : language === "en" ? "en-US" : "es-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const piece = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += piece;
        else interim += piece;
      }
      if (interim) setPartialGuest(interim);
      if (finalText.trim()) {
        setPartialGuest("");
        handleGuestUtterance(finalText);
      }
    };
    recognition.onerror = () => {
      setListening(false);
      setPartialGuest("");
    };
    recognition.onend = () => {
      setListening(false);
    };
    recRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
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

      <div id="ai-receptionist">
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
          streamReady={streamReady}
          connectionLabel={
            streamReady ? "WebRTC / Audio stream ready" : "Standby · no media session"
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
          speaking={speaking}
          transcriptRef={scrollRef}
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
                Add an ElevenLabs or OpenAI TTS HD key for studio-grade audio. Without a key, the
                simulator uses only Natural / Google / Microsoft Neural voices installed on this
                device — never the default robotic ones.
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
                  ? "Studio audio enabled. Previews and test calls will use HD TTS first."
                  : "No studio key yet — Neural browser fallback is active."}
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

function getSpeechRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const extra = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return extra.SpeechRecognition ?? extra.webkitSpeechRecognition ?? null;
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
      ? `Buenas noches. Soy Mateo, concierge de ${property.name}. Qué gusto atenderle. Está usted en la ${lineNumber}.${night} Deme un momento. ¿En qué puedo servirle?`
      : `Good evening. This is Mateo, concierge for ${property.name}. A pleasure to greet you on ${lineNumber}.${night} Take your time. How may I help?`;
  }

  if (profile.id === "sarah") {
    return lang === "es"
      ? `Hola. Soy Sarah, tu host en ${property.name}. Qué bueno que llamas. Estás en la ${lineNumber}.${night} Dime, ¿qué necesitas?`
      : `Hey. I'm Sarah, your host at ${property.name}. So glad you called. You're on ${lineNumber}.${night} What's going on? I'm here.`;
  }

  return lang === "es"
    ? `Hola. Qué gusto escucharte. Soy Elena, tu anfitriona de ${property.name}, aquí en Florida. Llamas al ${lineNumber}.${night} Cuéntame. ¿En qué te ayudo hoy?`
    : `Hi there. So nice to hear from you. I'm Elena, your host at ${property.name}, here in Florida. You're on ${lineNumber}.${night} Tell me. What can I do for you?`;
}
