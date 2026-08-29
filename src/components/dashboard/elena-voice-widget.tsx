"use client";

import React, { useRef, useState } from "react";
import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import {
  detectReplyLang,
  detectUtteranceLang,
  speakWithBrowserTts,
  unlockSpeechAudio,
} from "@/lib/human-voice";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply } from "@/lib/ask-avatar";
import { HOST_EMERGENCY_NUMBER } from "@/lib/receptionist-replies";
import {
  ElenaCaptureBanner,
  ElenaCaptureMic,
  ElenaCaptureProvider,
  ElenaCaptureStatus,
} from "@/components/dashboard/elena-talk-controls";

export default function ElenaVoiceWidget({ property }: { property?: Property }) {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Ready");
  const [muted, setMuted] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [guestHeard, setGuestHeard] = useState("");
  const [audioPending, setAudioPending] = useState(false);
  const [isAudioReadyToPlay, setIsAudioReadyToPlay] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const langRef = useRef<"es" | "en">("es");
  const unlockedRef = useRef(false);
  const stopCaptureRef = useRef<(() => void) | null>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const languageHintRef = useRef<"es" | "en">("es");

  const unlockAudio = () => {
    const audio = unlockSpeechAudio(audioRef.current);
    if (audio) {
      audioRef.current = audio;
      void audio.play().catch(() => {});
      audio.pause();
    }
    unlockedRef.current = true;
  };

  const speakViaBrowser = (text: string, lang: "es" | "en") => {
    const started = speakWithBrowserTts({
      text,
      lang,
      onStart: () => setStatus("Speaking..."),
      onEnd: () => setStatus("Ready"),
    });
    if (!started) setStatus("Ready");
    return started;
  };

  const speak = async (text: string, lang: "es" | "en" = "es") => {
    if (!text.trim()) return;
    langRef.current = lang;
    setMuted(false);
    setAudioPending(false);
    setIsAudioReadyToPlay(false);
    setStatus("Speaking...");
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    if (speakViaBrowser(text, detectUtteranceLang(text))) return;
    setStatus("Voice unavailable — reply shown below.");
  };

  const stopVoice = () => {
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      /* ignore */
    }
    stopCaptureRef.current?.();
    setMuted(true);
    setStatus("Ready");
  };

  const getElenaReply = async (
    text: string,
  ): Promise<{ reply: string; lang: "en" | "es" }> => {
    const lang = detectReplyLang(text, "auto");
    try {
      if (property) {
        const reply = await askAvatarReply({
          question: text,
          property,
          properties: [property],
          language: "auto",
          lastUserLang: lang,
          emergencyNumber: HOST_EMERGENCY_NUMBER,
          history: historyRef.current.slice(-8).map((turn) => ({
            role: turn.role === "user" ? ("guest" as const) : ("ai" as const),
            text: turn.content,
          })),
        });
        if (reply.trim()) return { reply: reply.trim(), lang };
      } else {
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
      }
    } catch {
      /* fallback below */
    }
    return {
      reply:
        lang === "en"
          ? "Hi, I'm Elena. I'm here — tell me what you need."
          : "Claro, soy Elena. Todo listo por aquí; dime qué necesitas y te ayudo enseguida.",
      lang,
    };
  };

  const respondTo = async (text: string) => {
    if (!text.trim()) return;
    const heard = text.trim();
    setInput(heard);
    setGuestHeard(heard);
    setIsAudioReadyToPlay(false);
    setStatus("Processing...");
    const { reply, lang } = await getElenaReply(text);
    historyRef.current = [
      ...historyRef.current.slice(-7),
      { role: "user", content: text.trim().slice(0, 500) },
      { role: "assistant", content: reply.slice(0, 800) },
    ];
    setReplyText(reply);
    setAudioPending(true);
    setStatus("Processing...");
    void speak(reply, lang);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    void respondTo(text);
  };

  return (
    <div className="p-5 bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm mx-auto text-white shadow-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3.5 min-w-0">
          <ElenaAvatar size={64} />
          <div className="leading-tight min-w-0">
            <h2 className="text-lg font-bold truncate">Elena · Receptionist</h2>
            <p className="text-[11px] text-slate-500">AI Voice Concierge</p>
          </div>
        </div>
        <span className="shrink-0 text-xs px-2 py-1 bg-emerald-900/60 text-emerald-400 border border-emerald-700 rounded-md">
          {status}
        </span>
      </div>

      <ElenaCaptureProvider
        onUnlock={unlockAudio}
        onTranscript={(text) => void respondTo(text)}
        stopCaptureRef={stopCaptureRef}
        languageHintRef={languageHintRef}
      >
        <div className="space-y-4">
        <ElenaCaptureBanner />
        <form onSubmit={handleSubmit} className="relative z-20 flex flex-row items-center gap-2 w-full pointer-events-auto">
          <input
            id="elena-guest-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="relative z-20 flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm touch-manipulation pointer-events-auto"
          />
          <ElenaCaptureMic />
          <button
            type="submit"
            className="relative z-20 shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-500 font-semibold rounded-lg transition text-sm touch-manipulation pointer-events-auto cursor-pointer"
          >
            Send
          </button>
        </form>
        <ElenaCaptureStatus muted={muted} />
        </div>
      </ElenaCaptureProvider>

      <audio
        ref={(el) => {
          if (el) audioRef.current = el;
        }}
        playsInline
        preload="auto"
        className="hidden"
      />

      {guestHeard ? (
        <div className="ml-4 rounded-2xl rounded-tr-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 leading-relaxed">
          {guestHeard}
        </div>
      ) : null}
      {audioPending && !replyText ? (
        <p className="text-xs text-emerald-300/90">Elena is typing…</p>
      ) : null}
      {replyText ? (
        <div className="mr-4 rounded-2xl rounded-tl-md border border-emerald-800/50 bg-emerald-950/40 px-3 py-2 text-sm text-slate-50 leading-relaxed">
          {replyText}
        </div>
      ) : null}

      {isAudioReadyToPlay ? (
        <button
          type="button"
          onClick={() => {
            const el = audioRef.current;
            if (!el) return;
            el.onended = () => {
              setIsAudioReadyToPlay(false);
              setStatus("Ready");
            };
            void el.play();
            setStatus("Talking...");
          }}
          className="w-full rounded-xl bg-emerald-500 px-4 py-4 text-base font-bold text-slate-950 shadow-lg transition hover:bg-emerald-400"
        >
          🔊 Tap to hear Elena&apos;s answer
        </button>
      ) : null}

      <button
        type="button"
        onClick={stopVoice}
        className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-3 py-2 tabular text-xs font-semibold text-slate-300 hover:bg-slate-900 hover:text-white transition"
      >
        {muted ? "Stopped" : "Mute / Stop voice"}
      </button>
    </div>
  );
}
