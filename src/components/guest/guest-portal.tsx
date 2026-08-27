"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  MapPin,
  Mic,
  VolumeX,
  Wifi,
  ShoppingBag,
} from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import { ReceptionistAvatar, type ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import { groceryFromHandbook } from "@/lib/receptionist-intent";
import { answerGuestQuestion, HOST_EMERGENCY_NUMBER } from "@/lib/receptionist-replies";
import {
  getVoiceProfile,
  primeVoices,
  speakWithSpeechSynthesis,
  stopHumanVoice,
} from "@/lib/human-voice";
import { fetchPropertyById } from "@/lib/supabase-listings";

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

type Line = { id: string; speaker: "guest" | "ai" | "system"; text: string };

function getSpeechRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const extra = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return extra.SpeechRecognition ?? extra.webkitSpeechRecognition ?? null;
}

export function GuestPortal({ propertyId }: { propertyId: string }) {
  const [property, setProperty] = useState<Property | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [partialGuest, setPartialGuest] = useState("");
  const [copied, setCopied] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const profile = getVoiceProfile("elena");
  const recRef = useRef<SpeechRec | null>(null);
  const genRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const propertyRef = useRef<Property | null>(null);

  const nextId = () => {
    idRef.current += 1;
    return `g-${idRef.current}`;
  };

  useEffect(() => {
    propertyRef.current = property;
  }, [property]);

  useEffect(() => {
    primeVoices();
    let cancelled = false;
    void (async () => {
      try {
        const row = await fetchPropertyById(propertyId);
        if (!cancelled) {
          setProperty(row);
          setLoadError(row ? null : "We couldn't find this stay.");
        }
      } catch (cause) {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : "Could not load this stay.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      recRef.current?.stop();
      stopHumanVoice(audioRef);
    };
  }, [propertyId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, partialGuest]);

  const phase: ReceptionistPhase = thinking
    ? "thinking"
    : listening
      ? "listening"
      : speaking
        ? "speaking"
        : "idle";

  const stopListening = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  };

  const stopSpeech = () => {
    genRef.current += 1;
    stopHumanVoice(audioRef);
    setSpeaking(false);
  };

  const speakReply = async (text: string) => {
    const gen = ++genRef.current;
    setLines((current) => [...current, { id: nextId(), speaker: "ai", text }]);
    await speakWithSpeechSynthesis({
      text,
      profile,
      language: "auto",
      speed: 0.85,
      shouldCancel: () => gen !== genRef.current,
      onStart: () => {
        if (gen === genRef.current) setSpeaking(true);
      },
    });
    if (gen === genRef.current) setSpeaking(false);
  };

  const handleGuestUtterance = (raw: string) => {
    const stay = propertyRef.current;
    const text = raw.trim();
    if (!text || !stay) return;
    stopListening();
    setPartialGuest("");
    setLines((current) => [...current, { id: nextId(), speaker: "guest", text }]);
    const reply = answerGuestQuestion({
      question: text,
      properties: [stay],
      fallback: stay,
      language: "auto",
      emergencyNumber: HOST_EMERGENCY_NUMBER,
    });
    setThinking(true);
    window.setTimeout(() => {
      setThinking(false);
      void speakReply(reply);
    }, 380);
  };

  const toggleTalk = () => {
    if (listening) {
      const leftover = partialGuest.trim();
      stopListening();
      setPartialGuest("");
      if (leftover) handleGuestUtterance(leftover);
      return;
    }
    if (speaking) stopSpeech();
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setLines((current) => [
        ...current,
        {
          id: nextId(),
          speaker: "system",
          text: "Microphone isn't available. Use Chrome and allow the mic, or type below.",
        },
      ]);
      return;
    }
    const recognition = new Ctor();
    recognition.lang = "es-US";
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
    recognition.onend = () => setListening(false);
    recRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const copyWifi = async (stay: Property) => {
    const payload = `${stay.wifiNetwork} · ${stay.wifiPassword}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      window.alert(payload);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07080c] text-slate-300 flex items-center justify-center px-6">
        <p className="text-sm">Preparing your stay…</p>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-[#07080c] text-slate-300 flex items-center justify-center px-6 text-center">
        <p className="text-sm">{loadError ?? "Stay not found."}</p>
      </div>
    );
  }

  const grocery = groceryFromHandbook(property, "es");
  const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(property.address || property.name)}`;
  const tel = HOST_EMERGENCY_NUMBER.replace(/[^\d+]/g, "");

  return (
    <div className="min-h-screen bg-[#07080c] text-slate-100">
      <div className="mx-auto max-w-md px-5 pt-10 pb-16">
        <p className="text-[10px] uppercase tracking-[0.28em] text-emerald-400/80 font-semibold">
          Zencierge · Guest
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">{property.name}</h1>
        <p className="mt-2 text-sm text-slate-400 leading-relaxed">
          Welcome. Elena is your concierge for this stay in {property.city}. Ask about Wi-Fi,
          Publix, parking, or check-in — in English or Spanish.
        </p>

        <section className="mt-8 rounded-[2rem] border border-emerald-500/20 bg-gradient-to-b from-slate-900/90 to-slate-950 p-6 shadow-[0_0_60px_rgb(16_185_129_/_0.12)]">
          <ReceptionistAvatar phase={phase} size="lg" name="Elena" />
          <button
            type="button"
            onClick={toggleTalk}
            disabled={thinking}
            className={`mt-5 w-full rounded-2xl py-3.5 text-sm font-bold transition-all ${
              listening
                ? "bg-sky-400 text-slate-950 shadow-lg shadow-sky-500/20"
                : "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/25 hover:bg-emerald-400"
            }`}
          >
            <span className="inline-flex items-center justify-center gap-2">
              <Mic className="h-4 w-4" />
              {listening ? "Escuchando…" : "Hablar con tu Conserje"}
            </span>
          </button>
          <button
            type="button"
            onClick={stopSpeech}
            disabled={!speaking}
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 py-2 text-[11px] font-semibold text-slate-400 disabled:opacity-40"
          >
            <VolumeX className="h-3.5 w-3.5" />
            Silenciar
          </button>

          <div ref={scrollRef} className="mt-4 max-h-44 overflow-y-auto space-y-2">
            {lines.length === 0 && !partialGuest ? (
              <p className="text-[11px] text-slate-500 text-center px-4">
                Tap the button and ask anything about your stay.
              </p>
            ) : null}
            {lines.map((line) => (
              <p
                key={line.id}
                className={`text-xs leading-relaxed ${
                  line.speaker === "guest"
                    ? "text-right text-slate-200"
                    : line.speaker === "ai"
                      ? "text-emerald-100/90"
                      : "text-center text-slate-500"
                }`}
              >
                {line.speaker === "guest" ? "You · " : line.speaker === "ai" ? "Elena · " : ""}
                {line.text}
              </p>
            ))}
            {partialGuest ? (
              <p className="text-xs text-right text-sky-300/80">You · {partialGuest}</p>
            ) : null}
          </div>
        </section>

        <div className="mt-6 grid grid-cols-1 gap-3">
          <button
            type="button"
            onClick={() => void copyWifi(property)}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left hover:border-emerald-500/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
              <Wifi className="h-4 w-4" />
              Copiar clave de Wi-Fi
            </div>
            <p className="mt-2 text-sm text-slate-200">
              {property.wifiNetwork} · {copied ? "Copied" : property.wifiPassword}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 inline-flex items-center gap-1">
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              One tap copies network and password
            </p>
          </button>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-semibold">
              <Clock className="h-4 w-4" />
              Check-in / Check-out
            </div>
            <p className="mt-2 text-sm text-slate-200">In {property.checkIn}</p>
            <p className="text-sm text-slate-200">Out {property.checkOut}</p>
          </div>

          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 hover:border-sky-500/30 transition-colors"
          >
            <div className="flex items-center gap-2 text-sky-300 text-xs font-semibold">
              <MapPin className="h-4 w-4" />
              Ubicación
            </div>
            <p className="mt-2 text-sm text-slate-200">{property.address}</p>
            <div className="mt-3 flex items-start gap-2 text-slate-400">
              <ShoppingBag className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs leading-relaxed">{grocery}</p>
            </div>
          </a>

          <button
            type="button"
            onClick={() => setReportOpen(true)}
            className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-left"
          >
            <div className="flex items-center gap-2 text-rose-300 text-xs font-semibold">
              <AlertTriangle className="h-4 w-4" />
              Reportar un problema / Contactar anfitrión
            </div>
            <p className="mt-2 text-xs text-rose-100/70">Leaks, lockouts, and urgent issues.</p>
          </button>
        </div>
      </div>

      {reportOpen ? (
        <div
          className="fixed inset-0 z-40 bg-slate-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          role="presentation"
          onClick={() => setReportOpen(false)}
        >
          <div
            role="dialog"
            className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-950 p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-base font-semibold text-white">Host line</h2>
            <p className="mt-2 text-sm text-slate-400">
              For emergencies Elena can also transfer you. Call the host directly if you prefer.
            </p>
            <a
              href={`tel:${tel}`}
              className="mt-4 flex w-full items-center justify-center rounded-2xl bg-emerald-500 py-3 text-sm font-bold text-slate-950"
            >
              Call {HOST_EMERGENCY_NUMBER}
            </a>
            <button
              type="button"
              onClick={() => setReportOpen(false)}
              className="mt-2 w-full py-2 text-xs text-slate-500"
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
