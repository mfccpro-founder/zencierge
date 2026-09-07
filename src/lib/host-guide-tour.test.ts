import {
  HOST_TOUR_COMMAND_EVENT,
  applyTourCommand,
  buildSpokenScript,
  createTourState,
  expectedTourStepCount,
  isUserGuidePath,
  matchGuideModuleIndex,
  parseHrefTab,
  pickGuideVoice,
  spokenScriptLooksSafe,
} from "./host-guide-tour";
import { buildHostGuideModules } from "./host-guide-content";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

export function runHostGuideTourTests() {
  const en = buildHostGuideModules("en");
  const es = buildHostGuideModules("es");
  const ids = en.map((mod) => mod.id);
  assert(en.length === 16 && expectedTourStepCount() === 16, "tour must have 16 steps");
  assert(!ids.includes("user-guide"), "User Guide must not be a tour step");
  assert(
    ids.join(",") ===
      "overview,calendar,payouts-noi,chargeback-shield,dispute-dossier,properties-access,elena-voice,guest-qr,housekeeping,photo-reports,supplies,team-cleaners,neighbor-shield,guest-dna,laws,settings",
    "16-step order must match sidebar",
  );

  const qr = en.find((mod) => mod.id === "guest-qr");
  assert(Boolean(qr?.href.includes("tab=guest-qr")), "Guest QR query tab");
  assert(parseHrefTab(en.find((mod) => mod.id === "photo-reports")!.href) === "reports", "photo reports tab");
  assert(parseHrefTab(en.find((mod) => mod.id === "supplies")!.href) === "supplies", "supplies tab");
  assert(parseHrefTab(en.find((mod) => mod.id === "team-cleaners")!.href) === "team", "team tab");
  assert(en.find((mod) => mod.id === "elena-voice")!.href !== qr!.href, "voice vs QR distinct");

  assert(matchGuideModuleIndex("/dashboard/voice-agent", "guest-qr", en) === ids.indexOf("guest-qr"), "match Guest QR");
  assert(matchGuideModuleIndex("/dashboard/voice-agent", null, en) === ids.indexOf("elena-voice"), "match Elena Voice");
  assert(matchGuideModuleIndex("/dashboard/housekeeping", "supplies", en) === ids.indexOf("supplies"), "match Supplies");
  assert(matchGuideModuleIndex("/dashboard/guide", null, en) === -1, "User Guide is not a module");
  assert(isUserGuidePath("/dashboard/guide/"), "guide path helper");

  let state = createTourState();
  let fx = applyTourCommand(state, { type: "start" }, 16, ids);
  assert(fx.state.mode === "tour" && fx.state.index === 0 && fx.navigateIndex === 0 && fx.cancel, "start");
  assert(fx.speak && !fx.state.pendingSpeak && fx.highlightId === "overview", "start speaks immediately while navigating");
  state = fx.state;

  fx = applyTourCommand(state, { type: "routeSettled", locationMatchesCurrent: true }, 16, ids);
  assert(!fx.speak && !fx.cancel && fx.navigateIndex === null, "routeSettled must not cancel or speak again");
  assert(fx.state.generation === state.generation, "routeSettled does not bump generation");
  state = fx.state;

  fx = applyTourCommand(state, { type: "pause" }, 16, ids);
  assert(!fx.pause, "pause only while speaking");
  state = { ...state, speech: "speaking" };
  fx = applyTourCommand(state, { type: "pause" }, 16, ids);
  assert(fx.pause && fx.state.speech === "paused", "pause");
  state = fx.state;
  fx = applyTourCommand(state, { type: "resume" }, 16, ids);
  assert(fx.resume && fx.state.speech === "speaking", "resume");
  state = fx.state;

  fx = applyTourCommand(state, { type: "repeat" }, 16, ids);
  assert(fx.speak && fx.cancel && fx.navigateIndex === null, "repeat current only");
  state = fx.state;

  fx = applyTourCommand(state, { type: "previous" }, 16, ids);
  assert(fx.navigateIndex === null && !fx.speak && !fx.cancel, "previous disabled on module 1");

  const beforeNextGen = state.generation;
  fx = applyTourCommand(state, { type: "next" }, 16, ids);
  assert(fx.state.index === 1 && fx.navigateIndex === 1 && fx.cancel && fx.speak, "next: one cancel, one nav, immediate speak");
  assert(fx.state.generation > beforeNextGen && !fx.state.pendingSpeak, "next invalidates generation and does not wait for URL");
  state = fx.state;

  const settledAfterNext = applyTourCommand(state, { type: "routeSettled", locationMatchesCurrent: true }, 16, ids);
  assert(!settledAfterNext.speak && !settledAfterNext.cancel, "routeSettled after next is silent");

  const beforePrevGen = state.generation;
  fx = applyTourCommand(state, { type: "previous" }, 16, ids);
  assert(fx.state.index === 0 && fx.navigateIndex === 0 && fx.cancel && fx.speak, "previous: one cancel, one nav, immediate speak");
  assert(fx.state.generation > beforePrevGen && !fx.state.pendingSpeak, "previous does not wait for URL");
  state = fx.state;

  fx = applyTourCommand(state, { type: "next" }, 16, ids);
  const rapidFirst = fx;
  fx = applyTourCommand(rapidFirst.state, { type: "next" }, 16, ids);
  assert(fx.state.index === 2 && fx.state.generation > rapidFirst.state.generation, "rapid next keeps only latest generation");
  assert(fx.speak && fx.cancel && fx.navigateIndex === 2, "rapid next speaks newest target only");
  const staleRapid = applyTourCommand(fx.state, { type: "speechEnded", generation: rapidFirst.state.generation }, 16, ids);
  assert(staleRapid.state.speech === fx.state.speech && staleRapid.state.generation === fx.state.generation, "stale rapid generation cannot restart speech");
  state = fx.state;

  fx = applyTourCommand(state, { type: "next" }, 16, ids);
  const scheduledGen = fx.state.generation;
  fx = applyTourCommand(fx.state, { type: "stop" }, 16, ids);
  assert(fx.state.mode === "idle" && fx.cancel && !fx.speak && fx.state.generation > scheduledGen, "stop invalidates scheduled speech");
  assert(fx.navigateIndex === null, "stop stays on the current page");
  const afterStopSettle = applyTourCommand(fx.state, { type: "routeSettled", locationMatchesCurrent: true }, 16, ids);
  assert(!afterStopSettle.speak && !afterStopSettle.cancel, "route completion after stop does not restart audio");

  state = createTourState();
  fx = applyTourCommand(state, { type: "start" }, 16, ids);
  state = fx.state;
  for (let i = 0; i < 6; i += 1) {
    fx = applyTourCommand(state, { type: "next" }, 16, ids);
    state = fx.state;
  }
  assert(ids[state.index] === "elena-voice", "query-tab neighbor is Elena Voice");
  fx = applyTourCommand(state, { type: "next" }, 16, ids);
  assert(fx.navigateIndex === 7 && ids[7] === "guest-qr" && en[7]!.href.includes("tab=guest-qr"), "query-tab next navigates to Guest QR href");
  assert(fx.speak && fx.cancel, "query-tab next still speaks immediately");
  state = fx.state;

  for (let i = state.index; i < 15; i += 1) {
    fx = applyTourCommand(state, { type: "next" }, 16, ids);
    state = fx.state;
  }
  assert(state.index === 15, "last module index");
  fx = applyTourCommand(state, { type: "next" }, 16, ids);
  assert(fx.finished && fx.state.mode === "idle" && fx.highlightId === null && fx.cancel && !fx.speak, "finish ends safely");

  state = createTourState();
  fx = applyTourCommand(state, { type: "explain", matchedIndex: null }, 16, ids);
  assert(fx.messageKey === "undocumented" && !fx.speak, "explain undocumented");
  fx = applyTourCommand(state, { type: "explain", matchedIndex: 7 }, 16, ids);
  assert(fx.state.mode === "explain" && fx.speak && fx.cancel && fx.navigateIndex === null && fx.highlightId === "guest-qr", "explain speaks once on matched route");
  assert(fx.state.mode !== "tour", "explain does not start full tour");
  const explainAgain = applyTourCommand(fx.state, { type: "repeat" }, 16, ids);
  assert(explainAgain.speak && explainAgain.cancel && explainAgain.navigateIndex === null, "repeat speaks once without navigation");

  fx = applyTourCommand(fx.state, { type: "stop" }, 16, ids);
  assert(fx.state.mode === "idle" && fx.cancel && fx.highlightId === null, "stop");

  const ended = applyTourCommand(
    { ...createTourState(), mode: "tour", generation: 3, speech: "speaking" },
    { type: "speechEnded", generation: 3 },
    16,
    ids,
  );
  assert(ended.state.speech === "idle" && ended.navigateIndex === null, "speech end does not auto-next");
  const stale = applyTourCommand(
    { ...createTourState(), mode: "tour", generation: 4, speech: "speaking" },
    { type: "speechEnded", generation: 3 },
    16,
    ids,
  );
  assert(stale.state.speech === "speaking", "stale speech end ignored");

  fx = applyTourCommand({ ...createTourState(), mode: "tour", index: 2 }, { type: "languageChanged" }, 16, ids);
  assert(fx.cancel && !fx.speak && fx.messageKey === "needRepeat", "language change cancels and waits");

  const enScript = buildSpokenScript(en[0]!);
  const esScript = buildSpokenScript(es[0]!);
  assert(enScript.includes(en[0]!.title) && enScript.includes(en[0]!.summary), "EN speech from static copy");
  assert(esScript.includes(es[0]!.title), "ES speech from static copy");
  for (const mod of [...en, ...es]) {
    const script = buildSpokenScript(mod);
    assert(spokenScriptLooksSafe(script), `unsafe speech for ${mod.id}`);
    assert(!mod.tips.some((tip) => script.includes(tip)), `tips must not be spoken in ${mod.id}`);
  }

  const esVoice = pickGuideVoice(
    [
      { lang: "en-US", name: "Samantha" },
      { lang: "es-US", name: "Paulina" },
    ],
    "es",
  );
  assert(esVoice?.lang === "es-US", "Spanish voice preference");
  assert(HOST_TOUR_COMMAND_EVENT.includes("host-guide-tour"), "command event");
}

const isDirectRun = process.argv[1]?.includes("host-guide-tour.test");
if (isDirectRun) {
  try {
    runHostGuideTourTests();
    console.log("host-guide-tour tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "host-guide-tour tests failed");
    process.exitCode = 1;
  }
}
