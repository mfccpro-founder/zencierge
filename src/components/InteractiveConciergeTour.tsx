"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  HOST_TOUR_COMMAND_EVENT,
  HOST_TOUR_SPEECH_RATE,
  HOST_TOUR_UI,
  applyTourCommand,
  buildSpokenScript,
  commandForRedStopButton,
  createTourState,
  isGuideModuleLocationActive,
  isUserGuidePath,
  markTourSpeaking,
  matchGuideModuleIndex,
  pickGuideVoice,
  setHostTourHighlight,
  type HostTourCommandDetail,
  type TourCommand,
  type TourEffects,
  type TourState,
} from "@/lib/host-guide-tour";
import {
  buildHostGuideModules,
  getHostGuideLangServerSnapshot,
  getHostGuideLangSnapshot,
  subscribeHostGuideLang,
} from "@/lib/host-guide-content";
import {
  buildSaturdayDemoModules,
  fetchSaturdayDemoVerification,
  type SaturdayDemoModule,
} from "@/lib/saturday-demo-tour";

const shell =
  "sticky top-20 z-30 mb-4 w-full max-w-full overflow-hidden rounded-xl border border-sky-400/40 bg-slate-950 text-white shadow-lg";
const btnClass =
  "rounded-lg bg-sky-400 px-2 py-1 text-[11px] font-extrabold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
const btnDanger =
  "rounded-lg bg-rose-500 px-2 py-1 text-[11px] font-extrabold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40";

