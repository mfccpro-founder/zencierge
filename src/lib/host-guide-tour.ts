import {
  buildHostGuideModules,
  hostGuideModuleCount,
  type GuideLang,
  type HostGuideModule,
} from "@/lib/host-guide-content";
import { USER_GUIDE_PATH, guideableHostNavItems, isHostNavItemActive, normalizePathname } from "@/lib/host-nav";

export const HOST_TOUR_COMMAND_EVENT = "zencierge-host-guide-tour";
export const HOST_TOUR_HIGHLIGHT_EVENT = "zencierge-host-guide-highlight";

export type HostTourCommandDetail =
  | { type: "start" }
  | { type: "explain" }
  | { type: "listen"; moduleId: string };

export type TourMode = "idle" | "tour" | "explain";
export type SpeechStatus = "idle" | "speaking" | "paused";

export type TourState = {
  mode: TourMode;
  index: number;
  speech: SpeechStatus;
  pendingSpeak: boolean;
  generation: number;
};

export type TourCommand =
  | { type: "start" }
  | { type: "explain"; matchedIndex: number | null }
  | { type: "listen"; index: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "repeat" }
  | { type: "previous" }
  | { type: "next" }
  | { type: "stop" }
  | { type: "routeSettled"; locationMatchesCurrent: boolean }
  | { type: "speechEnded"; generation: number }
  | { type: "languageChanged" };

export type TourEffects = {
  state: TourState;
  navigateIndex: number | null;
  speak: boolean;
  cancel: boolean;
  pause: boolean;
  resume: boolean;
  highlightId: string | null;
  finished: boolean;
  messageKey?: "undocumented" | "needRepeat";
};

export const HOST_TOUR_UI = {
  en: {
    title: "Host guided tour",
    start: "Start Guided Tour",
    explain: "Explain This Page",
    pause: "Pause",
    resume: "Resume",
    repeat: "Repeat",
    previous: "Previous",
    next: "Next",
    finish: "Finish",
    stop: "Stop",
    step: (current: number, total: number) => `Step ${current} of ${total}`,
    undocumented: "This page is not part of the 16-module host guide. Open a sidebar module or start the guided tour.",
    noSpeech: "Spoken audio is not available in this browser. You can still use Previous, Next, and the written User Guide.",
    needRepeat: "Language changed. Press Repeat or Resume to continue in the new language.",
    idleHint: "Start a full tour or explain the page you are on.",
  },
  es: {
    title: "Recorrido guiado",
    start: "Iniciar recorrido",
    explain: "Explicar esta página",
    pause: "Pausar",
    resume: "Continuar",
    repeat: "Repetir",
    previous: "Anterior",
    next: "Siguiente",
    finish: "Finalizar",
    stop: "Detener",
    step: (current: number, total: number) => `Paso ${current} de ${total}`,
    undocumented: "Esta página no forma parte de los 16 módulos de la guía. Abre un módulo de la barra o inicia el recorrido.",
    noSpeech: "Este navegador no puede hablar la guía. Igual puedes usar Anterior, Siguiente y la guía escrita.",
    needRepeat: "Cambió el idioma. Pulsa Repetir o Continuar para seguir en el idioma nuevo.",
    idleHint: "Inicia el recorrido completo o explica la página actual.",
  },
} as const;

export function createTourState(): TourState {
  return { mode: "idle", index: 0, speech: "idle", pendingSpeak: false, generation: 0 };
}

function bump(state: TourState): TourState {
  return { ...state, generation: state.generation + 1 };
}

