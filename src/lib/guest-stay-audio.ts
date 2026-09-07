import { guestStayBlobMpegLooksValid } from "./guest-stay-mp3";

export const GUEST_STAY_AUDIO_PATH = "/api/guest/stay-tts";
export const GUEST_STAY_WELCOME_TTS_PATH = "/api/guest/stay-welcome-tts";
export { GUEST_STAY_WELCOME_EN, GUEST_STAY_WELCOME_ES } from "./guest-stay-greeting";
export const GUEST_STAY_AUDIO_MAX_BYTES = 2_097_152;
export const GUEST_STAY_AUDIO_VOLUME = 0.85;
export const GUEST_STAY_AUDIO_MAX_DURATION_SEC = 45;
export const GUEST_STAY_AUDIO_METADATA_TIMEOUT_MS = 2_500;

export type GuestStayAudioStatus = "idle" | "speaking" | "stopped" | "unavailable";

export type GuestStayObjectUrlApi = {
  create: (blob: Blob) => string;
  revoke: (url: string) => void;
};

export type GuestStayAudioElement = {
  src: string;
  currentTime: number;
  duration: number;
  volume: number;
  pause: () => void;
  play: () => Promise<void>;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener?: (type: "loadedmetadata" | "error", listener: () => void) => void;
  removeEventListener?: (type: "loadedmetadata" | "error", listener: () => void) => void;
};

export function guestStayAudioPostInit(serializedJson: string, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    signal,
    body: serializedJson,
  };
}

export function guestStayAudioContentTypeAllowed(contentType: string | null) {
  const value = (contentType ?? "").split(";")[0]?.trim().toLowerCase();
  return value === "audio/mpeg";
}

export function shouldFetchGuestStayAudio(input: {
  mounted: boolean;
  ownerGeneration: number;
  currentGeneration: number;
  chatSucceeded: boolean;
}) {
  return input.mounted && input.chatSucceeded && input.ownerGeneration === input.currentGeneration;
}

export function isGuestStayAutoplayBlocked(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name) : "";
  return name === "NotAllowedError";
}

export function guestStayAudioDurationAllowed(
  duration: number,
  maxSec = GUEST_STAY_AUDIO_MAX_DURATION_SEC,
) {
  return Number.isFinite(duration) && duration > 0 && duration <= maxSec;
}

export function waitForGuestStayAudioReady(
  audio: GuestStayAudioElement,
  timeoutMs = GUEST_STAY_AUDIO_METADATA_TIMEOUT_MS,
): Promise<boolean> {
  if (guestStayAudioDurationAllowed(audio.duration)) return Promise.resolve(true);
  const addEventListener = audio.addEventListener;
  const removeEventListener = audio.removeEventListener;
  if (typeof addEventListener !== "function" || typeof removeEventListener !== "function") {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      removeEventListener("loadedmetadata", onMeta);
      removeEventListener("error", onErr);
      clearTimeout(timer);
      resolve(ok);
    };
    const onMeta = () => finish(guestStayAudioDurationAllowed(audio.duration));
    const onErr = () => finish(false);
    addEventListener("loadedmetadata", onMeta);
    addEventListener("error", onErr);
    const timer = setTimeout(() => finish(guestStayAudioDurationAllowed(audio.duration)), timeoutMs);
  });
}

export async function guestStayAudioBlobFromResponse(
  response: {
    ok: boolean;
    headers: { get: (name: string) => string | null };
    blob: () => Promise<Blob>;
  },
  maxBytes = GUEST_STAY_AUDIO_MAX_BYTES,
): Promise<Blob | null> {
  if (!response.ok) return null;
  if (!guestStayAudioContentTypeAllowed(response.headers.get("content-type"))) return null;
  let blob: Blob;
  try {
    blob = await response.blob();
  } catch {
    return null;
  }
  if (!blob || blob.size < 1 || blob.size > maxBytes) return null;
  const blobType = blob.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (blobType && blobType !== "audio/mpeg") return null;
  if (!(await guestStayBlobMpegLooksValid(blob))) return null;
  return blob;
}

