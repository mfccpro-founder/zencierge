"use client";

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import {
  ChevronUp,
  Headphones,
  Pause,
  Play,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";

type GuideLang = "en" | "es";

type Chapter = {
  at: number;
  title: { en: string; es: string };
  caption: { en: string; es: string };
};

const STORAGE_KEY = "zencierge.hideAvatarGuide";
const DURATION = 70;

const CHAPTERS: Chapter[] = [
  {
    at: 0,
    title: {
      en: "Florida Phone Number Setup",
      es: "Configuración del número de Florida",
    },
    caption: {
      en: "Assign a +1 305 or +1 954 virtual line so guests in South Florida always reach Zencierge first.",
      es: "Asigna una línea virtual +1 305 o +1 954 para que los huéspedes en el sur de Florida lleguen primero a Zencierge.",
    },
  },
  {
    at: 20,
    title: {
      en: "AI House Rules & Wi-Fi Knowledge Base",
      es: "Reglas de la casa e IA de Wi-Fi",
    },
    caption: {
      en: "Load door codes, Wi-Fi, parking, and handbooks so the voice agent answers from your real property data.",
      es: "Carga códigos, Wi-Fi, estacionamiento y handbooks para que la voz responda con los datos reales de tus unidades.",
    },
  },
  {
    at: 32,
    title: {
      en: "Calendar Sync · Airbnb & Vrbo iCal",
      es: "Sincronización de calendarios · iCal Airbnb y Vrbo",
    },
    caption: {
      en: "One-click Quick Connect, or paste each listing’s iCal link. We test the feed and keep both calendars blocked — zero double-bookings.",
      es: "Conecta en un clic o pega el iCal de cada anuncio. Probamos el feed y bloqueamos ambos calendarios: cero dobles reservas.",
    },
  },
  {
    at: 45,
    title: {
      en: "24/7 Guest Call Routing & Emergency Escalation",
      es: "Enrutamiento 24/7 y escalamiento de emergencias",
    },
    caption: {
      en: "Night coverage stays on. Leaks and lockouts transfer instantly to your host emergency number.",
      es: "La cobertura nocturna sigue activa. Fugas y cierres se transfieren al instante a tu número de emergencia.",
    },
  },
];

const copy = {
  en: {
    tooltip: "👋 See how Zencierge works (1 min demo)",
    badge: "AI Guide",
    title: "Meet your AI Concierge Guide",
    play: "Play demo",
    pause: "Pause",
    setup: "Start Setup Wizard",
    testCall: "Test Voice Call",
    dontShow: "Don't show again on login",
    close: "Close",
    open: "Open demo",
    chapter: "Jump to topic",
  },
  es: {
    tooltip: "👋 Mira cómo funciona Zencierge (demo 1 min)",
    badge: "Guía IA",
    title: "Conoce a tu guía Concierge IA",
    play: "Reproducir demo",
    pause: "Pausa",
    setup: "Iniciar asistente de alta",
    testCall: "Probar llamada de voz",
    dontShow: "No volver a mostrar al entrar",
    close: "Cerrar",
    open: "Abrir demo",
    chapter: "Saltar al tema",
  },
};

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.min(DURATION, Math.floor(seconds)));
  const mm = Math.floor(safe / 60);
  const ss = String(safe % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function chapterForTime(time: number): Chapter {
  let current: Chapter = CHAPTERS[0]!;
  for (const chapter of CHAPTERS) {
    if (time >= chapter.at) current = chapter;
  }
  return current;
}

export const CALENDAR_SYNC_AT = 32;

export type AiAvatarGuideHandle = {
  openCalendarSync: () => void;
};

type AiAvatarGuideProps = {
  onTestVoiceCall: () => void;
  onStartSetup: () => void;
};

export const AiAvatarGuide = forwardRef<AiAvatarGuideHandle, AiAvatarGuideProps>(
  function AiAvatarGuide({ onTestVoiceCall, onStartSetup }, ref) {
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [lang, setLang] = useState<GuideLang>("en");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dontShow, setDontShow] = useState(false);

  const playingRef = useRef(false);
  const timeRef = useRef(0);

  const labels = copy[lang];
  const activeChapter = useMemo(() => chapterForTime(time), [time]);
  const progress = (time / DURATION) * 100;

  useEffect(() => {
    setHidden(window.localStorage.getItem(STORAGE_KEY) === "1");
    setMounted(true);
  }, []);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    timeRef.current = time;
  }, [time]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = timeRef.current + 0.25;
      if (next >= DURATION) {
        timeRef.current = DURATION;
        setTime(DURATION);
        setPlaying(false);
        return;
      }
      timeRef.current = next;
      setTime(next);
    }, 250);
    return () => window.clearInterval(id);
  }, [playing]);

  useImperativeHandle(ref, () => ({
    openCalendarSync: () => {
      setHidden(false);
      setExpanded(true);
      timeRef.current = CALENDAR_SYNC_AT;
      setTime(CALENDAR_SYNC_AT);
      setPlaying(true);
    },
  }));

  if (!mounted) return null;
  if (hidden && !expanded) return null;

  const persistHide = () => {
    if (dontShow) window.localStorage.setItem(STORAGE_KEY, "1");
    setExpanded(false);
    setPlaying(false);
    if (dontShow) setHidden(true);
  };

  const seekTo = (seconds: number) => {
    timeRef.current = seconds;
    setTime(seconds);
    setPlaying(true);
  };

  const togglePlay = () => {
    if (time >= DURATION) {
      timeRef.current = 0;
      setTime(0);
    }
    setPlaying((value) => !value);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {expanded ? (
        <div
          className="pointer-events-auto w-[min(100vw-2rem,400px)] rounded-2xl border border-slate-800/90 bg-slate-950/95 shadow-2xl shadow-emerald-500/10 backdrop-blur-xl overflow-hidden view-enter"
          role="dialog"
          aria-labelledby="ai-guide-title"
        >
          <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-800">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">
                1 min demo
              </p>
              <h3 id="ai-guide-title" className="text-sm font-semibold text-white mt-0.5">
                {labels.title}
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
                {(["en", "es"] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setLang(code)}
                    className={`px-2 py-1 text-[10px] font-semibold rounded-md ${
                      lang === code
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {code === "en" ? "English" : "Español"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={persistHide}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label={labels.close}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="px-4 pt-4">
            <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 aspect-video">
              <AvatarStage speaking={playing} />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/90 to-transparent p-3">
                <p className="text-[11px] text-slate-200 leading-relaxed">
                  {activeChapter.caption[lang]}
                </p>
              </div>
              <button
                type="button"
                onClick={togglePlay}
                className="absolute inset-0 m-auto h-12 w-12 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
                aria-label={playing ? labels.pause : labels.play}
              >
                {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-[10px] font-mono text-slate-500 w-9">{formatTime(time)}</span>
              <input
                type="range"
                min={0}
                max={DURATION}
                step={0.25}
                value={time}
                onChange={(event) => seekTo(Number(event.target.value))}
                className="flex-1 accent-emerald-400"
                aria-label="Demo timeline"
              />
              <span className="text-[10px] font-mono text-slate-500 w-9 text-right">
                {formatTime(DURATION)}
              </span>
            </div>
            <div className="h-1 rounded-full bg-slate-800 mt-1 overflow-hidden">
              <div
                className="h-full bg-emerald-400/80"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="px-4 py-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
              {labels.chapter}
            </p>
            {CHAPTERS.map((chapter) => {
              const active = activeChapter.at === chapter.at;
              return (
                <button
                  key={chapter.at}
                  type="button"
                  onClick={() => seekTo(chapter.at)}
                  className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                    active
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-slate-800 bg-slate-900/40 hover:border-slate-700"
                  }`}
                >
                  <span className="text-[10px] font-mono text-emerald-400">
                    {formatTime(chapter.at)}
                  </span>
                  <span className="ml-2 text-xs text-slate-200">{chapter.title[lang]}</span>
                </button>
              );
            })}
          </div>

          <div className="px-4 pb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                persistHide();
                onStartSetup();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-2.5 text-[11px] font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {labels.setup}
            </button>
            <button
              type="button"
              onClick={() => {
                setExpanded(false);
                setPlaying(false);
                onTestVoiceCall();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
            >
              <Headphones className="h-3.5 w-3.5" />
              {labels.testCall}
            </button>
          </div>

          <label className="flex items-center gap-2 px-4 pb-4 text-[11px] text-slate-500 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(event) => setDontShow(event.target.checked)}
              className="accent-emerald-500"
            />
            {labels.dontShow}
          </label>
        </div>
      ) : null}

      <div className="pointer-events-auto group relative">
        <div className="absolute bottom-full right-0 mb-3 hidden group-hover:block w-56">
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-xl">
            {labels.tooltip}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="relative flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/40 bg-slate-950 shadow-lg shadow-emerald-500/20 avatar-breathe"
          aria-label={expanded ? labels.close : labels.open}
          aria-expanded={expanded}
        >
          <MiniAvatar speaking={playing && expanded} />
          <span className="absolute -top-1 -right-1 flex items-center gap-1 rounded-full border border-emerald-500/30 bg-slate-950 px-1.5 py-0.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[8px] font-bold uppercase tracking-wide text-emerald-300">
              {labels.badge}
            </span>
          </span>
          <span className="absolute -bottom-1 -left-1 rounded-full bg-slate-800 border border-slate-700 p-0.5 text-slate-300">
            {expanded ? <X className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          </span>
        </button>
      </div>
    </div>
  );
});

