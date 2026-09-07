import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  GUEST_STAY_MOBILE_STT_COPY,
  GUEST_STAY_MOBILE_STT_MAX_BYTES,
  GUEST_STAY_MOBILE_STT_MAX_MS,
  GUEST_STAY_MOBILE_STT_MIN_BYTES,
  GUEST_STAY_MOBILE_STT_PATH,
  GUEST_STAY_MOBILE_STT_DEBUG_PATH,
  GuestStayMobileSttStartupError,
  classifyGuestStayMobileMicError,
  guestStayIsAndroidUserAgent,
  guestStayIsIosMobileUserAgent,
  guestStayIsMobileBrowser,
  guestStayMobileServerSttPreferred,
  guestStayMobileSttFilename,
  guestStayMobileSttUiMode,
  guestStayPickMobileRecorderMime,
  postGuestStayMobileTranscribe,
  releaseGuestStayMediaStream,
  startGuestStayMobileSttSession,
} from "./guest-stay-mobile-stt";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks: FakeTrack[];
  constructor(tracks: FakeTrack[]) {
    this.tracks = tracks;
  }
  getTracks() {
    return this.tracks;
  }
}

type DataListener = (event: { data: Blob }) => void;

class FakeRecorder {
  static supported = new Set(["audio/mp4", "audio/webm"]);
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  stream: FakeStream;
  ondataavailable: DataListener | null = null;
  requestDataCalls = 0;
  stopCalls = 0;
  protected listeners = new Map<string, Array<(event?: { data: Blob }) => void>>();

  constructor(stream: FakeStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.mimeType = options?.mimeType || "audio/webm";
  }

  static isTypeSupported(mime: string) {
    return FakeRecorder.supported.has(mime);
  }

  addEventListener(type: string, fn: (event?: { data: Blob }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: (event?: { data: Blob }) => void) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== fn),
    );
  }

  protected emitData(data: Blob) {
    const event = { data };
    this.ondataavailable?.(event);
    for (const fn of this.listeners.get("dataavailable") ?? []) fn(event);
  }

  requestData() {
    this.requestDataCalls += 1;
    this.emitData(new Blob([new Uint8Array(120)], { type: this.mimeType }));
  }

  start(timeslice?: number) {
    if (this.state !== "inactive") throw new Error("already-started");
    this.state = "recording";
    void timeslice;
    this.emitData(new Blob([new Uint8Array(400)], { type: this.mimeType }));
    for (const fn of this.listeners.get("start") ?? []) fn();
  }

  stop() {
    this.stopCalls += 1;
    if (this.state === "inactive") return;
    this.state = "inactive";
    // Final chunk then stop (healthy order)
    this.emitData(new Blob([new Uint8Array(200)], { type: this.mimeType }));
    for (const fn of this.listeners.get("stop") ?? []) fn();
  }
}

/** Safari-like: no useful timeslice/requestData flush; stop first, final dataavailable afterward. */
class SafariLateFinalChunkRecorder extends FakeRecorder {
  private timers: { setTimeout: (fn: () => void, ms: number) => number };

  constructor(
    stream: FakeStream,
    options: MediaRecorderOptions | undefined,
    timers: { setTimeout: (fn: () => void, ms: number) => number },
  ) {
    super(stream, options);
    this.timers = timers;
  }

  requestData() {
    this.requestDataCalls += 1;
    // No chunk — reproduces WebKit empty flush before stop.
  }

  start() {
    if (this.state !== "inactive") throw new Error("already-started");
    this.state = "recording";
    for (const fn of this.listeners.get("start") ?? []) fn();
  }

  stop() {
    this.stopCalls += 1;
    if (this.state === "inactive") return;
    this.state = "inactive";
    for (const fn of this.listeners.get("stop") ?? []) fn();
    this.timers.setTimeout(() => {
      this.emitData(new Blob([new Uint8Array(220)], { type: this.mimeType }));
    }, 10);
  }
}

/** Throws when constructed with options, succeeds without — ctor fallback path. */
class FakeRecorderOptionsFail {
  static supported = new Set(["audio/mp4"]);
  state: "inactive" | "recording" = "inactive";
  mimeType = "audio/webm";
  stream: FakeStream;
  ondataavailable: DataListener | null = null;
  private listeners = new Map<string, Array<(event?: { data: Blob }) => void>>();
  static ctorCalls = 0;