export function createGuestStayAudioEngine() {
  let generation = 0;
  let objectUrl: string | null = null;
  let usable = false;
  let playing = false;
  let autoplayAttempts = 0;
  let playAttempts = 0;

  function detach(audio: GuestStayAudioElement | null, urls: GuestStayObjectUrlApi | null) {
    playing = false;
    try {
      audio?.pause();
    } catch {
      /* ignore */
    }
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.src = "";
      } catch {
        /* ignore */
      }
    }
    if (objectUrl && urls) {
      try {
        urls.revoke(objectUrl);
      } catch {
        /* ignore */
      }
    }
    objectUrl = null;
    usable = false;
  }

  return {
    generation: () => generation,
    hasUsableClip: () => usable && Boolean(objectUrl),
    isPlaying: () => playing,
    autoplayAttempts: () => autoplayAttempts,
    playAttempts: () => playAttempts,
    objectUrl: () => objectUrl,
    discard(audio: GuestStayAudioElement | null, urls: GuestStayObjectUrlApi | null) {
      detach(audio, urls);
    },
    reset(audio: GuestStayAudioElement | null, urls: GuestStayObjectUrlApi | null) {
      generation += 1;
      detach(audio, urls);
      return generation;
    },
    async installAndAutoplay(input: {
      ownerGeneration: number;
      isCurrent: (ownerGeneration: number) => boolean;
      blob: Blob;
      urls: GuestStayObjectUrlApi;
      audio: GuestStayAudioElement;
      onEnded: (ownerGeneration: number) => void;
      onError: (ownerGeneration: number) => void;
    }): Promise<"playing" | "retained" | "stale" | "failed"> {
      if (!input.isCurrent(input.ownerGeneration)) return "stale";
      if (!(await guestStayBlobMpegLooksValid(input.blob))) return "failed";
      const url = input.urls.create(input.blob);
      if (!input.isCurrent(input.ownerGeneration)) {
        try {
          input.urls.revoke(url);
        } catch {
          /* ignore */
        }
        return "stale";
      }
      if (objectUrl && objectUrl !== url) {
        try {
          input.urls.revoke(objectUrl);
        } catch {
          /* ignore */
        }
      }
      objectUrl = url;
      usable = true;
      playing = false;
      try {
        input.audio.volume = GUEST_STAY_AUDIO_VOLUME;
      } catch {
        /* ignore */
      }
      input.audio.src = url;
      const ready = await waitForGuestStayAudioReady(input.audio);
      if (!input.isCurrent(input.ownerGeneration)) {
        detach(input.audio, input.urls);
        return "stale";
      }
      if (!ready || !guestStayAudioDurationAllowed(input.audio.duration)) {
        detach(input.audio, input.urls);
        return "failed";
      }
      input.audio.onended = () => {
        if (!input.isCurrent(input.ownerGeneration)) return;
        playing = false;
        input.onEnded(input.ownerGeneration);
      };
      input.audio.onerror = () => {
        detach(input.audio, input.urls);
        if (!input.isCurrent(input.ownerGeneration)) return;
        input.onError(input.ownerGeneration);
      };
      autoplayAttempts += 1;
      playAttempts += 1;
      try {
        await input.audio.play();
        if (!input.isCurrent(input.ownerGeneration)) {
          try {
            input.audio.pause();
          } catch {
            /* ignore */
          }
          playing = false;
          return "stale";
        }
        playing = true;
        return "playing";
      } catch (error) {
        playing = false;
        if (!input.isCurrent(input.ownerGeneration)) {
          detach(input.audio, input.urls);
          return "stale";
        }
        if (isGuestStayAutoplayBlocked(error)) return "retained";
        detach(input.audio, input.urls);
        return "failed";
      }
    },
    async playManual(input: {
      ownerGeneration: number;
      isCurrent: (ownerGeneration: number) => boolean;
      audio: GuestStayAudioElement;
    }): Promise<"playing" | "failed" | "missing" | "stale"> {
      if (!input.isCurrent(input.ownerGeneration)) return "stale";
      if (!usable || !objectUrl) return "missing";
      playAttempts += 1;
      try {
        try {
          input.audio.volume = GUEST_STAY_AUDIO_VOLUME;
        } catch {
          /* ignore */
        }
        try {
          input.audio.pause();
        } catch {
          /* ignore */
        }
        input.audio.currentTime = 0;
        await input.audio.play();
        if (!input.isCurrent(input.ownerGeneration)) {
          try {
            input.audio.pause();
          } catch {
            /* ignore */
          }
          playing = false;
          return "stale";
        }
        playing = true;
        return "playing";
      } catch {
        playing = false;
        if (!input.isCurrent(input.ownerGeneration)) return "stale";
        return "failed";
      }
    },
    stop(audio: GuestStayAudioElement | null) {
      generation += 1;
      playing = false;
      try {
        audio?.pause();
      } catch {
        /* ignore */
      }
      return generation;
    },
  };
}
