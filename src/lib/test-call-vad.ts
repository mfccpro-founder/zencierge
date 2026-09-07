export type RecordingStopReason = "end_of_speech" | "no_speech" | "max_recording" | "fixed_timer_fallback";

export const TEST_CALL_VAD = {
  frameMs: 50,
  voiceHoldFrames: 5,
  noiseFloorMin: 0.004,
  noiseFloorMax: 0.06,
  noiseFloorStart: 0.012,
  noiseAdapt: 0.08,
  voiceMultiplier: 3,
  noSpeechMs: 6000,
  silenceMs: 1200,
  maxRecordingMs: 15000,
  fallbackClipMs: 6000,
} as const;

export type VadState = {
  startedAtMs: number;
  consecutiveVoiceFrames: number;
  noiseFloor: number;
  speechDetectedAtMs: number | null;
  lastVoiceAtMs: number | null;
  stopped: boolean;
};

export function createVadState(nowMs: number): VadState {
  return {
    startedAtMs: nowMs,
    consecutiveVoiceFrames: 0,
    noiseFloor: TEST_CALL_VAD.noiseFloorStart,
    speechDetectedAtMs: null,
    lastVoiceAtMs: null,
    stopped: false,
  };
}

export function vadVoiceThreshold(noiseFloor: number) {
  const fromNoise = noiseFloor * TEST_CALL_VAD.voiceMultiplier;
  const min = TEST_CALL_VAD.noiseFloorMin * 2.5;
  const max = TEST_CALL_VAD.noiseFloorMax * 2;
  return Math.min(max, Math.max(min, fromNoise));
}

export function shouldTranscribeForStopReason(reason: RecordingStopReason) {
  return reason === "end_of_speech" || reason === "max_recording" || reason === "fixed_timer_fallback";
}

export function testCallShouldResumeListening(input: {
  oneTurnMode: boolean;
  callEnded: boolean;
  wantMic: boolean;
  callActive: boolean;
  guestTurnAccepted: boolean;
  phase: "idle" | "listening" | "thinking" | "speaking" | "ended";
  pcmActive: boolean;
}) {
  if (input.callEnded || input.phase === "ended") return false;
  if (!input.wantMic || !input.callActive) return false;
  if (input.oneTurnMode && input.guestTurnAccepted) return false;
  if (input.phase === "speaking" || input.phase === "thinking") return false;
  if (input.pcmActive) return false;
  return true;
}

export function testCallAfterSpeechAction(input: {
  oneTurnMode: boolean;
  guestTurnAccepted: boolean;
  phaseEnded: boolean;
  pcmActive: boolean;
}): "resume_listen" | "end_call" | "none" {
  if (input.phaseEnded || input.pcmActive) return "none";
  if (input.oneTurnMode && input.guestTurnAccepted) return "end_call";
  return "resume_listen";
}

export function applyVadStopIfCurrent(input: {
  generation: number;
  currentGeneration: number;
  stopReason: RecordingStopReason | null;
}) {
  if (input.generation !== input.currentGeneration) return { apply: false as const };
  if (!input.stopReason) return { apply: false as const };
  return { apply: true as const, stopReason: input.stopReason };
}

