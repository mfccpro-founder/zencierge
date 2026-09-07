/** Client-safe mobile server-STT helpers for Guest Stay (kept separate from host voice tooling). */

export const GUEST_STAY_MOBILE_STT_MAX_MS = 20_000;
export const GUEST_STAY_MOBILE_STT_MAX_BYTES = 3 * 1024 * 1024;
export const GUEST_STAY_MOBILE_STT_MIN_BYTES = 200;
export const GUEST_STAY_MOBILE_STT_PATH = "/api/guest/stay-transcribe";
/** DEV-only beacon path — iPhone events appear in local `npm run dev` terminal. */
export const GUEST_STAY_MOBILE_STT_DEBUG_PATH = "/api/dev/guest-mobile-stt-debug";

export const GUEST_STAY_MOBILE_RECORDER_MIME_CANDIDATES = [
  "audio/mp4",
  "audio/aac",
  "audio/webm;codecs=opus",
  "audio/webm",
] as const;

export const GUEST_STAY_MOBILE_STT_COPY = {
  startingEn: "Starting microphone…",
  startingEs: "Iniciando micrófono…",
  stopSendEn: "Stop & send",
  stopSendEs: "Detener y enviar",
  processingEn: "Processing…",
  processingEs: "Procesando…",
  /** After a successful recording that produced no usable audio / transcript. */
  failHearEn: "I couldn't hear that. Try again or type your message.",
  failHearEs: "No pude escucharlo. Inténtalo de nuevo o escribe tu mensaje.",
  failPermissionEn: "Microphone access is required. Check your browser permissions.",
  failPermissionEs: "Se requiere acceso al micrófono. Revisa los permisos del navegador.",
  failRecorderEn: "I couldn't start the microphone. Try again or type your message.",
  failRecorderEs: "No pude iniciar el micrófono. Inténtalo de nuevo o escribe tu mensaje.",
  privacyEn:
    "Recording starts only when you tap. Tap Stop & send when you finish. Audio is transcribed securely for this stay, then discarded. Do not speak passwords, access codes, or payment information.",
  privacyEs:
    "La grabación comienza solamente cuando tocas. Toca Detener y enviar al terminar. El audio se transcribe de forma segura para esta estadía y luego se descarta. No digas contraseñas, códigos de acceso ni información de pago.",
} as const;

/** @deprecated Prefer failHear / failPermission / failRecorder. Kept for older call sites. */
export const GUEST_STAY_MOBILE_STT_COPY_LEGACY_FAIL = {
  failEn: GUEST_STAY_MOBILE_STT_COPY.failHearEn,
  failEs: GUEST_STAY_MOBILE_STT_COPY.failHearEs,
} as const;

export type GuestStayMobileSttUiMode = "tap" | "starting" | "stop-send" | "processing";
export type GuestStayMobileSttFailKind = "permission" | "recorder" | "hear";

export type GuestStayMobileSttTimerApi = {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
};

export type GuestStayMobileSttDiagEvent = {
  event: string;
  [key: string]: string | number | boolean | null | undefined;
};

function defaultTimers(): GuestStayMobileSttTimerApi {
  return {
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id) => {
      globalThis.clearTimeout(id);
    },
  };
}

/** DEV-only diagnostics. Never logs audio bytes, tokens, keys, or transcript text. */
export function guestStayMobileSttDevDiag(payload: GuestStayMobileSttDiagEvent) {
  if (process.env.NODE_ENV === "production") return;
  const body: GuestStayMobileSttDiagEvent = { t: Date.now(), ...payload };
  try {
    console.info("[guest-mobile-stt]", body);
  } catch {
    /* ignore */
  }
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  try {
    void fetch(GUEST_STAY_MOBILE_STT_DEBUG_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      /* ignore */
    });
  } catch {
    /* ignore */
  }
}

/** iPhone / iPad / iPod — including common WebKit UA spellings. */
export function guestStayIsIosMobileUserAgent(userAgent: string) {
  return /iPhone|iPad|iPod/i.test(userAgent);
}

export function guestStayIsAndroidUserAgent(userAgent: string) {
  return /Android/i.test(userAgent);
}

/**
 * Mobile Guest Stay browsers that should use server-STT instead of Web Speech.
 * Includes iPadOS 13+ desktop UA when the device reports multi-touch.
 */
export function guestStayIsMobileBrowser(input?: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
}) {
  const ua =
    input?.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (guestStayIsIosMobileUserAgent(ua)) return true;
  if (guestStayIsAndroidUserAgent(ua)) return true;
  const platform =
    input?.platform ?? (typeof navigator !== "undefined" ? navigator.platform : "");
  const maxTouchPoints =
    input?.maxTouchPoints ?? (typeof navigator !== "undefined" ? navigator.maxTouchPoints : 0);
  if (/Mac/i.test(platform) && maxTouchPoints > 1) return true;
  return false;
}

