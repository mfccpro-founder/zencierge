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
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
} from "react";
import { createPortal } from "react-dom";
import { Mic, MicOff } from "lucide-react";
import {
  acquireMicrophoneStream,
  describeGetUserMediaFailure,
  getSpeechRecognitionCtor,
  isInsecureMicrophoneContext,
  speechLangForHint,
  startBrowserSpeechListen,
  startPushToTalkFromStream,
  transcribePushToTalkBlob,
  type BrowserListenSession,
  type PushToTalkSession,
} from "@/lib/human-voice";
import { guestPressClass } from "@/lib/guest-press";
import { samePathOnSecureOrigin } from "@/lib/public-app-url";

type CaptureCtx = {
  recording: boolean;
  processing: boolean;
  micHint: string | null;
  httpsRequired: boolean;
  helperOpen: boolean;
  secureGuestHref: string | null;
  handleToggleRecord: () => void;
  closeHelper: () => void;
  typeInstead: () => void;
  hearElenaFallback: () => void;
  openSecurePage: () => void;
};

const COMPOSER_INPUT_ID = "elena-guest-input";

const CaptureContext = createContext<CaptureCtx | null>(null);

function useCapture() {
  const ctx = useContext(CaptureContext);
  if (!ctx) throw new Error("Elena capture context missing");
  return ctx;
}

function TalkEngageButton({
  className,
  children,
  onEngage,
  ariaLabel,
  listening,
}: {
  className: string;
  children: ReactNode;
  onEngage: () => void;
  ariaLabel: string;
  listening: boolean;
}) {
  const lockRef = useRef(false);

  const engage = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault();
    event.stopPropagation();
    if (lockRef.current) return;
    lockRef.current = true;
    window.setTimeout(() => {
      lockRef.current = false;
    }, 500);
    onEngage();
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={listening}
      onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return;
        engage(event);
      }}
      onTouchStart={(event: TouchEvent<HTMLButtonElement>) => {
        engage(event);
      }}
      onClick={(event) => {
        engage(event);
      }}
      className={className}
    >
      {children}
    </button>
  );
}

