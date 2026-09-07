export type GuestStayListenLang = "en" | "es";

export type GuestStayListenStatus =
  | "idle"
  | "listening"
  | "permission"
  | "no-speech"
  | "unavailable"
  | "insecure";

export const GUEST_STAY_RECOGNIZED_MAX = 500;

/** After the last interim transcript, soft-stop recognition so WebKit can fire onend. */
export const GUEST_STAY_LISTEN_SILENCE_MS = 2000;

/** Hard cap for a single listen session (iOS can hang without isFinal/onend). */
export const GUEST_STAY_LISTEN_MAX_MS = 15000;

/** Finalize watchdog: after a soft stop, deliver the buffered candidate if WebKit never fires onend. */
export const GUEST_STAY_LISTEN_FINALIZE_MS = 2500;

export type GuestStayListenTimerApi = {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

function defaultListenTimers(): GuestStayListenTimerApi {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => {
      globalThis.clearTimeout(id);
    },
  };
}

export const GUEST_STAY_LISTEN_COPY = {
  tapEn: "Tap to talk",
  tapEs: "Toca para hablar",
  stopEn: "Stop listening",
  stopEs: "Dejar de escuchar",
  langEn: "EN",
  langEs: "ES",
  httpsEn: "Microphone requires HTTPS. Type your message instead.",
  httpsEs: "El micrófono requiere HTTPS. Escribe tu mensaje.",
  permissionEn: "Microphone permission was denied. Allow the microphone, or type your message.",
  permissionEs: "Se denegó el permiso del micrófono. Permite el micrófono o escribe tu mensaje.",
  noSpeechEn: "No speech heard. Tap to talk again, or type your message.",
  noSpeechEs: "No se escuchó voz. Toca para hablar otra vez o escribe tu mensaje.",
  unavailableEn: "Microphone is unavailable. Type your message instead.",
  unavailableEs: "El micrófono no está disponible. Escribe tu mensaje.",
  privacyEn:
    "Listening starts only when you tap. When you finish speaking, your question is sent automatically. Your browser may use its speech service to convert audio into text. Do not speak passwords, access codes, or payment information.",
  privacyEs:
    "La escucha comienza solamente cuando tocas el botón. Al terminar de hablar, tu pregunta se envía automáticamente. Tu navegador puede usar su servicio de voz para convertir el audio en texto. No digas contraseñas, códigos de acceso ni información de pago.",
} as const;

type SpeechResultLike = {
  isFinal?: boolean;
  0?: { transcript?: string };
};

export type GuestStayRecognitionEvent = {
  results?: ArrayLike<SpeechResultLike>;
};

export type GuestStayRecognitionErrorEvent = {
  error?: string;
};

