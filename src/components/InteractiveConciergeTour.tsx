"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  HOST_TOUR_COMMAND_EVENT,
  HOST_TOUR_UI,
  applyTourCommand,
  buildSpokenScript,
  createTourState,
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

const shell =
  "relative z-30 mb-4 w-full max-w-full overflow-hidden rounded-xl border border-sky-400/40 bg-slate-950 text-white shadow-lg";
const btnClass =
  "rounded-lg bg-sky-400 px-2 py-1 text-[11px] font-extrabold text-slate-950 hover:bg-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
const btnDanger =
  "rounded-lg bg-rose-500 px-2 py-1 text-[11px] font-extrabold text-white hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40";

/** Red Stop is a user pause while narration is playing; terminal `stop` stays for cleanup/unmount. */
export function commandForRedStopButton(state: Pick<TourState, "speech">): TourCommand {
  if (state.speech === "speaking") return { type: "pause" };
  return { type: "stop" };
}

function HostGuideTourInner() {
  const router = useRouter();
  const pathname = usePathname() || "/dashboard";
  const tab = useSearchParams().get("tab");
  const lang = useSyncExternalStore(subscribeHostGuideLang, getHostGuideLangSnapshot, getHostGuideLangServerSnapshot);
  const modules = useMemo(() => buildHostGuideModules(lang), [lang]);
  const ids = useMemo(() => modules.map((mod) => mod.id), [modules]);
  const ui = HOST_TOUR_UI[lang];
  const [state, setState] = useState<TourState>(createTourState);
  const [status, setStatus] = useState("");
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
    utterance.rate = 1;
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
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<HostTourCommandDetail>).detail;
      if (!detail) return;
      if (detail.type === "start") run({ type: "start" });
      if (detail.type === "explain") {
        const matched = isUserGuidePath(pathname) ? -1 : matchGuideModuleIndex(pathname, tab, modulesRef.current);
        run({ type: "explain", matchedIndex: matched >= 0 ? matched : null });
      }
      if (detail.type === "listen") {
        const index = idsRef.current.indexOf(detail.moduleId);
        if (index >= 0) run({ type: "listen", index });
      }
    };
    window.addEventListener(HOST_TOUR_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(HOST_TOUR_COMMAND_EVENT, onCommand);
  }, [pathname, run, tab]);

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
        {status ? <p className="mt-1 text-[11px] leading-snug text-amber-200">{status}</p> : null}
        {!speechAvailable ? <p className="mt-1 text-[11px] leading-snug text-amber-200">{ui.noSpeech}</p> : null}
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-slate-800 px-3 py-2">
        <button type="button" className={btnClass} onClick={() => run({ type: "start" })}>
          {ui.start}
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
          onClick={() => run({ type: "previous" })}
        >
          {ui.previous}
        </button>
        <button type="button" className={btnClass} disabled={state.mode !== "tour"} onClick={() => run({ type: "next" })}>
          {state.mode === "tour" && last ? ui.finish : ui.next}
        </button>
        <button type="button" className={btnDanger} onClick={() => run(commandForRedStopButton(state))}>
          {ui.stop}
        </button>
      </div>
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
