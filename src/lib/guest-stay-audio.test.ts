import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createGuestStayAudioEngine,
  guestStayAudioBlobFromResponse,
  guestStayAudioContentTypeAllowed,
  guestStayAudioDurationAllowed,
  guestStayAudioPostInit,
  GUEST_STAY_AUDIO_MAX_BYTES,
  GUEST_STAY_AUDIO_MAX_DURATION_SEC,
  GUEST_STAY_AUDIO_PATH,
  GUEST_STAY_AUDIO_VOLUME,
  GUEST_STAY_WELCOME_EN,
  GUEST_STAY_WELCOME_ES,
  GUEST_STAY_WELCOME_TTS_PATH,
  isGuestStayAutoplayBlocked,
  shouldFetchGuestStayAudio,
  type GuestStayAudioElement,
  type GuestStayObjectUrlApi,
} from "./guest-stay-audio";
import { guestStayChatRequestBody } from "../components/guest/guest-elena-text-card";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function mockUrls() {
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  const urls: GuestStayObjectUrlApi = {
    create() {
      seq += 1;
      const url = `blob:guest-audio-${seq}`;
      created.push(url);
      return url;
    },
    revoke(url) {
      revoked.push(url);
    },
  };
  return { urls, created, revoked };
}

function mockAudio(playImpl?: () => Promise<void>, opts?: { duration?: number; emit?: "meta" | "error" | "none" }) {
  const plays: string[] = [];
  const sequence: string[] = [];
  const listeners: Record<"loadedmetadata" | "error", Array<() => void>> = {
    loadedmetadata: [],
    error: [],
  };
  let srcValue = "";
  const audio: GuestStayAudioElement & { paused: boolean } = {
    src: "",
    currentTime: 0,
    duration: opts?.duration ?? 1.2,
    volume: 1,
    paused: true,
    onended: null,
    onerror: null,
    pause() {
      sequence.push("pause");
      this.paused = true;
    },
    async play() {
      sequence.push("play");
      plays.push(this.src);
      if (playImpl) await playImpl();
      this.paused = false;
    },
    addEventListener(type, listener) {
      listeners[type].push(listener);
    },
    removeEventListener(type, listener) {
      listeners[type] = listeners[type].filter((item) => item !== listener);
    },
  };
  const time = { value: 0 };
  Object.defineProperty(audio, "currentTime", {
    configurable: true,
    get() {
      return time.value;
    },
    set(value: number) {
      sequence.push("rewind");
      time.value = value;
    },
  });
  Object.defineProperty(audio, "src", {
    configurable: true,
    get() {
      return srcValue;
    },
    set(value: string) {
      srcValue = value;
      if (!value || opts?.emit === "none") return;
      queueMicrotask(() => {
        if (opts?.emit === "error") {
          listeners.error.slice().forEach((listener) => listener());
          return;
        }
        listeners.loadedmetadata.slice().forEach((listener) => listener());
      });
    },
  });
  return { audio, plays, sequence, time };
}

function mpegBytes(size = 16) {
  const bytes = new Uint8Array(Math.max(size, 4));
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = 0x90;
  bytes[3] = 0x00;
  return bytes;
}

function mpegBlob(size = 16) {
  if (size < 1) return new Blob([], { type: "audio/mpeg" });
  return new Blob([mpegBytes(size)], { type: "audio/mpeg" });
}

function fakeResponse(input: { ok: boolean; type?: string | null; blob?: Blob | null; failBlob?: boolean }) {
  return {
    ok: input.ok,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "content-type") return input.type ?? null;
        return null;
      },
    },
    async blob() {
      if (input.failBlob) throw new Error("blob failed");
      return input.blob ?? new Blob();
    },
  };
}