export function applyTourCommand(state: TourState, command: TourCommand, stepCount: number, moduleIds: string[]): TourEffects {
  const last = Math.max(0, stepCount - 1);
  const idAt = (index: number) => moduleIds[index] ?? null;

  if (command.type === "stop") {
    const next = bump({ ...state, mode: "idle", speech: "idle", pendingSpeak: false });
    return { state: next, navigateIndex: null, speak: false, cancel: true, pause: false, resume: false, highlightId: null, finished: false };
  }

  if (command.type === "start") {
    const next = bump({ mode: "tour", index: 0, speech: "idle", pendingSpeak: false, generation: state.generation });
    return { state: next, navigateIndex: 0, speak: true, cancel: true, pause: false, resume: false, highlightId: idAt(0), finished: false };
  }

  if (command.type === "explain") {
    if (command.matchedIndex === null) {
      const next = bump({ ...state, mode: "idle", speech: "idle", pendingSpeak: false });
      return {
        state: next,
        navigateIndex: null,
        speak: false,
        cancel: true,
        pause: false,
        resume: false,
        highlightId: null,
        finished: false,
        messageKey: "undocumented",
      };
    }
    const next = bump({
      mode: "explain",
      index: command.matchedIndex,
      speech: "idle",
      pendingSpeak: false,
      generation: state.generation,
    });
    return {
      state: next,
      navigateIndex: null,
      speak: true,
      cancel: true,
      pause: false,
      resume: false,
      highlightId: idAt(command.matchedIndex),
      finished: false,
    };
  }

  if (command.type === "listen") {
    const next = bump({
      mode: "explain",
      index: command.index,
      speech: "idle",
      pendingSpeak: false,
      generation: state.generation,
    });
    return { state: next, navigateIndex: null, speak: true, cancel: true, pause: false, resume: false, highlightId: idAt(command.index), finished: false };
  }

  if (command.type === "pause") {
    if (state.speech !== "speaking") {
      return { state, navigateIndex: null, speak: false, cancel: false, pause: false, resume: false, highlightId: idAt(state.index), finished: false };
    }
    return {
      state: { ...state, speech: "paused" },
      navigateIndex: null,
      speak: false,
      cancel: false,
      pause: true,
      resume: false,
      highlightId: idAt(state.index),
      finished: false,
    };
  }

  if (command.type === "resume") {
    if (state.speech !== "paused") {
      return { state, navigateIndex: null, speak: false, cancel: false, pause: false, resume: false, highlightId: idAt(state.index), finished: false };
    }
    return {
      state: { ...state, speech: "speaking" },
      navigateIndex: null,
      speak: false,
      cancel: false,
      pause: false,
      resume: true,
      highlightId: idAt(state.index),
      finished: false,
    };
  }

  if (command.type === "repeat") {
    if (state.mode === "idle") {
      return { state, navigateIndex: null, speak: false, cancel: false, pause: false, resume: false, highlightId: null, finished: false };
    }
    const next = bump({ ...state, speech: "idle", pendingSpeak: false });
    return { state: next, navigateIndex: null, speak: true, cancel: true, pause: false, resume: false, highlightId: idAt(state.index), finished: false };
  }

  if (command.type === "previous") {
    if (state.mode !== "tour" || state.index <= 0) {
      return { state, navigateIndex: null, speak: false, cancel: false, pause: false, resume: false, highlightId: idAt(state.index), finished: false };
    }
    const index = state.index - 1;
    const next = bump({ ...state, index, speech: "idle", pendingSpeak: false });
    return { state: next, navigateIndex: index, speak: true, cancel: true, pause: false, resume: false, highlightId: idAt(index), finished: false };
  }

  if (command.type === "next") {
    if (state.mode !== "tour") {
      return { state, navigateIndex: null, speak: false, cancel: false, pause: false, resume: false, highlightId: idAt(state.index), finished: false };
    }
    if (state.index >= last) {
      const next = bump({ ...state, mode: "idle", speech: "idle", pendingSpeak: false });
      return { state: next, navigateIndex: null, speak: false, cancel: true, pause: false, resume: false, highlightId: null, finished: true };
    }
    const index = state.index + 1;
    const next = bump({ ...state, index, speech: "idle", pendingSpeak: false });
    return { state: next, navigateIndex: index, speak: true, cancel: true, pause: false, resume: false, highlightId: idAt(index), finished: false };
  }

  if (command.type === "routeSettled") {
    return {
      state,
      navigateIndex: null,
      speak: false,
      cancel: false,
      pause: false,
      resume: false,
      highlightId: idAt(state.index),
      finished: false,
    };
  }

  if (command.type === "speechEnded") {
    if (command.generation !== state.generation) {
      return { state, navigateIndex: null, speak: false, cancel: false, pause: false, resume: false, highlightId: idAt(state.index), finished: false };
    }
    return {
      state: { ...state, speech: "idle" },
      navigateIndex: null,
      speak: false,
      cancel: false,
      pause: false,
      resume: false,
      highlightId: idAt(state.index),
      finished: false,
    };
  }

  if (command.type === "languageChanged") {
    if (state.mode === "idle") {
      return { state, navigateIndex: null, speak: false, cancel: true, pause: false, resume: false, highlightId: null, finished: false };
    }
    const next = bump({ ...state, speech: "idle", pendingSpeak: false });
    return {
      state: next,
      navigateIndex: null,
      speak: false,
      cancel: true,
      pause: false,
      resume: false,
      highlightId: idAt(state.index),
      finished: false,
      messageKey: "needRepeat",
    };
  }

  return { state, navigateIndex: null, speak: false, cancel: false, pause: false, resume: false, highlightId: idAt(state.index), finished: false };
}

