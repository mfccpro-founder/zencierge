import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPresenterHeroPlaybackController,
  getHomepagePresenterHeroPlaybackController,
  type PresenterHeroPlaybackVideo,
} from "./presenter-hero-playback";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function createFakeVideo(options?: {
  playImpl?: () => Promise<void>;
}): PresenterHeroPlaybackVideo & { playCalls: number; pauseCalls: number } {
  const video = {
    playCalls: 0,
    pauseCalls: 0,
    muted: true,
    defaultMuted: true,
    loop: true,
    currentTime: 12,
    paused: true,
    ended: false,
    duration: 60,
    async play() {
      video.playCalls += 1;
      video.paused = false;
      video.ended = false;
      if (options?.playImpl) return options.playImpl();
    },
    pause() {
      video.pauseCalls += 1;
      video.paused = true;
    },
  };
  return video;
}

function createSeekableFakeVideo() {
  const listeners = new Map<string, Set<() => void>>();
  const base = createFakeVideo();
  let time = 60;

  return {
    ...base,
    get currentTime() {
      return time;
    },
    set currentTime(value: number) {
      time = value;
      setTimeout(() => {
        for (const listener of listeners.get("seeked") ?? []) listener();
      }, 0);
    },
    addEventListener(type: string, listener: () => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
}

async function run() {
  // 1. Autoplay starts at most once
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    const first = await controller.attemptAutoplayWithSound(video);
    const second = await controller.attemptAutoplayWithSound(video);
    assert(first === "playing", "first autoplay should play");
    assert(second === "skipped", "second autoplay must be skipped");
    assert(controller.getAutoplayPlayCallCount() === 1, "autoplay play() at most once");
    assert(video.playCalls === 1, "video.play called once for autoplay");
    assert(video.loop === false, "loop forced false before play");
    assert(controller.getActiveVideo() === video, "tracks single active video");
  }

  // 2. Natural end: reset to start, stay paused, never autoplay/replay
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 60;
    video.ended = true;
    const playCallsBeforeEnd = video.playCalls;
    controller.handleEnded(video);
    await controller.resetToFirstFramePaused(video);
    assert(controller.hasCompleted() === true, "marked completed on ended");
    assert(video.playCalls === playCallsBeforeEnd, "ended must not call play()");
    assert(video.currentTime === 0, "ended resets currentTime to 0");
    assert(video.paused === true, "ended keeps video paused");
    assert(video.loop === false, "loop remains false after ended");

    const afterEnded = await controller.attemptAutoplayWithSound(video);
    const gestureAfterEnded = await controller.startFromUserGesture(video);
    assert(afterEnded === "skipped", "no autoplay after ended");
    assert(gestureAfterEnded === "skipped", "no auto gesture via startFromUserGesture after ended");
    assert(controller.getTotalPlayCallCount() === 1, "no additional play() after ended");
    assert(video.currentTime === 0, "still at start while waiting for user Play");
    assert(video.paused === true, "still paused while waiting for user Play");
  }

  // 2b. Seekable reset waits for seeked and ends at 0 paused (no play)
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createSeekableFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 60;
    video.ended = true;
    const playsBefore = video.playCalls;
    controller.handleEnded(video);
    await controller.resetToFirstFramePaused(video);
    assert(video.currentTime === 0, "seekable reset lands on 0");
    assert(video.paused === true, "seekable reset stays paused");
    assert(video.playCalls === playsBefore, "seekable reset never calls play()");
  }

  // 3. Component source: four controls, one video, event sync, no loop
  {
    const componentPath = join(
      process.cwd(),
      "src/components/landing/homepage-guest-phone-experience.tsx",
    );
    const source = readFileSync(componentPath, "utf8");
    const videoTagCount = (source.match(/<video\b/g) ?? []).length;
    const audioTagCount = (source.match(/<audio\b/g) ?? []).length;
    assert(videoTagCount === 1, "exactly one presenter <video> element");
    assert(audioTagCount === 0, "no separate <audio> element");
    assert(!/loop=\{true\}/.test(source), "loop={true} must not appear");
    assert(/loop=\{false\}/.test(source), "explicit loop={false} required");
    assert(source.includes('addEventListener("play"'), "syncs on play event");
    assert(source.includes('addEventListener("pause"'), "syncs on pause event");
    assert(source.includes('addEventListener("ended"'), "syncs on ended event");
    assert(source.includes("resetToFirstFramePaused"), "ended path seeks to first frame");
    assert(source.includes('aria-label="Play presenter video"'), "Play control present");
    assert(source.includes('aria-label="Pause presenter video"'), "Pause control present");
    assert(source.includes('aria-label="Resume presenter video"'), "Resume control present");
    assert(
      source.includes('aria-label="Repeat presenter video from the beginning"'),
      "Repeat control present",
    );
    assert(source.includes('aria-label="Stop presenter video"'), "Stop control present");
    assert(source.includes("playFromUserGesture"), "Play wired to controller");
    assert(source.includes("resumeFromUserGesture"), "Resume wired to controller");
    assert(source.includes("repeatFromUserGesture"), "Repeat wired to controller");
    assert(source.includes("stopFromUserGesture"), "Stop wired to controller");
    assert(!source.includes("Tap to hear"), "no second tap overlay control");
    assert(!/controls=\{true\}/.test(source), "no native browser controls");
    assert(
      (source.match(/<PresenterHeroVideo\s*\/>/g) ?? []).length === 1,
      "PresenterHeroVideo mounted once",
    );
  }

  // 4. After end, first frame held paused; release still safe
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 59.9;
    controller.handleEnded(video);
    await controller.resetToFirstFramePaused(video);
    assert(video.currentTime === 0, "first frame after natural end");
    assert(video.paused === true, "paused after natural end");
    controller.releaseVideo(video);
    assert(video.pauseCalls >= 1, "release pauses video");
    assert(controller.getActiveVideo() === null, "active video cleared on release");
  }

  // 5. Exclusive playback: second video cannot echo over first
  {
    const controller = createPresenterHeroPlaybackController();
    const first = createFakeVideo();
    const second = createFakeVideo();
    await controller.attemptAutoplayWithSound(first);
    assert(first.paused === false, "first playing");
    const blockedAuto = await controller.attemptAutoplayWithSound(second);
    assert(blockedAuto === "skipped", "second autoplay skipped");
    const gesture = await controller.startFromUserGesture(second);
    assert(gesture === "playing", "gesture may start same controller on new element");
    assert(first.pauseCalls >= 1, "previous video paused to prevent echo");
    assert(controller.getActiveVideo() === second, "only latest video is active");
  }

  // 5b. Remount release pauses and does not double-count autoplay
  {
    const controller = createPresenterHeroPlaybackController();
    const first = createFakeVideo();
    const remount = createFakeVideo();
    await controller.attemptAutoplayWithSound(first);
    assert(controller.getAutoplayPlayCallCount() === 1, "one autoplay play call");
    controller.releaseVideo(first);
    assert(first.paused === true, "released video paused");
    const resumed = await controller.attemptAutoplayWithSound(remount);
    assert(resumed === "playing", "same session resumes on remounted element");
    assert(controller.getAutoplayPlayCallCount() === 1, "remount resume is not a second autoplay");
    assert(controller.getActiveVideo() === remount, "remounted video is exclusive active source");
  }

  // 6. Pause / resume keeps timestamp; no restart
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 18.5;
    const paused = controller.pauseFromUserGesture(video);
    assert(paused === "paused", "pause result");
    assert(video.paused === true, "video paused");
    assert(video.currentTime === 18.5, "timestamp preserved on pause");
    const resumed = await controller.resumeFromUserGesture(video);
    assert(resumed === "playing", "resume plays");
    assert(video.currentTime === 18.5, "resume does not restart");
  }

  // 7. After ended, Resume is skipped; Repeat restarts from beginning
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 60;
    video.ended = true;
    controller.handleEnded(video);
    await controller.resetToFirstFramePaused(video);
    assert(controller.hasCompleted() === true, "completed");
    assert(video.currentTime === 0, "ready at start before user Repeat");
    assert(video.paused === true, "paused after end");
    const resumeBlocked = await controller.resumeFromUserGesture(video);
    assert(resumeBlocked === "skipped", "Resume does not restart after end");
    const replay = await controller.repeatFromUserGesture(video);
    assert(replay === "playing", "explicit Repeat replays from beginning");
    assert(video.currentTime === 0, "Repeat starts from beginning");
    assert(controller.hasCompleted() === false, "completed cleared by Repeat");
    assert(controller.getAutoplayPlayCallCount() === 1, "Repeat is not a second autoplay");
  }

  // 7b. Stop resets to first frame paused; Resume blocked; Repeat works
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 22;
    const stopped = await controller.stopFromUserGesture(video);
    assert(stopped === "stopped", "stop result");
    assert(video.paused === true, "stopped remains paused");
    assert(video.currentTime === 0, "stop resets to first frame");
    assert(controller.hasCompleted() === true, "stop marks terminal");
    const resumeBlocked = await controller.resumeFromUserGesture(video);
    assert(resumeBlocked === "skipped", "Resume blocked after Stop");
    const replay = await controller.repeatFromUserGesture(video);
    assert(replay === "playing", "Repeat after Stop starts playback");
  }

  // 7c. Play after end starts from 0; Resume still skipped
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 60;
    video.ended = true;
    controller.handleEnded(video);
    await controller.resetToFirstFramePaused(video);
    const resumeBlocked = await controller.resumeFromUserGesture(video);
    assert(resumeBlocked === "skipped", "Resume blocked after end");
    const played = await controller.playFromUserGesture(video);
    assert(played === "playing", "Play after end starts playback");
    assert(video.currentTime === 0, "Play after end starts at 0");
    assert(controller.hasCompleted() === false, "Play clears terminal");
  }

  // 7d. Play mid-pause resumes same timestamp
  {
    const controller = createPresenterHeroPlaybackController();
    const video = createFakeVideo();
    await controller.attemptAutoplayWithSound(video);
    video.currentTime = 12.25;
    controller.pauseFromUserGesture(video);
    const played = await controller.playFromUserGesture(video);
    assert(played === "playing", "Play mid-pause works");
    assert(video.currentTime === 12.25, "Play mid-pause keeps timestamp");
  }

  // 8. Tap-to-hear / gesture uses same exclusive path (no second source)
  {
    const controller = createPresenterHeroPlaybackController();
    let shouldBlock = true;
    const video = createFakeVideo({
      playImpl: async () => {
        if (shouldBlock) {
          shouldBlock = false;
          throw new Error("autoplay blocked");
        }
      },
    });
    const blocked = await controller.attemptAutoplayWithSound(video);
    assert(blocked === "blocked", "autoplay blocked");
    assert(controller.hasAttemptedAutoplay() === true, "autoplay marked attempted");
    const started = await controller.startFromUserGesture(video);
    assert(started === "playing", "fallback starts same video element");
    assert(controller.getActiveVideo() === video, "fallback uses same active video");
  }

  // Page-session singleton
  {
    const a = getHomepagePresenterHeroPlaybackController();
    const b = getHomepagePresenterHeroPlaybackController();
    assert(a === b, "homepage playback controller is a singleton");
  }

  console.log("presenter-hero-playback tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