export function ElenaCaptureProvider({
  onUnlock,
  onTranscript,
  onFallbackSpeak,
  stopCaptureRef,
  languageHintRef,
  children,
}: {
  onUnlock: () => void;
  onTranscript: (text: string) => void;
  onFallbackSpeak?: () => void;
  stopCaptureRef: { current: (() => void) | null };
  languageHintRef: { current: "es" | "en" };
  children: ReactNode;
}) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [micHint, setMicHint] = useState<string | null>(null);
  const [httpsRequired, setHttpsRequired] = useState(false);
  const [helperOpen, setHelperOpen] = useState(false);
  const [secureGuestHref, setSecureGuestHref] = useState<string | null>(null);
  const speechRef = useRef<BrowserListenSession | null>(null);
  const recorderRef = useRef<PushToTalkSession | null>(null);
  const pendingInterimRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  const onUnlockRef = useRef(onUnlock);
  const onFallbackSpeakRef = useRef(onFallbackSpeak);
  onTranscriptRef.current = onTranscript;
  onUnlockRef.current = onUnlock;
  onFallbackSpeakRef.current = onFallbackSpeak;

  const stopListening = useCallback((flush: boolean) => {
    const leftover = pendingInterimRef.current.trim();
    pendingInterimRef.current = "";
    speechRef.current?.stop();
    speechRef.current = null;
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (flush && leftover) onTranscriptRef.current(leftover);
  }, []);

  const cancelListening = useCallback(() => {
    pendingInterimRef.current = "";
    speechRef.current?.cancel();
    speechRef.current = null;
    recorderRef.current?.cancel();
    recorderRef.current = null;
    setRecording(false);
    setProcessing(false);
  }, []);

  useEffect(() => {
    setHttpsRequired(isInsecureMicrophoneContext());
    setSecureGuestHref(samePathOnSecureOrigin());
    void fetch("/api/dev-tunnel", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { origin?: string | null }) => {
        if (typeof window === "undefined" || window.isSecureContext) return;
        const origin = typeof data.origin === "string" ? data.origin.replace(/\/$/, "") : "";
        if (!origin.toLowerCase().startsWith("https://")) return;
        setSecureGuestHref(
          `${origin}${window.location.pathname}${window.location.search}${window.location.hash}`,
        );
      })
      .catch(() => {
        /* keep env-based href */
      });
  }, []);

  useEffect(() => {
    stopCaptureRef.current = cancelListening;
    return () => {
      cancelListening();
      stopCaptureRef.current = null;
    };
  }, [cancelListening, stopCaptureRef]);

  const reportMicFailure = useCallback((cause: unknown) => {
    const described = describeGetUserMediaFailure(cause);
    console.error("[elena] microphone init failed", {
      kind: described.kind,
      message: described.message,
      secureContext: typeof window !== "undefined" ? window.isSecureContext : null,
      protocol: typeof window !== "undefined" ? window.location.protocol : null,
      host: typeof window !== "undefined" ? window.location.host : null,
      cause,
    });
    setMicHint(described.message);
    if (described.kind === "insecure" && !isInsecureMicrophoneContext()) {
      /* Local LAN: keep Tap to talk; do not open a blocking HTTPS modal. */
      return;
    }
    if (described.kind === "insecure") {
      setHttpsRequired(true);
      setHelperOpen(true);
    }
  }, []);

  const startMicRecorder = useCallback(async () => {
    try {
      const stream = await acquireMicrophoneStream();
      try {
        const session = startPushToTalkFromStream(stream, {
          onStop: (blob) => {
            recorderRef.current = null;
            setRecording(false);
            setProcessing(true);
            setMicHint("Transcribing…");
            void transcribePushToTalkBlob(blob, languageHintRef.current)
              .then((text) => {
                if (text.trim()) onTranscriptRef.current(text.trim());
                else setMicHint("No speech heard. Tap to talk again, or type a question.");
              })
              .catch((cause) => {
                console.error("[elena] transcribe failed", cause);
                setMicHint(cause instanceof Error ? cause.message : "Could not transcribe speech.");
              })
              .finally(() => setProcessing(false));
          },
        });
        recorderRef.current = session;
        setRecording(true);
        setMicHint("Listening… tap to stop");
      } catch (inner) {
        stream.getTracks().forEach((track) => track.stop());
        throw inner;
      }
    } catch (cause) {
      setRecording(false);
      setProcessing(false);
      reportMicFailure(cause);
    }
  }, [languageHintRef, reportMicFailure]);

  const handleToggleRecord = useCallback(() => {
    try {
      onUnlockRef.current();
    } catch (cause) {
      console.error("[elena] audio unlock failed", cause);
    }
    if (speechRef.current || recorderRef.current) {
      stopListening(true);
      return;
    }

    setMicHint("Listening…");
    setRecording(true);
    setProcessing(false);

    try {
      if (getSpeechRecognitionCtor()) {
        const session = startBrowserSpeechListen({
          lang: speechLangForHint(languageHintRef.current),
          onInterim: (text) => {
            pendingInterimRef.current = text;
            setMicHint(text ? `Hearing: ${text}` : "Listening… tap to stop");
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
            speechRef.current = null;
          },
          onEnd: () => {
            speechRef.current = null;
            setRecording(false);
          },
        });
        if (session) {
          speechRef.current = session;
          setMicHint("Listening… tap to stop");
          return;
        }
      }
    } catch (cause) {
      console.error("[elena] speech recognition failed", cause);
    }

    void startMicRecorder();
  }, [languageHintRef, reportMicFailure, startMicRecorder, stopListening]);

  const closeHelper = useCallback(() => setHelperOpen(false), []);

  const typeInstead = useCallback(() => {
    setHelperOpen(false);
    window.setTimeout(() => {
      const field = document.getElementById(COMPOSER_INPUT_ID);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.focus();
        field.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 50);
  }, []);

  const hearElenaFallback = useCallback(() => {
    try {
      onUnlockRef.current();
    } catch (cause) {
      console.error("[elena] audio unlock failed", cause);
    }
    onFallbackSpeakRef.current?.();
    setHelperOpen(false);
  }, []);

  const openSecurePage = useCallback(() => {
    const href = samePathOnSecureOrigin() ?? secureGuestHref;
    if (!href) return;
    window.location.assign(href);
  }, [secureGuestHref]);

  const value = useMemo(
    () => ({
      recording,
      processing,
      micHint,
      httpsRequired,
      helperOpen,
      secureGuestHref,
      handleToggleRecord,
      closeHelper,
      typeInstead,
      hearElenaFallback,
      openSecurePage,
    }),
    [
      closeHelper,
      handleToggleRecord,
      hearElenaFallback,
      helperOpen,
      httpsRequired,
      micHint,
      openSecurePage,
      processing,
      recording,
      secureGuestHref,
      typeInstead,
    ],
  );

  return (
    <CaptureContext.Provider value={value}>
      {children}
      <ElenaSecureConnectModal />
    </CaptureContext.Provider>
  );
}

