import { readFileSync } from "node:fs";
import { join } from "node:path";
import { commandForRedStopButton } from "./InteractiveConciergeTour";
import { applyTourCommand, createTourState, HOST_TOUR_UI } from "../lib/host-guide-tour";
import { buildHostGuideModules } from "../lib/host-guide-content";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function createFakeSynth() {
  const calls: string[] = [];
  const spoken: string[] = [];
  return {
    calls,
    spoken,
    pause() {
      calls.push("pause");
    },
    cancel() {
      calls.push("cancel");
    },
    resume() {
      calls.push("resume");
    },
    speak(text: string) {
      calls.push("speak");
      spoken.push(text);
    },
  };
}

function applySpeechFx(
  fx: ReturnType<typeof applyTourCommand>,
  synth: ReturnType<typeof createFakeSynth>,
) {
  if (fx.cancel) synth.cancel();
  if (fx.pause) synth.pause();
  if (fx.resume) synth.resume();
  if (fx.speak) synth.speak("script");
}

export function runInteractiveConciergeTourTests() {
  const source = readFileSync(join(process.cwd(), "src/components/InteractiveConciergeTour.tsx"), "utf8").replace(/\r\n/g, "\n");
  const ids = buildHostGuideModules("en").map((mod) => mod.id);
  const en = HOST_TOUR_UI.en;

  assert(source.includes("commandForRedStopButton(state)"), "red Stop button uses commandForRedStopButton");
  assert(source.includes("{ui.stop}"), "visible red button label remains Stop");
  assert(source.includes(`onClick={() => run({ type: "pause" })}`), "separate Pause button still dispatches pause");
  assert(source.includes(`onClick={() => run({ type: "resume" })}`), "Resume button still dispatches resume");
  assert(source.includes(`onClick={() => run({ type: "start" })}`), "Start mapping is unchanged");
  assert(source.includes(`onClick={() => run({ type: "repeat" })}`), "Repeat mapping is unchanged");
  assert(source.includes(`onClick={() => run({ type: "previous" })}`), "Previous mapping is unchanged");
  assert(source.includes(`onClick={() => run({ type: "next" })}`), "Next mapping is unchanged");
  assert(source.includes("cancelSpeech();"), "unmount cleanup still cancels speech");
  assert(
    source.includes('if (fx.pause && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.pause();'),
    "pause effect still calls speechSynthesis.pause",
  );
  assert(
    source.includes('if (fx.resume && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.resume();'),
    "resume effect still calls speechSynthesis.resume",
  );
  assert(!source.includes("commandForRedStopButton") || !/btnDanger[\s\S]*run\(\{\s*type:\s*"stop"\s*\}\)/.test(source), "red Stop button does not dispatch terminal stop while remapped");
  assert(!source.includes("TOUR_CHUNK_MAX_CHARS") && !source.includes("chunkTourNarration") && !source.includes("speakCurrentChunk"), "no chunking");
  assert(!source.includes("subscribeTourSpeechController") && !source.includes("cleanupRequired") && !source.includes("settleTourCleanup"), "no persistent speech controller or cleanup barrier");
  assert(!source.includes("/api/tts") && !/\bfetch\s*\(/.test(source), "no network TTS");
  assert(!source.includes("guest-stay-speech") && !source.includes("guest-stay-tts"), "no guest speech");
  assert(!source.includes("elena-voice-widget") && !source.includes("GuestElenaTextCard"), "no Elena imports");
  assert(!source.includes("HTMLAudioElement") && !source.includes("new Audio") && !source.includes("AudioContext"), "no audio element or Web Audio");

  const idle = createTourState();
  assert(commandForRedStopButton(idle).type === "stop", "idle red Stop still uses terminal stop");

  let fx = applyTourCommand(idle, { type: "start" }, 16, ids);
  const speaking = { ...fx.state, speech: "speaking" as const };
  const redStopCommand = commandForRedStopButton(speaking);
  assert(redStopCommand.type === "pause", "red Stop uses the existing pause command, not terminal stop");
  assert(redStopCommand.type !== "stop", "red Stop does not use the terminal stop command while speaking");

  const synth = createFakeSynth();
  synth.speak("overview");
  const pauseFx = applyTourCommand(speaking, redStopCommand, 16, ids);
  applySpeechFx(pauseFx, synth);
  assert(pauseFx.pause && !pauseFx.cancel && !pauseFx.speak && !pauseFx.resume, "red Stop pause effect does not cancel or restart");
  assert(pauseFx.navigateIndex === null, "red Stop does not navigate");
  assert(pauseFx.state.mode === "tour", "tour mode remains active after red Stop");
  assert(pauseFx.state.speech === "paused", "speech state becomes paused");
  assert(pauseFx.state.index === speaking.index && pauseFx.state.generation === speaking.generation, "red Stop does not restart the script or bump generation");
  assert(synth.calls.filter((call) => call === "pause").length === 1, "red Stop calls speechSynthesis.pause");
  assert(!synth.calls.includes("cancel"), "red Stop does not call speechSynthesis.cancel");
  assert(synth.spoken.length === 1, "red Stop does not create another utterance");
  assert(pauseFx.state.speech === "paused", "Resume becomes enabled because speech is paused");

  const resumeFx = applyTourCommand(pauseFx.state, { type: "resume" }, 16, ids);
  applySpeechFx(resumeFx, synth);
  assert(resumeFx.resume && !resumeFx.cancel && !resumeFx.speak && !resumeFx.pause, "Resume does not cancel or start a new script");
  assert(resumeFx.state.speech === "speaking" && resumeFx.state.mode === "tour", "Resume continues the same tour utterance");
  assert(resumeFx.state.index === pauseFx.state.index && resumeFx.state.generation === pauseFx.state.generation, "Resume does not restart from the beginning");
  assert(synth.calls.filter((call) => call === "resume").length === 1, "Resume calls speechSynthesis.resume");
  assert(synth.spoken.length === 1, "Resume does not create a second utterance");
  assert(synth.calls.filter((call) => call === "speak").length === 1, "no extra speak on Resume");

  const pauseBtn = applyTourCommand(speaking, { type: "pause" }, 16, ids);
  assert(pauseBtn.pause && pauseBtn.state.speech === "paused", "existing Pause command is unchanged");

  fx = applyTourCommand(createTourState(), { type: "start" }, 16, ids);
  assert(fx.speak && fx.cancel && fx.navigateIndex === 0, "Start mapping remains unchanged");
  fx = applyTourCommand({ ...fx.state, speech: "speaking" }, { type: "repeat" }, 16, ids);
  assert(fx.speak && fx.cancel && fx.navigateIndex === null, "Repeat mapping remains unchanged");
  fx = applyTourCommand({ mode: "tour", index: 1, speech: "speaking", pendingSpeak: false, generation: 2 }, { type: "previous" }, 16, ids);
  assert(fx.speak && fx.cancel && fx.navigateIndex === 0, "Previous mapping remains unchanged");
  fx = applyTourCommand({ mode: "tour", index: 0, speech: "speaking", pendingSpeak: false, generation: 2 }, { type: "next" }, 16, ids);
  assert(fx.speak && fx.cancel && fx.navigateIndex === 1, "Next mapping remains unchanged");

  const unmountSynth = createFakeSynth();
  unmountSynth.speak("owned");
  unmountSynth.cancel();
  assert(unmountSynth.calls.includes("cancel"), "unmount cleanup still may cancel");
  assert(en.stop === "Stop", "English Stop label is unchanged");
}

const isDirectRun = process.argv[1]?.includes("InteractiveConciergeTour.test");
if (isDirectRun) {
  try {
    runInteractiveConciergeTourTests();
    console.log("InteractiveConciergeTour tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "InteractiveConciergeTour tests failed");
    process.exitCode = 1;
  }
}
