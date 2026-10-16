"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import { GUEST_ELENA_TEXT_COPY } from "@/components/guest/guest-elena-text-card";
import { GUEST_STAY_LISTEN_COPY } from "@/lib/guest-stay-listen";
import { getHomepagePresenterHeroPlaybackController } from "@/lib/presenter-hero-playback";

/** Copy of approved master `promo-video/out/zencierge-final-validation.mp4` (master untouched). */
const PRESENTER_VIDEO_SRC = "/zencierge-promo.mp4";
const PRESENTER_POSTER_SRC = "/images/zencierge-presenter.png";
const PRESENTER_WIDTH = 1536;
const PRESENTER_HEIGHT = 1024;

/** Slightly taller modern smartphone proportion. */
const PHONE_ASPECT = "9 / 20.8";

const PRIMARY_STAY_CHIPS = ["Check-in", "Check-out", "Access", "Wi-Fi"] as const;

const SERVICE_CHIPS = [
  "Uber",
  "Lyft",
  "Instacart",
  "Uber Eats",
  "DoorDash",
] as const;

const CHIP_CLASS =
  "inline-flex h-7 items-center rounded-lg border border-cyan-400/30 bg-[#082238] px-2.5 text-[10px] font-semibold leading-none text-cyan-50";

const LANG_IDLE =
  "inline-flex h-7 min-w-[2.25rem] items-center justify-center rounded-md border border-cyan-400/30 bg-[#082238] px-2.5 text-[10px] font-semibold text-slate-100";

const LANG_ACTIVE =
  "inline-flex h-7 min-w-[2.25rem] items-center justify-center rounded-md border border-cyan-300 bg-cyan-400/20 px-2.5 text-[10px] font-semibold text-cyan-50";

const CALLOUT_TEXT =
  "text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.65),0_0_24px_rgba(15,23,42,0.55)]";

function PresenterHeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef(getHomepagePresenterHeroPlaybackController());
  const [isPlaying, setIsPlaying] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [isTerminal, setIsTerminal] = useState(false);

  const syncDerivedState = () => {
    const video = videoRef.current;
    const playback = playbackRef.current;
    if (!video) return;
    setIsPlaying(!video.paused);
    setAtStart(video.currentTime <= 0.05);
    setIsTerminal(playback.hasCompleted());
  };

  useEffect(() => {
    const video = videoRef.current;
    const playback = playbackRef.current;
    if (!video) return;

    let cancelled = false;
    video.loop = false;

    const onPlay = () => {
      setIsPlaying(true);
      setIsTerminal(false);
      setAtStart(video.currentTime <= 0.05);
    };

    const onPause = () => {
      setIsPlaying(false);
      setAtStart(video.currentTime <= 0.05);
      setIsTerminal(playback.hasCompleted());
    };

    const onSeeked = () => {
      setAtStart(video.currentTime <= 0.05);
      setIsPlaying(!video.paused);
      setIsTerminal(playback.hasCompleted());
    };

    const onEnded = () => {
      setIsPlaying(false);
      setIsTerminal(true);
      playback.handleEnded(video);

      void (async () => {
        await playback.resetToFirstFramePaused(video);
        if (cancelled) return;
        video.pause();
        if (video.currentTime !== 0) {
          video.currentTime = 0;
        }
        setIsPlaying(false);
        setAtStart(true);
        setIsTerminal(true);
      })();
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("seeked", onSeeked);

    const attemptAutoplayWithSound = async () => {
      const result = await playback.attemptAutoplayWithSound(video);
      if (cancelled) {
        video.pause();
        return;
      }
      setIsPlaying(result === "playing" && !video.paused);
      setAtStart(video.currentTime <= 0.05);
      setIsTerminal(playback.hasCompleted());
    };

    void attemptAutoplayWithSound();

    return () => {
      cancelled = true;
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("seeked", onSeeked);
      playback.releaseVideo(video);
    };
  }, []);

  const canPlay = !isPlaying;
  const canPause = isPlaying;
  const canResume = !isPlaying && !isTerminal && !atStart;
  const canRepeat = true;
  const canStop = isPlaying || (!atStart && !isTerminal);

  const onPlayClick = async () => {
    const video = videoRef.current;
    if (!video || !video.paused) return;
    await playbackRef.current.playFromUserGesture(video);
    syncDerivedState();
  };

  const onPauseClick = () => {
    const video = videoRef.current;
    if (!video || video.paused) return;
    playbackRef.current.pauseFromUserGesture(video);
    syncDerivedState();
  };

  const onResumeClick = async () => {
    const video = videoRef.current;
    if (!video) return;
    await playbackRef.current.resumeFromUserGesture(video);
    syncDerivedState();
  };

  const onRepeatClick = async () => {
    const video = videoRef.current;
    if (!video) return;
    await playbackRef.current.repeatFromUserGesture(video);
    syncDerivedState();
  };

  const onStopClick = async () => {
    const video = videoRef.current;
    if (!video) return;
    await playbackRef.current.stopFromUserGesture(video);
    setIsPlaying(false);
    setAtStart(true);
    setIsTerminal(true);
  };

  const controlBtnClass =
    "inline-flex h-8 items-center justify-center rounded-full border border-white/20 bg-slate-950/75 px-3 text-[11px] font-semibold tracking-wide text-white shadow-sm backdrop-blur-sm transition-colors hover:border-white/35 hover:bg-slate-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/50 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-slate-950/40 disabled:text-white/35 disabled:hover:border-white/10 disabled:hover:bg-slate-950/40";

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl shadow-sky-950/40">
        <video
          ref={videoRef}
          src={PRESENTER_VIDEO_SRC}
          poster={PRESENTER_POSTER_SRC}
          width={PRESENTER_WIDTH}
          height={PRESENTER_HEIGHT}
          playsInline
          preload="metadata"
          controls={false}
          loop={false}
          className="h-auto w-full max-w-full object-contain object-center"
          aria-label="Zencierge presenter introducing the guest phone experience"
        />
      </div>

      <div
        className="flex flex-wrap items-center justify-center gap-2"
        role="group"
        aria-label="Presenter video controls"
      >
        <button
          type="button"
          className={controlBtnClass}
          disabled={!canPlay}
          onClick={() => {
            void onPlayClick();
          }}
          aria-label="Play presenter video"
        >
          Play
        </button>
        <button
          type="button"
          className={controlBtnClass}
          disabled={!canPause}
          onClick={onPauseClick}
          aria-label="Pause presenter video"
        >
          Pause
        </button>
        <button
          type="button"
          className={controlBtnClass}
          disabled={!canResume}
          onClick={() => {
            void onResumeClick();
          }}
          aria-label="Resume presenter video"
        >
          Resume
        </button>
        <button
          type="button"
          className={controlBtnClass}
          disabled={!canRepeat}
          onClick={() => {
            void onRepeatClick();
          }}
          aria-label="Repeat presenter video from the beginning"
        >
          Repeat
        </button>
        <button
          type="button"
          className={controlBtnClass}
          disabled={!canStop}
          onClick={() => {
            void onStopClick();
          }}
          aria-label="Stop presenter video"
        >
          Stop
        </button>
      </div>
    </div>
  );
}

