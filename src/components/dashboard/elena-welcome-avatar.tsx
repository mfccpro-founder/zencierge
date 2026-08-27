"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, VolumeX } from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply } from "@/lib/ask-avatar";
import { HOST_EMERGENCY_NUMBER } from "@/lib/receptionist-replies";
import { ReceptionistAvatar, type ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import { useHeygenRepeatAvatar } from "@/components/dashboard/use-heygen-repeat";
import {
  getVoiceProfile,
  speakHumanVoice,
  stopHumanVoice,
  unlockSpeechAudio,
} from "@/lib/human-voice";

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

function getSpeechRecognitionCtor(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const extra = window as unknown as {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return extra.SpeechRecognition ?? extra.webkitSpeechRecognition ?? null;
}

export function ElenaWelcomeAvatar({ properties }: { properties: Property[] }) {
  const property = properties[0];
  const heygen = useHeygenRepeatAvatar();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recRef = useRef<SpeechRec | null>(null);
  const wantMicRef = useRef(false);
  const genRef = useRef(0);
  const unlockedRef = useRef(false);
  const linesRef = useRef<{ role: "guest" | "ai"; text: string }[]>([]);

  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [responding, setResponding] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState("Elena responde en español desde Zencierge, no desde la base de HeyGen.");

  const speaking = heygen.speaking || ttsSpeaking;
  const phase: ReceptionistPhase = thinking || responding
    ? "thinking"
    : listening
      ? "listening"
      : speaking
        ? "speaking"
        : "idle";

  useEffect(() => {
    return () => {
      recRef.current?.stop();
      void heygen.stop();
      stopHumanVoice(audioRef);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListening = () => {
    recRef.current?.stop();
    recRef.current = null;
    setListening(false);
  };

  const startListening = () => {
    stopListening();
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setStatus("Usa Chrome y permite el micrófono para hablar con Elena.");
      return;
    }
    const recognition = new Ctor();
    recRef.current = recognition;
    recognition.lang = "es-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const piece = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += piece;
      }
      if (finalText.trim()) {
        wantMicRef.current = true;
        void handleUtterance(finalText);
      }
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    setListening(true);
    recognition.start();
  };

  const speakBackendSpanish = async (text: string) => {
    const gen = genRef.current;
    stopListening();
    setResponding(true);
    const usedHeygen = await heygen.speakRepeat(text).catch((cause) => {
      console.error("[heygen] REPEAT speak failed", cause);
      return false;
    });
    if (usedHeygen) {
      setResponding(false);
      return;
    }
    if (gen !== genRef.current) return;
    await speakHumanVoice({
      text,
      profile: getVoiceProfile("elena"),
      language: "es",
      speed: 1,
      stability: 48,
      audioRef,
      shouldCancel: () => gen !== genRef.current,
      onPlaybackStart: () => {
        setResponding(false);
        setTtsSpeaking(true);
      },
      onPlaybackEnd: () => {
        setTtsSpeaking(false);
        setResponding(false);
        if (wantMicRef.current) startListening();
      },
    });
  };

  const handleUtterance = async (raw: string) => {
    const text = raw.trim();
    if (!text || !property) return;
    stopListening();
    linesRef.current = [...linesRef.current, { role: "guest" as const, text }].slice(-8);
    setCaption(text);
    setThinking(true);
    setResponding(true);
    const reply = await askAvatarReply({
      question: text,
      property,
      properties,
      language: "es",
      emergencyNumber: HOST_EMERGENCY_NUMBER,
      history: linesRef.current,
    });
    linesRef.current = [...linesRef.current, { role: "ai" as const, text: reply }].slice(-8);
    setCaption(reply);
    setThinking(false);
    await speakBackendSpanish(reply);
  };

  const onTalk = async () => {
    if (!unlockedRef.current && audioRef.current) {
      unlockSpeechAudio(audioRef.current);
      unlockedRef.current = true;
    }
    if (listening) {
      stopListening();
      wantMicRef.current = false;
      return;
    }
    wantMicRef.current = true;
    const started = await heygen.start().catch((cause) => {
      console.error("[heygen] session start failed; using /api/tts only", cause);
      return false;
    });
    setStatus(
      started
        ? "Sesión HeyGen en modo REPEAT. El texto lo escribe /api/avatar en español."
        : "HeyGen no está configurado. Vocalizo el español de /api/avatar con /api/tts (nova).",
    );
    startListening();
  };

  useEffect(() => {
    if (!heygen.speaking && wantMicRef.current && !thinking && !responding && !listening) {
      startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heygen.speaking]);

  if (!property) return null;

  return (
    <section className="rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/20 p-5 sm:p-6">
      <audio ref={audioRef} preload="auto" playsInline className="hidden" />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold">Avatar Elena</p>
          <h3 className="text-lg font-semibold text-white mt-1">Conserje en español</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Pregunta en español. GPT responde con la dirección de {property.name} ({property.address}, {property.city}).
            HeyGen solo repite ese texto (task_type: repeat). Sin knowledge base ni voz masculina.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-5">
        <div className="flex flex-col items-center">
          <div className="relative w-full aspect-[3/4] max-h-80 overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
            <video
              ref={heygen.videoRef}
              autoPlay
              playsInline
              className={`absolute inset-0 h-full w-full object-cover ${heygen.ready ? "opacity-100" : "opacity-0"}`}
            />
            {!heygen.ready ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <ReceptionistAvatar phase={phase} size="lg" name="Elena" />
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void onTalk()}
            disabled={thinking}
            className={`mt-4 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold ${
              listening ? "bg-sky-500 text-slate-950" : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            }`}
          >
            <Mic className="h-4 w-4" />
            {listening ? "Escuchando…" : responding ? "Elena está respondiendo..." : "Hablar con Elena"}
          </button>
          <button
            type="button"
            onClick={() => {
              genRef.current += 1;
              stopListening();
              stopHumanVoice(audioRef);
              void heygen.stop();
              wantMicRef.current = false;
            }}
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 py-2 text-[11px] font-semibold text-slate-300"
          >
            <VolumeX className="h-3.5 w-3.5" />
            Silenciar / cerrar sesión
          </button>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[11px] text-slate-500">{status}</p>
          {responding || thinking ? (
            <p className="mt-3 text-sm font-medium text-emerald-300">Elena está respondiendo...</p>
          ) : null}
          {caption ? <p className="mt-3 text-sm text-slate-200 leading-relaxed">{caption}</p> : (
            <p className="mt-3 text-sm text-slate-500">
              Ejemplo: «¿Hay una farmacia cerca?» — Elena usa {property.address}, {property.city}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
