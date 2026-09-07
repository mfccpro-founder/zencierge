import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyGuestStayRecognizedText,
  configureGuestStayRecognition,
  createGuestStayListenEngine,
  evaluateGuestStayListenSupport,
  guestStayFinalListenSendText,
  guestStayListenCandidate,
  guestStayListenCanStart,
  guestStayListenDebugEnabled,
  guestStayRecognitionLang,
  GUEST_STAY_LISTEN_COPY,
  GUEST_STAY_LISTEN_FINALIZE_MS,
  GUEST_STAY_LISTEN_MAX_MS,
  GUEST_STAY_LISTEN_SILENCE_MS,
  mapGuestStayListenError,
  type GuestStayListenTimerApi,
  type GuestStayRecognition,
  type GuestStayRecognitionCtor,
} from "./guest-stay-listen";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function createManualTimers(): GuestStayListenTimerApi & {
  flush: (ms: number) => void;
  pendingCount: () => number;
  pendingMs: () => number[];
} {
  let nextId = 1;
  const pending: Array<{ id: number; ms: number; fn: () => void }> = [];
  return {
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      pending.push({ id, ms, fn });
      return id;
    },
    clearTimeout(id) {
      const index = pending.findIndex((row) => row.id === id);
      if (index >= 0) pending.splice(index, 1);
    },
    flush(ms) {
      const due = pending.filter((row) => row.ms <= ms).sort((a, b) => a.id - b.id);
      for (const row of due) {
        const index = pending.findIndex((item) => item.id === row.id);
        if (index >= 0) pending.splice(index, 1);
        row.fn();
      }
    },
    pendingCount: () => pending.length,
    pendingMs: () => pending.map((row) => row.ms),
  };
}

function mockCtor(options?: {
  onStart?: (self: GuestStayRecognition & { stopped: boolean; aborted: boolean; started: boolean }) => void;
  syncEnd?: boolean;
  syncAborted?: boolean;
  throws?: boolean;
}): { Ctor: GuestStayRecognitionCtor; instances: Array<GuestStayRecognition & { stopped: boolean; aborted: boolean; started: boolean }> } {
  const instances: Array<GuestStayRecognition & { stopped: boolean; aborted: boolean; started: boolean }> = [];
  class MockRecognition implements GuestStayRecognition {
    lang = "";
    continuous = true;
    interimResults = true;
    maxAlternatives = 9;
    onresult: GuestStayRecognition["onresult"] = null;
    onerror: GuestStayRecognition["onerror"] = null;
    onend: GuestStayRecognition["onend"] = null;
    started = false;
    stopped = false;
    aborted = false;
    start() {
      if (options?.throws) throw new Error("start failed");
      this.started = true;
      options?.onStart?.(this);
      if (options?.syncAborted) this.onerror?.({ error: "aborted" });
      if (options?.syncEnd) this.onend?.();
    }
    stop() {
      this.stopped = true;
    }
    abort() {
      this.aborted = true;
    }
  }
  const wrapped: GuestStayRecognitionCtor = function (this: GuestStayRecognition) {
    const instance = new MockRecognition();
    instances.push(instance);
    return instance;
  } as unknown as GuestStayRecognitionCtor;
  return { Ctor: wrapped, instances };
}