export function tickVad(state: VadState, nowMs: number, rms: number): {
  state: VadState;
  stopReason: RecordingStopReason | null;
  speechJustDetected: boolean;
} {
  if (state.stopped) {
    return { state, stopReason: null, speechJustDetected: false };
  }

  const elapsed = nowMs - state.startedAtMs;
  const threshold = vadVoiceThreshold(state.noiseFloor);
  const voiced = Number.isFinite(rms) && rms >= threshold;

  let noiseFloor = state.noiseFloor;
  if (!voiced && Number.isFinite(rms) && rms >= 0) {
    noiseFloor = Math.min(
      TEST_CALL_VAD.noiseFloorMax,
      Math.max(TEST_CALL_VAD.noiseFloorMin, noiseFloor * (1 - TEST_CALL_VAD.noiseAdapt) + rms * TEST_CALL_VAD.noiseAdapt),
    );
  }

  const consecutiveVoiceFrames = voiced ? state.consecutiveVoiceFrames + 1 : 0;
  let speechDetectedAtMs = state.speechDetectedAtMs;
  let lastVoiceAtMs = state.lastVoiceAtMs;
  let speechJustDetected = false;

  if (!speechDetectedAtMs && consecutiveVoiceFrames >= TEST_CALL_VAD.voiceHoldFrames) {
    speechDetectedAtMs = nowMs;
    lastVoiceAtMs = nowMs;
    speechJustDetected = true;
  } else if (speechDetectedAtMs && voiced) {
    lastVoiceAtMs = nowMs;
  }

  const next: VadState = {
    startedAtMs: state.startedAtMs,
    consecutiveVoiceFrames,
    noiseFloor,
    speechDetectedAtMs,
    lastVoiceAtMs,
    stopped: false,
  };

  if (!speechDetectedAtMs && elapsed >= TEST_CALL_VAD.noSpeechMs) {
    return { state: { ...next, stopped: true }, stopReason: "no_speech", speechJustDetected };
  }
  if (speechDetectedAtMs && lastVoiceAtMs != null && nowMs - lastVoiceAtMs >= TEST_CALL_VAD.silenceMs) {
    return { state: { ...next, stopped: true }, stopReason: "end_of_speech", speechJustDetected };
  }
  if (elapsed >= TEST_CALL_VAD.maxRecordingMs) {
    return {
      state: { ...next, stopped: true },
      stopReason: speechDetectedAtMs ? "max_recording" : "no_speech",
      speechJustDetected,
    };
  }

  return { state: next, stopReason: null, speechJustDetected };
}

export type TestCallVadHandle = {
  cleanup: () => void;
};

function rmsFromTimeDomain(bytes: Uint8Array) {
  if (!bytes.length) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const centered = ((bytes[i] ?? 128) - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / bytes.length);
}

/** Local AnalyserNode VAD. Never touches the shared PCM/TTS AudioContext. */
export function attachTestCallVad(
  stream: MediaStream,
  options: {
    generation: number;
    isCurrent: () => boolean;
    onSpeechDetected: () => void;
    onDecision: (reason: RecordingStopReason, meta: { recordingDurationMs: number; silenceDurationMs: number }) => void;
  },
): TestCallVadHandle | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx || typeof AnalyserNode === "undefined") return null;

  let ctx: AudioContext;
  try {
    ctx = new AudioCtx();
  } catch {
    return null;
  }

  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let raf = 0;
  let interval = 0;
  let closed = false;
  let state = createVadState(typeof performance !== "undefined" ? performance.now() : Date.now());
  const timeDomain = new Uint8Array(256);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (interval) {
      window.clearInterval(interval);
      interval = 0;
    }
    try {
      source?.disconnect();
    } catch {
      /* ignore */
    }
    try {
      analyser?.disconnect();
    } catch {
      /* ignore */
    }
    source = null;
    analyser = null;
    if (ctx.state !== "closed") {
      void ctx.close().catch(() => {});
    }
  };

  const emit = (reason: RecordingStopReason) => {
    if (closed) return;
    if (!options.isCurrent()) {
      cleanup();
      return;
    }
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const recordingDurationMs = Math.max(0, Math.round(now - state.startedAtMs));
    const silenceDurationMs = reason === "end_of_speech" ? TEST_CALL_VAD.silenceMs : 0;
    cleanup();
    options.onDecision(reason, { recordingDurationMs, silenceDurationMs });
  };

  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);
    void ctx.resume().catch(() => {});
  } catch {
    cleanup();
    return null;
  }

  const sample = () => {
    if (closed || !analyser) return;
    if (!options.isCurrent()) {
      cleanup();
      return;
    }
    analyser.getByteTimeDomainData(timeDomain);
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const result = tickVad(state, now, rmsFromTimeDomain(timeDomain));
    state = result.state;
    if (result.speechJustDetected) options.onSpeechDetected();
    if (result.stopReason) emit(result.stopReason);
  };

  interval = window.setInterval(sample, TEST_CALL_VAD.frameMs);

  return { cleanup };
}
