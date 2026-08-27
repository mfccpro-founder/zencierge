"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, VolumeX } from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply } from "@/lib/ask-avatar";
import { HOST_EMERGENCY_NUMBER } from "@/lib/receptionist-replies";
import { ReceptionistAvatar, type ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import { useHeygenRepeatAvatar } from "@/components/dashboard/use-heygen-repeat";

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

const PLAYBACK_START_MS = 7000;

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
  const recRef = useRef<SpeechRec | null>(null);
  const wantMicRef = useRef(false);
  const genRef = useRef(0);
  const linesRef = useRef<{ role: "guest" | "ai"; text: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const safetyRef = useRef(0);
  const playbackStartedRef = useRef(false);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const currentAudioUrlRef = useRef<string | null>(null);

  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [responding, setResponding] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [guestBubble, setGuestBubble] = useState("");
  const [aiBubble, setAiBubble] = useState("");
  const [status, setStatus] = useState("Elena responde en español desde Zencierge, no desde la base de HeyGen.");

  const speaking = heygen.speaking || ttsSpeaking;
  const phase: ReceptionistPhase = thinking || responding
    ? "thinking"
    : listening
      ? "listening"
      : speaking
        ? "speaking"
        : "idle";

  const clearSafety = () => {
    if (safetyRef.current) {
      window.clearTimeout(safetyRef.current);
      safetyRef.current = 0;
    }
  };

  const markPlaybackStarted = () => {
    playbackStartedRef.current = true;
    clearSafety();
    setResponding(false);
  };

  const stopCurrentAudio = () => {
    const audio = currentAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.src = "";
      currentAudioRef.current = null;
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current);
      currentAudioUrlRef.current = null;
    }
  };

  const goIdle = (listen: boolean) => {
    clearSafety();
    abortRef.current?.abort();
    abortRef.current = null;
    genRef.current += 1;
    playbackStartedRef.current = false;
    setThinking(false);
    setResponding(false);
    setTtsSpeaking(false);
    stopListening();
    stopCurrentAudio();
    void heygen.interrupt();
    if (listen && wantMicRef.current) startListening();
  };

  const armSafety = () => {
    clearSafety();
    playbackStartedRef.current = false;
    safetyRef.current = window.setTimeout(() => {
      if (playbackStartedRef.current) return;
      console.error("[avatar] 7s safety: playback never started — reset idle");
      wantMicRef.current = true;
      goIdle(true);
    }, PLAYBACK_START_MS);
  };

  useEffect(() => {
    return () => {
      clearSafety();
      abortRef.current?.abort();
      recRef.current?.stop();
      void heygen.stop();
      stopCurrentAudio();
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
    try {
      recognition.start();
    } catch (cause) {
      console.error("[avatar] SpeechRecognition start failed", cause);
      setListening(false);
    }
  };

  const speakBackendSpanish = async (respuestaTexto: string) => {
    const gen = genRef.current;
    stopListening();
    setResponding(true);
    setTtsSpeaking(false);
    armSafety();
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: respuestaTexto, voice: "nova" }),
      });

      if (!response.ok) throw new Error("Error en /api/tts: " + response.statusText);

      const audioBlob = await response.blob();
      if (gen !== genRef.current) return;
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      currentAudioUrlRef.current = audioUrl;

      markPlaybackStarted();
      setTtsSpeaking(true);
      setResponding(false);

      await audio.play();
      await new Promise<void>((resolve, reject) => {
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("Audio playback failed"));
      });
    } catch (cause) {
      console.error("[avatar] /api/tts failed", cause);
      throw cause;
    } finally {
      setTtsSpeaking(false);
      setResponding(false);
      stopCurrentAudio();
      if (gen === genRef.current && wantMicRef.current) {
        startListening();
      }
    }
  };

  const handleUtterance = async (raw: string) => {
    const text = raw.trim();
    if (!text || !property) return;
    stopListening();
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const gen = ++genRef.current;
    linesRef.current = [...linesRef.current, { role: "guest" as const, text }].slice(-8);
    setGuestBubble(text);
    setThinking(true);
    setResponding(true);
    armSafety();
    try {
      const reply = await askAvatarReply({
        question: text,
        property,
        properties,
        language: "es",
        emergencyNumber: HOST_EMERGENCY_NUMBER,
        history: linesRef.current,
        signal: abort.signal,
      });
      if (abort.signal.aborted || gen !== genRef.current) return;
      linesRef.current = [...linesRef.current, { role: "ai" as const, text: reply }].slice(-8);
      setAiBubble(reply);
      setThinking(false);
      await speakBackendSpanish(reply);
    } catch (cause) {
      if (abort.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError")) return;
      console.error("[avatar] reply failed", cause);
      setThinking(false);
      setResponding(false);
    } finally {
      setThinking(false);
    }
  };

  const cancelTurn = () => {
    wantMicRef.current = true;
    goIdle(true);
    setStatus("Turno cancelado. Puedes hablar ahora.");
  };

  const onTalk = async () => {
    if (thinking || responding || ttsSpeaking) {
      cancelTurn();
      return;
    }
    if (listening) {
      stopListening();
      wantMicRef.current = false;
      return;
    }
    wantMicRef.current = true;
    setStatus("Cada respuesta llama a /api/tts (voz nova) y luego se reproduce el MP3.");
    startListening();
  };

  if (!property) return null;

  return (
    <section className="rounded-3xl border border-emerald-500/25 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/20 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-emerald-400/80 font-semibold">Avatar Elena</p>
          <h3 className="text-lg font-semibold text-white mt-1">Conserje en español</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xl">
            Pregunta en español. GPT responde con la dirección de {property.name} ({property.address}, {property.city}).
            El audio sale siempre de POST /api/tts con voice nova.
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
            className={`mt-4 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold ${
              listening
                ? "bg-sky-500 text-slate-950"
                : thinking || responding || ttsSpeaking
                  ? "bg-amber-400 text-slate-950"
                  : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            }`}
          >
            <Mic className="h-4 w-4" />
            {listening
              ? "Escuchando..."
              : thinking || responding || ttsSpeaking
                ? "Elena está respondiendo... (toca para cancelar)"
                : "Hablar"}
          </button>
          <button
            type="button"
            onClick={() => {
              wantMicRef.current = false;
              goIdle(false);
              void heygen.stop();
            }}
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 py-2 text-[11px] font-semibold text-slate-300"
          >
            <VolumeX className="h-3.5 w-3.5" />
            Silenciar / cerrar sesión
          </button>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <p className="text-[11px] text-slate-500">{status}</p>
          {thinking || responding ? (
            <button
              type="button"
              onClick={cancelTurn}
              className="text-sm font-medium text-emerald-300 underline-offset-2 hover:underline"
            >
              Elena está respondiendo... (toca para cancelar)
            </button>
          ) : null}
          {guestBubble ? (
            <div className="rounded-2xl rounded-tl-sm bg-slate-800 px-3 py-2 text-sm text-slate-100">
              {guestBubble}
            </div>
          ) : null}
          {aiBubble ? (
            <div className="rounded-2xl rounded-tr-sm bg-emerald-500/15 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-50">
              {aiBubble}
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Ejemplo: «¿Hay una farmacia cerca?» — Elena usa {property.address}, {property.city}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
