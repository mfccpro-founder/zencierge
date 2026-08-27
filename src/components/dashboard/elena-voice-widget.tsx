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

/** Pick the best browser voice for a language: es-US → es-ES → any es; en-US → en-GB → any en. */
function pickVoice(
  lang: "es" | "en",
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  if (lang === "es") {
    return (
      voices.find((v) => v.lang === "es-US") ??
      voices.find((v) => v.lang === "es-ES") ??
      voices.find((v) => v.lang.toLowerCase().startsWith("es-"))
    );
  }
  return (
    voices.find((v) => v.lang === "en-US") ??
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en-"))
  );
}

export default function ElenaVoiceWidget() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("En espera");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const langRef = useRef<"es" | "en">("es");
  const manualStopRef = useRef(false);

  useEffect(() => {
    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      recognitionRef.current?.abort();
    };
  }, []);

  /** Native browser TTS — speaks a reply in the matching language, never the raw user input. */
  const speak = (text: string, lang: "es" | "en" = "es") => {
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = voicesRef.current.length
      ? voicesRef.current
      : window.speechSynthesis.getVoices();
    const voice = pickVoice(lang, voices);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang ?? (lang === "es" ? "es-ES" : "en-US");
    langRef.current = lang;
    setStatus(lang === "es" ? "Elena habla... (ES)" : "Elena speaking... (EN)");
    utterance.onstart = () => setStatus(lang === "es" ? "Elena habla... (ES)" : "Elena speaking... (EN)");
    utterance.onend = () => setStatus("Listo");
    utterance.onerror = () => setStatus("Listo");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  /**
   * Ask Elena for a generated response to the user's text, then speak ONLY that reply.
   * Returns the reply plus the language Elena answered in so the right voice is used.
   * Never repeats the user's input back; on any failure speaks a neutral ES fallback.
   */
  const getElenaReply = async (
    text: string,
  ): Promise<{ reply: string; lang: "en" | "es" }> => {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (res.ok) {
        const data = (await res.json()) as { reply?: string; lang?: "en" | "es" };
        if (data.reply?.trim()) {
          return { reply: data.reply.trim(), lang: data.lang === "en" ? "en" : "es" };
        }
      }
    } catch {
      // Network/server errors are swallowed — no blocking, just a fallback reply.
    }
    return {
      reply: "Claro, soy Elena. Todo listo por aquí; dime qué necesitas y te ayudo enseguida.",
      lang: "es",
    };
  };

  const respondTo = async (text: string) => {
    if (!text.trim()) return;
    setStatus("Pensando...");
    const { reply, lang } = await getElenaReply(text);
    speak(reply, lang);
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
      manualStopRef.current = true;
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
    manualStopRef.current = false;
    // Sync recognition language with the language Elena last replied in (es-ES or
    // en-US). Browsers don't offer true multi-language auto-detect in one session,
    // so continuous mode + language sync lets the mic capture both over time.
    recognition.lang = langRef.current === "en" ? "en-US" : "es-ES";
    recognition.continuous = true;
    recognition.interimResults = true;

    let accumulated = "";
    let silenceTimer: number | undefined;

    const scheduleStop = () => {
      if (silenceTimer) window.clearTimeout(silenceTimer);
      silenceTimer = window.setTimeout(() => recognition.stop(), 1800);
    };

    recognition.onresult = (event) => {
      const phrase = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      if (!phrase) return;
      accumulated = phrase;
      setInput(phrase);
      setStatus(`"${phrase}"`);
      scheduleStop();
    };

    recognition.onerror = () => {
      setListening(false);
      setStatus("No te he escuchado. Prueba otra vez.");
    };

    recognition.onend = () => {
      if (silenceTimer) window.clearTimeout(silenceTimer);
      const wasManual = manualStopRef.current;
      manualStopRef.current = false;
      setListening(false);
      if (!wasManual && accumulated.trim()) {
        void respondTo(accumulated.trim());
      }
    };

    setListening(true);
    setStatus(`Escuchando... (${langRef.current === "en" ? "EN" : "ES"})`);
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
