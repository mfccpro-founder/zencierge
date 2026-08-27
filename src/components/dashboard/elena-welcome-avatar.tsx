"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Send, VolumeX } from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply } from "@/lib/ask-avatar";
import { HOST_EMERGENCY_NUMBER } from "@/lib/receptionist-replies";
import { ReceptionistAvatar, type ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";

type SpeechResultList = ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string }>>;
type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onerror: ((event?: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
    webkitAudioContext?: typeof AudioContext;
  }
}

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export function ElenaWelcomeAvatar({ properties }: { properties: Property[] }) {
  const property = properties[0];
  const recognitionRef = useRef<SpeechRec | null>(null);
  const wantMicRef = useRef(false);
  const genRef = useRef(0);
  const linesRef = useRef<{ role: "guest" | "ai"; text: string }[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const silenceTimerRef = useRef(0);
  const handleUtteranceRef = useRef<(text: string) => void>(() => {});

  const [isListening, setIsListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [responding, setResponding] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [draft, setDraft] = useState("");
  const [guestBubble, setGuestBubble] = useState("");
  const [aiBubble, setAiBubble] = useState("");
  const [status, setStatus] = useState("Elena responde en español. El audio sale de /api/tts.");

  const phase: ReceptionistPhase = thinking || responding
    ? "thinking"
    : isListening
      ? "listening"
      : ttsSpeaking
        ? "speaking"
        : "idle";

  const unlockAudio = () => {
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    audio.muted = false;
    audio.volume = 1;
    audio.src = SILENT_WAV;
    void audio.play().catch((cause) => {
      console.error("[avatar] unlock play failed", cause);
    });
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) {
        const ctx = new Ctor();
        void ctx.resume();
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.05);
      }
    } catch (cause) {
      console.error("[avatar] AudioContext unlock failed", cause);
    }
  };

  const stopCurrentAudio = () => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = 0;
    }
  };

  const goIdle = () => {
    clearSilenceTimer();
    wantMicRef.current = false;
    setIsListening(false);
  };

  useEffect(() => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      console.error("SpeechRecognition no soportado en este navegador");
      return;
    }

    const recognition = new SpeechRecognitionCtor();
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
      if (!finalText.trim()) return;
      clearSilenceTimer();
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
      goIdle();
      handleUtteranceRef.current(finalText.trim());
    };
    recognition.onerror = (event?: { error?: string }) => {
      console.error("SpeechRecognition error", event?.error ?? event);
      goIdle();
    };
    recognition.onend = () => {
      goIdle();
    };
    recognitionRef.current = recognition;

    return () => {
      clearSilenceTimer();
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
      stopCurrentAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListening = () => {
    clearSilenceTimer();
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
    goIdle();
  };

  const startListening = () => {
    console.log("Botón presionado: iniciando escucha...");
    const recognition = recognitionRef.current;
    if (!recognition) {
      console.error("SpeechRecognition no soportado en este navegador");
      setStatus("Este navegador no admite el micrófono. Escribe tu pregunta abajo y pulsa Enviar.");
      goIdle();
      return;
    }
    wantMicRef.current = true;
    setIsListening(true);
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* already stopped */
      }
      goIdle();
    }, 6000);
    try {
      recognition.start();
    } catch (cause) {
      console.error("[avatar] SpeechRecognition start failed", cause);
      goIdle();
    }
  };

  const cancelTurn = () => {
    genRef.current += 1;
    stopListening();
    stopCurrentAudio();
    setThinking(false);
    setResponding(false);
    setTtsSpeaking(false);
    setStatus("Turno cancelado. Puedes hablar ahora.");
  };

  const toggleListening = () => {
    console.log("Botón presionado: iniciando escucha...");
    unlockAudio();
    if (thinking || responding || ttsSpeaking) {
      cancelTurn();
      return;
    }
    if (isListening) {
      stopListening();
      return;
    }
    startListening();
  };

  const submitTypedQuestion = () => {
    const text = draft.trim();
    if (!text) return;
    console.log("Pregunta escrita enviada:", text);
    unlockAudio();
    setDraft("");
    recognitionRef.current?.stop();
    stopListening();
    void handleUtterance(text);
  };

  const playElenaMp3 = async (respuestaTexto: string) => {
    const gen = genRef.current;
    recognitionRef.current?.stop();
    stopListening();
    setResponding(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: respuestaTexto, voice: "nova" }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("Error en /api/tts:", res.status, errData);
        return;
      }

      const blob = await res.blob();
      if (!blob.size || blob.type.includes("json")) {
        console.error("Error en /api/tts: respuesta vacía o JSON", blob.type, blob.size);
        return;
      }
      if (gen !== genRef.current) return;

      stopCurrentAudio();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.volume = 1;
      audio.src = url;

      setTtsSpeaking(true);
      setResponding(false);
      console.log("Intentando reproducir audio...");
      await audio.play();
      console.log("Audio reproduciéndose con éxito");

      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => {
          console.error("Fallo al reproducir audio de Elena:", audio.error);
          resolve();
        };
      });
    } catch (error) {
      console.error("Fallo al reproducir audio de Elena:", error);
    } finally {
      setTtsSpeaking(false);
      setResponding(false);
    }
  };

  const handleUtterance = async (raw: string) => {
    const text = raw.trim();
    if (!text || !property) return;
    recognitionRef.current?.stop();
    stopListening();
    const gen = ++genRef.current;
    linesRef.current = [...linesRef.current, { role: "guest" as const, text }].slice(-8);
    setGuestBubble(text);
    setThinking(true);
    setResponding(true);
    try {
      const reply = await askAvatarReply({
        question: text,
        property,
        properties,
        language: "es",
        emergencyNumber: HOST_EMERGENCY_NUMBER,
        history: linesRef.current,
      });
      if (gen !== genRef.current) return;
      linesRef.current = [...linesRef.current, { role: "ai" as const, text: reply }].slice(-8);
      setAiBubble(reply);
      setThinking(false);
      await playElenaMp3(reply);
    } catch (cause) {
      console.error("[avatar] reply failed", cause);
      setThinking(false);
      setResponding(false);
    }
  };
  handleUtteranceRef.current = (text) => {
    void handleUtterance(text);
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
            <div className="absolute inset-0 flex items-center justify-center">
              <ReceptionistAvatar phase={phase} size="lg" name="Elena" />
            </div>
          </div>
          <button
            type="button"
            onClick={toggleListening}
            className={`relative z-10 mt-4 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold pointer-events-auto ${
              isListening
                ? "bg-sky-500 text-slate-950"
                : thinking || responding || ttsSpeaking
                  ? "bg-amber-400 text-slate-950"
                  : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            }`}
          >
            <Mic className="h-4 w-4" />
            {isListening
              ? "Escuchando..."
              : thinking || responding || ttsSpeaking
                ? "Elena está respondiendo... (toca para cancelar)"
                : "Hablar con Elena"}
          </button>
          <form
            className="mt-2 w-full flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submitTypedQuestion();
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Escribe tu pregunta…"
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="shrink-0 rounded-xl bg-emerald-500 p-2 text-slate-950 disabled:opacity-40"
              aria-label="Enviar pregunta"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              wantMicRef.current = false;
              genRef.current += 1;
              stopListening();
              stopCurrentAudio();
              setThinking(false);
              setResponding(false);
              setTtsSpeaking(false);
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