  constructor(stream: FakeStream, options?: MediaRecorderOptions) {
    FakeRecorderOptionsFail.ctorCalls += 1;
    if (options) throw new Error("options-unsupported");
    this.stream = stream;
  }

  static isTypeSupported(mime: string) {
    return FakeRecorderOptionsFail.supported.has(mime);
  }

  addEventListener(type: string, fn: (event?: { data: Blob }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener() {}

  requestData() {
    const event = { data: new Blob([new Uint8Array(100)], { type: this.mimeType }) };
    this.ondataavailable?.(event);
    for (const fn of this.listeners.get("dataavailable") ?? []) fn(event);
  }

  start() {
    this.state = "recording";
    const event = { data: new Blob([new Uint8Array(300)], { type: this.mimeType }) };
    this.ondataavailable?.(event);
    for (const fn of this.listeners.get("dataavailable") ?? []) fn(event);
    for (const fn of this.listeners.get("start") ?? []) fn();
  }

  stop() {
    this.state = "inactive";
    const event = { data: new Blob([new Uint8Array(80)], { type: this.mimeType }) };
    this.ondataavailable?.(event);
    for (const fn of this.listeners.get("dataavailable") ?? []) fn(event);
    for (const fn of this.listeners.get("stop") ?? []) fn();
  }
}

function makeTimers() {
  const pending: Array<{ id: number; fn: () => void; ms: number }> = [];
  let nextId = 1;
  return {
    pending,
    api: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        pending.push({ id, fn, ms });
        return id;
      },
      clearTimeout: (id: number) => {
        const idx = pending.findIndex((t) => t.id === id);
        if (idx >= 0) pending.splice(idx, 1);
      },
    },
    flush(ms?: number) {
      const due = pending.filter((t) => ms == null || t.ms <= ms);
      for (const t of due) {
        const idx = pending.indexOf(t);
        if (idx >= 0) pending.splice(idx, 1);
        t.fn();
      }
    },
  };
}

