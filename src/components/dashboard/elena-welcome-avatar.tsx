"use client";

import { useRef, useState, type FormEvent } from "react";
import { Mic, VolumeX } from "lucide-react";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply } from "@/lib/ask-avatar";
import { HOST_EMERGENCY_NUMBER } from "@/lib/receptionist-replies";
import { ReceptionistAvatar } from "@/components/dashboard/receptionist-avatar";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

export function ElenaWelcomeAvatar({ properties }: { properties: Property[] }) {
  const property = properties[0];
  const linesRef = useRef<{ role: "guest" | "ai"; text: string }[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [inputValue, setInputValue] = useState("");
  const [guestBubble, setGuestBubble] = useState("");
  const [aiBubble, setAiBubble] = useState("");
  const [status, setStatus] = useState("Escribe tu pregunta y pulsa Enviar. Elena responde en español.");
  const [busy, setBusy] = useState(false);

  const unlockAudio = () => {
    const unlock = new Audio(SILENT_WAV);
    unlock.volume = 1;
    void unlock.play().catch((cause) => {
      console.error("[avatar] unlock play failed", cause);
    });
  };

  const stopAudio = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.src = "";
    audioRef.current = null;
  };

  const sendQuestion = async () => {
    const text = inputValue.trim();
    if (!text || !property || busy) return;

    unlockAudio();
    setInputValue("");
    setGuestBubble(text);
    setBusy(true);
    setStatus("Elena está pensando…");
    linesRef.current = [...linesRef.current, { role: "guest" as const, text }].slice(-8);

    try {
      const reply = await askAvatarReply({
        question: text,
        property,
        properties,
        language: "es",
        emergencyNumber: HOST_EMERGENCY_NUMBER,
        history: linesRef.current,
      });
      linesRef.current = [...linesRef.current, { role: "ai" as const, text: reply }].slice(-8);
      setAiBubble(reply);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: reply, voice: "nova" }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error("Error en /api/tts:", res.status, errData);
        setStatus("No se pudo generar el audio. Revisa OPENAI_API_KEY.");
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      stopAudio();
      const sound = new Audio(url);
      sound.volume = 1;
      audioRef.current = sound;
      sound.onended = () => URL.revokeObjectURL(url);
      console.log("Intentando reproducir audio...");
      await sound.play();
      console.log("Audio reproduciéndose con éxito");
      setStatus("Elena responde en español. El audio sale de /api/tts.");
    } catch (error) {
      console.error("Fallo al reproducir audio de Elena:", error);
      setStatus("No se pudo reproducir el audio.");
    } finally {
      setBusy(false);
    }
  };

  const handleSendMessage = (event: FormEvent) => {
    event.preventDefault();
    void sendQuestion();
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
              <ReceptionistAvatar phase="idle" size="lg" name="Elena" />
            </div>
          </div>
          <button
            type="button"
            onClick={unlockAudio}
            className="relative z-10 mt-4 w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-bold pointer-events-auto bg-emerald-500 text-slate-950 hover:bg-emerald-400"
          >
            <Mic className="h-4 w-4" />
            Hablar con Elena
          </button>
          <form onSubmit={handleSendMessage} className="mt-4 flex gap-2 w-full max-w-md mx-auto">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Escribe tu pregunta para Elena..."
              className="flex-1 px-4 py-2 rounded-lg bg-slate-800 text-white border border-slate-700 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition"
            >
              Enviar
            </button>
          </form>
          <button
            type="button"
            onClick={stopAudio}
            className="mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 py-2 text-[11px] font-semibold text-slate-300"
          >
            <VolumeX className="h-3.5 w-3.5" />
            Silenciar / cerrar sesión
          </button>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
          <p className="text-[11px] text-slate-500">{status}</p>
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
