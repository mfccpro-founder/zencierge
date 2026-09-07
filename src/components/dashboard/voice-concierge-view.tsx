"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound, Phone, Play, Sparkles } from "lucide-react";
import { useListings } from "@/components/dashboard/listings-provider";
import { AiReceptionistStudio } from "@/components/dashboard/ai-receptionist-studio";
import { GuestQrCard } from "@/components/dashboard/guest-qr-card";
import type { ReceptionistPhase } from "@/components/dashboard/receptionist-avatar";
import type { Property } from "@/lib/dashboard-data";
import { askAvatarReply, conciergeSpokenText, type ConciergeLiveResult } from "@/lib/ask-avatar";
import { GoogleMapsLiveResults } from "@/components/dashboard/google-maps-live-results";
import { HostGuideResults } from "@/components/dashboard/host-guide-results";
import type { LocalGuidePublicResult } from "@/lib/local-guide-shared";
import { localTimeLabel, phonesMatch, voiceIdFromAvatarName } from "@/lib/property-agent";
import { useHeygenRepeatAvatar } from "@/components/dashboard/use-heygen-repeat";
import {
  VOICE_PROFILES,
  acquireMicrophoneStream,
  describeGetUserMediaFailure,
  detectUtteranceLang,
  getVoiceProfile,
  keepAudioChannelAlive,
  HOSPITALITY_TTS_SPEED,
  isSharedPcmPlaybackActive,
  playOpenAiTtsMpeg,
  resumePersistentAudio,
  startPushToTalkFromStream,
  stopHumanVoice,
  transcribePushToTalkBlob,
  unlockSpeechAudio,
  type LanguageMode,
  type PushToTalkSession,
  type ReplyLang,
  type VoiceProfile,
  type VoiceProfileId,
} from "@/lib/human-voice";
import {
  attachTestCallVad,
  shouldTranscribeForStopReason,
  TEST_CALL_VAD,
  testCallAfterSpeechAction,
  testCallShouldResumeListening,
  type RecordingStopReason,
} from "@/lib/test-call-vad";

type HoursMode = "always" | "night";
type FloridaLine = "305" | "954";

type SimLine = {
  id: string;
  speaker: "guest" | "ai" | "system";
  text: string;
};

const FLORIDA_LINES: Record<FloridaLine, { number: string; area: string }> = {
  "305": { number: "+1 (305) 555-0199", area: "Miami-Dade · 305" },
  "954": { number: "+1 (954) 555-0144", area: "Broward · 954" },
};

const AUTO_GREETING =
  "Hello! Welcome to Zencierge. ¡Hola! Bienvenido a Zencierge. How can I help you today? ¿En qué puedo ayudarte?";

const LISTEN_CLIP_MS = 6000;
const LISTEN_RESUME_GAP_MS = 400;
const TEST_CALL_LIMIT_MS = 60_000;

const VOICE_HEALTH_DEV = process.env.NODE_ENV !== "production";

type CallPhase = "idle" | "listening" | "thinking" | "speaking" | "ended";

export type TestCallAutoEndReason =
  | "response_completed"
  | "no_speech"
  | "transcribe_failed"
  | "mic_failed"
  | "safety_timeout";

export {
  testCallAfterSpeechAction,
  testCallShouldResumeListening,
} from "@/lib/test-call-vad";

type VoiceHealthEvent = { ms: number; name: string };

type VoiceHealthReport = {
  runNumber: number;
  languageMode: "auto" | "en" | "es";
  startCallEntered: boolean;
  callStartingAccepted: boolean;
  audioUnlockSucceeded: boolean;
  audioUnlockErrorName: string;
  micProbeStarted: boolean;
  micProbeSucceeded: boolean;
  micProbeErrorName: string;
  probeTrackCount: number | null;
  probeTracksStopped: boolean;
  greetingTtsStarted: boolean;
  greetingTtsCompleted: boolean;
  greetingTtsFailed: boolean;
  greetingTtsErrorName: string;
  afterSpeakingFinishedCalled: boolean;
  listenResumeRequested: boolean;
  wantMicAtResume: boolean | null;
  callActiveAtResume: boolean | null;
  phaseAtResume: CallPhase | "";
  pcmActiveAtResume: boolean | null;
  secondMicAcquireStarted: boolean;
  secondMicAcquireSucceeded: boolean;
  secondMicAcquireErrorName: string;
  listenTrackCount: number | null;
  listenTrackReadyState: string;
  listenTrackEnabled: boolean | null;
  listenTrackMuted: boolean | null;
  recorderAssigned: boolean;
  recorderMimeType: string;
  recorderStopRequested: boolean;
  recorderOnStopCount: number;
  blobBytes: number | null;
  phaseAtOnStop: CallPhase | "";
  listenGenerationMatched: boolean | null;
  transcribeAttempted: boolean;
  transcribeReturnedNonempty: boolean | null;
  transcribeFailed: boolean;
  transcribeErrorName: string;
  safetyTimerFired: boolean;
  oneTurnMode: boolean;
  guestTurnAccepted: boolean;
  autoEndRequested: boolean;
  autoEndReason: TestCallAutoEndReason | "";
  cleanupCompleted: boolean;
  finalPhase: CallPhase | "";
  vadAvailable: boolean | null;
  vadStarted: boolean;
  speechDetected: boolean;
  speechDetectedAtMs: number | null;
  silenceDetected: boolean;
  silenceDurationMs: number | null;
  recordingStopReason: RecordingStopReason | "";
  recordingDurationMs: number | null;
  vadCleanupCompleted: boolean;
  currentPhase: CallPhase | "";
  currentWantMic: boolean | null;
  currentCallActive: boolean | null;
  events: VoiceHealthEvent[];
};

function emptyVoiceHealthReport(runNumber: number, languageMode: "auto" | "en" | "es"): VoiceHealthReport {
  return {
    runNumber,
    languageMode,
    startCallEntered: false,
    callStartingAccepted: false,
    audioUnlockSucceeded: false,
    audioUnlockErrorName: "",
    micProbeStarted: false,
    micProbeSucceeded: false,
    micProbeErrorName: "",
    probeTrackCount: null,
    probeTracksStopped: false,
    greetingTtsStarted: false,
    greetingTtsCompleted: false,
    greetingTtsFailed: false,
    greetingTtsErrorName: "",
    afterSpeakingFinishedCalled: false,
    listenResumeRequested: false,
    wantMicAtResume: null,
    callActiveAtResume: null,
    phaseAtResume: "",
    pcmActiveAtResume: null,
    secondMicAcquireStarted: false,
    secondMicAcquireSucceeded: false,
    secondMicAcquireErrorName: "",
    listenTrackCount: null,
    listenTrackReadyState: "",
    listenTrackEnabled: null,
    listenTrackMuted: null,
    recorderAssigned: false,
    recorderMimeType: "",
    recorderStopRequested: false,
    recorderOnStopCount: 0,
    blobBytes: null,
    phaseAtOnStop: "",
    listenGenerationMatched: null,
    transcribeAttempted: false,
    transcribeReturnedNonempty: null,
    transcribeFailed: false,
    transcribeErrorName: "",
    safetyTimerFired: false,
    oneTurnMode: true,
    guestTurnAccepted: false,
    autoEndRequested: false,
    autoEndReason: "",
    cleanupCompleted: false,
    finalPhase: "",
    vadAvailable: null,
    vadStarted: false,
    speechDetected: false,
    speechDetectedAtMs: null,
    silenceDetected: false,
    silenceDurationMs: null,
    recordingStopReason: "",
    recordingDurationMs: null,
    vadCleanupCompleted: false,
    currentPhase: "idle",
    currentWantMic: null,
    currentCallActive: null,
    events: [],
  };
}

