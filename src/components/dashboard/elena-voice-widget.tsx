"use client";

import React, { useEffect, useRef, useState } from "react";
import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import {
  AutoplayBlockedError,
  detectReplyLang,
  detectUtteranceLang,
  isSpeechAudioUnlocked,
  playOpenAiTtsMpeg,
  speakWithBrowserTts,
  unlockSpeechAudio,
} from "@/lib/human-voice";
import { guestPressClass, withMobilePress } from "@/lib/guest-press";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply } from "@/lib/ask-avatar";
import { publicApiUrl } from "@/lib/public-app-url";
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
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const langRef = useRef<"es" | "en">("es");
  const unlockedRef = useRef(false);
  const greetedRef = useRef(false);
  const pendingSpeakRef = useRef<{ text: string; lang: "es" | "en" } | null>(null);
  const stopCaptureRef = useRef<(() => void) | null>(null);
  const historyRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const languageHintRef = useRef<"es" | "en">("en");

  const unlockAudio = () => {
    const audio = unlockSpeechAudio(audioRef.current);
    if (audio) audioRef.current = audio;
    unlockedRef.current = true;
    setAudioUnlocked(true);
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
    pendingSpeakRef.current = { text, lang };
    setMuted(false);
    setAudioPending(false);
    setStatus("Speaking...");
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    try {
      const el = await playOpenAiTtsMpeg(text, "coral", audioRef.current, lang);
      audioRef.current = el;
      pendingSpeakRef.current = null;
      setIsAudioReadyToPlay(false);
      el.onended = () => setStatus("Ready");
      return;
    } catch (cause) {
      if (cause instanceof AutoplayBlockedError) {
        setIsAudioReadyToPlay(true);
        setStatus("Tap to hear Elena");
        return;
      }
    }
    if (!unlockedRef.current) {
      setIsAudioReadyToPlay(true);
      setStatus("Tap to start audio");
      return;
    }
    if (speakViaBrowser(text, detectUtteranceLang(text))) {
      pendingSpeakRef.current = null;
      setIsAudioReadyToPlay(false);
      return;
    }
    setIsAudioReadyToPlay(true);
    setStatus("Tap to hear Elena");
  };

  const playPendingOrGreet = () => {
    unlockAudio();
    const pending = pendingSpeakRef.current;
    if (pending) {
      void speak(pending.text, pending.lang);
      return;
    }
    if (!greetedRef.current) {
      greetedRef.current = true;
      const hello = "Hi, I'm Elena, your stay concierge. How can I help?";
      setReplyText(hello);
      void speak(hello, "en");
    }
  };

  useEffect(() => {
    if (isSpeechAudioUnlocked()) {
      unlockedRef.current = true;
      setAudioUnlocked(true);
    }
  }, []);

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
        const res = await fetch(publicApiUrl("/api/chat"), {
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
    <div className="relative z-20 mx-auto w-full min-w-0 max-w-full space-y-4 overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-sm pointer-events-auto sm:max-w-sm sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <ElenaAvatar size={52} />
          <div className="min-w-0 leading-tight">
            <h2 className="truncate text-base font-bold sm:text-lg">Elena · Receptionist</h2>
            <p className="text-[11px] text-slate-500">AI Voice Concierge</p>
          </div>
        </div>
        <span className="w-fit shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
          {status}
        </span>
      </div>

      {!audioUnlocked ? (
        <button
          type="button"
          {...withMobilePress(playPendingOrGreet)}
          className={`${guestPressClass} w-full rounded-xl bg-sky-600 px-4 py-4 text-base font-bold text-white shadow-lg hover:bg-sky-500`}
        >
          Tap to start audio
        </button>
      ) : null}

      <ElenaCaptureProvider
        onUnlock={unlockAudio}
        onTranscript={(text) => void respondTo(text)}
        onFallbackSpeak={() => {
          unlockAudio();
          const line =
            "Hi, I'm Elena. This page is on HTTP, so the microphone is blocked. Type your question and I will answer out loud.";
          setReplyText(line);
          void speak(line, "en");
        }}
        stopCaptureRef={stopCaptureRef}
        languageHintRef={languageHintRef}
      >
        <div className="relative z-20 space-y-4 pointer-events-auto">
        <ElenaCaptureBanner />
        <form onSubmit={handleSubmit} className="relative z-20 flex w-full min-w-0 flex-col gap-2 pointer-events-auto sm:flex-row sm:items-center">
          <input
            id="elena-guest-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            enterKeyHint="send"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={unlockAudio}
            placeholder="Type a message..."
            className="relative z-20 min-h-11 w-full min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none ring-sky-600 touch-manipulation pointer-events-auto focus:ring-2"
          />
          <div className="flex w-full gap-2 sm:w-auto">
          <ElenaCaptureMic />
          <button
            type="submit"
            className={`${guestPressClass} flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400 sm:flex-none`}
          >
            Send
          </button>
          </div>
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
        <div className="ml-0 break-words rounded-2xl rounded-tr-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-800 sm:ml-4">
          {guestHeard}
        </div>
      ) : null}
      {audioPending && !replyText ? (
        <p className="text-xs text-sky-800">Elena is typing…</p>
      ) : null}
      {replyText ? (
        <div className="mr-0 break-words rounded-2xl rounded-tl-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm leading-relaxed text-slate-900 sm:mr-4">
          {replyText}
        </div>
      ) : null}

      {isAudioReadyToPlay ? (
        <button
          type="button"
          {...withMobilePress(() => {
            unlockAudio();
            const pending = pendingSpeakRef.current;
            const el = audioRef.current;
            if (el?.src && !el.src.startsWith("data:")) {
              el.onended = () => {
                setIsAudioReadyToPlay(false);
                setStatus("Ready");
              };
              void el.play().then(() => {
                setIsAudioReadyToPlay(false);
                setStatus("Talking...");
              }).catch(() => {
                if (pending) void speak(pending.text, pending.lang);
              });
              return;
            }
            playPendingOrGreet();
          })}
          className={`${guestPressClass} w-full rounded-xl bg-emerald-500 px-4 py-4 text-base font-bold text-slate-950 shadow-lg hover:bg-emerald-400`}
        >
          Tap to hear Elena
        </button>
      ) : null}

      <button
        type="button"
        {...withMobilePress(stopVoice)}
        className={`${guestPressClass} w-full rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400`}
      >
        {muted ? "Stopped" : "Mute / Stop voice"}
      </button>
    </div>
  );
}