function MiniAvatar({ speaking }: { speaking: boolean }) {
  return (
    <div className="relative h-12 w-12 rounded-full bg-gradient-to-br from-emerald-400/30 via-sky-500/20 to-violet-500/30 flex items-center justify-center overflow-hidden">
      <Sparkles className="h-5 w-5 text-emerald-300" />
      {speaking ? (
        <div className="absolute bottom-1.5 flex items-end gap-0.5 h-3">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              key={index}
              className="avatar-speak-bar w-0.5 h-3 rounded-full bg-emerald-300"
              style={{ animationDelay: `${index * 0.07}s` }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AvatarStage({ speaking }: { speaking: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center">
      <div
        className={`h-24 w-24 rounded-full bg-gradient-to-br from-emerald-400/40 via-slate-800 to-sky-500/30 border border-emerald-400/30 flex items-center justify-center ${speaking ? "avatar-breathe" : ""}`}
      >
        <div className="h-16 w-16 rounded-full bg-slate-900/80 flex items-center justify-center text-emerald-300">
          <Sparkles className="h-7 w-7" />
        </div>
      </div>
      <p className="mt-3 text-[11px] font-medium text-slate-300">Elena · Miami Hostess</p>
      <div className="mt-2 flex items-end gap-1 h-6">
        {Array.from({ length: 7 }, (_, index) => (
          <span
            key={index}
            className={`w-1 rounded-full bg-emerald-400/80 ${speaking ? "voice-bar" : "h-2 opacity-40"}`}
            style={{ animationDelay: `${index * 0.08}s`, height: speaking ? undefined : 8 }}
          />
        ))}
      </div>
    </div>
  );
}