function HostGuideTourInner() {
  const router = useRouter();
  const pathname = usePathname() || "/dashboard";
  const tab = useSearchParams().get("tab");
  const lang = useSyncExternalStore(subscribeHostGuideLang, getHostGuideLangSnapshot, getHostGuideLangServerSnapshot);
  const [sequence, setSequence] = useState<"host" | "saturday">("host");
  const hostModules = useMemo(() => buildHostGuideModules(lang), [lang]);
  const saturdayModules = useMemo(() => buildSaturdayDemoModules(lang), [lang]);
  const modules = sequence === "saturday" ? saturdayModules : hostModules;
  const ids = useMemo(() => modules.map((mod) => mod.id), [modules]);
  const ui = HOST_TOUR_UI[lang];
  const [state, setState] = useState<TourState>(createTourState);
  const [status, setStatus] = useState("");
  const [verifiedIndex, setVerifiedIndex] = useState<number | null>(null);
  const [trackedRequestId, setTrackedRequestId] = useState<string | null>(null);
  const [demoStartedAt, setDemoStartedAt] = useState<string | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);
  const stateRef = useRef(state);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakTimerRef = useRef<number | null>(null);
  const voiceCacheRef = useRef<{ lang: typeof lang; voice: SpeechSynthesisVoice } | null>(null);
  const modulesRef = useRef(modules);
  const idsRef = useRef(ids);
  const langRef = useRef(lang);
  const uiRef = useRef(ui);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    modulesRef.current = modules;
    idsRef.current = ids;
  }, [ids, modules]);
  useEffect(() => {
    langRef.current = lang;
    uiRef.current = ui;
    voiceCacheRef.current = null;
  }, [lang, ui]);

  const speechAvailable = typeof window !== "undefined" && "speechSynthesis" in window;

  const clearScheduledSpeak = useCallback(() => {
    if (speakTimerRef.current != null) {
      window.clearTimeout(speakTimerRef.current);
      speakTimerRef.current = null;
    }
  }, []);

  const cancelSpeech = useCallback(() => {
    utteranceRef.current = null;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speakCurrent = useCallback((tour: TourState) => {
    if (stateRef.current.generation !== tour.generation) return;
    const mod = modulesRef.current[tour.index];
    if (!mod) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setStatus(uiRef.current.noSpeech);
      return;
    }
    const text = buildSpokenScript(mod);
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = langRef.current === "es" ? "es-US" : "en-US";
    utterance.rate = HOST_TOUR_SPEECH_RATE;
    utterance.pitch = 1;
    const cached = voiceCacheRef.current;
    const voice =
      cached?.lang === langRef.current
        ? cached.voice
        : (() => {
            const picked = pickGuideVoice(window.speechSynthesis.getVoices(), langRef.current);
            if (picked) voiceCacheRef.current = { lang: langRef.current, voice: picked as SpeechSynthesisVoice };
            return picked as SpeechSynthesisVoice | undefined;
          })();
    if (voice) utterance.voice = voice;
    const generation = tour.generation;
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      const ended = applyTourCommand(
        stateRef.current,
        { type: "speechEnded", generation },
        modulesRef.current.length,
        idsRef.current,
      );
      stateRef.current = ended.state;
      setState(ended.state);
    };
    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return;
      utteranceRef.current = null;
      const ended = applyTourCommand(
        stateRef.current,
        { type: "speechEnded", generation },
        modulesRef.current.length,
        idsRef.current,
      );
      stateRef.current = ended.state;
      setState(ended.state);
    };
    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    const speaking = markTourSpeaking(tour);
    stateRef.current = speaking;
    setState(speaking);
  }, []);

  const applyFx = useCallback(
    (fx: TourEffects) => {
      if (fx.cancel) {
        clearScheduledSpeak();
        cancelSpeech();
      }
      if (fx.pause && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.pause();
      if (fx.resume && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.resume();
      setHostTourHighlight(fx.highlightId ?? "");
      stateRef.current = fx.state;
      setState(fx.state);
      if (fx.messageKey === "undocumented") setStatus(uiRef.current.undocumented);
      else if (fx.messageKey === "needRepeat") setStatus(uiRef.current.needRepeat);
      else if (fx.finished) setStatus("");
      if (fx.navigateIndex !== null) {
        const href = modulesRef.current[fx.navigateIndex]?.href;
        if (href) router.push(href);
      }
      if (fx.speak) {
        clearScheduledSpeak();
        speakTimerRef.current = window.setTimeout(() => {
          speakTimerRef.current = null;
          if (stateRef.current.generation !== fx.state.generation) return;
          speakCurrent(fx.state);
        }, 0);
      }
      if (fx.state.mode === "tour") {
        const prevHref = modulesRef.current[fx.state.index - 1]?.href;
        const nextHref = modulesRef.current[fx.state.index + 1]?.href;
        if (prevHref) router.prefetch(prevHref);
        if (nextHref) router.prefetch(nextHref);
      }
    },
    [cancelSpeech, clearScheduledSpeak, router, speakCurrent],
  );

  const run = useCallback(
    (command: TourCommand) => {
      applyFx(applyTourCommand(stateRef.current, command, modulesRef.current.length, idsRef.current));
    },
    [applyFx],
  );

  useEffect(() => {
    const tour = stateRef.current;
    if (!tour.pendingSpeak) return;
    const currentModule = modulesRef.current[tour.index];
    applyFx(
      applyTourCommand(
        tour,
        { type: "routeSettled", locationMatchesCurrent: Boolean(currentModule && isGuideModuleLocationActive(pathname, tab, currentModule)) },
        modulesRef.current.length,
        idsRef.current,
      ),
    );
  }, [applyFx, pathname, state.index, state.pendingSpeak, tab]);

  const activateSequence = useCallback((nextSequence: "host" | "saturday") => {
    const nextModules = nextSequence === "saturday" ? saturdayModules : hostModules;
    modulesRef.current = nextModules;
    idsRef.current = nextModules.map((mod) => mod.id);
    setSequence(nextSequence);
    setVerifiedIndex(null);
    setTrackedRequestId(null);
    setDemoStartedAt(nextSequence === "saturday" ? new Date().toISOString() : null);
    setCheckingServer(false);
    setStatus("");
    applyFx(applyTourCommand(stateRef.current, { type: "start" }, nextModules.length, idsRef.current));
  }, [applyFx, hostModules, saturdayModules]);

  const advanceSaturdayDemo = useCallback(async () => {
    const index = stateRef.current.index;
    const step = modulesRef.current[index] as SaturdayDemoModule | undefined;
    if (!step || stateRef.current.mode !== "tour") return;
    if (step.requirement === "manual" || verifiedIndex === index) {
      setVerifiedIndex(null);
      setStatus("");
      run({ type: "next" });
      return;
    }
    setCheckingServer(true);
    setStatus(lang === "es" ? "Comprobando el estado real en el servidor…" : "Checking the real server state…");
    try {
      const result = await fetchSaturdayDemoVerification({
        requirement: step.requirement,
        trackedRequestId,
        lang,
        startedAt: demoStartedAt ?? undefined,
      });
      setStatus(result.message);
      if (result.ok) {
        setTrackedRequestId(result.requestId);
        setVerifiedIndex(index);
      }
    } catch {
      setStatus(lang === "es" ? "No se pudo consultar el servidor. No se confirmó el resultado." : "The server could not be reached. The result was not confirmed.");
    } finally {
      setCheckingServer(false);
    }
  }, [demoStartedAt, lang, run, trackedRequestId, verifiedIndex]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<HostTourCommandDetail>).detail;
      if (!detail) return;
      if (detail.type === "start") activateSequence("host");
      if (detail.type === "explain") {
        modulesRef.current = hostModules;
        idsRef.current = hostModules.map((mod) => mod.id);
        setSequence("host");
        const matched = isUserGuidePath(pathname) ? -1 : matchGuideModuleIndex(pathname, tab, hostModules);
        run({ type: "explain", matchedIndex: matched >= 0 ? matched : null });
      }
      if (detail.type === "listen") {
        modulesRef.current = hostModules;
        idsRef.current = hostModules.map((mod) => mod.id);
        setSequence("host");
        const index = idsRef.current.indexOf(detail.moduleId);
        if (index >= 0) run({ type: "listen", index });
      }
    };
    window.addEventListener(HOST_TOUR_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(HOST_TOUR_COMMAND_EVENT, onCommand);
  }, [activateSequence, hostModules, pathname, run, tab]);

  useEffect(() => {
    return subscribeHostGuideLang(() => {
      applyFx(applyTourCommand(stateRef.current, { type: "languageChanged" }, modulesRef.current.length, idsRef.current));
    });
  }, [applyFx]);

  useEffect(() => {
    return () => {
      clearScheduledSpeak();
      cancelSpeech();
      setHostTourHighlight("");
    };
  }, [cancelSpeech, clearScheduledSpeak]);

  if (!pathname.startsWith("/dashboard")) return null;

  const current = modules[state.index];
  const active = state.mode !== "idle";
  const last = state.index >= modules.length - 1;
  const demoStep = sequence === "saturday" ? (current as SaturdayDemoModule | undefined) : undefined;
  const demoNeedsVerification = demoStep?.requirement !== undefined && demoStep.requirement !== "manual";
  const demoVerified = verifiedIndex === state.index;
  const demoUi = lang === "es"
    ? { start: "Demo del sábado", verify: "Verificar en servidor", continue: "Continuar", verified: "Resultado operativo confirmado por el servidor." }
    : { start: "Saturday demo", verify: "Verify on server", continue: "Continue", verified: "Operational result confirmed by the server." };

  return (
    <aside aria-label={ui.title} className={shell}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <p className="text-xs font-black tracking-tight">
          zen<span className="text-sky-400">cierge</span>
          <span className="ml-2 text-[10px] font-bold uppercase text-slate-400">{ui.title}</span>
        </p>
        <span className="text-[10px] font-medium text-slate-400">{ui.step(state.index + 1, modules.length)}</span>
      </div>
      <div className="px-3 py-2">
        <h4 className="text-xs font-bold text-white">{active && current ? current.title : ui.idleHint}</h4>
        {active && current ? <p className="mt-1 text-[11px] leading-relaxed text-slate-200">{current.summary}</p> : null}
        {status ? <p className="mt-1 text-[11px] leading-snug text-amber-200">{status}</p> : null}
        {!speechAvailable ? <p className="mt-1 text-[11px] leading-snug text-amber-200">{ui.noSpeech}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-slate-800 px-3 py-2">
        <button type="button" className={btnClass} onClick={() => activateSequence("host")}>
          {ui.start}
        </button>
        <button type="button" className={btnClass} onClick={() => activateSequence("saturday")}>
          {demoUi.start}
        </button>
        <button
          type="button"
          className={btnClass}
          onClick={() => {
            const matched = isUserGuidePath(pathname) ? -1 : matchGuideModuleIndex(pathname, tab, modules);
            run({ type: "explain", matchedIndex: matched >= 0 ? matched : null });
          }}
        >
          {ui.explain}
        </button>
        <button type="button" className={btnClass} disabled={state.speech !== "speaking"} onClick={() => run({ type: "pause" })}>
          {ui.pause}
        </button>
        <button type="button" className={btnClass} disabled={state.speech !== "paused"} onClick={() => run({ type: "resume" })}>
          {ui.resume}
        </button>
        <button type="button" className={btnClass} disabled={!active} onClick={() => run({ type: "repeat" })}>
          {ui.repeat}
        </button>
        <button
          type="button"
          className={btnClass}
          disabled={state.mode !== "tour" || state.index <= 0}
          onClick={() => {
            setVerifiedIndex(null);
            setStatus("");
            run({ type: "previous" });
          }}
        >
          {ui.previous}
        </button>
        {sequence === "saturday" ? (
          <button type="button" className={btnClass} disabled={state.mode !== "tour" || checkingServer} onClick={() => void advanceSaturdayDemo()}>
            {demoNeedsVerification && !demoVerified ? demoUi.verify : state.mode === "tour" && last ? ui.finish : demoUi.continue}
          </button>
        ) : (
          <button type="button" className={btnClass} disabled={state.mode !== "tour"} onClick={() => run({ type: "next" })}>
            {state.mode === "tour" && last ? ui.finish : ui.next}
          </button>
        )}
        <button type="button" className={btnDanger} onClick={() => run(commandForRedStopButton(state))}>
          {ui.stop}
        </button>
      </div>
      {sequence === "saturday" && demoVerified ? (
        <p className="border-t border-emerald-400/30 bg-emerald-950/40 px-3 py-2 text-[11px] font-semibold text-emerald-200" role="status">
          {demoUi.verified} {demoUi.continue}.
        </p>
      ) : null}
    </aside>
  );
}

export function InteractiveConciergeTour() {
  return (
    <Suspense fallback={null}>
      <HostGuideTourInner />
    </Suspense>
  );
}

export default InteractiveConciergeTour;