export async function runGuestStayMobileSttTests() {
  assert(GUEST_STAY_MOBILE_STT_MAX_MS === 20_000, "max duration is 20s");
  assert(GUEST_STAY_MOBILE_STT_MAX_BYTES === 3 * 1024 * 1024, "max payload is 3MB");
  assert(GUEST_STAY_MOBILE_STT_MIN_BYTES === 200, "min blob bytes is 200");
  assert(GUEST_STAY_MOBILE_STT_PATH === "/api/guest/stay-transcribe", "guest stay transcribe path");
  assert(
    GUEST_STAY_MOBILE_STT_DEBUG_PATH === "/api/dev/guest-mobile-stt-debug",
    "DEV mobile-stt debug beacon path",
  );
  assert(GUEST_STAY_MOBILE_STT_COPY.stopSendEn === "Stop & send", "Stop & send copy");

  assert(
    guestStayMobileServerSttPreferred({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      hasMediaRecorder: true,
      isSecureContext: true,
    }),
    "iOS prefers server STT",
  );
  assert(
    guestStayMobileServerSttPreferred({
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36",
      hasMediaRecorder: true,
      isSecureContext: true,
    }),
    "Android prefers server STT",
  );

  const timers = makeTimers();
  const track = new FakeTrack();
  let recorderRef: FakeRecorder | null = null;
  const captureRecorder = (recorder: FakeRecorder) => {
    recorderRef = recorder;
  };
  const session = await startGuestStayMobileSttSession({
    getUserMedia: async (constraints) => {
      assert((constraints as MediaStreamConstraints).audio === true, "getUserMedia audio:true");
      return new FakeStream([track]) as unknown as MediaStream;
    },
    MediaRecorderCtor: class extends FakeRecorder {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream as unknown as FakeStream, options);
        captureRecorder(this);
      }
    } as unknown as typeof MediaRecorder,
    isTypeSupported: (mime) => FakeRecorder.isTypeSupported(mime),
    maxDurationMs: 20_000,
    onDiag: () => {},
    timers: timers.api,
  });
  assert(Boolean(recorderRef), "recorder created");
  const rec = recorderRef!;
  assert(rec.requestDataCalls === 0, "requestData not called until stop");

  const blob1 = await session.stop();
  const blob2 = await session.stop();
  assert(rec.stopCalls === 1, "stop called exactly once");
  assert(rec.requestDataCalls === 1, "requestData used before stop");
  // start chunk 400 + requestData 120 + final stop chunk 200 = 720; requestData+stop must not lose final chunk
  assert(blob1.size === 720, "final dataavailable during stop is included in Blob");
  assert(blob2.size === blob1.size, "second stop is idempotent / no duplicate submit path");
  assert(track.stopped, "stream tracks released on success");

  // Safari late final chunk after stop event
  const lateTimers = makeTimers();
  const lateTrack = new FakeTrack();
  let lateRecorder: SafariLateFinalChunkRecorder | null = null;
  const lateSession = await startGuestStayMobileSttSession({
    getUserMedia: async () => new FakeStream([lateTrack]) as unknown as MediaStream,
    MediaRecorderCtor: class {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        lateRecorder = new SafariLateFinalChunkRecorder(
          stream as unknown as FakeStream,
          options,
          lateTimers.api,
        );
        return lateRecorder;
      }
      static isTypeSupported(mime: string) {
        return FakeRecorder.isTypeSupported(mime);
      }
    } as unknown as typeof MediaRecorder,
    isTypeSupported: () => true,
    onDiag: () => {},
    timers: lateTimers.api,
  });
  const latePromise = lateSession.stop();
  // Stop armed 250ms safety; late chunk at 10ms should complete first.
  lateTimers.flush(10);
  const lateBlob = await latePromise;
  assert(lateBlob.size === 220, "Safari late final dataavailable is included");
  assert(lateTrack.stopped, "tracks released after late-finalization stop");
  lateTimers.flush(250);

  // requestData + stop must not duplicate when same logical flush — Fake emits distinct chunks; verify order size sum
  // Empty / small blob must not upload
  let fetchCalls = 0;
  const emptyUpload = await postGuestStayMobileTranscribe({
    token: "tok",
    blob: new Blob([new Uint8Array(10)], { type: "audio/mp4" }),
    apiUrl: (path) => path,
    fetch: async () => {
      fetchCalls += 1;
      return new Response("{}", { status: 200 });
    },
  });
  assert(!emptyUpload.ok && emptyUpload.reason === "empty", "small Blob below minimum does not upload");
  assert(fetchCalls === 0, "empty Blob does not upload");

  const uploadOk = await postGuestStayMobileTranscribe({
    token: "tok",
    blob: new Blob([new Uint8Array(500)], { type: "audio/mp4" }),
    apiUrl: (path) => `https://example.test${path}`,
    fetch: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ transcript: "What time is my check-in?" }), { status: 200 });
    },
  });
  assert(uploadOk.ok, "upload triggered after valid Blob");
  assert(fetchCalls === 1, "upload occurs exactly once after valid Blob");

  // Android-style multiple chunks preserve order (size concatenation)
  const androidTimers = makeTimers();
  const androidTrack = new FakeTrack();
  class AndroidMultiChunkRecorder extends FakeRecorder {
    start() {
      this.state = "recording";
      this.emitData(new Blob([new Uint8Array(50)], { type: this.mimeType }));
      this.emitData(new Blob([new Uint8Array(60)], { type: this.mimeType }));
      for (const fn of this.listeners.get("start") ?? []) fn();
    }
    stop() {
      this.stopCalls += 1;
      if (this.state === "inactive") return;
      this.state = "inactive";
      this.emitData(new Blob([new Uint8Array(70)], { type: this.mimeType }));
      for (const fn of this.listeners.get("stop") ?? []) fn();
    }
  }
  const androidSession = await startGuestStayMobileSttSession({
    getUserMedia: async () => new FakeStream([androidTrack]) as unknown as MediaStream,
    MediaRecorderCtor: AndroidMultiChunkRecorder as unknown as typeof MediaRecorder,
    isTypeSupported: () => true,
    maxDurationMs: 20_000,
    onDiag: () => {},
    timers: androidTimers.api,
  });
  const androidBlob = await androidSession.stop();
  // 50 + 60 + requestData 120 + stop 70 = 300
  assert(androidBlob.size === 300, "Android-style multiple chunks preserve order");
  assert(androidTrack.stopped, "tracks released after android multi-chunk stop");

  // Max duration path
  const maxTimers = makeTimers();
  const maxTrack = new FakeTrack();
  const maxSession = await startGuestStayMobileSttSession({
    getUserMedia: async () => new FakeStream([maxTrack]) as unknown as MediaStream,
    MediaRecorderCtor: FakeRecorder as unknown as typeof MediaRecorder,
    isTypeSupported: () => false,
    maxDurationMs: 5,
    onAutoStop: () => {},
    onDiag: () => {},
    timers: maxTimers.api,
  });
  maxTimers.flush(5);
  maxTimers.flush(250);
  const maxBlob = await maxSession.stop();
  assert(maxBlob.size > 0, "max-duration finalization still works");
  assert(maxTrack.stopped, "tracks released after max-duration stop");

  // Permission / recorder failure still release tracks
  const failTrack = new FakeTrack();
  class FailStartRecorder extends FakeRecorder {
    start() {
      throw new Error("start-blocked");
    }
  }
  let recorderThrown = false;
  try {
    await startGuestStayMobileSttSession({
      getUserMedia: async () => new FakeStream([failTrack]) as unknown as MediaStream,
      MediaRecorderCtor: FailStartRecorder as unknown as typeof MediaRecorder,
      isTypeSupported: () => false,
      onDiag: () => {},
    });
  } catch (cause) {
    recorderThrown = true;
    assert(cause instanceof GuestStayMobileSttStartupError && cause.kind === "recorder", "recorder start failure");
  }
  assert(recorderThrown, "recorder start failure throws");
  assert(failTrack.stopped, "stream tracks are released on error");

  const cancelTrack = new FakeTrack();
  const cancelSession = await startGuestStayMobileSttSession({
    getUserMedia: async () => new FakeStream([cancelTrack]) as unknown as MediaStream,
    MediaRecorderCtor: FakeRecorder as unknown as typeof MediaRecorder,
    isTypeSupported: () => true,
    onDiag: () => {},
    timers: makeTimers().api,
  });
  cancelSession.cancel();
  assert(cancelTrack.stopped, "stream tracks are released on cancel");

  // ctor options fallback still works
  FakeRecorderOptionsFail.ctorCalls = 0;
  const fallback = await startGuestStayMobileSttSession({
    getUserMedia: async () => new FakeStream([new FakeTrack()]) as unknown as MediaStream,
    MediaRecorderCtor: FakeRecorderOptionsFail as unknown as typeof MediaRecorder,
    isTypeSupported: (mime) => FakeRecorderOptionsFail.isTypeSupported(mime),
    onDiag: () => {},
    timers: makeTimers().api,
  });
  assert(FakeRecorderOptionsFail.ctorCalls >= 2, "options ctor failure retries simplified constructor");
  await fallback.cancel();

  const source = readFileSync(join(process.cwd(), "src/lib/guest-stay-mobile-stt.ts"), "utf8");
  assert(source.includes("requestData"), "finalization uses requestData when available");
  assert(source.includes("sawChunkAfterStopInvoke"), "awaits post-stop dataavailable for Safari");
  assert(source.includes("250"), "short event-driven safety wait after stop");
  assert(source.includes('event: "dataavailable"'), "DEV diag logs each dataavailable chunk size");
  assert(source.includes('event: "upload-gate"'), "DEV diag logs upload gate outcome");
  assert(source.includes("GUEST_STAY_MOBILE_STT_DEBUG_PATH"), "DEV diag beacons to server terminal");
  assert(!source.includes("audioBitsPerSecond"), "still no audioBitsPerSecond requirement");
  assert(!source.includes("/api/guest/stay-transcribe/route"), "does not rewrite stay-transcribe route");

  void guestStayIsIosMobileUserAgent;
  void guestStayIsAndroidUserAgent;
  void guestStayIsMobileBrowser;
  void guestStayMobileSttUiMode;
  void guestStayPickMobileRecorderMime;
  void guestStayMobileSttFilename;
  void releaseGuestStayMediaStream;
  void classifyGuestStayMobileMicError;
  void GUEST_STAY_MOBILE_STT_COPY;
}

const isDirectRun = process.argv[1]?.includes("guest-stay-mobile-stt.test");
if (isDirectRun) {
  runGuestStayMobileSttTests()
    .then(() => {
      console.log("guest-stay-mobile-stt tests passed");
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
