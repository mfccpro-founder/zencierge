import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bindGuestStaySpeechVoiceRefresh,
  createGuestStaySpeechEngine,
  GUEST_STAY_SPEECH_PITCH,
  GUEST_STAY_SPEECH_RATE,
  GUEST_STAY_SPEECH_VOLUME,
  guestStaySpeechBcp47,
  isSpeakableGuestStayReply,
  parseGuestStaySpeechLang,
  refreshGuestStayVoiceCache,
  resetGuestStayVoiceCache,
  resolveGuestStayVoices,
  selectGuestStaySpeechVoice,
  shouldSpeakGuestStayText,
  type GuestStaySpeechSynth,
  type GuestStaySpeechUtterance,
  type GuestStaySpeechVoice,
} from "./guest-stay-speech";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function mockSynth(voices: GuestStaySpeechVoice[] = []): GuestStaySpeechSynth & {
  spoken: GuestStaySpeechUtterance[];
  cancelCount: number;
} {
  const spoken: GuestStaySpeechUtterance[] = [];
  let cancelCount = 0;
  return {
    supported: true,
    spoken,
    get cancelCount() {
      return cancelCount;
    },
    cancel() {
      cancelCount += 1;
    },
    getVoices() {
      return voices;
    },
    speak(utterance) {
      spoken.push(utterance);
      return true;
    },
  };
}