export function guestStayMobileServerSttPreferred(input?: {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  hasMediaRecorder?: boolean;
  isSecureContext?: boolean;
}) {
  if (!guestStayIsMobileBrowser(input)) return false;
  const hasMediaRecorder =
    input?.hasMediaRecorder ??
    (typeof globalThis !== "undefined" && typeof (globalThis as { MediaRecorder?: unknown }).MediaRecorder !== "undefined");
  const isSecureContext =
    input?.isSecureContext ?? (typeof window !== "undefined" ? window.isSecureContext : false);
  return hasMediaRecorder && isSecureContext;
}

export function guestStayPickMobileRecorderMime(isTypeSupported: (mime: string) => boolean) {
  for (const candidate of GUEST_STAY_MOBILE_RECORDER_MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate)) return candidate;
    } catch {
      /* ignore unsupported probe failures */
    }
  }
  return "";
}

export function guestStayMobileSttFilename(mimeOrType: string) {
  const t = mimeOrType.toLowerCase();
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "audio.mp4";
  if (t.includes("mpeg") || t.includes("mp3")) return "audio.mp3";
  if (t.includes("wav")) return "audio.wav";
  if (t.includes("ogg")) return "audio.ogg";
  return "audio.webm";
}

export function guestStayMobileSttUiMode(input: {
  starting?: boolean;
  recording: boolean;
  processing: boolean;
}): GuestStayMobileSttUiMode {
  if (input.processing) return "processing";
  if (input.recording) return "stop-send";
  if (input.starting) return "starting";
  return "tap";
}

export function classifyGuestStayMobileMicError(cause: unknown): GuestStayMobileSttFailKind {
  const name =
    cause && typeof cause === "object" && "name" in cause
      ? String((cause as { name?: unknown }).name ?? "")
      : cause instanceof Error
        ? cause.name
        : "";
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError" ||
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "NotReadableError"
  ) {
    return "permission";
  }
  if (cause instanceof GuestStayMobileSttStartupError) return cause.kind;
  return "recorder";
}

export class GuestStayMobileSttStartupError extends Error {
  readonly kind: "permission" | "recorder";
  constructor(kind: "permission" | "recorder", message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "GuestStayMobileSttStartupError";
    this.kind = kind;
  }
}

