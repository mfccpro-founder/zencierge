"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Volume2 } from "lucide-react";
import { ElenaAvatar } from "@/components/dashboard/elena-avatar";
import { useListings } from "@/components/dashboard/listings-provider";
import { guestPressClass } from "@/lib/guest-press";
import {
  AutoplayBlockedError,
  playOpenAiTtsMpeg,
  stopHumanVoice,
  unlockSpeechAudio,
} from "@/lib/human-voice";
import { DEFAULT_HOST_PROFILE_NAME, readStoredHostProfileName } from "@/lib/host-display-name";
import { HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH } from "@/lib/housekeeping-proof-host";
import {
  claimIsabelaAutoVoiceSessionSpeak,
  composeSmartLoginBriefing,
  countSameDayReservationMoves,
  hasIsabelaAutoVoiceSpokenThisSession,
  HOST_TIMEZONE_STORAGE_KEY,
  LOGIN_BRIEFING_V1_LIVE_SOURCES,
  parseHostBriefingLanguage,
  parsePendingHousekeepingCount,
  readIsabelaAutoVoicePreference,
  readStoredHostBriefingLanguage,
  resolveHostBriefingTimeZone,
  shouldAttemptIsabelaAutoSpeak,
  writeIsabelaAutoVoicePreference,
  type VoiceBriefingLanguage,
} from "@/lib/smart-voice-briefing";

function firstName(full: string) {
  return full.trim().split(/\s+/)[0] || "Host";
}

function hasPlayableMpeg(audio: HTMLAudioElement | null) {
  const src = audio?.currentSrc || audio?.src || "";
  return Boolean(src) && !src.startsWith("data:");
}

type Playback = "idle" | "loading" | "playing" | "blocked" | "error";

