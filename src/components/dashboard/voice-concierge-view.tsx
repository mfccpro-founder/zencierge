"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Mic, MicOff, Phone, PhoneOff, Play, Send, Sparkles } from "lucide-react";
import { properties, type Property } from "@/lib/dashboard-data";
import {
  VOICE_PROFILES,
  detectReplyLang,
  getVoiceProfile,
  primeVoices,
  speakHumanVoice,
  stopHumanVoice,
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

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const FLORIDA_LINES: Record<FloridaLine, { number: string; area: string }> = {
  "305": { number: "+1 (305) 555-0199", area: "Miami-Dade · 305" },
  "954": { number: "+1 (954) 555-0144", area: "Broward · 954" },
};

const QUICK_PROMPTS = [
  "¿Cuál es la clave del Wi-Fi de Miami Beach?",
  "¿Dónde me estaciono?",
  "What's the door code for Brickell?",
  "There's a water leak in the bathroom",
];

const inputClass =
  "w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none";

export function VoiceConciergeView() {
  const [voiceId, setVoiceId] = useState<VoiceProfileId>("elena");
  const [language, setLanguage] = useState<LanguageMode>("auto");
  const [speed, setSpeed] = useState(1.05);
  const [stability, setStability] = useState(68);
  const [floridaLine, setFloridaLine] = useState<FloridaLine>("305");
  const [emergencyNumber, setEmergencyNumber] = useState("+1 (954) 275-3544");
  const [hours, setHours] = useState<HoursMode>("always");
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "prop-1");
  const [callActive, setCallActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<SimLine[]>([]);
  const [partialAi, setPartialAi] = useState("");
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
  const speedRef = useRef(1.05);

  const nextId = () => {
    idRef.current += 1;
    return `sim-${idRef.current}`;
  };

  useEffect(() => {
    callActiveRef.current = callActive;
  }, [callActive]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, partialAi]);

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
    setCallActive(false);
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
    setSpeaking(true);
    setPartialAi(text);

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

  const startCall = () => {
    const greeting = buildGreeting({
      profile,
      language,
      hours,
      property: selectedProperty,
      lineNumber: lineMeta.number,
    });
    setCallActive(true);
    setLines([
      {
        id: nextId(),
        speaker: "system",
        text: `Connected · ${lineMeta.number} · ${selectedProperty.name} · ${profile.name}`,
      },
    ]);
    void streamReply(greeting);
  };

  const handleGuestUtterance = (raw: string) => {
    const text = raw.trim();
    if (!text || !callActiveRef.current) return;
    stopListening();
    setDraft("");
    setLines((current) => [...current, { id: nextId(), speaker: "guest", text }]);

    const reply = answerGuestQuestion({
      question: text,
      properties,
      fallback: selectedProperty,
      profile,
      language,
      hours,
      emergencyNumber,
    });
    void streamReply(reply);
  };

  const playPreview = async (item: VoiceProfile) => {
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
    if (!callActive) return;
    if (listening) {
      stopListening();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setLines((current) => [
        ...current,
        {
          id: nextId(),
          speaker: "system",
          text: "Live mic is not available in this browser. Type a question or use a suggested prompt.",
        },
      ]);
      return;
    }

    const recognition = new Ctor();
    recognition.lang = language === "es" ? "es-US" : language === "en" ? "en-US" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript ?? "";
      if (transcript) handleGuestUtterance(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
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
          Human voice profiles, Florida routing, and a live call simulator grounded in your property
          handbooks.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
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
                min={0.9}
                max={1.3}
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

        <aside className="xl:col-span-1">
          <div className="rounded-[2rem] border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-4 shadow-xl shadow-emerald-500/5">
            <div className="mx-auto mb-3 h-5 w-24 rounded-full bg-slate-950 border border-slate-800" />

            <div className="flex items-center justify-between px-1 mb-3">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                  Live Voice Tester
                </p>
                <p className="text-xs font-mono text-slate-300 mt-0.5">{lineMeta.number}</p>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                  callActive
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-slate-700 bg-slate-800 text-slate-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${callActive ? "bg-emerald-400 live-dot" : "bg-slate-500"}`}
                />
                {callActive ? (speaking ? "Speaking" : listening ? "Listening" : "Live") : "Idle"}
              </span>
            </div>

            <label className="text-[10px] font-medium text-slate-500 block mb-1.5 px-1">
              Grounding property
            </label>
            <select
              value={selectedProperty.id}
              onChange={(event) => setPropertyId(event.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none mb-3"
            >
              {properties.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/80 overflow-hidden">
              <div ref={scrollRef} className="h-64 overflow-y-auto p-3 space-y-2">
                {lines.length === 0 && !callActive ? (
                  <p className="text-xs text-slate-500 text-center pt-16 px-4">
                    Preview a human voice, then start a test call. Replies stay warm and use live
                    property codes.
                  </p>
                ) : null}
                {lines.map((line) => (
                  <TranscriptBubble key={line.id} line={line} />
                ))}
                {partialAi ? (
                  <TranscriptBubble
                    line={{ id: "partial", speaker: "ai", text: partialAi }}
                    live
                  />
                ) : null}
              </div>

              {speaking ? (
                <div className="flex items-end justify-center gap-1 h-8 pb-2">
                  {Array.from({ length: 7 }, (_, index) => (
                    <span
                      key={index}
                      className="voice-bar w-1 rounded-full bg-emerald-400/80"
                      style={{ animationDelay: `${index * 0.08}s` }}
                    />
                  ))}
                </div>
              ) : null}

              <form
                className="border-t border-slate-800 p-2 flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleGuestUtterance(draft);
                }}
              >
                <button
                  type="button"
                  onClick={toggleListen}
                  disabled={!callActive}
                  className={`shrink-0 rounded-xl p-2 border transition-colors disabled:opacity-40 ${
                    listening
                      ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                      : "bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800"
                  }`}
                  aria-label={listening ? "Stop listening" : "Speak a question"}
                >
                  {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </button>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={!callActive || speaking}
                  placeholder={callActive ? "Ask as a guest…" : "Start a test call first"}
                  className="flex-1 bg-transparent text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={!callActive || speaking || !draft.trim()}
                  className="shrink-0 rounded-xl p-2 bg-emerald-500 text-slate-950 disabled:opacity-40"
                  aria-label="Send question"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={!callActive || speaking}
                  onClick={() => handleGuestUtterance(prompt)}
                  className="rounded-full border border-slate-800 bg-slate-900 px-2.5 py-1 text-[10px] text-slate-400 hover:text-slate-200 hover:border-slate-700 disabled:opacity-40"
                >
                  {prompt}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={callActive ? endCall : startCall}
              className={`mt-4 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold transition-all ${
                callActive
                  ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                  : "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
              }`}
            >
              {callActive ? (
                <>
                  <PhoneOff className="h-4 w-4" /> End Test Call
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4" /> Start Test Call
                </>
              )}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TranscriptBubble({ line, live = false }: { line: SimLine; live?: boolean }) {
  if (line.speaker === "system") {
    return (
      <p className="text-[10px] text-center text-slate-500 uppercase tracking-wide">{line.text}</p>
    );
  }

  const guest = line.speaker === "guest";
  return (
    <div className={`flex ${guest ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
          guest
            ? "bg-slate-800 text-slate-100 rounded-br-md"
            : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-50 rounded-bl-md"
        }`}
      >
        <p className="text-[10px] font-semibold mb-0.5 opacity-70">
          {guest ? "Guest" : "Zencierge"}
          {live ? " · playing" : ""}
        </p>
        {line.text}
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

function matchProperty(question: string, listings: Property[], fallback: Property): Property {
  const lower = question.toLowerCase();
  const hit = listings.find(
    (property) =>
      lower.includes(property.name.toLowerCase()) ||
      lower.includes(property.city.toLowerCase()) ||
      (property.city === "Miami Beach" && lower.includes("miami")) ||
      (property.city === "Fort Lauderdale" &&
        (lower.includes("lauderdale") || lower.includes("fort lauderdale"))),
  );
  return hit ?? fallback;
}

function isEmergency(question: string) {
  return /\b(leak|fuga|inund|flood|locked out|cerradura|broken lock|lock broken|water leak)\b/i.test(
    question,
  );
}

function isWifi(question: string) {
  return /\b(wifi|wi-fi|clave|password|contraseña|contrasena|network|red)\b/i.test(question);
}

function isParking(question: string) {
  return /\b(park|estacion|parking|garage|gate|portón|porton)\b/i.test(question);
}

function isDoor(question: string) {
  return /\b(door|codigo|código|code|smartlock|lock|keypad|puerta)\b/i.test(question);
}

function isCheck(question: string) {
  return /\b(check-?in|check-?out|entrada|salida|late)\b/i.test(question);
}

function nightNote(hours: HoursMode, lang: ReplyLang) {
  if (hours !== "night") return "";
  return lang === "es"
    ? " Por cierto, estás en la línea nocturna, así que aquí estoy con calma, a cualquier hora."
    : " And just so you know, this is the overnight line — I'm here, unhurried, whenever you need me.";
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
      ? `Buenas noches… soy Mateo, concierge de ${property.name}. Qué gusto atenderle. Está usted en la ${lineNumber}.${night} Deme un momento… ¿en qué puedo servirle?`
      : `Good evening… this is Mateo, concierge for ${property.name}. A pleasure to greet you on ${lineNumber}.${night} Take your time — how may I help?`;
  }

  if (profile.id === "sarah") {
    return lang === "es"
      ? `¡Hola! Soy Sarah, tu host en ${property.name}. Qué bueno que llamas. Estás en la ${lineNumber}.${night} Dime, ¿qué necesitas?`
      : `Hey! I'm Sarah, your host at ${property.name}. So glad you called — you're on ${lineNumber}.${night} What's going on? I'm here.`;
  }

  return lang === "es"
    ? `¡Hola! Qué gusto escucharte. Soy Elena, tu anfitriona de ${property.name} aquí en Florida. Llamas al ${lineNumber}.${night} Cuéntame… ¿en qué te ayudo hoy?`
    : `Hi there! So nice to hear from you. I'm Elena, your host at ${property.name} here in Florida. You're on ${lineNumber}.${night} Tell me… what can I do for you?`;
}

function answerGuestQuestion({
  question,
  properties: listings,
  fallback,
  profile,
  language,
  hours,
  emergencyNumber,
}: {
  question: string;
  properties: Property[];
  fallback: Property;
  profile: VoiceProfile;
  language: LanguageMode;
  hours: HoursMode;
  emergencyNumber: string;
}) {
  const lang = detectReplyLang(question, language);
  const property = matchProperty(question, listings, fallback);
  const night = nightNote(hours, lang);
  const name = property.name;

  if (isEmergency(question)) {
    if (lang === "es") {
      return `Ay, lo siento mucho… eso sí hay que atenderlo ya. No te preocupes, no estás solo. Voy a transferirte ahora mismo con el anfitrión al ${emergencyNumber}. Por favor no fuerces la cerradura ni toques tuberías, ¿sí? Quédate cerca del teléfono.${night}`;
    }
    return `Oh no — I'm really sorry you're dealing with that. Let's get you help right away. I'm transferring you to the host at ${emergencyNumber} now. Please don't force the lock or touch any plumbing, okay? Stay close to the phone.${night}`;
  }

  if (isWifi(question)) {
    if (lang === "es") {
      return `¡Hola! Claro que sí, con mucho gusto te paso la clave del Wi-Fi de ${name}. La red se llama ${property.wifiNetwork}… y la contraseña es ${property.wifiPassword}. Si se te olvida, también está en la tarjetita del cajón de la entrada. ¿Te conectas bien o te ayudo con algo más?${night}`;
    }
    return `Hi! Of course — I'd be happy to get you on Wi-Fi at ${name}. The network is ${property.wifiNetwork}… and the password is ${property.wifiPassword}. There's a little card in the entry drawer too, just in case. Want me to stay on while you connect?${night}`;
  }

  if (isParking(question)) {
    const gate =
      property.gateCode && property.gateCode !== "—"
        ? lang === "es"
          ? ` El código del portón es ${property.gateCode}… dáselo despacio si vas manejando.`
          : ` The gate code is ${property.gateCode}… take it slow if you're driving.`
        : "";
    if (lang === "es") {
      return `Sin problema, yo te oriento. En ${name} el estacionamiento es así: ${property.parking}.${gate} Si no ves el espacio, llámame otra vez y lo vemos juntos, ¿vale?${night}`;
    }
    return `Absolutely — let's get you parked. At ${name}: ${property.parking}.${gate} If you don't see the spot, call me back and we'll walk through it together, okay?${night}`;
  }

  if (isDoor(question)) {
    if (lang === "es") {
      return `Claro, con calma. El código de la puerta de ${name} es ${property.doorCode}. Es ${property.smartlock}. El check-in es ${property.checkIn}. Si la cerradura parpadea, espera un segundo y vuelve a intentarlo… a veces es solo el sensor.${night}`;
    }
    return `Of course. The door code for ${name} is ${property.doorCode}. That's the ${property.smartlock}. Check-in is ${property.checkIn}. If the lock blinks, wait a beat and try again — it happens.${night}`;
  }

  if (isCheck(question)) {
    if (lang === "es") {
      return `Con gusto te lo aclaro. En ${name} el check-in es ${property.checkIn}, y el check-out ${property.checkOut}. Si necesitas algo más flexible, lo anoto con el anfitrión, ¿te parece?${night}`;
    }
    return `Happy to clarify. At ${name}, check-in is ${property.checkIn}, and check-out is ${property.checkOut}. If you need something more flexible, I'll note it for the host — sound good?${night}`;
  }

  if (lang === "es") {
    return `Mmm, déjame pensarlo un segundo… en ${name} esto es lo que suelo decirles a los huéspedes: ${property.handbook} Si quieres, te lo explico más despacio. ¿Qué más te ronda?${night}`;
  }
  return `Let me think for a second… at ${name}, here's what I usually share with guests: ${property.handbook} I can slow that down if you want. What else is on your mind?${night}`;
}