export type GuestStayRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart?: (() => void) | null;
  onresult: ((event: GuestStayRecognitionEvent) => void) | null;
  onerror: ((event: GuestStayRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
};

export type GuestStayRecognitionCtor = new () => GuestStayRecognition;

/** DEV-only beacon so iPhone STT events appear in the local `npm run dev` terminal. */
export const GUEST_STAY_LISTEN_DEBUG_PATH = "/api/dev/guest-listen-debug";

export function guestStayListenDebugEnabled() {
  return process.env.NODE_ENV !== "production";
}

/** Temporary DEV instrumentation — no production behavior. */
export function guestStayListenDebug(event: string, data: Record<string, unknown> = {}) {
  if (!guestStayListenDebugEnabled()) return;
  const payload: Record<string, unknown> = { t: Date.now(), event };
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string" && value.length > 240) {
      payload[key] = `${value.slice(0, 240)}…`;
    } else {
      payload[key] = value;
    }
  }
  try {
    // eslint-disable-next-line no-console -- temporary DEV STT probe only
    console.info("[guest-listen-debug]", payload);
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  try {
    void fetch(GUEST_STAY_LISTEN_DEBUG_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}

export function guestStayRecognitionLang(lang: GuestStayListenLang) {
  return lang === "es" ? "es-MX" : "en-US";
}

export function getGuestStaySpeechRecognitionCtor(): GuestStayRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const extra = window as unknown as {
    SpeechRecognition?: GuestStayRecognitionCtor;
    webkitSpeechRecognition?: GuestStayRecognitionCtor;
  };
  return extra.SpeechRecognition ?? extra.webkitSpeechRecognition ?? null;
}

export function evaluateGuestStayListenSupport(input: {
  isBrowser: boolean;
  isSecureContext: boolean;
  hasCtor: boolean;
}): Extract<GuestStayListenStatus, "idle" | "insecure" | "unavailable"> {
  if (!input.isBrowser || !input.hasCtor) return "unavailable";
  if (!input.isSecureContext) return "insecure";
  return "idle";
}

export function guestStayListenCanStart(status: ReturnType<typeof evaluateGuestStayListenSupport>) {
  return status === "idle";
}

export function applyGuestStayRecognizedText(draft: string, recognized: string, max = GUEST_STAY_RECOGNIZED_MAX) {
  const phrase = recognized.trim();
  if (!phrase) return draft.slice(0, max);
  const base = draft.trimEnd();
  const next = base ? `${base} ${phrase}` : phrase;
  return next.slice(0, max);
}

export function guestStayFinalListenSendText(draft: string, recognized: string) {
  const phrase = recognized.trim();
  if (!phrase) return null;
  const message = applyGuestStayRecognizedText(draft, phrase);
  return message.trim() ? message : null;
}

export function configureGuestStayRecognition(recognition: GuestStayRecognition, lang: GuestStayListenLang) {
  recognition.lang = guestStayRecognitionLang(lang);
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
}

export function guestStayListenCandidate(text: string, max = GUEST_STAY_RECOGNIZED_MAX) {
  const phrase = text.trim();
  if (!phrase) return "";
  return phrase.slice(0, max);
}

function haltRecognition(recognition: GuestStayRecognition, abort: boolean) {
  try {
    if (abort && recognition.abort) recognition.abort();
    else recognition.stop();
  } catch {
    return;
  }
}

function resultTranscript(result: SpeechResultLike | undefined) {
  return guestStayListenCandidate(result?.[0]?.transcript ?? "");
}

function finalTranscript(event: GuestStayRecognitionEvent) {
  const results = event.results;
  if (!results || results.length < 1) return "";
  let latest = "";
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result?.isFinal) continue;
    const text = resultTranscript(result);
    if (text) latest = text;
  }
  return latest;
}

function latestTranscript(event: GuestStayRecognitionEvent) {
  const results = event.results;
  if (!results || results.length < 1) return "";
  let latest = "";
  for (let index = 0; index < results.length; index += 1) {
    const text = resultTranscript(results[index]);
    if (text) latest = text;
  }
  return latest;
}

export function mapGuestStayListenError(code: string | undefined): GuestStayListenStatus | "abort" {
  if (code === "aborted") return "abort";
  if (code === "not-allowed" || code === "service-not-allowed") return "permission";
  if (code === "no-speech") return "no-speech";
  return "unavailable";
}

export type GuestStayListenEndResult = {
  accepted: boolean;
  text: string;
  status: GuestStayListenStatus;
};

const VISIBLE_LISTEN_ERRORS: GuestStayListenStatus[] = ["permission", "no-speech", "unavailable", "insecure"];