export function runGuestStayListenTests() {
  assert(guestStayRecognitionLang("en") === "en-US", "EN sets en-US");
  assert(guestStayRecognitionLang("es") === "es-MX", "ES sets es-MX");

  assert(evaluateGuestStayListenSupport({ isBrowser: true, isSecureContext: true, hasCtor: true }) === "idle", "secure context + constructor enables Tap to talk");
  assert(guestStayListenCanStart("idle"), "ready gate can start");
  assert(evaluateGuestStayListenSupport({ isBrowser: true, isSecureContext: false, hasCtor: true }) === "insecure", "insecure/LAN HTTP disables mic");
  assert(evaluateGuestStayListenSupport({ isBrowser: true, isSecureContext: true, hasCtor: false }) === "unavailable", "missing constructor unavailable");
  assert(!guestStayListenCanStart("insecure") && !guestStayListenCanStart("unavailable"), "blocked gates cannot start");

  assert(GUEST_STAY_LISTEN_COPY.httpsEn.includes("HTTPS"), "HTTPS English copy");
  assert(GUEST_STAY_LISTEN_COPY.privacyEn.includes("sent automatically"), "English privacy states auto-send");
  assert(GUEST_STAY_LISTEN_COPY.privacyEs.includes("se envía automáticamente"), "Spanish privacy states auto-send");
  assert(GUEST_STAY_LISTEN_COPY.httpsEs.includes("HTTPS"), "HTTPS Spanish copy");

  const rec = {
    lang: "",
    continuous: true,
    interimResults: true,
    maxAlternatives: 4,
    onresult: null,
    onerror: null,
    onend: null,
    start() {},
    stop() {},
  };
  configureGuestStayRecognition(rec, "es");
  assert(rec.lang === "es-MX" && rec.continuous === false && rec.interimResults === true && rec.maxAlternatives === 1, "recognition options are one-shot with interim buffering");
  assert(guestStayListenCandidate("  hola  ") === "hola", "candidate is trimmed");
  assert(guestStayListenCandidate("a".repeat(510)).length === 500, "candidate is capped at 500");
  assert(guestStayListenCandidate("   ") === "", "whitespace is not a valid candidate");

  assert(applyGuestStayRecognizedText("", "  Checkout time  ") === "Checkout time", "one final phrase fills empty input");
  assert(applyGuestStayRecognizedText("Need ", "checkout time") === "Need checkout time", "existing draft is preserved and final text appended");
  assert(applyGuestStayRecognizedText("a".repeat(498), "hello").length === 500, "recognized text is capped at 500");

  const engine = createGuestStayListenEngine();
  let storedBeforeStart = false;
  let listeningBeforeStart = false;
  const mock = mockCtor({
    onStart() {
      storedBeforeStart = engine.recognition() !== null;
      listeningBeforeStart = engine.listening();
    },
  });
  const started = engine.start({
    lang: "en",
    ctor: mock.Ctor,
    isBrowser: true,
    isSecureContext: true,
  });
  assert(storedBeforeStart && listeningBeforeStart, "recognition is stored and status is listening before start()");
  assert(started.started && engine.listening(), "listen starts");
  assert(mock.instances[0]?.lang === "en-US", "started recognition uses en-US");
  assert(mock.instances[0]?.continuous === false, "started recognition is not continuous");
  const gen = started.generation;
  const accepted = engine.handleResult(gen, { results: [{ isFinal: true, 0: { transcript: " Where is checkout " } }] });
  assert(accepted.accepted && accepted.text.includes("checkout"), "final phrase is accepted");
  assert(!engine.listening(), "listening ends after one final phrase");
  assert(applyGuestStayRecognizedText("", accepted.text) === "Where is checkout", "trimmed phrase is ready for the input");

  const sendGuard = { sendCalls: 0 };
  const finalEngine = createGuestStayListenEngine();
  const finalMock = mockCtor();
  const finalStart = finalEngine.start({
    lang: "en",
    ctor: finalMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: () => {
      sendGuard.sendCalls += 1;
    },
  });
  finalMock.instances[0]?.onresult?.({ results: [{ isFinal: true, 0: { transcript: " Check-in time " } }] });
  assert(finalEngine.status() === "idle" && sendGuard.sendCalls === 1, "first final phrase notifies once for auto-send");
  finalMock.instances[0]?.onresult?.({ results: [{ isFinal: true, 0: { transcript: " second phrase " } }] });
  finalMock.instances[0]?.onend?.();
  finalMock.instances[0]?.onerror?.({ error: "no-speech" });
  assert(sendGuard.sendCalls === 1, "onend/onerror after the final phrase do not notify again");
  assert(guestStayFinalListenSendText("Need", "Check-in time") === "Need Check-in time", "draft plus recognized phrase is the send text");
  assert(guestStayFinalListenSendText("", "   ") === null, "empty/whitespace recognized text is not sent");
  assert(applyGuestStayRecognizedText("Need", "Check-in time") === "Need Check-in time", "final phrase still appends to a draft");
  void finalStart;

  const stopEngine = createGuestStayListenEngine();
  const stopMock = mockCtor();
  const stopStart = stopEngine.start({ lang: "en", ctor: stopMock.Ctor, isBrowser: true, isSecureContext: true });
  stopEngine.stop();
  assert(!stopEngine.listening(), "Stop aborts listening");
  assert(stopMock.instances[0]?.stopped || stopMock.instances[0]?.aborted, "Stop halt the recognizer");
  const staleAfterStop = stopEngine.handleResult(stopStart.generation, {
    results: [{ isFinal: true, 0: { transcript: "stale" } }],
  });
  assert(!staleAfterStop.accepted, "stale result after Stop is ignored");

  const unmountEngine = createGuestStayListenEngine();
  const unmountMock = mockCtor();
  const unmountStart = unmountEngine.start({ lang: "es", ctor: unmountMock.Ctor, isBrowser: true, isSecureContext: true });
  assert(unmountMock.instances[0]?.lang === "es-MX", "Spanish recognition uses es-MX");
  unmountEngine.abort();
  assert(!unmountEngine.listening(), "unmount/token remount abort safely");
  assert(unmountEngine.handleError(unmountStart.generation, "not-allowed") === "idle", "stale error callbacks are ignored");
  assert(unmountEngine.handleEnd(unmountStart.generation).status === "idle", "stale end callbacks are ignored");
  assert(!unmountEngine.handleEnd(unmountStart.generation).accepted, "stale end cannot auto-send");

  const errEngine = createGuestStayListenEngine();
  const errMock = mockCtor();
  const errStart = errEngine.start({ lang: "en", ctor: errMock.Ctor, isBrowser: true, isSecureContext: true });
  assert(errEngine.handleError(errStart.generation, "not-allowed") === "permission", "permission denied status");
  const noSpeech = createGuestStayListenEngine();
  const noSpeechStart = noSpeech.start({ lang: "en", ctor: mockCtor().Ctor, isBrowser: true, isSecureContext: true });
  assert(noSpeech.handleError(noSpeechStart.generation, "no-speech") === "no-speech", "no-speech status");
  assert(mapGuestStayListenError("network") === "unavailable", "failed recognition is unavailable");
  const abortEngine = createGuestStayListenEngine();
  abortEngine.start({ lang: "en", ctor: mockCtor().Ctor, isBrowser: true, isSecureContext: true });
  assert(abortEngine.stop() === "idle", "requested abort remains silent idle");
  const unexpectedAbort = createGuestStayListenEngine();
  const unexpectedStart = unexpectedAbort.start({ lang: "en", ctor: mockCtor().Ctor, isBrowser: true, isSecureContext: true });
  assert(unexpectedAbort.handleError(unexpectedStart.generation, "aborted") === "no-speech", "unexpected aborted error becomes visible no-speech/retry");

  const syncEnd = createGuestStayListenEngine();
  const syncEndStart = syncEnd.start({
    lang: "en",
    ctor: mockCtor({ syncEnd: true }).Ctor,
    isBrowser: true,
    isSecureContext: true,
  });
  assert(syncEndStart.status === "no-speech", "start() firing onend synchronously does not become silent idle");
  assert(syncEnd.status() === "no-speech", "onend with no final phrase becomes no-speech");

  const syncAborted = createGuestStayListenEngine();
  const syncAbortedStart = syncAborted.start({
    lang: "en",
    ctor: mockCtor({ syncAborted: true }).Ctor,
    isBrowser: true,
    isSecureContext: true,
  });
  assert(syncAbortedStart.status === "no-speech", "synchronous unexpected aborted is visible no-speech");

  const throws = createGuestStayListenEngine();
  const thrown = throws.start({
    lang: "en",
    ctor: mockCtor({ throws: true }).Ctor,
    isBrowser: true,
    isSecureContext: true,
  });
  assert(!thrown.started && thrown.status === "unavailable" && throws.recognition() === null, "start() throw is visible unavailable");

  const endNoFinal = createGuestStayListenEngine();
  const endNoFinalStart = endNoFinal.start({ lang: "en", ctor: mockCtor().Ctor, isBrowser: true, isSecureContext: true });
  const emptyEnd = endNoFinal.handleEnd(endNoFinalStart.generation);
  assert(emptyEnd.status === "no-speech" && !emptyEnd.accepted, "onend with no final phrase becomes no-speech");

  const permissionKeep = createGuestStayListenEngine();
  const permissionStart = permissionKeep.start({ lang: "en", ctor: mockCtor().Ctor, isBrowser: true, isSecureContext: true });
  permissionKeep.handleError(permissionStart.generation, "not-allowed");
  assert(permissionKeep.handleEnd(permissionStart.generation).status === "permission", "onend keeps a visible permission error");

  const insecure = createGuestStayListenEngine();
  const insecureStart = insecure.start({
    lang: "en",
    ctor: mockCtor().Ctor,
    isBrowser: true,
    isSecureContext: false,
  });
  assert(!insecureStart.started && insecureStart.status === "insecure", "insecure context does not start recognition");

  const missing = createGuestStayListenEngine();
  const missingStart = missing.start({ lang: "en", ctor: null, isBrowser: true, isSecureContext: true });
  assert(!missingStart.started && missingStart.status === "unavailable", "missing constructor does not start");

  const retry = createGuestStayListenEngine();
  const firstMock = mockCtor();
  retry.start({ lang: "en", ctor: firstMock.Ctor, isBrowser: true, isSecureContext: true });
  const secondMock = mockCtor();
  retry.start({ lang: "es", ctor: secondMock.Ctor, isBrowser: true, isSecureContext: true });
  assert(firstMock.instances[0]?.aborted, "a new recognition attempt aborts the previous session");
  assert(secondMock.instances[0]?.lang === "es-MX", "new attempt uses the selected language");

  const advance = createGuestStayListenEngine();
  const advanceMock = mockCtor();
  const advanceStart = advance.start({ lang: "en", ctor: advanceMock.Ctor, isBrowser: true, isSecureContext: true });
  const advanced = advance.advanceGeneration();
  assert(advanced !== advanceStart.generation, "Clear can bump listen generation before abort");
  assert(
    !advance.handleResult(advanceStart.generation, { results: [{ isFinal: true, 0: { transcript: "stale" } }] }).accepted,
    "stale recognition after generation bump is ignored",
  );

  const interimSends: string[] = [];
  const interimEngine = createGuestStayListenEngine();
  const interimMock = mockCtor();
  const interimStart = interimEngine.start({
    lang: "es",
    ctor: interimMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      interimSends.push(text);
    },
  });
  assert(interimMock.instances[0]?.lang === "es-MX", "ES start uses es-MX");
  assert(interimMock.instances[0]?.interimResults === true, "interim results are enabled");
  interimMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "  hola  " } }] });
  assert(!interimEngine.handleResult(interimStart.generation, { results: [{ isFinal: false, 0: { transcript: "  hola  " } }] }).accepted, "interim result does not send yet");
  interimMock.instances[0]?.onend?.();
  assert(interimSends.length === 1 && interimSends[0] === "hola", "interim Spanish transcript + onend → auto-send once");
  interimMock.instances[0]?.onend?.();
  assert(interimSends.length === 1, "buffered onend cannot send twice");

  const latestSends: string[] = [];
  const latestEngine = createGuestStayListenEngine();
  const latestMock = mockCtor();
  latestEngine.start({
    lang: "es",
    ctor: latestMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      latestSends.push(text);
    },
  });
  latestMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "uno" } }] });
  latestMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "dos" } }] });
  latestMock.instances[0]?.onend?.();
  assert(latestSends.length === 1 && latestSends[0] === "dos", "multiple interim results → latest valid candidate sent once");

  const onceSends: string[] = [];
  const onceEngine = createGuestStayListenEngine();
  const onceMock = mockCtor();
  onceEngine.start({
    lang: "en",
    ctor: onceMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      onceSends.push(text);
    },
  });
  onceMock.instances[0]?.onresult?.({ results: [{ isFinal: true, 0: { transcript: " Check-in time " } }] });
  onceMock.instances[0]?.onend?.();
  assert(onceSends.length === 1, "final result followed by onend → send once, not twice");

  const emptySends: string[] = [];
  const emptyEngine = createGuestStayListenEngine();
  const emptyMock = mockCtor();
  emptyEngine.start({
    lang: "es",
    ctor: emptyMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      emptySends.push(text);
    },
  });
  emptyMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "   " } }] });
  emptyMock.instances[0]?.onend?.();
  assert(emptySends.length === 0 && emptyEngine.status() === "no-speech", "empty onend → no-speech and no send");

  const stopSends: string[] = [];
  const stopBuf = createGuestStayListenEngine();
  const stopBufMock = mockCtor();
  const stopBufStart = stopBuf.start({
    lang: "es",
    ctor: stopBufMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      stopSends.push(text);
    },
  });
  stopBufMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hola" } }] });
  stopBuf.stop();
  stopBufMock.instances[0]?.onend?.();
  assert(stopSends.length === 0 && stopBuf.status() === "idle", "Stop with buffered phrase → no send");
  assert(!stopBuf.handleEnd(stopBufStart.generation).accepted, "Stop generation cannot auto-send later");

  const abortSends: string[] = [];
  const abortBuf = createGuestStayListenEngine();
  const abortBufMock = mockCtor();
  abortBuf.start({
    lang: "es",
    ctor: abortBufMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      abortSends.push(text);
    },
  });
  abortBufMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hola" } }] });
  abortBuf.abort();
  abortBufMock.instances[0]?.onend?.();
  assert(abortSends.length === 0 && abortBuf.status() === "idle", "requested abort with buffered phrase → no send");

  const permSends: string[] = [];
  const permEngine = createGuestStayListenEngine();
  const permMock = mockCtor();
  permEngine.start({
    lang: "es",
    ctor: permMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      permSends.push(text);
    },
  });
  permMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hola" } }] });
  permMock.instances[0]?.onerror?.({ error: "not-allowed" });
  permMock.instances[0]?.onend?.();
  assert(permSends.length === 0 && permEngine.status() === "permission", "permission with buffered phrase → no send");

  const unavailSends: string[] = [];
  const unavailEngine = createGuestStayListenEngine();
  const unavailMock = mockCtor();
  unavailEngine.start({
    lang: "es",
    ctor: unavailMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      unavailSends.push(text);
    },
  });
  unavailMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hola" } }] });
  unavailMock.instances[0]?.onerror?.({ error: "network" });
  unavailMock.instances[0]?.onend?.();
  assert(unavailSends.length === 0 && unavailEngine.status() === "unavailable", "unavailable with buffered phrase → no send");

  const switchSends: string[] = [];
  const switchEngine = createGuestStayListenEngine();
  const enMock = mockCtor();
  const enStart = switchEngine.start({
    lang: "en",
    ctor: enMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      switchSends.push(text);
    },
  });
  assert(enMock.instances[0]?.lang === "en-US", "EN start uses en-US");
  enMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hello" } }] });
  const esMock = mockCtor();
  const esStart = switchEngine.start({
    lang: "es",
    ctor: esMock.Ctor,
    isBrowser: true,
    isSecureContext: true,
    onFinal: (text) => {
      switchSends.push(text);
    },
  });
  assert(enMock.instances[0]?.aborted, "EN→ES while listening aborts old session");
  assert(esMock.instances[0]?.lang === "es-MX", "EN→ES while listening starts fresh es-MX");
  enMock.instances[0]?.onend?.();
  enMock.instances[0]?.onresult?.({ results: [{ isFinal: true, 0: { transcript: "hello" } }] });
  assert(switchSends.length === 0, "language-switch old generation cannot auto-send");
  assert(enStart.generation !== esStart.generation, "language switch uses a new generation");

  const esToEn = createGuestStayListenEngine();
  const esFirst = mockCtor();
  esToEn.start({ lang: "es", ctor: esFirst.Ctor, isBrowser: true, isSecureContext: true });
  const enSecond = mockCtor();
  esToEn.start({ lang: "en", ctor: enSecond.Ctor, isBrowser: true, isSecureContext: true });
  assert(esFirst.instances[0]?.aborted, "ES→EN while listening aborts old session");
  assert(enSecond.instances[0]?.lang === "en-US", "ES→EN while listening starts fresh en-US");

  assert(GUEST_STAY_LISTEN_SILENCE_MS === 2000, "silence finalize window is 2s");
  assert(GUEST_STAY_LISTEN_MAX_MS === 15000, "max listen duration is 15s");
  assert(GUEST_STAY_LISTEN_FINALIZE_MS === 2500, "finalize watchdog window is 2.5s");

  {
    const timers = createManualTimers();
    const silenceSends: string[] = [];
    const silenceEngine = createGuestStayListenEngine({ timers });
    const silenceMock = mockCtor();
    silenceEngine.start({
      lang: "en",
      ctor: silenceMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        silenceSends.push(text);
      },
    });
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_MAX_MS), "max-duration timer arms on start");
    silenceMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "Where is my code password" } }] });
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_SILENCE_MS), "silence timer arms after interim");
    assert(silenceSends.length === 0 && silenceEngine.listening(), "interim alone does not send");
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    assert(silenceMock.instances[0]?.stopped, "silence soft-stops recognition without abort");
    assert(!silenceMock.instances[0]?.aborted, "silence soft-stop is not abort");
    assert(silenceEngine.candidate() === "Where is my code password", "soft stop preserves candidate");
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_FINALIZE_MS), "soft stop arms finalize watchdog");
    silenceMock.instances[0]?.onend?.();
    assert(silenceSends.length === 1 && silenceSends[0] === "Where is my code password", "interim + silence → soft stop → send once");
    silenceMock.instances[0]?.onend?.();
    assert(silenceSends.length === 1, "duplicate onend after silence finalize does not resend");
  }

  {
    const timers = createManualTimers();
    const resetEngine = createGuestStayListenEngine({ timers });
    const resetMock = mockCtor();
    resetEngine.start({ lang: "en", ctor: resetMock.Ctor, isBrowser: true, isSecureContext: true });
    resetMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "where" } }] });
    const silenceArmed = timers.pendingCount();
    resetMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "where is my" } }] });
    assert(timers.pendingCount() === silenceArmed, "new interim replaces silence timer (no stack of silence timers)");
    assert(resetEngine.candidate() === "where is my", "latest interim replaces candidate");
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    resetMock.instances[0]?.onend?.();
    assert(resetEngine.status() === "idle", "reset silence path ends listening");
  }

  {
    const timers = createManualTimers();
    const finalSends: string[] = [];
    const finalEngine = createGuestStayListenEngine({ timers });
    const finalMock = mockCtor();
    finalEngine.start({
      lang: "en",
      ctor: finalMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        finalSends.push(text);
      },
    });
    finalMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "check" } }] });
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_SILENCE_MS), "silence armed before final");
    finalMock.instances[0]?.onresult?.({ results: [{ isFinal: true, 0: { transcript: "Check-in time" } }] });
    assert(finalSends.length === 1 && finalSends[0] === "Check-in time", "isFinal sends once");
    assert(!timers.pendingMs().includes(GUEST_STAY_LISTEN_SILENCE_MS), "isFinal clears silence watchdog");
    assert(!timers.pendingMs().includes(GUEST_STAY_LISTEN_MAX_MS), "isFinal clears max watchdog");
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    timers.flush(GUEST_STAY_LISTEN_MAX_MS);
    finalMock.instances[0]?.onend?.();
    assert(finalSends.length === 1, "watchdogs after isFinal cannot duplicate send");
  }

  {
    const timers = createManualTimers();
    const raceSends: string[] = [];
    const raceEngine = createGuestStayListenEngine({ timers });
    const raceMock = mockCtor();
    raceEngine.start({
      lang: "en",
      ctor: raceMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        raceSends.push(text);
      },
    });
    raceMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hello there" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    assert(raceMock.instances[0]?.stopped, "silence requested soft stop");
    raceMock.instances[0]?.onresult?.({ results: [{ isFinal: true, 0: { transcript: "hello there final" } }] });
    assert(raceSends.length === 1 && raceSends[0] === "hello there final", "isFinal near silence timeout wins once");
    raceMock.instances[0]?.onend?.();
    assert(raceSends.length === 1, "onend after late final does not duplicate");
  }

  {
    const timers = createManualTimers();
    const cancelSends: string[] = [];
    const cancelEngine = createGuestStayListenEngine({ timers });
    const cancelMock = mockCtor();
    cancelEngine.start({
      lang: "en",
      ctor: cancelMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        cancelSends.push(text);
      },
    });
    cancelMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "do not send" } }] });
    cancelEngine.stop();
    assert(timers.pendingCount() === 0, "manual Stop clears watchdogs");
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    timers.flush(GUEST_STAY_LISTEN_MAX_MS);
    cancelMock.instances[0]?.onend?.();
    assert(cancelSends.length === 0, "manual Stop remains cancel with no send");
  }

  {
    const timers = createManualTimers();
    const abortSends: string[] = [];
    const abortEngine = createGuestStayListenEngine({ timers });
    const abortMock = mockCtor();
    abortEngine.start({
      lang: "en",
      ctor: abortMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        abortSends.push(text);
      },
    });
    abortMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "abort me" } }] });
    abortEngine.abort();
    assert(timers.pendingCount() === 0, "abort clears watchdogs");
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    abortMock.instances[0]?.onend?.();
    assert(abortSends.length === 0, "abort does not send");
  }

  {
    const timers = createManualTimers();
    const staleSends: string[] = [];
    const staleEngine = createGuestStayListenEngine({ timers });
    const staleMock = mockCtor();
    const staleStart = staleEngine.start({
      lang: "en",
      ctor: staleMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        staleSends.push(text);
      },
    });
    staleMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "stale phrase" } }] });
    staleEngine.advanceGeneration();
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    timers.flush(GUEST_STAY_LISTEN_MAX_MS);
    staleMock.instances[0]?.onend?.();
    assert(
      !staleEngine.handleResult(staleStart.generation, { results: [{ isFinal: true, 0: { transcript: "stale phrase" } }] }).accepted,
      "stale generation cannot accept",
    );
    assert(staleSends.length === 0, "stale generation never sends");
  }

  {
    const timers = createManualTimers();
    const maxSends: string[] = [];
    const maxEngine = createGuestStayListenEngine({ timers });
    const maxMock = mockCtor();
    maxEngine.start({
      lang: "en",
      ctor: maxMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        maxSends.push(text);
      },
    });
    maxMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "max duration phrase" } }] });
    timers.flush(GUEST_STAY_LISTEN_MAX_MS);
    assert(maxMock.instances[0]?.stopped, "max-duration soft-stops with candidate");
    maxMock.instances[0]?.onend?.();
    assert(maxSends.length === 1 && maxSends[0] === "max duration phrase", "max-duration + candidate → finalize once");
  }

  {
    const timers = createManualTimers();
    const emptySends: string[] = [];
    const emptyEngine = createGuestStayListenEngine({ timers });
    const emptyMock = mockCtor();
    emptyEngine.start({
      lang: "en",
      ctor: emptyMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        emptySends.push(text);
      },
      onStatus: () => {},
    });
    timers.flush(GUEST_STAY_LISTEN_MAX_MS);
    assert(emptyMock.instances[0]?.stopped, "max-duration soft-stops without candidate");
    emptyMock.instances[0]?.onend?.();
    assert(emptySends.length === 0 && emptyEngine.status() === "no-speech", "max-duration + no candidate → safe no-speech, no send");
  }

  {
    const naturalSends: string[] = [];
    const naturalEngine = createGuestStayListenEngine();
    const naturalMock = mockCtor();
    naturalEngine.start({
      lang: "en",
      ctor: naturalMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        naturalSends.push(text);
      },
    });
    naturalMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "natural end" } }] });
    naturalMock.instances[0]?.onend?.();
    assert(naturalSends.length === 1 && naturalSends[0] === "natural end", "desktop/natural onend with candidate still sends once");
  }

  // --- R3 finalize watchdog ---
  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    mock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "soft abort phrase" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    assert(mock.instances[0]?.stopped, "R3#1 soft-stop requested");
    mock.instances[0]?.onerror?.({ error: "aborted" });
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_FINALIZE_MS), "R3#1 aborted+candidate arms finalize");
    assert(sends.length === 0 && engine.listening(), "R3#1 aborted with candidate waits for finalize");
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    assert(sends.length === 1 && sends[0] === "soft abort phrase", "R3#1 soft-stop + candidate + aborted → exactly one send");
    assert(engine.status() === "idle", "R3#1 ends idle after finalize send");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    mock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "late onend phrase" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    assert(sends.length === 1 && sends[0] === "late onend phrase", "R3#2 watchdog delivers once");
    mock.instances[0]?.onend?.();
    assert(sends.length === 1, "R3#2 late onend after watchdog → no duplicate");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    mock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "race interim" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_FINALIZE_MS), "R3#3 finalize armed before isFinal race");
    mock.instances[0]?.onresult?.({ results: [{ isFinal: true, 0: { transcript: "race final wins" } }] });
    assert(sends.length === 1 && sends[0] === "race final wins", "R3#3 isFinal wins the race once");
    assert(!timers.pendingMs().includes(GUEST_STAY_LISTEN_FINALIZE_MS), "R3#3 isFinal clears finalize watchdog");
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    mock.instances[0]?.onend?.();
    assert(sends.length === 1, "R3#3 isFinal racing watchdog → exactly one send");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    mock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "no callback phrase" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    assert(sends.length === 0, "R3#4 soft-stop alone does not send yet");
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    assert(sends.length === 1 && sends[0] === "no callback phrase", "R3#4 soft-stop + candidate + no callbacks → watchdog sends once after 2500ms");
    assert(engine.status() === "idle", "R3#4 idle after watchdog send");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    timers.flush(GUEST_STAY_LISTEN_MAX_MS);
    assert(mock.instances[0]?.stopped, "R3#5 max soft-stop without candidate");
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_FINALIZE_MS), "R3#5 finalize armed with empty candidate");
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    assert(sends.length === 0 && engine.status() === "no-speech", "R3#5 soft-stop + no candidate + missing onend → no-speech, no send");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    const started = engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    assert(engine.handleError(started.generation, "aborted") === "no-speech", "R3#6 aborted + empty candidate → no-speech");
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    assert(sends.length === 0 && engine.status() === "no-speech", "R3#6 aborted + empty candidate → no send");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    mock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "manual stop keep" } }] });
    engine.stop();
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    mock.instances[0]?.onend?.();
    assert(sends.length === 0 && engine.status() === "idle", "R3#7 manual stop() with candidate → no send");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    mock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "manual abort keep" } }] });
    engine.abort();
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    mock.instances[0]?.onend?.();
    assert(sends.length === 0 && engine.status() === "idle", "R3#8 manual abort() with candidate → no send");
  }

  {
    const timers = createManualTimers();
    const sends: string[] = [];
    const engine = createGuestStayListenEngine({ timers });
    const mock = mockCtor();
    engine.start({
      lang: "en",
      ctor: mock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push(text);
      },
    });
    mock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "armed then stop" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    assert(timers.pendingMs().includes(GUEST_STAY_LISTEN_FINALIZE_MS), "R3#9 finalize armed after soft-stop");
    engine.stop();
    assert(timers.pendingCount() === 0, "R3#9 manual stop clears finalize watchdog");
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    mock.instances[0]?.onend?.();
    assert(sends.length === 0, "R3#9 watchdog armed then manual stop → no send");
  }

  {
    const timers = createManualTimers();
    const sends: Array<{ text: string; lang: string }> = [];
    const engine = createGuestStayListenEngine({ timers });
    const enMock = mockCtor();
    engine.start({
      lang: "en",
      ctor: enMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push({ text, lang: enMock.instances[0]?.lang ?? "" });
      },
    });
    assert(enMock.instances[0]?.lang === "en-US", "R3#10 EN recognition lang is en-US");
    enMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hello english" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    assert(sends.length === 1 && sends[0]?.text === "hello english" && sends[0]?.lang === "en-US", "R3#10 EN sends once with en-US");

    const esMock = mockCtor();
    engine.start({
      lang: "es",
      ctor: esMock.Ctor,
      isBrowser: true,
      isSecureContext: true,
      onFinal: (text) => {
        sends.push({ text, lang: esMock.instances[0]?.lang ?? "" });
      },
    });
    assert(esMock.instances[0]?.lang === "es-MX", "R3#10 ES recognition lang is es-MX");
    esMock.instances[0]?.onresult?.({ results: [{ isFinal: false, 0: { transcript: "hola espanol" } }] });
    timers.flush(GUEST_STAY_LISTEN_SILENCE_MS);
    timers.flush(GUEST_STAY_LISTEN_FINALIZE_MS);
    assert(sends.length === 2 && sends[1]?.text === "hola espanol" && sends[1]?.lang === "es-MX", "R3#10 ES sends once with es-MX");
    assert(sends[0]?.lang === "en-US" && sends[1]?.lang === "es-MX", "R3#10 EN then ES on same engine → one send each with correct langs");
  }

  const source = readFileSync(join(process.cwd(), "src/lib/guest-stay-listen.ts"), "utf8");
  assert(source.includes("GUEST_STAY_LISTEN_SILENCE_MS"), "silence constant is used");
  assert(source.includes("GUEST_STAY_LISTEN_MAX_MS"), "max-duration constant is used");
  assert(source.includes("GUEST_STAY_LISTEN_FINALIZE_MS"), "finalize watchdog constant is used");
  assert(source.includes("softStopRecognition"), "soft stop path exists");
  assert(source.includes("armFinalizeTimer"), "finalize watchdog arms after soft stop / aborted");
  assert(source.includes("armSilenceTimer"), "silence timer arms from interim results");
  assert(source.includes("guestStayListenDebug"), "temporary DEV STT debug helper is present");
  assert(source.includes("GUEST_STAY_LISTEN_DEBUG_PATH"), "DEV debug beacon path is present");
  assert(guestStayListenDebugEnabled() === (process.env.NODE_ENV !== "production"), "debug gate follows NODE_ENV");
  assert(!/\btoken\b/.test(source), "recognition helper has no token argument or fields");
  const withoutDebug = source
    .replace(/export function guestStayListenDebug\([\s\S]*?\n\}/, "")
    .replace(/guestStayListenDebug\([\s\S]*?\);/g, "");
  assert(
    !/getUserMedia|MediaRecorder|\/api\/transcribe|\/api\/tts|\/api\/avatar|human-voice|ElenaVoiceWidget|localStorage|sessionStorage|document\.cookie/.test(
      withoutDebug,
    ),
    "no recording, upload, legacy voice, or storage outside DEV debug",
  );
  assert(
    !/console\.(log|info|debug|error)|fetch\(/.test(withoutDebug),
    "non-debug production paths stay free of console/fetch",
  );
}

const isDirectRun = process.argv[1]?.includes("guest-stay-listen.test");
if (isDirectRun) {
  try {
    runGuestStayListenTests();
    console.log("guest-stay-listen tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-listen tests failed");
    process.exitCode = 1;
  }
}