export function runGuestStaySpeechTests() {
  assert(guestStaySpeechBcp47("en") === "en-US", "English maps to en-US");
  assert(guestStaySpeechBcp47("es") === "es-US", "Spanish maps to es-US");
  assert(parseGuestStaySpeechLang("es") === "es" && parseGuestStaySpeechLang("en") === "en", "lang parse");

  assert(selectGuestStaySpeechVoice([], "en") === null, "empty voices uses default immediately");

  resetGuestStayVoiceCache();
  const first = resolveGuestStayVoices([
    { name: "Local US", lang: "en-US", localService: true },
    { name: "Cloud US", lang: "en-US", localService: false },
  ]);
  const cached = resolveGuestStayVoices([]);
  assert(cached[0]?.name === first[0]?.name, "cached voice selection");
  resetGuestStayVoiceCache();

  const englishFemaleOverMale = selectGuestStaySpeechVoice(
    [
      { name: "Microsoft David", lang: "en-US", localService: true },
      { name: "Google US English", lang: "en-US", localService: false },
      { name: "Microsoft Zira", lang: "en-US", localService: false },
    ],
    "en",
  );
  assert(englishFemaleOverMale?.name === "Microsoft Zira", "English selects an English female voice over a male/default voice");

  const spanishFemale = selectGuestStaySpeechVoice(
    [
      { name: "Microsoft David", lang: "en-US", localService: true },
      { name: "Microsoft Jorge", lang: "es-US", localService: true },
      { name: "Microsoft Dalia", lang: "es-US", localService: false },
    ],
    "es",
  );
  assert(spanishFemale?.name === "Microsoft Dalia", "Spanish selects a Spanish female voice");

  const naturalFemale = selectGuestStaySpeechVoice(
    [
      { name: "Microsoft Zira", lang: "en-US", localService: true },
      { name: "Microsoft Aria Natural", lang: "en-US", localService: false },
    ],
    "en",
  );
  assert(naturalFemale?.name === "Microsoft Aria Natural", "Natural female outranks a basic female voice in the same language");

  assert(
    selectGuestStaySpeechVoice(
      [
        { name: "Spain", lang: "es-ES", localService: true },
        { name: "US Spanish", lang: "es-US", localService: false },
      ],
      "es",
    )?.lang === "es-US",
    "Spanish prefers es-US",
  );
  assert(
    selectGuestStaySpeechVoice(
      [
        { name: "Spain", lang: "es-ES", localService: true },
        { name: "Mexico", lang: "es-MX", localService: false },
      ],
      "es",
    )?.lang === "es-MX",
    "Spanish falls back to es-MX before other Spanish",
  );
  assert(
    selectGuestStaySpeechVoice([{ name: "Spain", lang: "es-ES", localService: true }], "es")?.lang === "es-ES",
    "Spanish falls back to other es when es-US and es-MX are missing",
  );

  let delayedVoices: GuestStaySpeechVoice[] = [];
  const listeners: Array<() => void> = [];
  const delayedSynth: GuestStaySpeechSynth = {
    supported: true,
    getVoices() {
      return delayedVoices;
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    cancel() {},
    speak() {
      return true;
    },
  };
  resetGuestStayVoiceCache();
  bindGuestStaySpeechVoiceRefresh(delayedSynth);
  assert(resolveGuestStayVoices([]).length === 0, "empty/delayed voice list remains safe");
  delayedVoices = [
    { name: "Microsoft David", lang: "en-US", localService: true },
    { name: "Microsoft Aria", lang: "en-US", localService: false },
  ];
  listeners.forEach((listener) => listener());
  assert(
    selectGuestStaySpeechVoice(resolveGuestStayVoices([]), "en")?.name === "Microsoft Aria",
    "voiceschanged refreshes the available selection",
  );
  resetGuestStayVoiceCache();
  refreshGuestStayVoiceCache(delayedVoices);
  assert(resolveGuestStayVoices([])[0]?.name === "Microsoft David" || resolveGuestStayVoices([]).length === 2, "refresh keeps a non-empty cache");

  const enVoices: GuestStaySpeechVoice[] = [
    { name: "UK", lang: "en-GB", localService: true },
    { name: "US local", lang: "en-US", localService: true },
  ];
  assert(selectGuestStaySpeechVoice(enVoices, "en")?.name === "US local", "English prefers en-US local");

  const synth = mockSynth(enVoices);
  const engine = createGuestStaySpeechEngine();
  const firstSpeak = engine.speak("Check-in is listed on the stay card.", "en", synth);
  assert(firstSpeak.started && engine.status() === "speaking", "speak starts");
  assert(synth.spoken[0]?.lang === "en-US", "English utterance lang");
  assert(synth.spoken[0]?.rate === GUEST_STAY_SPEECH_RATE, "calm Elena rate");
  assert(synth.spoken[0]?.pitch === GUEST_STAY_SPEECH_PITCH, "calm Elena pitch");
  assert(synth.spoken[0]?.volume === GUEST_STAY_SPEECH_VOLUME, "full volume");
  assert(engine.utterances() === 1 && synth.spoken.length === 1, "one utterance at a time");
  engine.speak("Checkout is listed on the stay card.", "en", synth);
  assert(synth.cancelCount >= 1, "cancel before new speech");
  assert(engine.utterances() === 1 && synth.spoken.length === 2, "still one active utterance");

  const stopped = engine.stop(synth);
  assert(stopped === "stopped" && engine.utterances() === 0, "Stop cancels and returns idle");

  engine.speak("The stay is active.", "en", synth);
  const genBeforeSend = engine.generation();
  engine.cancelForSend(synth);
  assert(engine.status() === "idle", "new Send cancels speech");
  assert(engine.handleEnd(genBeforeSend) === "idle", "stale callbacks ignored");
  engine.handleError(genBeforeSend);
  assert(engine.status() === "idle", "stale error callbacks ignored");

  const unmountEngine = createGuestStaySpeechEngine();
  const unmountSynth = mockSynth();
  unmountEngine.speak("The stay is active.", "en", unmountSynth);
  const speakingGen = unmountEngine.generation();
  unmountEngine.unmount(unmountSynth);
  assert(unmountSynth.cancelCount >= 1, "unmount/token change cancels");
  unmountEngine.handleEnd(speakingGen);
  assert(unmountEngine.utterances() === 0, "stale unmount callbacks ignored");

  const listen = createGuestStaySpeechEngine();
  const listenSynth = mockSynth();
  listen.speak("Use the Transportation card below for Uber and Lyft.", "en", listenSynth);
  listen.handleEnd(listen.generation());
  const latest = listen.lastReply();
  if (!latest) throw new Error("stores latest assistant reply");
  assert(latest.text.includes("Transportation"), "stores latest assistant reply text");
  listen.speak(latest.text, "en", listenSynth);
  assert(listenSynth.spoken.at(-1)?.text === latest.text, "Listen repeats only latest assistant reply");

  const esSynth = mockSynth();
  const esEngine = createGuestStaySpeechEngine();
  esEngine.speak("La entrada está en la tarjeta.", "es", esSynth);
  assert(esSynth.spoken[0]?.lang === "es-US", "Spanish utterance lang");

  assert(shouldSpeakGuestStayText("elena", "The stay is active."), "assistant replies may be spoken");
  assert(!shouldSpeakGuestStayText("guest", "Hello"), "no speech for user messages");
  assert(!isSpeakableGuestStayReply("https://example.com"), "no speech for URLs");
  assert(!isSpeakableGuestStayReply("wifi password is secret"), "no speech for private field values");
  assert(!isSpeakableGuestStayReply("The door code is 4920#"), "no speech for raw door codes");
  assert(
    isSpeakableGuestStayReply(
      "For security, I can't provide entry or access codes through voice or chat. Please use the secure Access section in your Guest Stay.",
    ),
    "private-intent Access refusal remains speakable",
  );
  assert(!isSpeakableGuestStayReply("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY"), "no speech for token-like strings");

  const unavailable = createGuestStaySpeechEngine();
  const none: GuestStaySpeechSynth = {
    supported: false,
    cancel() {},
    getVoices() {
      return [];
    },
    speak() {
      return false;
    },
  };
  const blocked = unavailable.speak("The stay is active.", "en", none);
  assert(!blocked.started && blocked.status === "unavailable", "text remains usable when speech is unavailable");
  assert(unavailable.lastReply()?.text === "The stay is active.", "reply is kept when unavailable");

  const source = readFileSync(join(process.cwd(), "src/lib/guest-stay-speech.ts"), "utf8");
  assert(source.includes("voiceschanged"), "voiceschanged refreshes browser voices");
  assert(source.includes("getVoices()"), "voices are loaded with getVoices");
  assert(
    !/setTimeout|setInterval|getUserMedia|MediaRecorder|\/api\/tts|openai|transcribe|\bVAD\b|\bPCM\b|localStorage|sessionStorage|console\.(log|info|debug)/i.test(
      source,
    ),
    "no timers, mic, TTS API, OpenAI, MediaRecorder, VAD, PCM, storage, or logging",
  );
}

const isDirectRun = process.argv[1]?.includes("guest-stay-speech.test");
if (isDirectRun) {
  try {
    runGuestStaySpeechTests();
    console.log("guest-stay-speech tests passed");
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : "guest-stay-speech tests failed");
    process.exitCode = 1;
  }
}