export function createGuestStayListenEngine(options?: { timers?: GuestStayListenTimerApi }) {
  const timers = options?.timers ?? defaultListenTimers();
  let generation = 0;
  let status: GuestStayListenStatus = "idle";
  let recognition: GuestStayRecognition | null = null;
  let explicitAbort = false;
  let receivedFinal = false;
  let candidate = "";
  let silenceTimer: number | null = null;
  let maxTimer: number | null = null;
  let finalizeTimer: number | null = null;
  let softStopRequested = false;
  let activeOnFinal: ((text: string, generation: number) => void) | undefined;
  let activeOnStatus: ((next: GuestStayListenStatus, generation: number) => void) | undefined;

  function discardCandidate() {
    candidate = "";
  }

  function clearListenTimers() {
    if (silenceTimer != null) {
      timers.clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (maxTimer != null) {
      timers.clearTimeout(maxTimer);
      maxTimer = null;
    }
    if (finalizeTimer != null) {
      timers.clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
  }

  function armFinalizeTimer(ownerGeneration: number) {
    if (finalizeTimer != null) {
      timers.clearTimeout(finalizeTimer);
      finalizeTimer = null;
    }
    if (ownerGeneration !== generation || explicitAbort || receivedFinal || status !== "listening") return;
    guestStayListenDebug("finalize-timer-armed", {
      generation: ownerGeneration,
      ms: GUEST_STAY_LISTEN_FINALIZE_MS,
      candidate,
    });
    finalizeTimer = timers.setTimeout(() => {
      finalizeTimer = null;
      if (ownerGeneration !== generation || explicitAbort || receivedFinal || status !== "listening") return;
      guestStayListenDebug("finalize-timer-fired", {
        generation: ownerGeneration,
        candidate,
      });
      const phrase = guestStayListenCandidate(candidate);
      if (phrase) {
        const ended = finishAccepted(phrase);
        if (ended.accepted) {
          guestStayListenDebug("onFinal-invoked", {
            generation: ownerGeneration,
            text: ended.text,
            via: "finalize-watchdog",
          });
          activeOnFinal?.(ended.text, ownerGeneration);
        }
        activeOnStatus?.(ended.status, ownerGeneration);
        return;
      }
      recognition = null;
      softStopRequested = false;
      status = "no-speech";
      guestStayListenDebug("onFinal-not-invoked", {
        generation: ownerGeneration,
        reason: status,
        candidateAtEnd: candidate,
      });
      activeOnStatus?.(status, ownerGeneration);
    }, GUEST_STAY_LISTEN_FINALIZE_MS);
  }

  /** Soft stop: force WebKit onend without canceling the candidate / bumping generation. */
  function softStopRecognition(reason: "silence" | "max") {
    if (explicitAbort || receivedFinal || status !== "listening") return;
    const current = recognition;
    if (!current || softStopRequested) return;
    softStopRequested = true;
    clearListenTimers();
    armFinalizeTimer(generation);
    guestStayListenDebug("soft-stop-requested", {
      generation,
      reason,
      candidate,
      receivedFinal,
      explicitAbort,
    });
    try {
      current.stop();
    } catch {
      /* ignore */
    }
  }

  function armSilenceTimer(ownerGeneration: number) {
    if (silenceTimer != null) {
      timers.clearTimeout(silenceTimer);
      silenceTimer = null;
      guestStayListenDebug("silence-timer-reset", { generation: ownerGeneration, candidate });
    }
    if (explicitAbort || receivedFinal || status !== "listening" || ownerGeneration !== generation) return;
    if (!guestStayListenCandidate(candidate)) return;
    guestStayListenDebug("silence-timer-armed", {
      generation: ownerGeneration,
      ms: GUEST_STAY_LISTEN_SILENCE_MS,
      candidate,
    });
    silenceTimer = timers.setTimeout(() => {
      silenceTimer = null;
      if (ownerGeneration !== generation) return;
      guestStayListenDebug("silence-timer-fired", { generation: ownerGeneration, candidate });
      softStopRecognition("silence");
    }, GUEST_STAY_LISTEN_SILENCE_MS);
  }

  function armMaxTimer(ownerGeneration: number) {
    if (maxTimer != null) {
      timers.clearTimeout(maxTimer);
      maxTimer = null;
    }
    guestStayListenDebug("max-watchdog-armed", {
      generation: ownerGeneration,
      ms: GUEST_STAY_LISTEN_MAX_MS,
    });
    maxTimer = timers.setTimeout(() => {
      maxTimer = null;
      if (ownerGeneration !== generation) return;
      if (explicitAbort || receivedFinal || status !== "listening") return;
      guestStayListenDebug("max-watchdog-fired", { generation: ownerGeneration, candidate });
      softStopRecognition("max");
    }, GUEST_STAY_LISTEN_MAX_MS);
  }

  function invalidate(abort: boolean, logEvent?: "manual-abort" | "manual-cancel") {
    clearListenTimers();
    softStopRequested = false;
    explicitAbort = true;
    generation += 1;
    receivedFinal = false;
    discardCandidate();
    const current = recognition;
    recognition = null;
    if (status === "listening" || status === "no-speech") status = "idle";
    if (current) haltRecognition(current, abort);
    if (logEvent) {
      guestStayListenDebug(logEvent, {
        generation,
        abort,
      });
    }
    return generation;
  }

  function finishAccepted(text: string): GuestStayListenEndResult {
    const phrase = guestStayListenCandidate(text);
    if (!phrase) return { accepted: false, text: "", status };
    clearListenTimers();
    receivedFinal = true;
    softStopRequested = false;
    discardCandidate();
    if (recognition) haltRecognition(recognition, false);
    recognition = null;
    status = "idle";
    return { accepted: true, text: phrase, status };
  }

  const api = {
    status: () => status,
    generation: () => generation,
    listening: () => status === "listening",
    recognition: () => recognition,
    candidate: () => candidate,
    start(input: {
      lang: GuestStayListenLang;
      ctor: GuestStayRecognitionCtor | null;
      isBrowser: boolean;
      isSecureContext: boolean;
      onFinal?: (text: string, generation: number) => void;
      onStatus?: (status: GuestStayListenStatus, generation: number) => void;
    }): {
      started: boolean;
      generation: number;
      status: GuestStayListenStatus;
      recognition: GuestStayRecognition | null;
    } {
      invalidate(true);
      explicitAbort = false;
      receivedFinal = false;
      softStopRequested = false;
      discardCandidate();
      const gate = evaluateGuestStayListenSupport({
        isBrowser: input.isBrowser,
        isSecureContext: input.isSecureContext,
        hasCtor: Boolean(input.ctor),
      });
      if (gate !== "idle" || !input.ctor) {
        status = gate === "idle" ? "unavailable" : gate;
        guestStayListenDebug("start-blocked", { generation, status: gate });
        input.onStatus?.(status, generation);
        return { started: false, generation, status, recognition: null };
      }
      const myGen = generation;
      activeOnFinal = input.onFinal;
      activeOnStatus = input.onStatus;
      const instance = new input.ctor();
      guestStayListenDebug("recognition-created", {
        generation: myGen,
        lang: guestStayRecognitionLang(input.lang),
      });
      configureGuestStayRecognition(instance, input.lang);
      instance.onstart = () => {
        guestStayListenDebug("onstart", { generation: myGen });
      };
      instance.onresult = (event) => {
        const finals = finalTranscript(event);
        const latest = latestTranscript(event);
        guestStayListenDebug("onresult", {
          generation: myGen,
          isFinal: Boolean(finals),
          transcript: finals || latest,
          candidateBefore: candidate,
        });
        const result = api.handleResult(myGen, event);
        if (result.accepted) {
          guestStayListenDebug("onFinal-invoked", {
            generation: myGen,
            text: result.text,
            via: "onresult-final",
          });
          activeOnFinal?.(result.text, myGen);
        }
        activeOnStatus?.(status, myGen);
      };
      instance.onerror = (event) => {
        guestStayListenDebug("onerror", {
          generation: myGen,
          error: event.error ?? "",
          candidate,
        });
        const next = api.handleError(myGen, event.error);
        activeOnStatus?.(next, myGen);
      };
      instance.onend = () => {
        const candidateAtEnd = candidate;
        guestStayListenDebug("onend", {
          generation: myGen,
          candidate: candidateAtEnd,
          receivedFinal,
          explicitAbort,
          softStopRequested,
          status,
        });
        const ended = api.handleEnd(myGen);
        if (ended.accepted) {
          guestStayListenDebug("onFinal-invoked", {
            generation: myGen,
            text: ended.text,
            via: "onend-candidate",
          });
          activeOnFinal?.(ended.text, myGen);
        } else {
          guestStayListenDebug("onFinal-not-invoked", {
            generation: myGen,
            reason: ended.status,
            candidateAtEnd,
          });
        }
        activeOnStatus?.(ended.status, myGen);
      };
      recognition = instance;
      status = "listening";
      guestStayListenDebug("start-requested", { generation: myGen, lang: input.lang });
      try {
        instance.start();
      } catch {
        clearListenTimers();
        recognition = null;
        discardCandidate();
        status = "unavailable";
        guestStayListenDebug("start-threw", { generation: myGen });
        activeOnStatus?.(status, myGen);
        return { started: false, generation: myGen, status, recognition: null };
      }
      armMaxTimer(myGen);
      activeOnStatus?.(status, myGen);
      return { started: true, generation: myGen, status, recognition };
    },
    handleResult(callbackGeneration: number, event: GuestStayRecognitionEvent) {
      if (callbackGeneration !== generation) return { accepted: false, text: "", status };
      if (receivedFinal || status !== "listening") return { accepted: false, text: "", status };
      const final = finalTranscript(event);
      if (final) return finishAccepted(final);
      const latest = latestTranscript(event);
      if (latest) {
        candidate = latest;
        guestStayListenDebug("candidate-updated", {
          generation: callbackGeneration,
          candidate,
        });
        armSilenceTimer(callbackGeneration);
      }
      return { accepted: false, text: "", status };
    },
    handleError(callbackGeneration: number, code?: string) {
      if (callbackGeneration !== generation) return status;
      clearListenTimers();
      softStopRequested = false;
      recognition = null;
      if (receivedFinal) {
        status = "idle";
        return status;
      }
      const mapped = mapGuestStayListenError(code);
      if (mapped === "abort") {
        if (explicitAbort) {
          discardCandidate();
          status = "idle";
          return status;
        }
        if (guestStayListenCandidate(candidate)) {
          armFinalizeTimer(callbackGeneration);
          return status;
        }
        status = "no-speech";
        return status;
      }
      if (mapped === "permission" || mapped === "unavailable") {
        discardCandidate();
        status = mapped;
        return status;
      }
      status = mapped;
      return status;
    },
    handleEnd(callbackGeneration: number): GuestStayListenEndResult {
      if (callbackGeneration !== generation) return { accepted: false, text: "", status };
      clearListenTimers();
      softStopRequested = false;
      recognition = null;
      if (explicitAbort) {
        discardCandidate();
        status = "idle";
        return { accepted: false, text: "", status };
      }
      if (receivedFinal) {
        status = "idle";
        return { accepted: false, text: "", status };
      }
      const phrase = guestStayListenCandidate(candidate);
      if (phrase) return finishAccepted(phrase);
      if (VISIBLE_LISTEN_ERRORS.includes(status)) return { accepted: false, text: "", status };
      status = "no-speech";
      return { accepted: false, text: "", status };
    },
    stop() {
      invalidate(false, "manual-cancel");
      status = "idle";
      return status;
    },
    abort() {
      invalidate(true, "manual-abort");
      status = "idle";
      return status;
    },
    advanceGeneration() {
      clearListenTimers();
      softStopRequested = false;
      generation += 1;
      explicitAbort = true;
      receivedFinal = false;
      discardCandidate();
      guestStayListenDebug("generation-advanced", { generation });
      return generation;
    },
  };
  return api;
}