function ElenaSecureConnectModal() {
  const {
    helperOpen,
    httpsRequired,
    secureGuestHref,
    closeHelper,
    typeInstead,
    hearElenaFallback,
    openSecurePage,
  } = useCapture();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!helperOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeHelper();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeHelper, helperOpen]);

  if (!mounted || !helperOpen || typeof document === "undefined") return null;

  const title = httpsRequired ? "Connect securely for voice" : "Microphone unavailable";
  const body = httpsRequired
    ? secureGuestHref
      ? "This page is HTTP, so some phones block the microphone. If you have a real HTTPS guest URL configured, you can open it. Otherwise type a question or hear Elena speak."
      : "This page is HTTP (for example a local network IP). Some phones block the microphone. Type a question or hear Elena speak. Do not prefix this address with https:// — the local server is HTTP only."
    : "The microphone could not start. You can type your question, or tap Hear Elena speak for a spoken greeting.";

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close voice help"
        className="absolute inset-0 bg-slate-950/50"
        onClick={closeHelper}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="elena-secure-connect-title"
        className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-xl"
      >
        <h3 id="elena-secure-connect-title" className="text-base font-bold text-slate-900">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
        <div className="mt-4 flex flex-col gap-2">
          {secureGuestHref ? (
            <button
              type="button"
              className={`${guestPressClass} w-full rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white hover:bg-sky-500`}
              onClick={openSecurePage}
            >
              Open HTTPS tunnel for Tap to talk
            </button>
          ) : null}
          <button
            type="button"
            className={`${guestPressClass} w-full rounded-xl px-4 py-3 text-sm font-bold ${
              secureGuestHref
                ? "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                : "bg-sky-600 text-white hover:bg-sky-500"
            }`}
            onClick={typeInstead}
          >
            Type a question instead
          </button>
          <button
            type="button"
            className={`${guestPressClass} w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400`}
            onClick={hearElenaFallback}
          >
            Hear Elena speak
          </button>
          <button
            type="button"
            className={`${guestPressClass} w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50`}
            onClick={closeHelper}
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const ElenaCaptureBanner = memo(function ElenaCaptureBanner() {
  const { recording, processing, handleToggleRecord, httpsRequired, micHint, secureGuestHref, openSecurePage } =
    useCapture();
  const label = recording
    ? "Listening… tap to stop"
    : processing
      ? "Transcribing…"
      : httpsRequired
        ? "Voice help"
        : "Tap to talk";
  return (
    <div className="space-y-2">
      {httpsRequired ? (
        <div
          role="status"
          className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-left text-xs text-amber-950"
        >
          <p className="font-bold">Microphone blocked on HTTP</p>
          <p className="mt-1 leading-relaxed">
            {secureGuestHref
              ? "This page is HTTP. Open a real HTTPS guest URL if one is configured, or tap Voice help."
              : "Tap Voice help for a spoken greeting, or type below. Some phones limit the microphone on HTTP."}
          </p>
          {secureGuestHref ? (
            <button
              type="button"
              className={`${guestPressClass} mt-2 w-full rounded-lg bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-500`}
              onClick={openSecurePage}
            >
              Open HTTPS tunnel for Tap to talk
            </button>
          ) : null}
        </div>
      ) : null}
      {micHint && !recording && !processing && !httpsRequired ? (
        <div role="status" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-left text-xs text-rose-900">
          {micHint}
        </div>
      ) : null}
      <TalkEngageButton
        listening={recording}
        ariaLabel={label}
        onEngage={handleToggleRecord}
        className={`${guestPressClass} w-full rounded-xl py-3 text-sm font-bold transition ${
          recording
            ? "bg-rose-600 text-white shadow-[0_0_0_3px_rgba(251,113,133,0.55)]"
            : processing
              ? "bg-amber-500 text-slate-950"
              : httpsRequired
                ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
                : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
        }`}
      >
        <span className="inline-flex items-center justify-center gap-2">
          {recording ? <span className="live-dot h-2.5 w-2.5 rounded-full bg-white" /> : null}
          {label}
        </span>
      </TalkEngageButton>
    </div>
  );
});

export const ElenaCaptureMic = memo(function ElenaCaptureMic() {
  const { recording, processing, handleToggleRecord, httpsRequired } = useCapture();
  const label = recording
    ? "Listening… tap to stop"
    : processing
      ? "Transcribing…"
      : httpsRequired
        ? "Voice help"
        : "Tap to talk";
  return (
    <TalkEngageButton
      listening={recording}
      ariaLabel={label}
      onEngage={handleToggleRecord}
      className={`${guestPressClass} flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition ${
        recording
          ? "bg-rose-600 text-white shadow-[0_0_0_3px_rgba(251,113,133,0.55)]"
          : processing
            ? "bg-amber-500 text-slate-950"
            : httpsRequired
              ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
              : "bg-sky-600 text-white hover:bg-sky-500"
      }`}
    >
      {recording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
    </TalkEngageButton>
  );
});

export const ElenaCaptureStatus = memo(function ElenaCaptureStatus({
  muted,
}: {
  muted: boolean;
}) {
  const { recording, processing, micHint, httpsRequired, secureGuestHref } = useCapture();
  return (
    <p className={`text-[11px] ${recording ? "font-semibold text-rose-700" : "text-slate-500"}`}>
      {micHint
        ? micHint
        : recording
          ? "Listening… tap to stop"
          : processing
            ? "Transcribing…"
            : muted
              ? "Voice muted"
              : httpsRequired
                ? secureGuestHref
                  ? "Open the HTTPS guest link if configured"
                  : "Type a question · microphone may be limited on HTTP"
                : "Standby · Tap to talk"}
    </p>
  );
});