export async function runGuestStayAudioTests() {
  const body = guestStayChatRequestBody("opaque-stay-token", "Hello");
  assert(Object.keys(body).sort().join(",") === "message,token", "TTS JSON keys are token and message");
  const serialized = JSON.stringify(body);
  assert(!serialized.includes("reply") && !serialized.includes("lang") && !serialized.includes("engine"), "TTS body has no reply/lang/engine");
  assert(!serialized.includes("history") && !serialized.includes("provider") && !serialized.includes("voice"), "TTS body has no history/provider/voice");
  const signal = new AbortController().signal;
  const init = guestStayAudioPostInit(serialized, signal);
  assert(init.method === "POST" && init.cache === "no-store", "TTS fetch is POST no-store");
  assert(init.body === serialized, "TTS fetch body is the exact serialized chat pair");
  const parsed = JSON.parse(String(init.body)) as Record<string, unknown>;
  assert(Object.keys(parsed).sort().join(",") === "message,token", "parsed TTS body is exact");

  assert(guestStayAudioContentTypeAllowed("audio/mpeg"), "mpeg allowed");
  assert(guestStayAudioContentTypeAllowed("audio/mpeg; charset=binary"), "mpeg with params allowed");
  assert(!guestStayAudioContentTypeAllowed("application/json"), "json rejected");
  assert(!guestStayAudioContentTypeAllowed("audio/wav"), "non-mpeg rejected");

  const good = await guestStayAudioBlobFromResponse(fakeResponse({ ok: true, type: "audio/mpeg", blob: mpegBlob() }));
  assert(good !== null && good.size === 16, "ok mpeg blob accepted");
  assert((await guestStayAudioBlobFromResponse(fakeResponse({ ok: false, type: "audio/mpeg", blob: mpegBlob() }))) === null, "failed HTTP rejected");
  assert((await guestStayAudioBlobFromResponse(fakeResponse({ ok: true, type: "application/json", blob: mpegBlob() }))) === null, "non-audio rejected");
  assert((await guestStayAudioBlobFromResponse(fakeResponse({ ok: true, type: "audio/mpeg", blob: mpegBlob(GUEST_STAY_AUDIO_MAX_BYTES + 1) }))) === null, "oversize rejected");
  assert((await guestStayAudioBlobFromResponse(fakeResponse({ ok: true, type: "audio/mpeg", blob: mpegBlob(0) }))) === null, "empty blob rejected");
  assert((await guestStayAudioBlobFromResponse(fakeResponse({ ok: true, type: "audio/mpeg", failBlob: true }))) === null, "blob read failure rejected");
  assert(
    (await guestStayAudioBlobFromResponse(
      fakeResponse({ ok: true, type: "audio/mpeg", blob: new Blob([new Uint8Array(16)], { type: "audio/mpeg" }) }),
    )) === null,
    "mpeg Content-Type with invalid bytes is rejected",
  );

  assert(guestStayAudioDurationAllowed(1.2), "finite duration above zero is allowed");
  assert(!guestStayAudioDurationAllowed(0), "zero duration rejected");
  assert(!guestStayAudioDurationAllowed(Number.NaN), "NaN duration rejected");
  assert(!guestStayAudioDurationAllowed(Number.POSITIVE_INFINITY), "infinite duration rejected");
  assert(!guestStayAudioDurationAllowed(GUEST_STAY_AUDIO_MAX_DURATION_SEC + 1), "excessive duration rejected");

  assert(
    shouldFetchGuestStayAudio({ mounted: true, ownerGeneration: 2, currentGeneration: 2, chatSucceeded: true }),
    "successful current chat may fetch audio",
  );
  assert(
    !shouldFetchGuestStayAudio({ mounted: true, ownerGeneration: 2, currentGeneration: 2, chatSucceeded: false }),
    "failed chat does not fetch audio",
  );
  assert(
    !shouldFetchGuestStayAudio({ mounted: true, ownerGeneration: 1, currentGeneration: 2, chatSucceeded: true }),
    "stale chat does not fetch audio",
  );
  assert(
    !shouldFetchGuestStayAudio({ mounted: false, ownerGeneration: 2, currentGeneration: 2, chatSucceeded: true }),
    "unmounted chat does not fetch audio",
  );

  const blocked = Object.assign(new Error("blocked"), { name: "NotAllowedError" });
  assert(isGuestStayAutoplayBlocked(blocked), "NotAllowedError is autoplay blocked");
  assert(!isGuestStayAutoplayBlocked(new Error("fail")), "generic play failure is not autoplay blocked");

  const engine = createGuestStayAudioEngine();
  const urls = mockUrls();
  const auto = mockAudio();
  const autoResult = await engine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: mpegBlob(),
    urls: urls.urls,
    audio: auto.audio,
    onEnded() {},
    onError() {},
  });
  assert(autoResult === "playing", "valid MP3 autoplays");
  assert(urls.created.length === 1, "one object URL is created");
  assert(engine.autoplayAttempts() === 1 && auto.plays.length === 1, "one automatic play is attempted");
  assert(engine.hasUsableClip(), "successful autoplay keeps the clip");
  assert(auto.audio.volume === GUEST_STAY_AUDIO_VOLUME, "autoplay sets the safe volume");
  assert(auto.audio.volume <= GUEST_STAY_AUDIO_VOLUME && auto.audio.volume < 1, "volume is at or below the safe limit and below 1");

  const retainedEngine = createGuestStayAudioEngine();
  const retainedUrls = mockUrls();
  let retainBlocked = true;
  const retainedAudio = mockAudio(async () => {
    if (retainBlocked) {
      retainBlocked = false;
      throw Object.assign(new Error("blocked"), { name: "NotAllowedError" });
    }
  });
  const retained = await retainedEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: mpegBlob(),
    urls: retainedUrls.urls,
    audio: retainedAudio.audio,
    onEnded() {},
    onError() {},
  });
  assert(retained === "retained", "autoplay rejection retains server audio");
  assert(retainedEngine.hasUsableClip(), "blocked autoplay keeps the object URL");
  assert(retainedUrls.revoked.length === 0, "blocked autoplay does not revoke the clip");
  const manual = await retainedEngine.playManual({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    audio: retainedAudio.audio,
  });
  assert(manual === "playing", "manual Listen plays retained server audio");
  assert(retainedAudio.sequence.slice(-3).join(",") === "pause,rewind,play", "Listen pauses then rewinds then plays");
  assert(retainedAudio.time.value === 0, "Listen rewinds to the start");
  assert(retainedAudio.audio.volume === GUEST_STAY_AUDIO_VOLUME, "Listen keeps the safe volume");

  const failEngine = createGuestStayAudioEngine();
  const failUrls = mockUrls();
  const failAudio = mockAudio(async () => {
    throw new Error("decode failed");
  });
  const failedInstall = await failEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: mpegBlob(),
    urls: failUrls.urls,
    audio: failAudio.audio,
    onEnded() {},
    onError() {},
  });
  assert(failedInstall === "failed" && !failEngine.hasUsableClip(), "non-autoplay play failure is not retained as server audio");
  assert(failUrls.revoked.length === 1, "failed play revokes the object URL");
  assert(failAudio.audio.paused, "failed play pauses server audio");
  assert(failAudio.audio.src === "", "failed play detaches src");

  const invalidEngine = createGuestStayAudioEngine();
  const invalidUrls = mockUrls();
  const invalidAudio = mockAudio();
  let invalidFallback = 0;
  const invalidInstall = await invalidEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: new Blob([new Uint8Array(24)], { type: "audio/mpeg" }),
    urls: invalidUrls.urls,
    audio: invalidAudio.audio,
    onEnded() {},
    onError() {
      invalidFallback += 1;
    },
  });
  assert(invalidInstall === "failed", "invalid MPEG bytes fail before play");
  assert(invalidAudio.plays.length === 0, "invalid client Blob never calls play");
  assert(invalidUrls.created.length === 0, "invalid client Blob never creates an object URL");
  assert(invalidEngine.autoplayAttempts() === 0, "invalid signature does not autoplay");
  assert(invalidFallback === 0, "engine does not start fallback itself");

  async function rejectDuration(duration: number, label: string) {
    const durEngine = createGuestStayAudioEngine();
    const durUrls = mockUrls();
    const durAudio = mockAudio(undefined, { duration });
    const result = await durEngine.installAndAutoplay({
      ownerGeneration: 1,
      isCurrent: (gen) => gen === 1,
      blob: mpegBlob(),
      urls: durUrls.urls,
      audio: durAudio.audio,
      onEnded() {},
      onError() {},
    });
    assert(result === "failed", `${label} duration is rejected`);
    assert(durAudio.plays.length === 0, `${label} duration never calls play`);
    assert(!durEngine.hasUsableClip(), `${label} duration marks the clip unusable`);
    assert(durUrls.revoked.length === 1, `${label} duration revokes the object URL`);
  }
  await rejectDuration(0, "zero");
  await rejectDuration(Number.NaN, "NaN");
  await rejectDuration(Number.POSITIVE_INFINITY, "infinite");
  await rejectDuration(GUEST_STAY_AUDIO_MAX_DURATION_SEC + 5, "excessive");

  const decodeEngine = createGuestStayAudioEngine();
  const decodeUrls = mockUrls();
  const decodeAudio = mockAudio(undefined, { duration: Number.NaN, emit: "error" });
  const decoded = await decodeEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: mpegBlob(),
    urls: decodeUrls.urls,
    audio: decodeAudio.audio,
    onEnded() {},
    onError() {},
  });
  assert(decoded === "failed", "metadata/decode error fails closed");
  assert(decodeAudio.plays.length === 0, "metadata/decode error never calls play");
  assert(decodeAudio.sequence[0] === "pause", "metadata/decode error pauses first");
  assert(decodeAudio.audio.src === "", "metadata/decode error detaches src");
  assert(decodeUrls.revoked.length === 1, "metadata/decode error revokes the object URL");
  assert(!decodeEngine.hasUsableClip(), "metadata/decode error marks the clip unusable");

  const errorEngine = createGuestStayAudioEngine();
  const errorUrls = mockUrls();
  const errorAudio = mockAudio();
  let errorFallback = 0;
  const errorPlaying: string[] = [];
  await errorEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: mpegBlob(),
    urls: errorUrls.urls,
    audio: errorAudio.audio,
    onEnded() {},
    onError() {
      errorPlaying.push(errorEngine.isPlaying() ? "playing" : "stopped");
      errorPlaying.push(errorAudio.audio.src === "" ? "detached" : "attached");
      errorPlaying.push(errorAudio.audio.paused ? "paused" : "live");
      errorFallback += 1;
    },
  });
  assert(errorEngine.isPlaying(), "autoplay is playing before onerror");
  errorAudio.audio.onerror?.();
  assert(errorFallback === 1, "onerror starts one fallback");
  assert(errorPlaying.join(",") === "stopped,detached,paused", "onerror cannot leave server audio playing during fallback");
  assert(!errorEngine.hasUsableClip(), "onerror marks the clip unusable");
  assert(errorUrls.revoked.length === 1, "onerror revokes the object URL");
  errorAudio.audio.onerror?.();
  assert(errorFallback === 1, "cleared onerror cannot start a second fallback");

  const staleEngine = createGuestStayAudioEngine();
  const staleUrls = mockUrls();
  const staleAudio = mockAudio();
  let live = true;
  const stale = await staleEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: () => {
      const current = live;
      live = false;
      return current;
    },
    blob: mpegBlob(),
    urls: staleUrls.urls,
    audio: staleAudio.audio,
    onEnded() {},
    onError() {},
  });
  assert(stale === "stale", "stale completion does not play");
  assert(staleUrls.created.length === 1 && staleUrls.revoked.length === 1, "stale completion revokes the unused URL");
  assert(staleAudio.plays.length === 0, "stale completion does not call play");

  let ended = 0;
  const endEngine = createGuestStayAudioEngine();
  const endUrls = mockUrls();
  const endAudio = mockAudio();
  await endEngine.installAndAutoplay({
    ownerGeneration: 3,
    isCurrent: (gen) => gen === 3,
    blob: mpegBlob(),
    urls: endUrls.urls,
    audio: endAudio.audio,
    onEnded() {
      ended += 1;
    },
    onError() {},
  });
  endAudio.audio.onended?.();
  assert(ended === 1, "ended restores through the current-generation callback");
  assert(endEngine.hasUsableClip(), "ended playback keeps the cached clip");
  assert(endUrls.revoked.length === 0, "ended playback does not revoke the object URL");
  endAudio.time.value = 12;
  endAudio.sequence.length = 0;
  const replay = await endEngine.playManual({
    ownerGeneration: 3,
    isCurrent: (gen) => gen === 3,
    audio: endAudio.audio,
  });
  assert(replay === "playing", "Listen after ended plays the cached MP3");
  assert(endAudio.sequence.join(",") === "pause,rewind,play", "Listen sets currentTime to 0 before play");
  assert(endAudio.time.value === 0, "manual replay starts at the beginning");
  assert(endAudio.plays[endAudio.plays.length - 1] === endUrls.created[0], "manual replay uses the same object URL");
  endAudio.time.value = 8;
  endAudio.sequence.length = 0;
  const replayAgain = await endEngine.playManual({
    ownerGeneration: 3,
    isCurrent: (gen) => gen === 3,
    audio: endAudio.audio,
  });
  assert(replayAgain === "playing", "repeated Listen after ended still plays");
  assert(endAudio.sequence.join(",") === "pause,rewind,play", "each Listen rewinds before play");
  assert(endAudio.time.value === 0, "repeated Listen rewinds each time");
  assert(endUrls.created.length === 1, "replay does not create another object URL");
  endEngine.reset(endAudio.audio, endUrls.urls);
  endAudio.audio.onended?.();
  assert(ended === 1, "ended after reset does not change UI");
  assert(endUrls.revoked.includes(endUrls.created[0] ?? ""), "reset revokes the object URL");
  assert(endUrls.revoked.length === 1, "reset revokes the cached URL once");

  const seekEngine = createGuestStayAudioEngine();
  const seekUrls = mockUrls();
  const seekAudio = mockAudio();
  await seekEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: mpegBlob(),
    urls: seekUrls.urls,
    audio: seekAudio.audio,
    onEnded() {},
    onError() {},
  });
  seekAudio.sequence.length = 0;
  Object.defineProperty(seekAudio.audio, "currentTime", {
    configurable: true,
    get() {
      return 9;
    },
    set() {
      seekAudio.sequence.push("rewind");
      throw new Error("seek failed");
    },
  });
  const seekFail = await seekEngine.playManual({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    audio: seekAudio.audio,
  });
  assert(seekFail === "failed", "rewind failure uses the existing failed result");
  assert(seekAudio.sequence.join(",") === "pause,rewind", "rewind failure does not call play");
  assert(seekEngine.hasUsableClip(), "rewind failure keeps the clip for browser-speech fallback");

  const stopEngine = createGuestStayAudioEngine();
  const stopUrls = mockUrls();
  const stopAudio = mockAudio();
  await stopEngine.installAndAutoplay({
    ownerGeneration: 1,
    isCurrent: (gen) => gen === 1,
    blob: mpegBlob(),
    urls: stopUrls.urls,
    audio: stopAudio.audio,
    onEnded() {},
    onError() {},
  });
  assert(stopEngine.isPlaying(), "autoplay marks playing");
  stopEngine.stop(stopAudio.audio);
  assert(!stopEngine.isPlaying() && stopAudio.audio.paused, "stop pauses server audio");
  assert(stopEngine.hasUsableClip(), "stop keeps the clip for Listen");

  const source = readFileSync(join(process.cwd(), "src/lib/guest-stay-audio.ts"), "utf8");
  const manualFn = source.slice(source.indexOf("async playManual"), source.indexOf("stop(audio"));
  const autoFn = source.slice(source.indexOf("async installAndAutoplay"), source.indexOf("async playManual"));
  assert(manualFn.indexOf("pause()") < manualFn.indexOf("currentTime = 0"), "manual replay pauses before rewind");
  assert(manualFn.indexOf("currentTime = 0") < manualFn.indexOf(".play()"), "manual replay rewinds before play");
  assert(!autoFn.includes("currentTime"), "automatic first playback does not rewind");
  assert(autoFn.includes("waitForGuestStayAudioReady"), "autoplay waits for metadata readiness");
  assert(autoFn.indexOf("guestStayBlobMpegLooksValid") < autoFn.indexOf(".play()"), "MPEG validation runs before play");
  assert(autoFn.indexOf("waitForGuestStayAudioReady") < autoFn.indexOf(".play()"), "metadata readiness runs before play");
  assert(source.includes("GUEST_STAY_AUDIO_VOLUME"), "server Audio volume is set explicitly");
  assert(source.includes("discard(audio"), "engine can discard a clip without a new generation");
  assert(source.includes(GUEST_STAY_AUDIO_PATH), "audio helper targets stay-tts");
  assert(source.includes(GUEST_STAY_WELCOME_TTS_PATH), "audio helper exposes the welcome TTS path");
  assert(source.includes('from "./guest-stay-greeting"'), "audio helper re-exports shared greeting constants");
  assert(GUEST_STAY_WELCOME_EN.includes("secure text concierge"), "English welcome constant is present");
  assert(GUEST_STAY_WELCOME_ES.includes("conserjería segura"), "Spanish welcome constant is present");
  assert(!/wifiPassword|doorCode|gateCode/.test(`${GUEST_STAY_WELCOME_EN}${GUEST_STAY_WELCOME_ES}`), "welcome constants have no access fields");
  assert(!/\btoken\b/.test(source), "audio helper has no token");
  assert(!/console\.(log|info|debug|error)|localStorage|sessionStorage|human-voice|\/api\/tts\b|MediaRecorder|getUserMedia|ElenaVoiceWidget/.test(source), "audio helper stays isolated");
  assert(!/wifiPassword|doorCode|gateCode/.test(source), "audio helper has no access fields");
}

const isDirectRun = process.argv[1]?.includes("guest-stay-audio.test");
if (isDirectRun) {
  runGuestStayAudioTests()
    .then(() => {
      console.log("guest-stay-audio tests passed");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "guest-stay-audio tests failed");
      process.exitCode = 1;
    });
}
