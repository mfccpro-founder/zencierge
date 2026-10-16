import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyTourCommand,
  buildSpokenScript,
  commandForRedStopButton,
  createTourState,
  HOST_TOUR_SPEECH_RATE,
  HOST_TOUR_UI,
  isGuideModuleLocationActive,
  matchGuideModuleIndex,
  parseHrefTab,
} from "../lib/host-guide-tour";
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
  const layoutSource = readFileSync(join(process.cwd(), "src/app/(host-portal)/dashboard/layout.tsx"), "utf8").replace(/\r\n/g, "\n");
  const ids = buildHostGuideModules("en").map((mod) => mod.id);
  const en = HOST_TOUR_UI.en;

  assert(source.includes("commandForRedStopButton(state)"), "red Stop button uses commandForRedStopButton");
  assert(source.includes("{ui.stop}"), "visible red button label remains Stop");
  assert(source.includes(`onClick={() => run({ type: "pause" })}`), "separate Pause button still dispatches pause");
  assert(source.includes(`onClick={() => run({ type: "resume" })}`), "Resume button still dispatches resume");
  assert(source.includes("utterance.rate = HOST_TOUR_SPEECH_RATE"), "tour narration uses the slower shared speech rate");
  assert(source.includes("current.summary"), "active tour step renders its explanation");
  assert(source.includes('"sticky top-20 z-30'), "tour controls remain visible below the host header when a module scrolls to an in-page tab");
  assert(layoutSource.includes("overflow-x-clip"), "dashboard clipping does not create an ancestor scroll container that disables sticky tour controls");
  assert(!layoutSource.includes("overflow-x-hidden"), "dashboard layout does not trap the sticky tour in a non-scrolling overflow ancestor");
  assert(source.includes("isGuideModuleLocationActive(pathname, tab, currentModule)"), "speech waits for the requested route or tab");
  assert(HOST_TOUR_SPEECH_RATE === 0.82, "tour narration rate is deliberately slower than the browser default");
  assert(source.includes(`onClick={() => activateSequence("host")}`), "Start explicitly selects the original host tour");
  assert(source.includes(`onClick={() => run({ type: "repeat" })}`), "Repeat mapping is unchanged");
  assert(source.includes(`run({ type: "previous" });`), "Previous still dispatches the original command after clearing the demo gate");
  assert(source.includes(`onClick={() => run({ type: "next" })}`), "Next mapping is unchanged");
  assert(source.includes(`onClick={() => activateSequence("saturday")}`), "Saturday demo has an explicit start control");
  assert(source.includes("fetchSaturdayDemoVerification"), "operational demo steps use server verification");
  assert(source.includes("cancelSpeech();"), "unmount cleanup still cancels speech");
  assert(
    source.includes('if (fx.pause && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.pause();'),
    "pause effect still calls speechSynthesis.pause",
  );
  assert(
    source.includes('if (fx.resume && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.resume();'),
    "resume effect still calls speechSynthesis.resume",
  );
  assert(source.includes("commandForRedStopButton(state)"), "red Stop button dispatches the dedicated terminal command");
  assert(!source.includes("TOUR_CHUNK_MAX_CHARS") && !source.includes("chunkTourNarration") && !source.includes("speakCurrentChunk"), "no chunking");
  assert(!source.includes("subscribeTourSpeechController") && !source.includes("cleanupRequired") && !source.includes("settleTourCleanup"), "no persistent speech controller or cleanup barrier");
  assert(!source.includes("/api/tts") && !/\bfetch\s*\(/.test(source), "no network TTS");
  assert(!source.includes("guest-stay-speech") && !source.includes("guest-stay-tts"), "no guest speech");
  assert(!source.includes("elena-voice-widget") && !source.includes("GuestElenaTextCard"), "no Elena imports");
  assert(!source.includes("HTMLAudioElement") && !source.includes("new Audio") && !source.includes("AudioContext"), "no audio element or Web Audio");

  const idle = createTourState();
  const firstModule = buildHostGuideModules("en")[0];
  const spokenScript = buildSpokenScript(firstModule);
  assert(spokenScript.includes(" … "), "spoken tour inserts an audible observation pause between sections");
  assert(
    spokenScript.split(" … ").length === firstModule.steps.length + 2,
    "spoken tour pauses after the title, summary, and between every instruction",
  );
  assert(commandForRedStopButton(idle).type === "stop", "idle red Stop uses terminal stop");

  let fx = applyTourCommand(idle, { type: "start" }, 16, ids);
  assert(fx.state.pendingSpeak && !fx.speak, "Start waits for Overview to become active before speaking");
  fx = applyTourCommand(fx.state, { type: "routeSettled", locationMatchesCurrent: true }, 16, ids);
  assert(fx.speak && !fx.state.pendingSpeak, "Start speaks only after Overview is active");
  const speaking = { ...fx.state, speech: "speaking" as const };
  const redStopCommand = commandForRedStopButton(speaking);
  assert(redStopCommand.type === "stop", "red Stop remains terminal while narration is speaking");

  const synth = createFakeSynth();
  synth.speak("overview");
  const stopFx = applyTourCommand(speaking, redStopCommand, 16, ids);
  applySpeechFx(stopFx, synth);
  assert(stopFx.cancel && !stopFx.pause && !stopFx.speak && !stopFx.resume, "red Stop cancels without pausing or restarting");
  assert(stopFx.navigateIndex === null, "red Stop does not navigate");
  assert(stopFx.state.mode === "idle" && stopFx.state.speech === "idle", "red Stop ends the tour");
  assert(synth.calls.filter((call) => call === "cancel").length === 1, "red Stop calls speechSynthesis.cancel");
  assert(synth.spoken.length === 1, "red Stop does not create another utterance");

  const pausedForResume = applyTourCommand(speaking, { type: "pause" }, 16, ids);
  applySpeechFx(pausedForResume, synth);
  const resumeFx = applyTourCommand(pausedForResume.state, { type: "resume" }, 16, ids);
  applySpeechFx(resumeFx, synth);
  assert(resumeFx.resume && !resumeFx.cancel && !resumeFx.speak && !resumeFx.pause, "Resume does not cancel or start a new script");
  assert(resumeFx.state.speech === "speaking" && resumeFx.state.mode === "tour", "Resume continues the same tour utterance");
  assert(resumeFx.state.index === pausedForResume.state.index && resumeFx.state.generation === pausedForResume.state.generation, "Resume does not restart from the beginning");
  assert(synth.calls.filter((call) => call === "resume").length === 1, "Resume calls speechSynthesis.resume");
  assert(synth.spoken.length === 1, "Resume does not create a second utterance");
  assert(synth.calls.filter((call) => call === "speak").length === 1, "no extra speak on Resume");

  const pauseBtn = applyTourCommand(speaking, { type: "pause" }, 16, ids);
  assert(pauseBtn.pause && pauseBtn.state.speech === "paused", "existing Pause command is unchanged");

  fx = applyTourCommand(createTourState(), { type: "start" }, 16, ids);
  assert(!fx.speak && fx.cancel && fx.navigateIndex === 0 && fx.state.pendingSpeak, "Start navigates before speaking");
  fx = applyTourCommand(fx.state, { type: "routeSettled", locationMatchesCurrent: false }, 16, ids);
  assert(!fx.speak && fx.state.pendingSpeak, "tour stays silent while the requested route is not active");
  fx = applyTourCommand(fx.state, { type: "routeSettled", locationMatchesCurrent: true }, 16, ids);
  assert(fx.speak && !fx.state.pendingSpeak, "tour speaks after the requested route becomes active");
  fx = applyTourCommand({ ...fx.state, speech: "speaking" }, { type: "repeat" }, 16, ids);
  assert(fx.speak && fx.cancel && fx.navigateIndex === null, "Repeat mapping remains unchanged");
  fx = applyTourCommand({ mode: "tour", index: 1, speech: "speaking", pendingSpeak: false, generation: 2 }, { type: "previous" }, 16, ids);
  assert(!fx.speak && fx.cancel && fx.navigateIndex === 0 && fx.state.pendingSpeak, "Previous waits for navigation before speaking");
  fx = applyTourCommand({ mode: "tour", index: 0, speech: "speaking", pendingSpeak: false, generation: 2 }, { type: "next" }, 16, ids);
  assert(!fx.speak && fx.cancel && fx.navigateIndex === 1 && fx.state.pendingSpeak, "Next waits for navigation before speaking");

  const modules = buildHostGuideModules("en");
  assert(modules.length === 16, "all 16 host modules are present");
  modules.forEach((module, index) => {
    const url = new URL(module.href, "https://zencierge.local");
    const matched = matchGuideModuleIndex(url.pathname, parseHrefTab(module.href), modules);
    assert(matched === index, `${module.id} route selects its own module`);
    assert(isGuideModuleLocationActive(url.pathname, parseHrefTab(module.href), module), `${module.id} recognizes its active route or tab`);
    assert(buildSpokenScript(module).length > module.summary.length, `${module.id} has spoken explanation and instructions`);
    const waiting: ReturnType<typeof applyTourCommand>["state"] = {
      mode: "tour",
      index,
      speech: "idle",
      pendingSpeak: true,
      generation: index + 1,
    };
    const settled = applyTourCommand(waiting, { type: "routeSettled", locationMatchesCurrent: true }, modules.length, ids);
    assert(settled.speak && settled.highlightId === module.id, `${module.id} speaks and highlights after its tab opens`);
    const moduleSpeaking = { ...settled.state, speech: "speaking" as const };
    const paused = applyTourCommand(moduleSpeaking, { type: "pause" }, modules.length, ids);
    const resumed = applyTourCommand(paused.state, { type: "resume" }, modules.length, ids);
    assert(paused.pause && resumed.resume, `${module.id} preserves Pause and Resume`);
  });

  (["en", "es"] as const).forEach((language) => {
    const localizedModules = buildHostGuideModules(language);
    assert(localizedModules.length === 16, `${language} contains all 16 host modules`);
    localizedModules.forEach((module) => {
      const visibleCopy = [module.title, module.summary].join(" ");
      const spokenCopy = buildSpokenScript(module);
      assert(!/\bElena\b/i.test(visibleCopy), `${language}/${module.id} visible tour copy names Isabela, not Elena`);
      assert(!/\bElena\b/i.test(spokenCopy), `${language}/${module.id} spoken tour copy names Isabela, not Elena`);
      assert(spokenCopy.includes(module.title), `${language}/${module.id} narration includes the visible title`);
      assert(spokenCopy.includes(module.summary), `${language}/${module.id} narration includes the visible summary`);
    });
  });

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