function sanitizedErrorName(cause: unknown) {
  if (cause instanceof DOMException && cause.name) return cause.name.slice(0, 80);
  if (cause instanceof Error && cause.name) return cause.name.slice(0, 80);
  return "Error";
}

function voiceHealthNow() {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function voiceHealthElapsedMs(startedAt: number) {
  if (!startedAt) return 0;
  return Math.max(0, Math.round(voiceHealthNow() - startedAt));
}

const LANGUAGE_MIRROR_INSTRUCTION =
  "Automatically detect the language of the guest's last message and answer only in that language (Spanish if they spoke Spanish, English if they spoke English). Never reply in the other language.";

function detectGuestLang(text: string): ReplyLang {
  return detectUtteranceLang(text);
}

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-600";

export function VoiceConciergeView() {
  const { properties } = useListings();
  const [voiceId, setVoiceId] = useState<VoiceProfileId>("elena");
  const [language, setLanguage] = useState<LanguageMode>("auto");
  const [speed, setSpeed] = useState(HOSPITALITY_TTS_SPEED);
  const [stability, setStability] = useState(68);
  const [floridaLine, setFloridaLine] = useState<FloridaLine>("305");
  const [emergencyNumber, setEmergencyNumber] = useState("+1 (954) 275-3544");
  const [hours, setHours] = useState<HoursMode>("always");
  const [propertyId, setPropertyId] = useState(properties[0]?.id ?? "prop-1");
  const [callActive, setCallActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [draft, setDraft] = useState("");
  const [lines, setLines] = useState<SimLine[]>([]);
  const [livePlaces, setLivePlaces] = useState<ConciergeLiveResult[]>([]);
  const [hostPlaces, setHostPlaces] = useState<LocalGuidePublicResult[]>([]);
  const [partialAi, setPartialAi] = useState("");
  const [partialGuest, setPartialGuest] = useState("");
  const [elevenKey, setElevenKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);
  const [previewing, setPreviewing] = useState<VoiceProfileId | null>(null);
  const [engineLabel, setEngineLabel] = useState("Studio TTS");
  const [tapToListen, setTapToListen] = useState(false);
  const [responding, setResponding] = useState(false);
  const [voiceHealth, setVoiceHealth] = useState<VoiceHealthReport>(() => emptyVoiceHealthReport(0, "auto"));
  const [voiceHealthCopyFallback, setVoiceHealthCopyFallback] = useState("");
  const [voiceHealthCopyStatus, setVoiceHealthCopyStatus] = useState("");
  const voiceHealthStartRef = useRef(0);
  const voiceHealthRunRef = useRef(0);
  const voiceHealthGreetingRef = useRef(false);
  const testCallActiveRef = useRef(false);
  const testCallGuestTurnAcceptedRef = useRef(false);
  const testCallLimitTimerRef = useRef(0);
  const endCallInFlightRef = useRef(false);
  const vadCleanupRef = useRef<(() => void) | null>(null);
  const recordingStopReasonRef = useRef<RecordingStopReason | "">("");

  const profile = getVoiceProfile(voiceId);
  const selectedProperty =
    properties.find((property) => property.id === propertyId) ?? properties[0];
  const lineMeta = FLORIDA_LINES[floridaLine];
  const lineNumber = selectedProperty?.assignedPhoneNumber?.trim() || lineMeta.number;
  const studioReady = Boolean(elevenKey.trim() || openaiKey.trim());

  const idRef = useRef(0);
  const genRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const callActiveRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unlockedRef = useRef(false);
  const speedRef = useRef(HOSPITALITY_TTS_SPEED);
  const heygen = useHeygenRepeatAvatar();
  const abortRef = useRef<AbortController | null>(null);
  const safetyRef = useRef(0);
  const audioWatchdogRef = useRef(0);
  const playbackStartedRef = useRef(false);
  const heygenSpeakingRef = useRef(false);
  const recRef = useRef<PushToTalkSession | null>(null);
  const listenClipTimerRef = useRef(0);
  const listenGenRef = useRef(0);
  const wantMicRef = useRef(false);
  const startListeningRef = useRef<() => void>(() => {});
  const languageRef = useRef<LanguageMode>(language);
  const sessionLangRef = useRef<LanguageMode>(language);
  // Language detected for the CURRENT utterance only. The UI selector never
  // changes when the user speaks — in Auto it stays "Auto" forever.
  const currentTurnLangRef = useRef<ReplyLang>("en");
  const speakingRef = useRef(false);
  const respondingRef = useRef(false);
  const thinkingRef = useRef(false);
  const callPhaseRef = useRef<CallPhase>("idle");
  const callStartingRef = useRef(false);
  const listenResumeTimerRef = useRef(0);
  const stopListeningRef = useRef<() => void>(() => {});
  const resumeListeningRef = useRef<() => void>(() => {});
  const applyCallPhaseRef = useRef<(next: CallPhase) => void>(() => {});

  const nextId = () => {
    idRef.current += 1;
    return `sim-${idRef.current}`;
  };

  const applyCallPhase = (next: CallPhase) => {
    callPhaseRef.current = next;
    speakingRef.current = next === "speaking";
    thinkingRef.current = next === "thinking";
    respondingRef.current = next === "thinking" || next === "speaking";
    setListening(next === "listening");
    setThinking(next === "thinking");
    setSpeaking(next === "speaking");
    setResponding(next === "thinking" || next === "speaking");
  };
  applyCallPhaseRef.current = applyCallPhase;

  const pushVoiceHealth = (name: string, patch?: Partial<VoiceHealthReport>) => {
    if (!VOICE_HEALTH_DEV) return;
    const ms = voiceHealthElapsedMs(voiceHealthStartRef.current);
    setVoiceHealth((prev) => ({
      ...prev,
      ...patch,
      recorderOnStopCount:
        name === "recorderOnStop" ? prev.recorderOnStopCount + 1 : (patch?.recorderOnStopCount ?? prev.recorderOnStopCount),
      currentPhase: callPhaseRef.current,
      currentWantMic: wantMicRef.current,
      currentCallActive: callActiveRef.current,
      events: [...prev.events, { ms, name }].slice(-100),
    }));
  };

  const resetVoiceHealth = (languageMode: "auto" | "en" | "es") => {
    voiceHealthRunRef.current += 1;
    voiceHealthStartRef.current = voiceHealthNow();
    voiceHealthGreetingRef.current = false;
    setVoiceHealthCopyFallback("");
    setVoiceHealthCopyStatus("");
    setVoiceHealth(emptyVoiceHealthReport(voiceHealthRunRef.current, languageMode));
  };

  const cleanupVad = () => {
    const fn = vadCleanupRef.current;
    vadCleanupRef.current = null;
    if (!fn) return;
    try {
      fn();
    } catch {
      /* already disconnected */
    }
    pushVoiceHealth("vadCleanupCompleted", { vadCleanupCompleted: true });
  };

  const clearListenResumeTimer = () => {
    if (listenResumeTimerRef.current) {
      window.clearTimeout(listenResumeTimerRef.current);
      listenResumeTimerRef.current = 0;
    }
  };

  useEffect(() => {
    callActiveRef.current = callActive;
  }, [callActive]);

  useEffect(() => {
    if (!selectedProperty) return;
    setVoiceId(voiceIdFromAvatarName(selectedProperty.assignedAvatarName));
    if (phonesMatch(selectedProperty.assignedPhoneNumber, FLORIDA_LINES["954"].number)) {
      setFloridaLine("954");
    } else if (phonesMatch(selectedProperty.assignedPhoneNumber, FLORIDA_LINES["305"].number)) {
      setFloridaLine("305");
    }
  }, [selectedProperty?.id, selectedProperty?.assignedAvatarName, selectedProperty?.assignedPhoneNumber]);

  useEffect(() => {
    languageRef.current = language;
    if (language !== "auto") sessionLangRef.current = language;
    if (!wantMicRef.current || !callActiveRef.current) return;
    if (testCallActiveRef.current) return;
    if (callPhaseRef.current === "ended" || callPhaseRef.current === "speaking" || callPhaseRef.current === "thinking") {
      return;
    }
    stopListeningRef.current();
    window.setTimeout(() => resumeListeningRef.current(), 80);
  }, [language]);

  useEffect(() => {
    speakingRef.current = speaking || heygen.speaking;
  }, [speaking, heygen.speaking]);

  useEffect(() => {
    respondingRef.current = responding;
  }, [responding]);

  useEffect(() => {
    thinkingRef.current = thinking;
  }, [thinking]);

  useEffect(() => {
    if (!responding) return;
    const timer = window.setTimeout(() => {
      if (testCallActiveRef.current) return;
      console.error("[voice] global safety timer — cancelling stuck turn; microphone stays off");
      pushVoiceHealth("safetyTimerFired", { safetyTimerFired: true });
      genRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      stopListeningRef.current();
      stopHumanVoice(audioRef);
      void heygen.interrupt();
      if (callPhaseRef.current !== "ended") applyCallPhaseRef.current("idle");
      setPartialAi("");
      setTapToListen(false);
    }, 25000);
    return () => window.clearTimeout(timer);
  }, [responding]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, partialAi, partialGuest]);

  useEffect(() => {
    const storedEleven = window.localStorage.getItem("zencierge.elevenlabsKey") ?? "";
    const storedOpenAi = window.localStorage.getItem("zencierge.openaiTtsKey") ?? "";
    if (storedEleven) setElevenKey(storedEleven);
    if (storedOpenAi) setOpenaiKey(storedOpenAi);
  }, []);

  useEffect(() => {
    return () => {
      wantMicRef.current = false;
      callPhaseRef.current = "ended";
      callStartingRef.current = false;
      listenGenRef.current += 1;
      if (listenResumeTimerRef.current) {
        window.clearTimeout(listenResumeTimerRef.current);
        listenResumeTimerRef.current = 0;
      }
      if (listenClipTimerRef.current) {
        window.clearTimeout(listenClipTimerRef.current);
        listenClipTimerRef.current = 0;
      }
      if (testCallLimitTimerRef.current) {
        window.clearTimeout(testCallLimitTimerRef.current);
        testCallLimitTimerRef.current = 0;
      }
      try {
        recRef.current?.cancel();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
      try {
        vadCleanupRef.current?.();
      } catch {
        /* already disconnected */
      }
      vadCleanupRef.current = null;
      stopHumanVoice(audioRef);
    };
  }, []);

  useEffect(() => {
    heygenSpeakingRef.current = heygen.speaking;
    if (heygen.speaking) {
      playbackStartedRef.current = true;
      if (safetyRef.current) {
        window.clearTimeout(safetyRef.current);
        safetyRef.current = 0;
      }
    }
  }, [heygen.speaking]);

  useEffect(() => {
    if (properties.length > 0 && !properties.some((item) => item.id === propertyId)) {
      setPropertyId(properties[0]!.id);
    }
  }, [properties, propertyId]);

  if (!selectedProperty) {
    return (
      <p className="text-sm text-slate-400">
        Add a property first so the concierge can use door codes and Wi-Fi.
      </p>
    );
  }

  const phase: ReceptionistPhase = thinking
    ? "thinking"
    : listening
      ? "listening"
      : speaking || heygen.speaking
        ? "speaking"
        : "idle";

  const persistKeys = (eleven: string, openai: string) => {
    window.localStorage.setItem("zencierge.elevenlabsKey", eleven);
    window.localStorage.setItem("zencierge.openaiTtsKey", openai);
  };

  const stopListening = () => {
    cleanupVad();
    listenGenRef.current += 1;
    clearListenResumeTimer();
    if (listenClipTimerRef.current) {
      window.clearTimeout(listenClipTimerRef.current);
      listenClipTimerRef.current = 0;
    }
    try {
      recRef.current?.cancel();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
    setListening(false);
  };
  stopListeningRef.current = stopListening;

  const clearTestCallLimitTimer = () => {
    if (testCallLimitTimerRef.current) {
      window.clearTimeout(testCallLimitTimerRef.current);
      testCallLimitTimerRef.current = 0;
    }
  };

  const resumeListeningIfAllowed = () => {
    pushVoiceHealth("listenResumeRequested", {
      listenResumeRequested: true,
      wantMicAtResume: wantMicRef.current,
      callActiveAtResume: callActiveRef.current,
      phaseAtResume: callPhaseRef.current,
      pcmActiveAtResume: isSharedPcmPlaybackActive(),
    });
    if (
      !testCallShouldResumeListening({
        oneTurnMode: testCallActiveRef.current,
        callEnded: callPhaseRef.current === "ended",
        wantMic: wantMicRef.current,
        callActive: callActiveRef.current,
        guestTurnAccepted: testCallGuestTurnAcceptedRef.current,
        phase: callPhaseRef.current,
        pcmActive: isSharedPcmPlaybackActive(),
      })
    ) {
      return;
    }
    startListeningRef.current();
  };
  resumeListeningRef.current = resumeListeningIfAllowed;

  const afterSpeakingFinished = () => {
    pushVoiceHealth("afterSpeakingFinishedCalled", { afterSpeakingFinishedCalled: true });
    const action = testCallAfterSpeechAction({
      oneTurnMode: testCallActiveRef.current,
      guestTurnAccepted: testCallGuestTurnAcceptedRef.current,
      phaseEnded: callPhaseRef.current === "ended",
      pcmActive: isSharedPcmPlaybackActive(),
    });
    if (action === "none") return;
    if (action === "end_call") {
      endCall({ status: "Call ended.", autoEndReason: "response_completed" });
      return;
    }
    applyCallPhase("idle");
    clearListenResumeTimer();
    listenResumeTimerRef.current = window.setTimeout(() => {
      listenResumeTimerRef.current = 0;
      resumeListeningIfAllowed();
    }, LISTEN_RESUME_GAP_MS);
  };

  const clearSafety = () => {
    if (safetyRef.current) {
      window.clearTimeout(safetyRef.current);
      safetyRef.current = 0;
    }
    if (audioWatchdogRef.current) {
      window.clearTimeout(audioWatchdogRef.current);
      audioWatchdogRef.current = 0;
    }
  };

  const releaseAndListen = () => {
    if (callPhaseRef.current === "ended") return;
    applyCallPhase("idle");
    afterSpeakingFinished();
  };

  const cancelSpeech = () => {
    genRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    clearSafety();
    playbackStartedRef.current = false;
    callStartingRef.current = false;
    stopHumanVoice(audioRef);
    void heygen.interrupt();
    setPreviewing(null);
    setPartialAi("");
    setTapToListen(false);
    if (callPhaseRef.current === "ended") return;
    applyCallPhase("idle");
  };

  const endCall = (options?: { status?: string; autoEndReason?: TestCallAutoEndReason }) => {
    if (endCallInFlightRef.current) return;
    if (callPhaseRef.current === "ended" && !callActiveRef.current && !callStartingRef.current) return;
    endCallInFlightRef.current = true;
    if (options?.autoEndReason) {
      pushVoiceHealth("autoEndRequested", {
        autoEndRequested: true,
        autoEndReason: options.autoEndReason,
      });
    }
    clearTestCallLimitTimer();
    applyCallPhase("ended");
    wantMicRef.current = false;
    callActiveRef.current = false;
    testCallActiveRef.current = false;
    testCallGuestTurnAcceptedRef.current = false;
    callStartingRef.current = false;
    voiceHealthGreetingRef.current = false;
    clearListenResumeTimer();
    stopListening();
    cancelSpeech();
    void heygen.stop();
    setPartialGuest("");
    setCallActive(false);
    setStreamReady(false);
    setLines((current) => [
      ...current,
      { id: nextId(), speaker: "system", text: options?.status ?? "Call ended." },
    ]);
    pushVoiceHealth("cleanupCompleted", {
      cleanupCompleted: true,
      finalPhase: "ended",
      currentPhase: "ended",
      currentWantMic: false,
      currentCallActive: false,
    });
    endCallInFlightRef.current = false;
  };

  const applySpeed = (value: number) => {
    speedRef.current = value;
    setSpeed(value);
  };

  const ensureAudioUnlocked = () => {
    // Called synchronously from the click handler (Test Call with Elena) so the
    // browser treats this gesture as the unlock for all later playback.
    unlockSpeechAudio(audioRef.current);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
    unlockedRef.current = true;
  };

  const playQueuedStudio = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    stopListening();
    setTapToListen(false);
    setSpeaking(true);
    audio.loop = false;
    audio.volume = 1;
    audio.onended = () => {
      keepAudioChannelAlive(audio);
      setTapToListen(false);
      afterSpeakingFinished();
    };
    try {
      await resumePersistentAudio(audio);
    } catch (cause) {
      console.error("[voice] Tap to listen failed", cause);
      setSpeaking(false);
    }
  };

  const speakAdvancedAudio = async (text: string) => {
    const lang = detectUtteranceLang(text);
    const el = await playOpenAiTtsMpeg(text, "marin", audioRef.current, lang, true);
    audioRef.current = el;
  };

  const speak = async (text: string) => {
    if (callPhaseRef.current === "ended") return;
    const greetingSpeak = voiceHealthGreetingRef.current;
    if (greetingSpeak) {
      voiceHealthGreetingRef.current = false;
      pushVoiceHealth("greetingTtsStarted", { greetingTtsStarted: true });
    }
    stopListening();
    applyCallPhase("speaking");
    const speakGen = genRef.current;
    let greetingFailed = false;

    try {
      if (heygen.ready) {
        const ok = await heygen.speakRepeat(text);
        if (ok) {
          await new Promise<void>((resolve) => {
            const startedAt = Date.now();
            const tick = () => {
              if (callPhaseRef.current === "ended") {
                resolve();
                return;
              }
              if (!heygenSpeakingRef.current && Date.now() - startedAt > 400) {
                resolve();
                return;
              }
              if (Date.now() - startedAt > 20000) {
                resolve();
                return;
              }
              window.setTimeout(tick, 200);
            };
            window.setTimeout(tick, 350);
          });
          return;
        }
      }
      await speakAdvancedAudio(text);
    } catch (cause) {
      if (greetingSpeak) {
        greetingFailed = true;
        pushVoiceHealth("greetingTtsFailed", {
          greetingTtsFailed: true,
          greetingTtsErrorName: sanitizedErrorName(cause),
        });
      }
      console.error("[voice] speak failed", cause);
      setLines((current) => [
        ...current,
        { id: nextId(), speaker: "system", text: "Voice playback unavailable — reply is in the transcript." },
      ]);
    } finally {
      if (greetingSpeak && !greetingFailed) {
        pushVoiceHealth("greetingTtsCompleted", { greetingTtsCompleted: true });
      }
      if (speakGen !== genRef.current) return;
      if (isSharedPcmPlaybackActive()) return;
      afterSpeakingFinished();
    }
  };

  const streamReply = async (displayText: string, spokenText = displayText) => {
    if (callPhaseRef.current === "ended") return;
    genRef.current += 1;
    stopListening();
    applyCallPhase("speaking");
    setPartialAi("");
    setLines((current) => [...current, { id: nextId(), speaker: "ai", text: displayText }]);
    try {
      await speak(spokenText);
    } catch (cause) {
      console.error("[voice] Studio TTS failed", cause);
    }
  };

  const ensureVoiceSession = () => {
    if (callActiveRef.current) return;
    setCallActive(true);
    setStreamReady(true);
    setLines((current) =>
      current.length
        ? current
        : [
            {
              id: nextId(),
              speaker: "system",
              text: `Mic session · ${selectedProperty.name} · ${profile.name}`,
            },
          ],
    );
  };

  const handleGuestUtterance = (raw: string) => {
    const text = raw.trim();
    if (!text || !selectedProperty) return;
    if (callPhaseRef.current === "thinking" || callPhaseRef.current === "speaking") return;
    if (testCallActiveRef.current) {
      testCallGuestTurnAcceptedRef.current = true;
      wantMicRef.current = false;
      pushVoiceHealth("guestTurnAccepted", { guestTurnAccepted: true });
    }
    ensureVoiceSession();
    callActiveRef.current = true;
    if (callPhaseRef.current === "ended") applyCallPhase("idle");
    stopListening();
    applyCallPhase("thinking");
    setPartialGuest("");
    setDraft("");
    setLines((current) => [...current, { id: nextId(), speaker: "guest", text }]);

    // The UI language selector is IMMUTABLE to voice input: if the user chose
    // "Auto" it stays "Auto" always. The per-turn language lives only in
    // currentTurnLangRef and is sent to the API for THIS utterance alone.
    const mode = languageRef.current;
    const detected = detectGuestLang(text);
    currentTurnLangRef.current = detected;

    const history = lines
      .filter((line) => line.speaker === "guest" || line.speaker === "ai")
      .slice(-6)
      .map((line) => ({ role: line.speaker === "guest" ? ("guest" as const) : ("ai" as const), text: line.text }));

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const started = performance.now();
    const question = `${LANGUAGE_MIRROR_INSTRUCTION}\n\nGuest: ${text}`;

    void (async () => {
      try {
        const reply = await askAvatarReply({
          question,
          property: selectedProperty,
          properties,
          // Pass the mode untouched: "auto" lets the server decide from
          // lastUserLang (this utterance only); es/en are forced manual modes.
          language: mode,
          // Language of THIS utterance, detected per message — the server uses
          // it for the override flag so English history never anchors replies.
          lastUserLang: detected,
          hours,
          emergencyNumber,
          openaiKey,
          history,
          signal: abort.signal,
        });
        if (callPhaseRef.current === "ended" || abort.signal.aborted) return;
        setLatencyMs(Math.round(performance.now() - started));
        setHostPlaces(reply.hostResults ?? []);
        setLivePlaces(reply.hostResults?.length ? [] : (reply.liveResults ?? []));
        await streamReply(reply.displayText, conciergeSpokenText(reply));
      } catch (cause) {
        if (abort.signal.aborted) return;
        console.error("[voice] avatar reply failed", cause);
        setLines((current) => [
          ...current,
          {
            id: nextId(),
            speaker: "system",
            text: "Elena could not reply just now. Try again or type your question.",
          },
        ]);
        if (testCallActiveRef.current) {
          endCall({ status: "Call ended.", autoEndReason: "response_completed" });
          return;
        }
        if (callPhaseRef.current === "thinking") afterSpeakingFinished();
      }
    })();
  };

  const startListening = () => {
    if (callPhaseRef.current === "ended") return;
    if (!wantMicRef.current || !callActiveRef.current) return;
    if (callPhaseRef.current === "speaking" || callPhaseRef.current === "thinking") return;
    if (isSharedPcmPlaybackActive()) return;
    if (recRef.current) return;
    if (testCallGuestTurnAcceptedRef.current) return;

    void (async () => {
      if (callPhaseRef.current === "ended") return;
      if (!wantMicRef.current || !callActiveRef.current) return;
      if (callPhaseRef.current === "speaking" || callPhaseRef.current === "thinking") return;
      if (isSharedPcmPlaybackActive()) return;
      if (recRef.current) return;
      if (testCallGuestTurnAcceptedRef.current) return;

      applyCallPhase("listening");
      const gen = ++listenGenRef.current;
      try {
        pushVoiceHealth("secondMicAcquireStarted", { secondMicAcquireStarted: true });
        const stream = await acquireMicrophoneStream();
        const listenTrack = stream.getAudioTracks()[0] ?? stream.getTracks()[0];
        pushVoiceHealth("secondMicAcquireSucceeded", {
          secondMicAcquireSucceeded: true,
          listenTrackCount: stream.getTracks().length,
          listenTrackReadyState: listenTrack?.readyState ?? "",
          listenTrackEnabled: listenTrack ? listenTrack.enabled : null,
          listenTrackMuted: listenTrack ? listenTrack.muted : null,
        });
        if (
          gen !== listenGenRef.current ||
          callPhaseRef.current !== "listening" ||
          !wantMicRef.current ||
          !callActiveRef.current
        ) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const session = startPushToTalkFromStream(stream, {
          onStop: (blob) => {
            recRef.current = null;
            cleanupVad();
            if (listenClipTimerRef.current) {
              window.clearTimeout(listenClipTimerRef.current);
              listenClipTimerRef.current = 0;
            }
            const matched = gen === listenGenRef.current;
            const stopReason = recordingStopReasonRef.current;
            pushVoiceHealth("recorderOnStop", {
              blobBytes: blob.size,
              phaseAtOnStop: callPhaseRef.current,
              listenGenerationMatched: matched,
              recorderMimeType: (blob.type || "").slice(0, 80),
              recordingStopReason: stopReason,
            });
            void (async () => {
              if (gen !== listenGenRef.current) return;
              if (callPhaseRef.current === "ended") return;
              if (callPhaseRef.current !== "listening") return;
              if (!callActiveRef.current || !wantMicRef.current) return;
              if (stopReason === "no_speech" || (stopReason && !shouldTranscribeForStopReason(stopReason))) {
                if (testCallActiveRef.current) {
                  endCall({ status: "No speech detected — test ended", autoEndReason: "no_speech" });
                }
                return;
              }
              try {
                const mode = languageRef.current;
                const lang = mode === "es" || mode === "en" ? mode : undefined;
                pushVoiceHealth("transcribeAttempted", { transcribeAttempted: true });
                const text = await transcribePushToTalkBlob(blob, lang);
                pushVoiceHealth("transcribeReturnedNonempty", {
                  transcribeReturnedNonempty: Boolean(text),
                });
                if (gen !== listenGenRef.current) return;
                if (callPhaseRef.current !== "listening") return;
                if (!callActiveRef.current || !wantMicRef.current) return;
                if (text) {
                  handleGuestUtterance(text);
                  return;
                }
              } catch (cause) {
                pushVoiceHealth("transcribeFailed", {
                  transcribeFailed: true,
                  transcribeErrorName: sanitizedErrorName(cause),
                });
                console.error("[voice] transcribe failed", cause);
                if (testCallActiveRef.current) {
                  endCall({ status: "No speech detected — test ended", autoEndReason: "transcribe_failed" });
                  return;
                }
                const message =
                  cause instanceof Error
                    ? cause.message
                    : "Could not transcribe speech. Try again, or type a question.";
                setLines((current) => [
                  ...current,
                  { id: nextId(), speaker: "system", text: message },
                ]);
              }
              if (testCallActiveRef.current) {
                endCall({ status: "No speech detected — test ended", autoEndReason: "no_speech" });
                return;
              }
              resumeListeningIfAllowed();
            })();
          },
        });
        recRef.current = session;
        pushVoiceHealth("recorderAssigned", { recorderAssigned: true });
        recordingStopReasonRef.current = "";
        cleanupVad();
        if (testCallActiveRef.current) {
          const vad = attachTestCallVad(stream, {
            generation: gen,
            isCurrent: () =>
              gen === listenGenRef.current &&
              callPhaseRef.current === "listening" &&
              testCallActiveRef.current &&
              Boolean(recRef.current),
            onSpeechDetected: () => {
              if (gen !== listenGenRef.current) return;
              pushVoiceHealth("speechDetected", {
                speechDetected: true,
                speechDetectedAtMs: voiceHealthElapsedMs(voiceHealthStartRef.current),
              });
            },
            onDecision: (reason, meta) => {
              if (gen !== listenGenRef.current) return;
              recordingStopReasonRef.current = reason;
              pushVoiceHealth("recordingStopReason", {
                recordingStopReason: reason,
                recordingDurationMs: meta.recordingDurationMs,
                silenceDetected: reason === "end_of_speech",
                silenceDurationMs: meta.silenceDurationMs || null,
              });
              if (reason === "no_speech") {
                try {
                  recRef.current?.cancel();
                } catch {
                  /* ignore */
                }
                recRef.current = null;
                endCall({ status: "No speech detected — test ended", autoEndReason: "no_speech" });
                return;
              }
              try {
                recRef.current?.stop();
              } catch {
                /* already stopped */
              }
            },
          });
          if (vad) {
            vadCleanupRef.current = vad.cleanup;
            pushVoiceHealth("vadStarted", { vadAvailable: true, vadStarted: true });
          } else {
            pushVoiceHealth("vadUnavailable", { vadAvailable: false, vadStarted: false });
            recordingStopReasonRef.current = "fixed_timer_fallback";
            listenClipTimerRef.current = window.setTimeout(() => {
              listenClipTimerRef.current = 0;
              recordingStopReasonRef.current = "fixed_timer_fallback";
              pushVoiceHealth("recorderStopRequested", {
                recorderStopRequested: true,
                recordingStopReason: "fixed_timer_fallback",
              });
              try {
                recRef.current?.stop();
              } catch {
                /* already stopped */
              }
            }, TEST_CALL_VAD.fallbackClipMs);
          }
        } else {
          listenClipTimerRef.current = window.setTimeout(() => {
            listenClipTimerRef.current = 0;
            pushVoiceHealth("recorderStopRequested", { recorderStopRequested: true });
            try {
              recRef.current?.stop();
            } catch {
              /* already stopped */
            }
          }, LISTEN_CLIP_MS);
        }
      } catch (cause) {
        pushVoiceHealth("secondMicAcquireFailed", {
          secondMicAcquireSucceeded: false,
          secondMicAcquireErrorName: sanitizedErrorName(cause),
        });
        console.error("[voice] microphone start failed", cause);
        wantMicRef.current = false;
        if (testCallActiveRef.current) {
          endCall({ status: "No speech detected — test ended", autoEndReason: "mic_failed" });
        } else if ((callPhaseRef.current as CallPhase) !== "ended") {
          applyCallPhase("idle");
        }
        const { message } = describeGetUserMediaFailure(cause);
        setLines((current) => [...current, { id: nextId(), speaker: "system", text: message }]);
      }
    })();
  };
  startListeningRef.current = startListening;

  const startCall = () => {
    if (callStartingRef.current || callActiveRef.current) {
      pushVoiceHealth("startCallEntered", { startCallEntered: true, callStartingAccepted: false });
      return;
    }
    resetVoiceHealth(language === "en" || language === "es" ? language : "auto");
    pushVoiceHealth("startCallEntered", { startCallEntered: true });
    pushVoiceHealth("callStartingAccepted", { callStartingAccepted: true, oneTurnMode: true });
    callStartingRef.current = true;
    endCallInFlightRef.current = false;
    testCallActiveRef.current = true;
    testCallGuestTurnAcceptedRef.current = false;
    ensureAudioUnlocked();
    pushVoiceHealth("audioUnlockSucceeded", { audioUnlockSucceeded: true });
    applyCallPhase("idle");
    wantMicRef.current = true;
    callActiveRef.current = true;
    sessionLangRef.current = language === "auto" ? "auto" : language;
    const greeting = buildGreeting({
      profile,
      language,
      hours,
      property: selectedProperty,
      lineNumber,
    });
    setCallActive(true);
    setStreamReady(true);
    setLatencyMs(null);
    setLines([
      {
        id: nextId(),
        speaker: "system",
        text: `Connected · ${lineNumber} · ${selectedProperty.name} · ${profile.name} · ${selectedProperty.timezone}`,
      },
    ]);
    clearTestCallLimitTimer();
    testCallLimitTimerRef.current = window.setTimeout(() => {
      testCallLimitTimerRef.current = 0;
      if (!testCallActiveRef.current && !callActiveRef.current) return;
      pushVoiceHealth("safetyTimerFired", { safetyTimerFired: true });
      endCall({ status: "Test ended automatically", autoEndReason: "safety_timeout" });
    }, TEST_CALL_LIMIT_MS);

    void (async () => {
      try {
        try {
          pushVoiceHealth("micProbeStarted", { micProbeStarted: true });
          const stream = await acquireMicrophoneStream();
          const probeTracks = stream.getTracks();
          pushVoiceHealth("micProbeSucceeded", {
            micProbeSucceeded: true,
            probeTrackCount: probeTracks.length,
          });
          probeTracks.forEach((track) => track.stop());
          pushVoiceHealth("probeTracksStopped", { probeTracksStopped: true });
        } catch (cause) {
          pushVoiceHealth("micProbeFailed", {
            micProbeSucceeded: false,
            micProbeErrorName: sanitizedErrorName(cause),
          });
          console.error("[voice] microphone permission denied", cause);
          wantMicRef.current = false;
          const { message } = describeGetUserMediaFailure(cause);
          setLines((current) => [...current, { id: nextId(), speaker: "system", text: message }]);
          endCall({ status: "No speech detected — test ended", autoEndReason: "mic_failed" });
          return;
        }
        if (!callActiveRef.current || callPhaseRef.current === "ended") return;
        voiceHealthGreetingRef.current = true;
        void streamReply(greeting);
      } catch (cause) {
        console.error("[voice] Test Call failed", cause);
        endCall({ status: "No speech detected — test ended", autoEndReason: "mic_failed" });
      } finally {
        callStartingRef.current = false;
      }
    })();
  };

  const playPreview = async (item: VoiceProfile) => {
    ensureAudioUnlocked();
    cancelSpeech();
    setVoiceId(item.id);
    setPreviewing(item.id);
    setSpeaking(true);
    const sample =
      language === "en" ? item.preview.en : language === "es" ? item.preview.es : item.preview.es;
    const gen = genRef.current;
    await speak(sample);
    if (gen === genRef.current) {
      setSpeaking(false);
      setPreviewing(null);
    }
  };

  const toggleListen = () => {
    ensureAudioUnlocked();
    if (listening || callPhaseRef.current === "listening") {
      wantMicRef.current = false;
      stopListening();
      if (callPhaseRef.current !== "ended") applyCallPhase("idle");
      return;
    }
    if (callPhaseRef.current === "speaking" || callPhaseRef.current === "thinking" || heygen.speaking) {
      cancelSpeech();
    }
    ensureVoiceSession();
    callActiveRef.current = true;
    if (callPhaseRef.current === "ended") applyCallPhase("idle");
    wantMicRef.current = true;
    resumeListeningIfAllowed();
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          AI Voice Concierge Settings
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">
          Human voice profiles, Florida routing, and a live receptionist avatar grounded in
          ai_handbook.
        </p>
      </div>

      <audio ref={audioRef} className="sr-only" preload="auto" playsInline />
      <div id="heygen" className="scroll-mt-28">
      <div id="ai-receptionist">
        {responding ? (
          <button
            type="button"
            onClick={() => {
              cancelSpeech();
            }}
            className="mb-3 w-full text-center text-xs font-medium text-sky-800 hover:underline"
          >
            Elena is responding... (tap to cancel)
          </button>
        ) : null}
        {tapToListen ? (
          <button
            type="button"
            onClick={() => void playQueuedStudio()}
            className="mb-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-white py-3 text-sm font-bold text-slate-950 hover:bg-slate-100"
          >
            <Play className="h-4 w-4" />
            Tap to listen
          </button>
        ) : null}
        {hostPlaces.length ? (
          <div className="mb-3">
            <HostGuideResults results={hostPlaces} />
          </div>
        ) : null}
        {livePlaces.length ? (
          <div className="mb-3">
            <GoogleMapsLiveResults results={livePlaces} />
          </div>
        ) : null}
        <AiReceptionistStudio
          phase={phase}
          voiceName={profile.name}
          properties={properties}
          selectedProperty={selectedProperty}
          propertyId={selectedProperty.id}
          onPropertyChange={setPropertyId}
          language={language}
          onLanguageChange={setLanguage}
          callActive={callActive}
          latencyMs={latencyMs}
          streamReady={streamReady || heygen.ready}
          connectionLabel={
            heygen.ready
              ? "Elena live · EN/ES · female voice"
              : streamReady
                ? "Audio stream ready · hospitality TTS"
                : "Standby · No media session"
          }
          lines={lines}
          partialAi={partialAi}
          partialGuest={partialGuest}
          draft={draft}
          onDraftChange={setDraft}
          onSimulateCall={startCall}
          onEndCall={() => endCall()}
          onSend={handleGuestUtterance}
          onListen={toggleListen}
          onStopSpeech={cancelSpeech}
          listening={listening}
          speaking={speaking || heygen.speaking}
          transcriptRef={scrollRef}
          videoRef={heygen.videoRef}
          videoReady={heygen.ready}
        />
        {VOICE_HEALTH_DEV ? (
          <VoiceHealthCheckPanel
            report={voiceHealth}
            fallbackJson={voiceHealthCopyFallback}
            copyStatus={voiceHealthCopyStatus}
            onCopy={async () => {
              const json = JSON.stringify(voiceHealth, null, 2);
              try {
                await navigator.clipboard.writeText(json);
                setVoiceHealthCopyFallback("");
                setVoiceHealthCopyStatus("Copied.");
              } catch {
                setVoiceHealthCopyFallback(json);
                setVoiceHealthCopyStatus("Clipboard blocked. Copy from the box below.");
              }
            }}
            onReset={() => {
              resetVoiceHealth(language === "en" || language === "es" ? language : "auto");
              setVoiceHealthCopyStatus("Diagnostics reset.");
            }}
          />
        ) : null}
      </div>
      </div>

      <div id="guest-qr" className="scroll-mt-28">
      <GuestQrCard property={selectedProperty} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="space-y-6">
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-5 w-5 text-sky-700" />
                <h3 className="font-semibold text-slate-900">Human voice profiles</h3>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">
                {engineLabel}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2">
              {VOICE_PROFILES.map((item) => {
                const active = voiceId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border px-4 py-3 transition-all ${
                      active
                        ? "border-sky-300 bg-sky-50"
                        : "border-slate-200 bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => setVoiceId(item.id)}
                        className="flex-1 text-left"
                      >
                        <div className="text-sm font-semibold text-slate-900">
                          {item.name}{" "}
                          <span className="font-medium text-slate-600">— {item.title}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">{item.hint}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => void playPreview(item)}
                        disabled={previewing === item.id}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                      >
                        <Play className="h-3 w-3" />
                        {previewing === item.id ? "Playing…" : "Preview"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Language</label>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as LanguageMode)}
                className={inputClass}
              >
                <option value="auto">Auto bilingual English/Spanish</option>
                <option value="en">English only</option>
                <option value="es">Spanish only</option>
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SliderField
                label="Speaking Speed"
                value={speed}
                min={0.85}
                max={1.08}
                step={0.01}
                display={`${speed.toFixed(2)}×`}
                onChange={applySpeed}
              />
              <SliderField
                label="Voice stability"
                value={stability}
                min={40}
                max={90}
                step={1}
                display={`${stability}%`}
                onChange={setStability}
              />
            </div>

            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  <p className="text-sm font-semibold text-slate-900">Studio TTS</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowKeys((value) => !value)}
                  className="text-slate-500 hover:text-slate-900"
                  aria-label={showKeys ? "Hide API keys" : "Show API keys"}
                >
                  {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-600">
                Audio is generated by /api/tts as a live PCM stream (gpt-4o-mini-tts, marin).
                Playback starts with the first audio chunk. Keys in .env.local or pasted here.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-slate-600">
                    ElevenLabs API Key
                  </label>
                  <input
                    type={showKeys ? "text" : "password"}
                    value={elevenKey}
                    autoComplete="off"
                    onChange={(event) => {
                      setElevenKey(event.target.value);
                      persistKeys(event.target.value, openaiKey);
                    }}
                    placeholder="xi-… or sk_…"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-slate-600">
                    OpenAI TTS API Key
                  </label>
                  <input
                    type={showKeys ? "text" : "password"}
                    value={openaiKey}
                    autoComplete="off"
                    onChange={(event) => {
                      setOpenaiKey(event.target.value);
                      persistKeys(elevenKey, event.target.value);
                    }}
                    placeholder="sk-…"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
              </div>
              <p className="text-[11px] text-sky-800">
                {studioReady
                  ? "Studio audio enabled. Previews and test calls use /api/tts MP3."
                  : "Uses ELEVENLABS_API_KEY or OPENAI_API_KEY from the server if no key is pasted here."}
              </p>
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Phone className="h-5 w-5 text-sky-700" />
                <h3 className="font-semibold text-slate-900">Phone routing</h3>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                Twilio SIP Connected
              </span>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">Inbound DID by listing</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {properties.map((item) => {
                  const active = item.id === selectedProperty?.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setPropertyId(item.id)}
                      className={`rounded-xl border px-4 py-3 text-left transition-all ${
                        active
                          ? "border-sky-400 bg-sky-50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300"
                      }`}
                    >
                      <div className="font-mono text-sm font-bold text-slate-900">
                        {item.assignedPhoneNumber || "No DID yet"}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-600">
                        {item.assignedAvatarName} · {item.name} · {item.timezone}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        Local {localTimeLabel(item.timezone)}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">
                Host emergency forwarding
              </label>
              <input
                value={emergencyNumber}
                onChange={(event) => setEmergencyNumber(event.target.value)}
                className={`${inputClass} font-mono`}
                aria-label="Emergency forwarding number"
              />
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                Instant transfer on severe incidents: water leaks, broken locks, lockouts.
              </p>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-slate-600">AI coverage hours</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setHours("always")}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                    hours === "always"
                      ? "border-sky-400 bg-sky-50 text-sky-900"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  24/7
                </button>
                <button
                  type="button"
                  onClick={() => setHours("night")}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-all ${
                    hours === "night"
                      ? "border-violet-300 bg-violet-50 text-violet-900"
                      : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  Overnight (10 PM–8 AM)
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        <span className="font-mono text-[11px] text-slate-500">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-sky-600"
      />
    </div>
  );
}

function VoiceHealthCheckPanel({
  report,
  fallbackJson,
  copyStatus,
  onCopy,
  onReset,
}: {
  report: VoiceHealthReport;
  fallbackJson: string;
  copyStatus: string;
  onCopy: () => void | Promise<void>;
  onReset: () => void;
}) {
  const micProbe = report.micProbeErrorName
    ? "Failed"
    : report.micProbeSucceeded
      ? "Passed"
      : report.micProbeStarted
        ? "Pending"
        : "Pending";
  const listeningStream = report.secondMicAcquireErrorName
    ? "Failed"
    : report.secondMicAcquireSucceeded
      ? "Started"
      : "Not started";
  const recorder = report.recorderOnStopCount > 0
    ? "Stopped"
    : report.recorderAssigned
      ? "Recording"
      : "Not started";
  const transcription = report.transcribeFailed
    ? "Failed"
    : report.transcribeReturnedNonempty === true
      ? "Returned"
      : report.transcribeAttempted && report.transcribeReturnedNonempty === false
        ? "Empty"
        : report.transcribeAttempted
          ? "Attempted"
          : "Not attempted";

  return (
    <section className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950">
      <h3 className="text-xs font-semibold uppercase tracking-wide">Voice Health Check (dev only)</h3>
      <p className="mt-1 text-[11px] text-amber-900">
        After one Test Call, copy this report. It has no transcript, audio, or listing details.
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        <li>Current phase: {report.currentPhase || "idle"}</li>
        <li>Mic probe: {micProbe}</li>
        <li>Listening stream: {listeningStream}</li>
        <li>Recorder: {recorder}</li>
        <li>Audio bytes: {report.blobBytes == null ? "—" : String(report.blobBytes)}</li>
        <li>Transcription: {transcription}</li>
        <li>Safety timer: {report.safetyTimerFired ? "Fired" : "Not fired"}</li>
        <li>Run: {report.runNumber} · language: {report.languageMode}</li>
      </ul>
      <ol className="mt-2 max-h-36 list-decimal space-y-0.5 overflow-y-auto pl-4 text-[11px] text-slate-800">
        {report.events.length ? (
          report.events.map((item, index) => (
            <li key={`${item.ms}-${item.name}-${index}`}>
              +{item.ms}ms {item.name}
            </li>
          ))
        ) : (
          <li>No events yet. Press Test Call with Elena.</li>
        )}
      </ol>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-amber-800 px-3 py-1.5 text-[11px] font-semibold text-white"
          onClick={() => void onCopy()}
        >
          Copy diagnostics
        </button>
        <button
          type="button"
          className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-950"
          onClick={onReset}
        >
          Reset diagnostics
        </button>
      </div>
      {copyStatus ? <p className="mt-1 text-[11px] text-amber-900">{copyStatus}</p> : null}
      {fallbackJson ? (
        <textarea
          readOnly
          value={fallbackJson}
          className="mt-2 h-32 w-full rounded-lg border border-amber-200 bg-white p-2 font-mono text-[10px] text-slate-800"
        />
      ) : null}
    </section>
  );
}

function nightNote(hours: HoursMode, lang: ReplyLang) {
  if (hours !== "night") return "";
  return lang === "es"
    ? " Por cierto, estás en la línea nocturna. Aquí estoy, con calma, a cualquier hora."
    : " And just so you know, this is the overnight line. I'm here, unhurried, whenever you need me.";
}

function buildGreeting({
  profile,
  language,
  hours,
  property,
  lineNumber,
}: {
  profile: VoiceProfile;
  language: LanguageMode;
  hours: HoursMode;
  property: Property;
  lineNumber: string;
}) {
  if (language === "auto") {
    return AUTO_GREETING;
  }

  const lang: ReplyLang = language === "en" ? "en" : "es";
  const night = nightNote(hours, lang);

  if (profile.id === "mateo") {
    return lang === "es"
      ? `Buenas noches. Soy tu conserje en ${property.name}, ${property.address}, ${property.city}. Qué gusto atenderle. Está usted en la ${lineNumber}.${night} Deme un momento. ¿En qué puedo servirle?`
      : `Good evening. This is your concierge for ${property.name}, ${property.address}, ${property.city}. A pleasure to greet you on ${lineNumber}.${night} Take your time. How may I help?`;
  }

  if (profile.id === "sarah") {
    return lang === "es"
      ? `Hola. Soy Sarah, tu host en ${property.name}, ${property.address}, ${property.city}. Qué bueno que llamas. Estás en la ${lineNumber}.${night} Dime, ¿qué necesitas?`
      : `Hey. I'm Sarah, your host at ${property.name}, ${property.address}, ${property.city}. So glad you called. You're on ${lineNumber}.${night} What's going on? I'm here.`;
  }

  return lang === "es"
    ? `Hola. Qué gusto escucharte. Soy ${profile.name}, tu anfitriona de ${property.name}, en ${property.address}, ${property.city}. Llamas al ${lineNumber}.${night} Cuéntame. ¿En qué te ayudo hoy?`
    : `Hi there. So nice to hear from you. I'm ${profile.name}, your host at ${property.name}, ${property.address}, ${property.city}. You're on ${lineNumber}.${night} Tell me. What can I do for you?`;
}
