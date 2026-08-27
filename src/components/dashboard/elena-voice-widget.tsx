"use client";

import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";

declare global {
  interface Window {
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    SpeechRecognition?: new () => BrowserSpeechRecognition;
  }
}

interface BrowserSpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

/** Pick the best Spanish voice available in the browser (es-US → es-ES → any es). */
function pickSpanishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return (
    voices.find((v) => v.lang === "es-US") ??
    voices.find((v) => v.lang === "es-ES") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("es-"))
  );
}

export default function ElenaVoiceWidget() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("En espera");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    const loadVoices = () => {
      voiceRef.current = pickSpanishVoice(window.speechSynthesis.getVoices()) ?? null;
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      recognitionRef.current?.abort();
    };
  }, []);

  /** Native browser TTS — speaks only what we pass (the AI reply), never the raw user input. */
  const speak = (text: string) => {
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) utterance.voice = voiceRef.current;
    utterance.lang = voiceRef.current?.lang ?? "es-ES";
    setStatus("Elena hablando...");
    utterance.onstart = () => setStatus("Elena hablando...");
    utterance.onend = () => setStatus("Listo");
    utterance.onerror = () => setStatus("Listo");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  /**
   * Ask Elena for a generated response to the user's text, then speak ONLY that reply.
   * Never repeats the user's input back; on any failure speaks a neutral Elena fallback.
   */
  const getElenaReply = async (text: string): Promise<string> => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = (await res.json()) as { reply?: string };
        if (data.reply?.trim()) return data.reply.trim();
      }
    } catch {
      // Network/server errors are swallowed — no blocking, just a fallback reply.
    }
    return "Claro, soy Elena. Todo listo por aquí; dime qué necesitas y te ayudo enseguida.";
  };

  const respondTo = async (text: string) => {
    if (!text.trim()) return;
    setStatus("Pensando...");
    const reply = await getElenaReply(text);
    speak(reply);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    void respondTo(text);
  };

  const toggleMic = () => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      setStatus("En espera");
      return;
    }

    const Recognition =
      window.webkitSpeechRecognition ?? window.SpeechRecognition;
    if (!Recognition) {
      setStatus("Micrófono no soportado en este navegador");
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    recognition.lang = "es-ES";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      if (!transcript) return;
      setInput(transcript);
      setStatus(`"${transcript}"`);
      void respondTo(transcript);
    };

    recognition.onerror = () => {
      setListening(false);
      setStatus("No te he escuchado. Prueba otra vez.");
    };

    recognition.onend = () => setListening(false);

    setListening(true);
    setStatus("Escuchando...");
    recognition.start();
  };

  return (
    <div className="p-6 bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg mx-auto text-white shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Elena Asistente</h2>
        <span className="text-xs px-2 py-1 bg-emerald-900/60 text-emerald-400 border border-emerald-700 rounded-md">
          {status}
        </span>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-row items-center gap-2 w-full">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe lo que quieres que Elena diga..."
          className="flex-1 min-w-0 px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={toggleMic}
          aria-label={listening ? "Detener micrófono" : "Hablar por micrófono"}
          className={`shrink-0 flex items-center justify-center w-11 h-[42px] rounded-lg transition ${
            listening
              ? "bg-rose-600 hover:bg-rose-500 text-white"
              : "bg-slate-700 hover:bg-slate-600 text-white"
          }`}
        >
          {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          type="submit"
          className="shrink-0 px-5 py-2 bg-blue-600 hover:bg-blue-500 font-semibold rounded-lg transition"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
