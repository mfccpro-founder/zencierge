"use client";

import React, { useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import {
  isFatalTtsNetworkError,
  playOpenAiTtsMpeg,
  speakWithBrowserTts,
} from "@/lib/human-voice";

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

export default function ElenaVoiceWidget() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Ready");
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const langRef = useRef<"es" | "en">("es");
  const manualStopRef = useRef(false);

  // Short-term memory: recent turns sent to /api/chat so follow-ups keep context.
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  /** OpenAI /api/tts (nova). Browser TTS only on fatal network error, and never a male Windows voice. */
  const speak = async (text: string, lang: "es" | "en" = "es") => {
    if (!text.trim()) return;
    langRef.current = lang;
    setMuted(false);
    setStatus("Speaking...");
    audioRef.current?.pause();
    try {
      const audio = await playOpenAiTtsMpeg(text, "nova");
      audioRef.current = audio;
      audio.addEventListener("ended", () => setStatus("Ready"));
    } catch (err) {
      console.error("[elena] /api/tts failed", err);
      if (!isFatalTtsNetworkError(err)) {
        setStatus("Ready");
        return;
      }
      const started = speakWithBrowserTts({
        text,
        lang,
        onStart: () => setStatus("Speaking..."),
        onEnd: () => setStatus("Ready"),
      });
      if (!started) setStatus("Ready");
    }
  };

  /** Immediately stop any spoken audio and microphone listening. */
  const stopVoice = () => {
    audioRef.current?.pause();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    manualStopRef.current = true;
    setListening(false);
    setMuted(true);
    setStatus("Ready");
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
        body: JSON.stringify({
          message: text,
          history: historyRef.current.slice(-8),
        }),
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
    setStatus("Thinking...");
    const { reply, lang } = await getElenaReply(text);
    historyRef.current = [
      ...historyRef.current.slice(-7),
      { role: "user", content: text.trim().slice(0, 500) },
      { role: "assistant", content: reply.slice(0, 800) },
    ];
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
      setStatus("Ready");
      return;
    }

    const Recognition =
      window.webkitSpeechRecognition ?? window.SpeechRecognition;
    if (!Recognition) {
      setStatus("Mic not supported in this browser");
      return;
    }

    const recognition = new Recognition();
    recognitionRef.current = recognition;
    manualStopRef.current = false;
    // Default to Spanish (es-US) so the mic transcribes Spanish correctly without
    // mangling words. Recognition stays in Spanish; the reply language is decided
    // by /api/chat on the transcribed text.
    recognition.lang = "es-US";
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
      scheduleStop();
    };

    recognition.onerror = () => {
      setListening(false);
      setStatus("Didn't catch that. Try again.");
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
    setStatus("Listening...");
    recognition.start();
  };

  return (
    <div className="p-5 bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm mx-auto text-white shadow-xl space-y-4">
      {/* Compact header: Elena mini-avatar + title + status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative">
            <ElenaAvatar size={64} />
            {listening ? (
              <div className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-end gap-0.5 h-3">
                {Array.from({ length: 3 }, (_, index) => (
                  <span
                    key={index}
                    className="w-0.5 h-3 rounded-full bg-emerald-300"
                    style={{ animationDelay: `${index * 0.07}s` }}
                  />
                ))}
              </div>
            ) : null}
          </div>
          <div className="leading-tight min-w-0">
            <h2 className="text-lg font-bold truncate">Elena · Receptionist</h2>
            <p className="text-[11px] text-slate-500">AI Voice Concierge</p>
          </div>
        </div>
        <span className="shrink-0 text-xs px-2 py-1 bg-emerald-900/60 text-emerald-400 border border-emerald-700 rounded-md">
          {status}
        </span>
      </div>

      {/* Controls row: input + mic + send */}
      <form onSubmit={handleSubmit} className="flex flex-row items-center gap-2 w-full">
        <input
          id="elena-guest-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
        />
        <button
          type="button"
          onClick={toggleMic}
          aria-label={listening ? "Stop microphone" : "Speak into the microphone"}
          className={`shrink-0 flex items-center justify-center w-11 h-[40px] rounded-lg transition ${
            listening
              ? "bg-rose-600 hover:bg-rose-500 text-white"
              : "bg-slate-700 hover:bg-slate-600 text-white"
          }`}
        >
          {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <button
          type="submit"
          className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 font-semibold rounded-lg transition text-sm"
        >
          Send
        </button>
      </form>

      {/* Session status + wide mute button */}
      <div className="space-y-2">
        <p className="text-[11px] text-slate-500">
          {listening ? "Listening for speech..." : muted ? "Voice muted" : "Standby · no media session"}
        </p>
        <button
          type="button"
          onClick={stopVoice}
          className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 tabular text-xs font-semibold text-slate-300 hover:bg-slate-900 hover:text-white transition"
        >
          {muted ? "Stopped" : "Mute / Stop voice"}
        </button>
      </div>
    </div>
  );
}
