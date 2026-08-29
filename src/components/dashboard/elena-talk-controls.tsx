"use client";

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Mic, MicOff } from "lucide-react";
import {
  speechLangForHint,
  startBrowserSpeechListen,
  type BrowserListenSession,
} from "@/lib/human-voice";

type CaptureCtx = {
  recording: boolean;
  processing: boolean;
  micHint: string | null;
  handleToggleRecord: () => void;
};

const CaptureContext = createContext<CaptureCtx | null>(null);

function useCapture() {
  const ctx = useContext(CaptureContext);
  if (!ctx) throw new Error("Elena capture context missing");
  return ctx;
}

export function ElenaCaptureProvider({
  onUnlock,
  onTranscript,
  stopCaptureRef,
  languageHintRef,
  children,
}: {
  onUnlock: () => void;
  onTranscript: (text: string) => void;
  stopCaptureRef: { current: (() => void) | null };
  languageHintRef: { current: "es" | "en" };
  children: ReactNode;
}) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [micHint, setMicHint] = useState<string | null>(null);
  const sessionRef = useRef<BrowserListenSession | null>(null);
  const pendingInterimRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  const onUnlockRef = useRef(onUnlock);
  onTranscriptRef.current = onTranscript;
  onUnlockRef.current = onUnlock;

  const stopListening = useCallback((flush: boolean) => {
    const leftover = pendingInterimRef.current.trim();
    pendingInterimRef.current = "";
    sessionRef.current?.stop();
    sessionRef.current = null;
    setRecording(false);
    setProcessing(false);
    if (flush && leftover) onTranscriptRef.current(leftover);
  }, []);

  const cancelListening = useCallback(() => {
    pendingInterimRef.current = "";
    sessionRef.current?.cancel();
    sessionRef.current = null;
    setRecording(false);
    setProcessing(false);
  }, []);

  useEffect(() => {
    stopCaptureRef.current = cancelListening;
    return () => {
      cancelListening();
      stopCaptureRef.current = null;
    };
  }, [cancelListening, stopCaptureRef]);

  const handleToggleRecord = useCallback(() => {
    onUnlockRef.current();
    if (sessionRef.current) {
      stopListening(true);
      return;
    }

    setMicHint(null);
    const session = startBrowserSpeechListen({
      lang: speechLangForHint(languageHintRef.current),
      onInterim: (text) => {
        pendingInterimRef.current = text;
        setMicHint(text ? `Hearing: ${text}` : "Listening…");
      },
      onFinal: (text) => {
        pendingInterimRef.current = "";
        setMicHint(null);
        onTranscriptRef.current(text);
      },
      onError: (message) => {
        setMicHint(message);
        setRecording(false);
        setProcessing(false);
        sessionRef.current = null;
      },
      onEnd: () => {
        sessionRef.current = null;
        setRecording(false);
      },
    });

    if (!session) {
      setMicHint("Live speech is not available. Type a question instead.");
      return;
    }

    sessionRef.current = session;
    setRecording(true);
    setMicHint("Listening… tap to stop");
  }, [languageHintRef, stopListening]);

  const value = useMemo(
    () => ({ recording, processing, micHint, handleToggleRecord }),
    [handleToggleRecord, micHint, processing, recording],
  );

  return <CaptureContext.Provider value={value}>{children}</CaptureContext.Provider>;
}

const tapBtn = "relative z-10 touch-manipulation cursor-pointer";

export const ElenaCaptureBanner = memo(function ElenaCaptureBanner() {
  const { recording, processing, handleToggleRecord } = useCapture();
  const label = recording ? "Tap to stop" : processing ? "Listening…" : "Tap to talk";
  return (
    <button type="button" onClick={handleToggleRecord} className={`${tapBtn} w-full rounded-xl py-3 text-sm font-bold transition ${
        recording
          ? "bg-rose-600 text-white hover:bg-rose-500"
          : processing
            ? "bg-amber-500 text-slate-950"
            : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
      }`}
    >
      {label}
    </button>
  );
});

export const ElenaCaptureMic = memo(function ElenaCaptureMic() {
  const { recording, processing, handleToggleRecord } = useCapture();
  return (
    <button
      type="button"
      onClick={handleToggleRecord}
      aria-label={recording ? "Tap to stop" : processing ? "Listening…" : "Tap to talk"}
      className={`${tapBtn} shrink-0 flex items-center justify-center w-11 h-[40px] rounded-lg transition ${
        recording
          ? "bg-rose-600 text-white"
          : processing
            ? "bg-amber-500 text-slate-950"
            : "bg-slate-700 hover:bg-slate-600 text-white"
      }`}
    >
      {recording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </button>
  );
});

export const ElenaCaptureStatus = memo(function ElenaCaptureStatus({
  muted,
}: {
  muted: boolean;
}) {
  const { recording, processing, micHint } = useCapture();
  return (
    <p className="text-[11px] text-slate-500">
      {micHint
        ? micHint
        : recording
          ? "Listening… tap to stop"
          : processing
            ? "Listening…"
            : muted
              ? "Voice muted"
              : "Standby · Browser speech"}
    </p>
  );
});