export function SmartVoiceBriefingCard() {
  const { properties, reservations, loading: listingsLoading } = useListings();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingTextRef = useRef<string | null>(null);
  const playGenRef = useRef(0);
  const briefingActiveRef = useRef(false);
  const autoSpeakStartedRef = useRef(false);
  const briefingTextRef = useRef("");
  const [hostName] = useState(() =>
    typeof window === "undefined" ? "Host" : firstName(readStoredHostProfileName() || DEFAULT_HOST_PROFILE_NAME),
  );
  const [language, setLanguage] = useState<VoiceBriefingLanguage>(() =>
    typeof window === "undefined" ? "en" : readStoredHostBriefingLanguage(),
  );
  const [tick, setTick] = useState(0);
  const [housekeepingPending, setHousekeepingPending] = useState(0);
  const [housekeepingLive, setHousekeepingLive] = useState(false);
  const [playback, setPlayback] = useState<Playback>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [engineLabel, setEngineLabel] = useState<string | null>(null);
  const [showEnableVoice, setShowEnableVoice] = useState(false);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const syncLanguage = () => {
      setLanguage(readStoredHostBriefingLanguage());
    };
    syncLanguage();
    window.addEventListener("storage", syncLanguage);
    window.addEventListener("zencierge-host-language", syncLanguage);
    return () => {
      window.removeEventListener("storage", syncLanguage);
      window.removeEventListener("zencierge-host-language", syncLanguage);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadHousekeeping = async () => {
      try {
        const response = await fetch(HOUSEKEEPING_PROOF_HOST_OPTIONS_PATH, {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (!response.ok) {
          if (!cancelled) {
            setHousekeepingLive(false);
            setHousekeepingPending(0);
          }
          return;
        }
        const payload: unknown = await response.json().catch(() => null);
        const count = parsePendingHousekeepingCount(payload);
        if (cancelled) return;
        if (count == null) {
          setHousekeepingLive(false);
          setHousekeepingPending(0);
          return;
        }
        setHousekeepingLive(true);
        setHousekeepingPending(count);
      } catch {
        if (!cancelled) {
          setHousekeepingLive(false);
          setHousekeepingPending(0);
        }
      }
    };
    void loadHousekeeping();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  useEffect(() => {
    return () => {
      playGenRef.current += 1;
      briefingActiveRef.current = false;
      stopHumanVoice(audioRef);
    };
  }, []);

  const briefing = useMemo(() => {
    void tick;
    const storedZone =
      (typeof window !== "undefined" && window.localStorage.getItem(HOST_TIMEZONE_STORAGE_KEY)?.trim()) || "";
    const zone = resolveHostBriefingTimeZone({
      storedTimeZone: storedZone,
      propertyTimeZones: properties.map((property) => property.timezone),
    });
    const provisional = composeSmartLoginBriefing({
      hostFirstName: hostName,
      language,
      timeZone: zone,
      counts: { arrivals: 0, departures: 0, housekeepingPending: 0 },
    });
    const dayMoves = countSameDayReservationMoves(reservations, provisional.clock.dateIso);
    return composeSmartLoginBriefing({
      hostFirstName: hostName,
      language: parseHostBriefingLanguage(language),
      timeZone: zone,
      counts: {
        arrivals: dayMoves.arrivals,
        departures: dayMoves.departures,
        housekeepingPending: housekeepingLive ? housekeepingPending : 0,
      },
      sources: {
        ...LOGIN_BRIEFING_V1_LIVE_SOURCES,
        housekeeping: housekeepingLive,
      },
    });
  }, [hostName, language, properties, reservations, tick, housekeepingPending, housekeepingLive]);

  useEffect(() => {
    briefingTextRef.current = briefing.spokenText;
  }, [briefing.spokenText]);

  const unlockAudio = useCallback(() => {
    const audio = unlockSpeechAudio(audioRef.current);
    if (audio) audioRef.current = audio;
    return audio ?? audioRef.current;
  }, []);

  const attachAudio = (el: HTMLAudioElement | null) => {
    if (el) audioRef.current = el;
  };

  const finishIfCurrent = (gen: number) => {
    if (gen !== playGenRef.current) return;
    briefingActiveRef.current = false;
    setPlayback("idle");
  };

  const markPlaying = (el: HTMLAudioElement, gen: number) => {
    if (gen !== playGenRef.current) return;
    setPlayback("playing");
    setHint(null);
    el.onended = () => {
      finishIfCurrent(gen);
    };
  };

  const playBufferedMpeg = async (gen: number) => {
    const el = unlockAudio();
    if (!el || !hasPlayableMpeg(el)) return false;
    el.loop = false;
    el.muted = false;
    el.volume = 1;
    try {
      await el.play();
      if (gen !== playGenRef.current) return true;
      pendingTextRef.current = null;
      markPlaying(el, gen);
      await new Promise<void>((resolve) => {
        const done = () => {
          el.removeEventListener("ended", done);
          el.removeEventListener("error", done);
          el.removeEventListener("abort", done);
          resolve();
        };
        if (gen !== playGenRef.current || el.ended || el.paused) {
          done();
          return;
        }
        el.addEventListener("ended", done);
        el.addEventListener("error", done);
        el.addEventListener("abort", done);
      });
      return true;
    } catch {
      return false;
    }
  };

  const speakBriefing = async (gen: number, replayBlocked: boolean, mode: "manual" | "auto") => {
    if (gen !== playGenRef.current) return;
    const text = (pendingTextRef.current || briefingTextRef.current || briefing.spokenText).trim();
    if (!text) {
      briefingActiveRef.current = false;
      setPlayback("idle");
      return;
    }

    unlockAudio();
    pendingTextRef.current = text;

    if (replayBlocked && (await playBufferedMpeg(gen))) {
      if (gen === playGenRef.current) {
        briefingActiveRef.current = false;
        setPlayback("idle");
      }
      return;
    }

    if (gen !== playGenRef.current) return;

    const target = audioRef.current;
    const onPcmPlaying = () => {
      if (gen !== playGenRef.current) return;
      const node = audioRef.current;
      if (node) {
        const model = node.dataset.ttsModel || node.dataset.ttsEngine || "openai-audio";
        const ttsVoice = node.dataset.ttsVoice || "marin";
        setEngineLabel(`${model} · ${ttsVoice}`);
      }
      setPlayback("playing");
    };
    target?.addEventListener("playing", onPcmPlaying);

    try {
      const el = await playOpenAiTtsMpeg(text, "marin", audioRef.current, undefined, true);
      target?.removeEventListener("playing", onPcmPlaying);
      if (gen !== playGenRef.current) return;
      audioRef.current = el;
      pendingTextRef.current = null;
      const model = el.dataset.ttsModel || el.dataset.ttsEngine || "openai-audio";
      const ttsVoice = el.dataset.ttsVoice || "marin";
      setEngineLabel(`${model} · ${ttsVoice}`);
      briefingActiveRef.current = false;
      setPlayback("idle");
      setHint(null);
      setShowEnableVoice(false);
      return;
    } catch (cause) {
      target?.removeEventListener("playing", onPcmPlaying);
      if (gen !== playGenRef.current) return;
      briefingActiveRef.current = false;
      if (cause instanceof AutoplayBlockedError) {
        setPlayback("blocked");
        if (mode === "auto") {
          setHint(null);
          setShowEnableVoice(true);
          return;
        }
        setHint(
          language === "es"
            ? "Toca Escuchar briefing otra vez. El navegador bloqueó la reproducción automática."
            : "Tap Hear briefing again. Your browser blocked autoplay until a second tap.",
        );
        return;
      }
      if (mode === "auto") {
        setPlayback("idle");
        setHint(null);
        return;
      }
      setPlayback("error");
      setEngineLabel(null);
      setHint(cause instanceof Error ? cause.message : "Advanced OpenAI audio failed. Browser TTS was not used.");
    }
  };

  const startSpeak = (mode: "manual" | "auto", replayBlocked: boolean) => {
    if (briefingActiveRef.current || playback === "loading" || playback === "playing") {
      return false;
    }
    unlockAudio();
    briefingActiveRef.current = true;
    const gen = ++playGenRef.current;
    setPlayback("loading");
    setHint(null);
    void speakBriefing(gen, replayBlocked, mode);
    return true;
  };

  useEffect(() => {
    if (autoSpeakStartedRef.current) return;
    if (
      !shouldAttemptIsabelaAutoSpeak({
        preference: readIsabelaAutoVoicePreference(),
        sessionAlreadySpoken: hasIsabelaAutoVoiceSpokenThisSession(),
        listingsLoading,
        playbackBusy: briefingActiveRef.current || playback === "loading" || playback === "playing",
      })
    ) {
      return;
    }
    if (!claimIsabelaAutoVoiceSessionSpeak()) return;
    autoSpeakStartedRef.current = true;
    // Defer one tick so the first post-load briefing text is committed.
    const timer = window.setTimeout(() => {
      startSpeak("auto", false);
    }, 0);
    return () => window.clearTimeout(timer);
    // Intentionally once when listings finish loading — not on briefing/HK/language refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auto-speak once per Overview session
  }, [listingsLoading]);

  const stopBriefing = () => {
    playGenRef.current += 1;
    briefingActiveRef.current = false;
    pendingTextRef.current = null;
    stopHumanVoice(audioRef);
    setPlayback("idle");
    setHint(language === "es" ? "Briefing detenido" : "Briefing stopped");
  };

  const onBriefingButton = () => {
    if (briefingActiveRef.current || playback === "loading" || playback === "playing") {
      stopBriefing();
      return;
    }
    const replayBlocked = playback === "blocked";
    startSpeak("manual", replayBlocked);
  };

  const onEnableIsabelaVoice = () => {
    writeIsabelaAutoVoicePreference("enabled");
    setShowEnableVoice(false);
    claimIsabelaAutoVoiceSessionSpeak();
    autoSpeakStartedRef.current = true;
    if (briefingActiveRef.current || playback === "loading" || playback === "playing") return;
    unlockAudio();
    startSpeak("manual", false);
  };

  const pressOnce = (target: EventTarget | null, handler: () => void) => {
    const node = target instanceof HTMLElement ? target : null;
    const now = Date.now();
    const prev = node ? Number(node.dataset.pressAt ?? 0) : 0;
    if (now - prev < 400) return;
    if (node) node.dataset.pressAt = String(now);
    handler();
  };

  const onBriefingPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      event.stopPropagation();
      pressOnce(event.currentTarget, onBriefingButton);
    }
  };

  const onBriefingClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    pressOnce(event.currentTarget, onBriefingButton);
  };

  const briefingBusy = playback === "loading" || playback === "playing";
  const buttonLabel = briefingBusy
    ? language === "es"
      ? "Detener"
      : "Stop"
    : playback === "blocked" && !showEnableVoice
      ? language === "es"
        ? "Toca otra vez"
        : "Tap again"
      : language === "es"
        ? "Escuchar"
        : "Hear briefing";

  return (
    <div className="relative rounded-2xl border border-sky-200 bg-gradient-to-r from-sky-50 via-white to-white px-4 py-3 shadow-sm sm:px-5">
      <audio
        ref={attachAudio}
        playsInline
        preload="auto"
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ElenaAvatar size={40} />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-800">
              Isabela · Smart Login Briefing
            </p>
            <h2 className="text-base font-bold text-slate-900 sm:text-lg">{briefing.greeting.replace(/\.$/, "")}</h2>
            <p className="mt-0.5 text-sm leading-snug text-slate-700">{briefing.sentence}</p>
            {engineLabel ? <p className="mt-1 text-[10px] text-slate-500">Engine {engineLabel}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {showEnableVoice ? (
            <button
              type="button"
              className={`${guestPressClass} inline-flex items-center gap-2 rounded-full border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100`}
              onClick={onEnableIsabelaVoice}
            >
              {language === "es" ? "Activar voz de Isabela" : "Enable Isabela Voice"}
            </button>
          ) : null}
          <button
            type="button"
            onPointerDown={() => {
              unlockAudio();
            }}
            className={`${guestPressClass} inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-950 hover:bg-sky-50`}
            onPointerUp={onBriefingPointerUp}
            onClick={onBriefingClick}
          >
            <Volume2 className="h-4 w-4" />
            {buttonLabel}
          </button>
        </div>
      </div>
      {hint ? (
        <p
          className={`mt-2 text-xs font-medium ${
            playback === "error"
              ? "text-rose-800"
              : hint === "Briefing stopped" || hint === "Briefing detenido"
                ? "text-slate-700"
                : "text-amber-800"
          }`}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