export function markTourSpeaking(state: TourState): TourState {
  return { ...state, speech: "speaking" };
}

export function buildSpokenScript(module: HostGuideModule) {
  const steps = module.steps.map((step) => `${step.title}. ${step.body}`).join(" ");
  return `${module.title}. ${module.summary} ${steps}`.replace(/\s+/g, " ").trim();
}

export function matchGuideModuleIndex(pathname: string, tab: string | null, modules: HostGuideModule[] = buildHostGuideModules("en")) {
  const items = guideableHostNavItems();
  return modules.findIndex((mod) => {
    const item = items.find((row) => row.id === mod.id);
    return item ? isHostNavItemActive(pathname, tab, item) : false;
  });
}

export function isUserGuidePath(pathname: string) {
  return normalizePathname(pathname) === USER_GUIDE_PATH;
}

export function expectedTourStepCount() {
  return hostGuideModuleCount();
}

export function parseHrefTab(href: string) {
  const url = new URL(href, "https://zencierge.local");
  return url.searchParams.get("tab");
}

let highlightId = "";
const highlightListeners = new Set<() => void>();

export function setHostTourHighlight(id: string) {
  highlightId = id;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(HOST_TOUR_HIGHLIGHT_EVENT));
  }
  highlightListeners.forEach((listener) => listener());
}

export function getHostTourHighlight() {
  return highlightId;
}

export function subscribeHostTourHighlight(onStoreChange: () => void) {
  highlightListeners.add(onStoreChange);
  if (typeof window === "undefined") return () => highlightListeners.delete(onStoreChange);
  window.addEventListener(HOST_TOUR_HIGHLIGHT_EVENT, onStoreChange);
  return () => {
    highlightListeners.delete(onStoreChange);
    window.removeEventListener(HOST_TOUR_HIGHLIGHT_EVENT, onStoreChange);
  };
}

export function dispatchHostTourCommand(detail: HostTourCommandDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<HostTourCommandDetail>(HOST_TOUR_COMMAND_EVENT, { detail }));
}

const SECRET_RE =
  /\b\d{3,6}\s*#|sk-[a-z0-9]{8,}|@[a-z0-9.-]+\.[a-z]{2,}|\b\d{1,5}\s+\w+\s+(street|st\.|ave|calle)|wifi password|door code|gate code|lockbox|alarm code|código de la puerta|\$\d/i;

export function spokenScriptLooksSafe(script: string) {
  return !SECRET_RE.test(script);
}

export function pickGuideVoice(voices: Array<{ lang: string; name: string }>, lang: GuideLang) {
  if (lang === "es") {
    return (
      voices.find((voice) => voice.lang.toLowerCase() === "es-us") ||
      voices.find((voice) => voice.lang.toLowerCase().startsWith("es")) ||
      null
    );
  }
  return (
    voices.find((voice) => voice.lang.toLowerCase() === "en-us" && /samantha|google|natural|neural|aria/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.toLowerCase() === "en-us") ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ||
    null
  );
}
