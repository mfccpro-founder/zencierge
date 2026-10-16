/**
 * Homepage presenter hero playback policy:
 * - exactly one audible video source
 * - autoplay at most once
 * - no loop / no automatic replay
 * - pause/resume without resetting timestamp mid-play
 * - on natural end: reset to start, stay paused, wait for user Play
 */

export type PresenterHeroPlaybackVideo = {
  play: () => Promise<void>;
  pause: () => void;
  muted: boolean;
  defaultMuted: boolean;
  loop: boolean;
  currentTime: number;
  paused: boolean;
  ended: boolean;
  duration: number;
};

type SeekablePresenterVideo = PresenterHeroPlaybackVideo & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type PresenterHeroPlayResult =
  | "playing"
  | "blocked"
  | "failed"
  | "skipped"
  | "paused";

export type PresenterHeroPlaybackController = {
  attemptAutoplayWithSound: (
    video: PresenterHeroPlaybackVideo,
  ) => Promise<PresenterHeroPlayResult>;
  startFromUserGesture: (
    video: PresenterHeroPlaybackVideo,
  ) => Promise<PresenterHeroPlayResult>;
  pauseFromUserGesture: (video: PresenterHeroPlaybackVideo) => "paused" | "skipped";
  /**
   * Play from currentTime. If terminal/stopped at 0, clears terminal and starts.
   * Does not force-reset mid-video (use Repeat for that).
   */
  playFromUserGesture: (
    video: PresenterHeroPlaybackVideo,
  ) => Promise<PresenterHeroPlayResult>;
  /**
   * Resume from currentTime only. Skips when stopped/ended at start.
   * Use repeatFromUserGesture to replay from the beginning.
   */
  resumeFromUserGesture: (
    video: PresenterHeroPlaybackVideo,
  ) => Promise<PresenterHeroPlayResult>;
  /** User-only: seek to 0 and play immediately. */
  repeatFromUserGesture: (
    video: PresenterHeroPlaybackVideo,
  ) => Promise<PresenterHeroPlayResult>;
  /** Pause, reset to first frame, stay paused. No autoplay. */
  stopFromUserGesture: (video: PresenterHeroPlaybackVideo) => Promise<"stopped">;
  handleEnded: (video: PresenterHeroPlaybackVideo) => void;
  /**
   * After natural end: pause, seek to 0, wait for seeked so the first frame paints.
   * Never calls play().
   */
  resetToFirstFramePaused: (video: PresenterHeroPlaybackVideo) => Promise<void>;
  /** Pause on unmount so a remount cannot echo with a second element. */
  releaseVideo: (video: PresenterHeroPlaybackVideo) => void;
  hasCompleted: () => boolean;
  hasAttemptedAutoplay: () => boolean;
  getActiveVideo: () => PresenterHeroPlaybackVideo | null;
  getAutoplayPlayCallCount: () => number;
  getGesturePlayCallCount: () => number;
  getTotalPlayCallCount: () => number;
};

function prepareForAudiblePlayback(video: PresenterHeroPlaybackVideo) {
  video.loop = false;
  video.muted = false;
  video.defaultMuted = false;
}

function isSeekablePresenterVideo(
  video: PresenterHeroPlaybackVideo,
): video is SeekablePresenterVideo {
  const candidate = video as PresenterHeroPlaybackVideo & {
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  return (
    typeof candidate.addEventListener === "function" &&
    typeof candidate.removeEventListener === "function"
  );
}

/** Pause and seek to 0; wait for seeked so the first frame is visible. Never plays. */
export async function resetPresenterVideoToFirstFramePaused(
  video: PresenterHeroPlaybackVideo,
): Promise<void> {
  video.loop = false;
  video.pause();

  if (!isSeekablePresenterVideo(video)) {
    video.currentTime = 0;
    video.pause();
    return;
  }

  // From the ended/final-frame state, a single currentTime=0 often does not
  // repaint. Nudge first, then seek to 0 and wait for seeked — never play().
  const nudge =
    Number.isFinite(video.duration) && video.duration > 0.05
      ? Math.min(0.05, video.duration * 0.001)
      : 0.01;

  await seekPresenterVideoAndWait(video, nudge);
  video.pause();
  await seekPresenterVideoAndWait(video, 0);
  video.pause();
}

function seekPresenterVideoAndWait(
  video: SeekablePresenterVideo,
  time: number,
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", onSeeked);
      video.pause();
      resolve();
    };

    const onSeeked = () => {
      finish();
    };

    video.addEventListener("seeked", onSeeked);

    try {
      video.currentTime = time;
    } catch {
      finish();
      return;
    }

    // Fallback only — do not finish on setTimeout(0) (that raced ahead of paint).
    setTimeout(() => {
      if (Math.abs(video.currentTime - time) <= 0.05) {
        finish();
        return;
      }
      try {
        video.currentTime = time;
      } catch {
        // ignore
      }
      video.pause();
      finish();
    }, 500);
  });
}