/**
 * Homepage V2 — Final hero polish: centered title, larger phone on the right.
 * Presenter uses approved promo video copy. Phone is static visual only.
 */
export function HomepageGuestPhoneExperience() {
  return (
    <section
      id="guest-experience"
      className="relative overflow-hidden border-b border-slate-800 px-6 pb-16 pt-16 md:pb-20 md:pt-20"
      aria-labelledby="guest-experience-heading"
    >
      <div className="pointer-events-none absolute left-1/4 top-1/3 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-sky-500/10 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-0 right-1/4 h-[320px] w-[320px] rounded-full bg-cyan-500/5 blur-[100px]" />

      <div className="relative z-10 mx-auto max-w-[96rem]">
        {/* Centered title block above the visual composition */}
        <div className="mx-auto mb-10 max-w-4xl text-center lg:mb-8">
          <p className="mb-3 text-xs font-extrabold uppercase tracking-widest text-sky-400">
            See Zencierge in action
          </p>
          <h1
            id="guest-experience-heading"
            className="mb-5 text-4xl font-black leading-[1.12] tracking-tight text-white md:text-5xl lg:text-6xl"
          >
            See exactly what your guest experiences.
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-slate-400 md:text-lg">
            Zencierge gives your guests instant answers right from their phone — while you get fewer
            interruptions and more time back.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/signup"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-emerald-400 px-8 py-4 text-sm font-black text-slate-950 shadow-xl shadow-sky-500/25 transition-all hover:-translate-y-0.5 hover:from-sky-300 hover:to-emerald-300 sm:w-auto"
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#pricing"
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-8 py-4 text-center text-sm font-bold text-slate-200 transition-colors hover:bg-slate-800 sm:w-auto"
            >
              View Pricing
            </a>
          </div>
        </div>

        {/* Presenter dominant left · phone stays on the right */}
        <div className="grid min-w-0 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-16 xl:gap-x-24">
          <div className="order-1 w-full min-w-0 lg:mt-24 lg:min-w-0 xl:mt-28">
            <PresenterHeroVideo />
          </div>

          <div className="order-2 mx-auto flex w-full max-w-[320px] flex-col items-center text-center lg:mr-6 lg:ml-8 lg:w-[320px] lg:max-w-[320px] lg:shrink-0 lg:justify-self-end xl:mr-10 xl:ml-12">
            <p
              className={`mb-2.5 text-base font-bold uppercase tracking-[0.14em] sm:text-lg ${CALLOUT_TEXT}`}
            >
              What your guest sees
            </p>
            <p className="mb-5 w-full max-w-[320px] text-sm font-medium leading-relaxed text-white/80">
              This is the exact mobile experience your guests will see.
            </p>

            <div className="relative w-full max-w-[320px]">
              <div
                className="pointer-events-none absolute -inset-4 rounded-[3.25rem] bg-sky-400/20 blur-2xl animate-pulse"
                aria-hidden="true"
              />
              <div
                className="pointer-events-none absolute -inset-1 rounded-[2.9rem] ring-1 ring-sky-300/25"
                aria-hidden="true"
              />

              <div
                className="relative w-full max-w-full rounded-[2.85rem] bg-gradient-to-b from-zinc-500 via-zinc-900 to-black p-[2px] shadow-[0_32px_70px_-20px_rgba(0,0,0,0.9),0_0_36px_rgba(56,189,248,0.22)]"
                style={{ aspectRatio: PHONE_ASPECT }}
                aria-hidden="true"
              >
                <div className="flex h-full min-h-0 flex-col rounded-[2.7rem] bg-[#0a0a0b] p-[12px]">
                  <div className="relative z-10 mb-3 flex shrink-0 justify-center pt-0.5">
                    <div className="flex h-[28px] w-[102px] items-center justify-center gap-2.5 rounded-full bg-black ring-1 ring-zinc-800">
                      <span className="h-2.5 w-2.5 rounded-full bg-zinc-800 ring-1 ring-zinc-700" />
                      <span className="h-1.5 w-11 rounded-full bg-zinc-900" />
                    </div>
                  </div>

                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[2.05rem] border border-zinc-800/90 bg-[#0d3258]">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3.5 pb-3.5 pt-3.5">
                      {/* Header */}
                      <div className="flex min-w-0 items-center gap-3">
                        <ElenaAvatar size={34} showGlow={false} />
                        <div className="min-w-0 leading-tight">
                          <p className="truncate text-[13px] font-bold tracking-tight text-white">
                            Isabela
                          </p>
                          <p className="mt-0.5 truncate text-[10px] font-medium text-cyan-100/65">
                            Guest Stay Assistant
                          </p>
                        </div>
                      </div>

                      {/* Language */}
                      <div className="mt-3.5 flex items-center gap-1.5">
                        <span className={LANG_ACTIVE}>{GUEST_STAY_LISTEN_COPY.langEn}</span>
                        <span className={LANG_IDLE}>{GUEST_STAY_LISTEN_COPY.langEs}</span>
                      </div>

                      {/* Primary stay chips */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {PRIMARY_STAY_CHIPS.map((label) => (
                          <span key={label} className={CHIP_CLASS}>
                            {label}
                          </span>
                        ))}
                      </div>

                      {/* Sample conversation */}
                      <div className="mt-3.5 space-y-2 rounded-xl border border-cyan-400/20 bg-[#071e36]/90 p-2.5">
                        <p className="ml-2 whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-cyan-500/20 px-2.5 py-1.5 text-[11px] leading-relaxed text-white">
                          How do I get groceries delivered?
                        </p>
                        <p className="mr-2 whitespace-pre-wrap break-words rounded-2xl rounded-tl-md bg-[#123a62] px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-100">
                          Try Instacart for groceries, or Uber Eats and DoorDash for restaurant
                          delivery.
                        </p>
                      </div>

                      {/* Service chips */}
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {SERVICE_CHIPS.map((label) => (
                          <span key={label} className={CHIP_CLASS}>
                            {label}
                          </span>
                        ))}
                      </div>

                      {/* Input */}
                      <div className="mt-auto flex min-w-0 items-center gap-2 pt-3.5">
                        <div className="flex min-h-9 min-w-0 flex-1 items-center truncate rounded-lg border border-cyan-400/25 bg-[#082238] px-2.5 text-[11px] text-slate-400">
                          Ask about your stay...
                        </div>
                        <div className="flex min-h-9 shrink-0 items-center rounded-lg border border-cyan-300/40 bg-cyan-400/20 px-3 text-[11px] font-semibold text-cyan-50">
                          {GUEST_ELENA_TEXT_COPY.sendEn}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex shrink-0 justify-center pb-0.5">
                    <div className="h-1 w-[112px] rounded-full bg-zinc-700" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
