import {
  applyVadStopIfCurrent,
  createVadState,
  shouldTranscribeForStopReason,
  TEST_CALL_VAD,
  testCallAfterSpeechAction,
  testCallShouldResumeListening,
  tickVad,
  vadVoiceThreshold,
} from "./test-call-vad";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function runVoiceFrames(start: ReturnType<typeof createVadState>, fromMs: number, frames: number, rms: number) {
  let state = start;
  let last = { state, stopReason: null as ReturnType<typeof tickVad>["stopReason"], speechJustDetected: false };
  for (let i = 0; i < frames; i += 1) {
    last = tickVad(state, fromMs + i * TEST_CALL_VAD.frameMs, rms);
    state = last.state;
  }
  return last;
}

export function runTestCallVadTests() {
  const loud = vadVoiceThreshold(TEST_CALL_VAD.noiseFloorStart) * 2;
  const quiet = TEST_CALL_VAD.noiseFloorMin / 2;

  const spike = tickVad(createVadState(0), 50, loud);
  assert(!spike.state.speechDetectedAtMs, "isolated noise must not count as speech");
  assert(spike.state.consecutiveVoiceFrames === 1, "one spike is one frame");
  const afterSpike = tickVad(spike.state, 100, quiet);
  assert(afterSpike.state.consecutiveVoiceFrames === 0, "noise frame must reset hold");
  assert(!afterSpike.state.speechDetectedAtMs, "spike then quiet is not speech");

  const held = runVoiceFrames(createVadState(0), 0, TEST_CALL_VAD.voiceHoldFrames, loud);
  assert(Boolean(held.state.speechDetectedAtMs), "sustained speech must be detected");
  assert(held.speechJustDetected, "first hold crossing should flag speechJustDetected");

  let afterSpeech = held.state;
  let silenceStop = tickVad(afterSpeech, (afterSpeech.speechDetectedAtMs ?? 0) + 1000, quiet);
  assert(!silenceStop.stopReason, "silence under 1.2s must not stop");
  silenceStop = tickVad(silenceStop.state, (afterSpeech.speechDetectedAtMs ?? 0) + TEST_CALL_VAD.silenceMs, quiet);
  assert(silenceStop.stopReason === "end_of_speech", "1.2s silence after speech must stop");
  assert(shouldTranscribeForStopReason("end_of_speech"), "end of speech should transcribe");

  afterSpeech = held.state;
  const resume = tickVad(afterSpeech, (afterSpeech.lastVoiceAtMs ?? 0) + 800, loud);
  assert(!resume.stopReason, "voice during silence window must not stop");
  const stillOpen = tickVad(resume.state, (resume.state.lastVoiceAtMs ?? 0) + 1000, quiet);
  assert(!stillOpen.stopReason, "silence timer must reset after resumed speech");
  const stoppedAfterReset = tickVad(stillOpen.state, (resume.state.lastVoiceAtMs ?? 0) + TEST_CALL_VAD.silenceMs, quiet);
  assert(stoppedAfterReset.stopReason === "end_of_speech", "silence after resume still ends at 1.2s");

  const noSpeech = tickVad(createVadState(0), TEST_CALL_VAD.noSpeechMs, quiet);
  assert(noSpeech.stopReason === "no_speech", "6s without speech must end without transcription");
  assert(!shouldTranscribeForStopReason("no_speech"), "no_speech must not transcribe");

  const talking = runVoiceFrames(createVadState(0), 0, TEST_CALL_VAD.voiceHoldFrames, loud).state;
  const maxed = tickVad(talking, TEST_CALL_VAD.maxRecordingMs, loud);
  assert(maxed.stopReason === "max_recording", "continuous speech must stop at 15s");
  assert(shouldTranscribeForStopReason("max_recording"), "max recording should transcribe once");

  const stale = applyVadStopIfCurrent({ generation: 1, currentGeneration: 2, stopReason: "end_of_speech" });
  assert(!stale.apply, "stale generation must not stop a new recorder");
  const live = applyVadStopIfCurrent({ generation: 4, currentGeneration: 4, stopReason: "end_of_speech" });
  assert(live.apply && live.stopReason === "end_of_speech", "current generation may stop");

  assert(shouldTranscribeForStopReason("fixed_timer_fallback"), "fallback six-second stop still transcribes");
  assert(TEST_CALL_VAD.fallbackClipMs === 6000, "fallback must keep the prior six-second clip");

  assert(
    testCallAfterSpeechAction({
      oneTurnMode: true,
      guestTurnAccepted: true,
      phaseEnded: false,
      pcmActive: false,
    }) === "end_call",
    "successful response still auto-ends Test Call",
  );
  assert(
    testCallAfterSpeechAction({
      oneTurnMode: true,
      guestTurnAccepted: false,
      phaseEnded: false,
      pcmActive: false,
    }) === "resume_listen",
    "greeting completion still opens listening once",
  );
  assert(
    !testCallShouldResumeListening({
      oneTurnMode: true,
      callEnded: false,
      wantMic: true,
      callActive: true,
      guestTurnAccepted: true,
      phase: "idle",
      pcmActive: false,
    }),
    "accepted guest turn cannot resume listening",
  );

  const greeting = "Hello! Welcome to Zencierge. ¡Hola! Bienvenido a Zencierge. How can I help you today? ¿En qué puedo ayudarte?";
  assert(/Hello!/.test(greeting) && /Hola!/.test(greeting), "bilingual greeting text must stay bilingual");
  const mirror =
    "Automatically detect the language of the guest's last message and answer only in that language (Spanish if they spoke Spanish, English if they spoke English). Never reply in the other language.";
  assert(/Never reply in the other language/.test(mirror), "language mirroring instruction must stay");
}

const isDirectRun = process.argv[1]?.includes("test-call-vad");
if (isDirectRun) {
  try {
    runTestCallVadTests();
    console.log("test-call-vad tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "test-call-vad tests failed");
    process.exitCode = 1;
  }
}