export function createPresenterHeroPlaybackController(): PresenterHeroPlaybackController {
  let autoplayAttempted = false;
  let autoplaySucceeded = false;
  let userPaused = false;
  let resumeAfterRemount = false;
  let completed = false;
  let playEpoch = 0;
  let autoplayPlayCalls = 0;
  let gesturePlayCalls = 0;
  let activeVideo: PresenterHeroPlaybackVideo | null = null;

  const claimExclusivePlayback = (video: PresenterHeroPlaybackVideo) => {
    if (activeVideo && activeVideo !== video) {
      try {
        activeVideo.pause();
      } catch {
        // ignore pause errors from detached nodes
      }
    }
    activeVideo = video;
  };

  return {
    async attemptAutoplayWithSound(video) {
      if (completed) return "skipped";

      // Same autoplay session after Strict Mode remount — not a second autoplay.
      if (resumeAfterRemount) {
        resumeAfterRemount = false;
        const epoch = playEpoch;
        claimExclusivePlayback(video);
        prepareForAudiblePlayback(video);
        try {
          await video.play();
          if (epoch !== playEpoch) {
            video.pause();
            return "skipped";
          }
          autoplaySucceeded = true;
          userPaused = false;
          return "playing";
        } catch {
          return "blocked";
        }
      }

      if (autoplayAttempted) return "skipped";
      autoplayAttempted = true;
      const epoch = playEpoch;
      claimExclusivePlayback(video);
      prepareForAudiblePlayback(video);
      try {
        autoplayPlayCalls += 1;
        await video.play();
        if (epoch !== playEpoch) {
          video.pause();
          return "skipped";
        }
        autoplaySucceeded = true;
        userPaused = false;
        return "playing";
      } catch {
        return "blocked";
      }
    },

    async startFromUserGesture(video) {
      if (completed) return "skipped";
      resumeAfterRemount = false;
      userPaused = false;
      const epoch = playEpoch;
      claimExclusivePlayback(video);
      prepareForAudiblePlayback(video);
      try {
        gesturePlayCalls += 1;
        await video.play();
        if (epoch !== playEpoch) {
          video.pause();
          return "skipped";
        }
        return "playing";
      } catch {
        return "failed";
      }
    },

    pauseFromUserGesture(video) {
      if (video.paused) return "skipped";
      resumeAfterRemount = false;
      userPaused = true;
      if (activeVideo && activeVideo !== video) {
        try {
          activeVideo.pause();
        } catch {
          // ignore
        }
      }
      activeVideo = video;
      video.pause();
      return "paused";
    },

    async playFromUserGesture(video) {
      if (!video.paused) return "skipped";

      resumeAfterRemount = false;
      userPaused = false;
      const epoch = playEpoch;
      claimExclusivePlayback(video);
      prepareForAudiblePlayback(video);

      if (completed) {
        completed = false;
        video.currentTime = 0;
      }

      try {
        gesturePlayCalls += 1;
        await video.play();
        if (epoch !== playEpoch) {
          video.pause();
          return "skipped";
        }
        return "playing";
      } catch {
        return "failed";
      }
    },

    async resumeFromUserGesture(video) {
      // Do not restart from ended/stopped start — Repeat handles that.
      if (completed) return "skipped";
      if (video.paused === false) return "skipped";
      if (video.currentTime <= 0.05) return "skipped";

      resumeAfterRemount = false;
      userPaused = false;
      const epoch = playEpoch;
      claimExclusivePlayback(video);
      prepareForAudiblePlayback(video);

      try {
        gesturePlayCalls += 1;
        await video.play();
        if (epoch !== playEpoch) {
          video.pause();
          return "skipped";
        }
        return "playing";
      } catch {
        return "failed";
      }
    },

    async repeatFromUserGesture(video) {
      resumeAfterRemount = false;
      userPaused = false;
      completed = false;
      const epoch = playEpoch;
      claimExclusivePlayback(video);
      prepareForAudiblePlayback(video);
      video.pause();
      video.currentTime = 0;

      try {
        gesturePlayCalls += 1;
        await video.play();
        if (epoch !== playEpoch) {
          video.pause();
          return "skipped";
        }
        return "playing";
      } catch {
        return "failed";
      }
    },

    async stopFromUserGesture(video) {
      resumeAfterRemount = false;
      userPaused = false;
      completed = true;
      claimExclusivePlayback(video);
      video.loop = false;
      video.pause();
      await resetPresenterVideoToFirstFramePaused(video);
      video.pause();
      return "stopped";
    },

    handleEnded(video) {
      completed = true;
      resumeAfterRemount = false;
      userPaused = false;
      video.loop = false;
      // Mark complete + pause. Frame reset via resetToFirstFramePaused (seeked).
      video.pause();
      if (activeVideo === video) {
        activeVideo = video;
      }
    },

    resetToFirstFramePaused(video) {
      return resetPresenterVideoToFirstFramePaused(video);
    },

    releaseVideo(video) {
      playEpoch += 1;
      const shouldResumeSession =
        autoplaySucceeded && !completed && !userPaused && activeVideo === video;
      try {
        video.pause();
      } catch {
        // ignore
      }
      if (activeVideo === video) {
        activeVideo = null;
      }
      // Continue the same autoplay session on the remounted element (no second source).
      if (shouldResumeSession) {
        resumeAfterRemount = true;
      }
    },

    hasCompleted() {
      return completed;
    },

    hasAttemptedAutoplay() {
      return autoplayAttempted;
    },

    getActiveVideo() {
      return activeVideo;
    },

    getAutoplayPlayCallCount() {
      return autoplayPlayCalls;
    },

    getGesturePlayCallCount() {
      return gesturePlayCalls;
    },

    getTotalPlayCallCount() {
      return autoplayPlayCalls + gesturePlayCalls;
    },
  };
}

/** One controller per page load so Strict Mode remounts cannot autoplay twice. */
const homepagePresenterHeroPlayback = createPresenterHeroPlaybackController();

export function getHomepagePresenterHeroPlaybackController() {
  return homepagePresenterHeroPlayback;
}