export function releaseGuestStayMediaStream(stream: MediaStream | null | undefined) {
  if (!stream) return;
  try {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export type GuestStayMobileSttSession = {
  stop: () => Promise<Blob>;
  cancel: () => void;
};

export type GuestStayMobileSttSessionDeps = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  MediaRecorderCtor: new (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder;
  isTypeSupported: (mime: string) => boolean;
  maxDurationMs?: number;
  onAutoStop?: () => void;
  onRecordingStarted?: () => void;
  timers?: GuestStayMobileSttTimerApi;
  onDiag?: (event: GuestStayMobileSttDiagEvent) => void;
};

function createGuestStayMobileRecorder(
  Ctor: GuestStayMobileSttSessionDeps["MediaRecorderCtor"],
  stream: MediaStream,
  mime: string,
  diag: (event: GuestStayMobileSttDiagEvent) => void,
): MediaRecorder {
  if (mime) {
    try {
      const withMime = new Ctor(stream, { mimeType: mime });
      diag({ event: "MediaRecorder-ctor-ok", mode: "mime-only", mime });
      return withMime;
    } catch {
      diag({ event: "MediaRecorder-ctor-fallback", mode: "browser-default", mime });
    }
  }
  const plain = new Ctor(stream);
  diag({ event: "MediaRecorder-ctor-ok", mode: "browser-default", mime: mime || "none" });
  return plain;
}

/**
 * Starts exactly one MediaRecorder session.
 * Resolves only after the recorder reaches the recording state / `start` event.
 * Call stop() once to finalize, or cancel() to abort.
 */
export async function startGuestStayMobileSttSession(
  deps: GuestStayMobileSttSessionDeps,
): Promise<GuestStayMobileSttSession> {
  const timers = deps.timers ?? defaultTimers();
  const maxDurationMs = deps.maxDurationMs ?? GUEST_STAY_MOBILE_STT_MAX_MS;
  const diag = deps.onDiag ?? guestStayMobileSttDevDiag;

  diag({
    event: "session-begin",
    mobile: true,
  });

  let stream: MediaStream;
  try {
    diag({ event: "getUserMedia-request", constraints: "audio:true" });
    stream = await deps.getUserMedia({ audio: true });
    diag({
      event: "getUserMedia-success",
      trackCount: stream.getTracks().length,
    });
  } catch (cause) {
    const kind = classifyGuestStayMobileMicError(cause);
    diag({
      event: "getUserMedia-failure",
      category: kind,
      name: cause instanceof Error ? cause.name : "unknown",
    });
    throw new GuestStayMobileSttStartupError(
      kind === "permission" ? "permission" : "permission",
      "getUserMedia-failed",
      { cause },
    );
  }

  const mime = guestStayPickMobileRecorderMime(deps.isTypeSupported);
  diag({ event: "mime-selected", mime: mime || "browser-default" });

  let recorder: MediaRecorder;
  try {
    recorder = createGuestStayMobileRecorder(deps.MediaRecorderCtor, stream, mime, diag);
  } catch (cause) {
    releaseGuestStayMediaStream(stream);
    diag({
      event: "MediaRecorder-ctor-failure",
      name: cause instanceof Error ? cause.name : "unknown",
    });
    throw new GuestStayMobileSttStartupError("recorder", "MediaRecorder-ctor-failed", { cause });
  }

  const chunks: BlobPart[] = [];
  let chunkCount = 0;
  let chunkBytes = 0;
  let settled = false;
  let stopPromise: Promise<Blob> | null = null;
  let maxTimer: number | null = null;
  let awaitingFinalChunk = false;

  const pushChunk = (data: Blob | null | undefined) => {
    if (data && data.size > 0) {
      chunks.push(data);
      chunkCount += 1;
      chunkBytes += data.size;
    }
  };

  let stopSeen = false;
  /** True only after `stop()` is invoked — chunks from `requestData()` alone are not final. */
  let stopInvoked = false;
  let sawChunkAfterStopInvoke = false;
  let completeFinalization: (() => void) | null = null;

  const onDataAvailable = (event: Event) => {
    const data = (event as BlobEvent).data;
    const chunkSize = data?.size ?? 0;
    pushChunk(data);
    diag({
      event: "dataavailable",
      chunkSize,
      chunkCount,
      chunkBytes,
    });
    // Safari may fire empty dataavailable from requestData; only post-stop chunks finalize.
    if (awaitingFinalChunk && stopInvoked && data && data.size > 0) {
      sawChunkAfterStopInvoke = true;
      completeFinalization?.();
    }
  };
  recorder.addEventListener("dataavailable", onDataAvailable);

  const finishBlob = () => {
    const type = recorder.mimeType || mime || "audio/webm";
    return new Blob(chunks, { type });
  };

  const release = () => {
    try {
      recorder.removeEventListener("dataavailable", onDataAvailable);
    } catch {
      /* ignore */
    }
    releaseGuestStayMediaStream(stream);
    if (maxTimer != null) {
      timers.clearTimeout(maxTimer);
      maxTimer = null;
    }
  };

  /**
   * Safari/iPhone often delivers the final encoded chunk in `dataavailable` around `stop`.
   * Sequence: optional requestData() → stop once → wait for stop + final dataavailable → Blob.
   */
  const stopOnce = (): Promise<Blob> => {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise<Blob>((resolve, reject) => {
      if (settled) {
        release();
        resolve(finishBlob());
        return;
      }
      settled = true;

      if (recorder.state === "inactive") {
        const blob = finishBlob();
        diag({
          event: "recorder-stop",
          chunkCount,
          chunkBytes,
          blobSize: blob.size,
          blobType: blob.type || "unknown",
        });
        release();
        resolve(blob);
        return;
      }

      let completed = false;
      let safetyTimer: number | null = null;
      let didRequestData = false;
      stopSeen = false;
      stopInvoked = false;
      sawChunkAfterStopInvoke = false;
      awaitingFinalChunk = true;

      const complete = () => {
        if (completed) return;
        if (!stopSeen) return;
        completed = true;
        awaitingFinalChunk = false;
        completeFinalization = null;
        if (safetyTimer != null) {
          timers.clearTimeout(safetyTimer);
          safetyTimer = null;
        }
        const blob = finishBlob();
        diag({
          event: "recorder-stop",
          chunkCount,
          chunkBytes,
          blobSize: blob.size,
          blobType: blob.type || "unknown",
          sawChunkAfterStopInvoke,
          usedRequestData: didRequestData,
        });
        release();
        resolve(blob);
      };
      completeFinalization = complete;

      const onStop = () => {
        stopSeen = true;
        if (sawChunkAfterStopInvoke) {
          complete();
          return;
        }
        // WebKit may deliver the last dataavailable after `stop` — brief event-driven wait.
        safetyTimer = timers.setTimeout(() => {
          safetyTimer = null;
          complete();
        }, 250);
      };

      try {
        recorder.addEventListener("stop", onStop, { once: true });

        try {
          const maybeRequest = (
            recorder as MediaRecorder & { requestData?: () => void }
          ).requestData;
          if (typeof maybeRequest === "function") {
            didRequestData = true;
            diag({ event: "recorder-requestData" });
            maybeRequest.call(recorder);
          }
        } catch {
          didRequestData = false;
        }

        stopInvoked = true;
        recorder.stop();
      } catch (cause) {
        awaitingFinalChunk = false;
        completeFinalization = null;
        stopInvoked = false;
        if (safetyTimer != null) timers.clearTimeout(safetyTimer);
        release();
        reject(cause instanceof Error ? cause : new Error("recorder-stop-failed"));
      }
    });
    return stopPromise;
  };

  try {
    diag({ event: "recorder-start-request", mime: mime || "browser-default" });
    await new Promise<void>((resolve, reject) => {
      let settledStart = false;
      const succeed = () => {
        if (settledStart) return;
        settledStart = true;
        diag({ event: "recorder-onstart", state: recorder.state });
        resolve();
      };
      const fail = (cause: unknown) => {
        if (settledStart) return;
        settledStart = true;
        reject(cause instanceof Error ? cause : new Error("recorder-start-failed"));
      };
      try {
        recorder.addEventListener("start", succeed, { once: true });
        recorder.addEventListener(
          "error",
          () => fail(new Error("recorder-error")),
          { once: true },
        );
      } catch {
        /* addEventListener may be absent on some fakes — rely on state below */
      }
      try {
        try {
          recorder.start(250);
        } catch {
          recorder.start();
        }
      } catch (cause) {
        fail(cause);
        return;
      }
      if (recorder.state === "recording") {
        succeed();
      }
    });
  } catch (cause) {
    release();
    diag({
      event: "recorder-start-failure",
      name: cause instanceof Error ? cause.name : "unknown",
    });
    throw new GuestStayMobileSttStartupError("recorder", "recorder-start-failed", { cause });
  }

  deps.onRecordingStarted?.();

  maxTimer = timers.setTimeout(() => {
    maxTimer = null;
    if (settled) return;
    void stopOnce().then(() => {
      deps.onAutoStop?.();
    });
  }, maxDurationMs);

  return {
    stop: stopOnce,
    cancel: () => {
      if (settled) {
        release();
        return;
      }
      settled = true;
      awaitingFinalChunk = false;
      completeFinalization = null;
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch {
        /* ignore */
      }
      release();
      chunks.length = 0;
      chunkCount = 0;
      chunkBytes = 0;
      stopPromise = Promise.resolve(new Blob([], { type: mime || "audio/webm" }));
      diag({ event: "recorder-cancel" });
    },
  };
}

export type GuestStayMobileTranscribeResult =
  | { ok: true; transcript: string }
  | { ok: false; reason: "empty" | "oversized" | "http" | "network" };

export async function postGuestStayMobileTranscribe(input: {
  token: string;
  blob: Blob;
  fetch: typeof fetch;
  apiUrl: (path: string) => string;
  signal?: AbortSignal;
}): Promise<GuestStayMobileTranscribeResult> {
  const blobSize = input.blob?.size ?? 0;
  const blobType = input.blob?.type || "unknown";

  if (!input.blob || blobSize < GUEST_STAY_MOBILE_STT_MIN_BYTES) {
    guestStayMobileSttDevDiag({
      event: "upload-gate",
      blobSize,
      blobType,
      uploadAttempted: false,
      reason: "below-min-bytes",
      minBytes: GUEST_STAY_MOBILE_STT_MIN_BYTES,
    });
    return { ok: false, reason: "empty" };
  }
  if (blobSize > GUEST_STAY_MOBILE_STT_MAX_BYTES) {
    guestStayMobileSttDevDiag({
      event: "upload-gate",
      blobSize,
      blobType,
      uploadAttempted: false,
      reason: "oversized",
      maxBytes: GUEST_STAY_MOBILE_STT_MAX_BYTES,
    });
    return { ok: false, reason: "oversized" };
  }

  guestStayMobileSttDevDiag({
    event: "upload-gate",
    blobSize,
    blobType,
    uploadAttempted: true,
  });

  const form = new FormData();
  form.set("token", input.token);
  const filename = guestStayMobileSttFilename(input.blob.type);
  form.set("file", input.blob, filename);

  try {
    const response = await input.fetch(input.apiUrl(GUEST_STAY_MOBILE_STT_PATH), {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: input.signal,
    });
    if (!response.ok) return { ok: false, reason: "http" };
    const payload = (await response.json()) as { transcript?: unknown };
    const transcript = typeof payload.transcript === "string" ? payload.transcript.trim() : "";
    if (!transcript) return { ok: false, reason: "empty" };
    return { ok: true, transcript: transcript.slice(0, 500) };
  } catch {
    return { ok: false, reason: "network" };
  }
}
