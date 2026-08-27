"use client";

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import {
  ChevronUp,
  Headphones,
  Link2,
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
const DURATION = 80;

const CHAPTERS: Chapter[] = [
  {
    at: 0,
    title: {
      en: "Welcome — host tutorial",
      es: "Bienvenida — tutorial del anfitrión",
    },
    caption: {
      en: "Hi, I'm Elena. In under a minute I'll show you how to set up a property, test the voice simulator, and share the guest portal link.",
      es: "Hola, soy Elena. En un minuto te muestro cómo configurar una propiedad, probar el simulador de voz y compartir el enlace del Portal del Huésped.",
    },
  },
  {
    at: 14,
    title: {
      en: "Configure properties & the AI handbook",
      es: "Configura propiedades y el handbook de IA",
    },
    caption: {
      en: "Open Properties. Add Wi-Fi, door codes, check-in hours, and the AI handbook. That text is what I read when a guest asks a question.",
      es: "Abre Properties. Carga Wi-Fi, códigos, horarios de check-in y el handbook de IA. Ese texto es lo que leo cuando un huésped pregunta.",
    },
  },
  {
    at: 32,
    title: {
      en: "Test the voice simulator",
      es: "Prueba el simulador de voz",
    },
    caption: {
      en: "Go to Voice Concierge, pick the listing, and tap Hablar con el Avatar. Ask for Wi-Fi or the grocery store — I answer from that unit's handbook.",
      es: "Ve a Voice Concierge, elige el listing y pulsa Hablar con el Avatar. Pregunta el Wi-Fi o el súper: respondo con el handbook de esa unidad.",
    },
  },
  {
    at: 50,
    title: {
      en: "Share the Guest Portal link",
      es: "Comparte el Portal del Huésped",
    },
    caption: {
      en: "In Properties, tap Ver Portal del Huésped. It opens /guest/ plus the listing id — a public page with no host sidebar. Send that link to your Airbnb guests.",
      es: "En Properties, pulsa Ver Portal del Huésped. Abre /guest/ más el id del listing: una página pública, sin menú de host. Envía ese enlace a tus huéspedes de Airbnb.",
    },
  },
  {
    at: 66,
    title: {
      en: "Calendar Sync · Airbnb & Vrbo iCal",
      es: "Sincronización de calendarios · iCal Airbnb y Vrbo",
    },
    caption: {
      en: "One-click Quick Connect, or paste each listing’s iCal link. We test the feed and keep both calendars blocked — zero double-bookings.",
      es: "Conecta en un clic o pega el iCal de cada anuncio. Probamos el feed y bloqueamos ambos calendarios: cero dobles reservas.",
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
    guestLink: "Open Guest Portal setup",
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
    guestLink: "Configurar Portal del Huésped",
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

export const CALENDAR_SYNC_AT = 66;

export type AiAvatarGuideHandle = {
  openCalendarSync: () => void;
  openTutorial: () => void;
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
  const [modal, setModal] = useState(false);

  const playingRef = useRef(false);
  const timeRef = useRef(0);
  const speechGen = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const labels = copy[lang];
  const activeChapter = useMemo(() => chapterForTime(time), [time]);

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

  useImperativeHandle(ref, () => ({
    openCalendarSync: () => {
      setHidden(false);
      setExpanded(true);
      setModal(true);
      timeRef.current = CALENDAR_SYNC_AT;
      setTime(CALENDAR_SYNC_AT);
      setPlaying(false);
    },
    openTutorial: () => {
      setHidden(false);
      setExpanded(true);
      setModal(true);
      timeRef.current = 0;
      setTime(0);
      setPlaying(false);
    },
  }));

  if (!mounted) return null;
  if (hidden && !expanded) return null;

  const persistHide = () => {
    if (dontShow) window.localStorage.setItem(STORAGE_KEY, "1");
    setExpanded(false);
    setModal(false);
    setPlaying(false);
    speechGen.current += 1;
    videoRef.current?.pause();
    if (dontShow) setHidden(true);
  };

  const seekTo = (seconds: number) => {
    timeRef.current = seconds;
    setTime(seconds);
    const video = videoRef.current;
    if (video && Number.isFinite(seconds) && video.readyState >= 1) {
      video.currentTime = seconds;
    }
  };

  const panel = (
        <div
          className={`pointer-events-auto rounded-2xl border border-violet-400/20 bg-slate-950/95 shadow-2xl shadow-violet-500/10 backdrop-blur-xl view-enter ${
            modal ? "w-[min(100vw-1.5rem,640px)] max-h-[90vh] overflow-y-auto" : "w-[min(100vw-2rem,420px)] overflow-hidden"
          }`}
          role="dialog"
          aria-labelledby="ai-guide-title"
          aria-modal={modal}
        >
          <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-slate-800">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold">
                🎓 Video Guía / Tutorial
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
            <div className="relative w-full overflow-hidden rounded-2xl border border-violet-400/25 bg-slate-950 aspect-video shadow-[0_0_40px_rgb(139_92_246_/_0.16)]">
              <video
                ref={videoRef}
                src="/onboarding.mp4?v=1"
                autoPlay={false}
                controls
                playsInline
                preload="auto"
                className="w-full h-full rounded-xl object-contain bg-black"
                onTimeUpdate={(event) => {
                  const seconds = event.currentTarget.currentTime;
                  timeRef.current = seconds;
                  setTime(seconds);
                }}
              >
                <source src="/onboarding.mp4?v=1" type="video/mp4" />
              </video>
            </div>
            <p className="mt-3 text-[11px] text-slate-400 leading-relaxed">
              {activeChapter.caption[lang]}
            </p>
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
                setModal(false);
                setPlaying(false);
                onTestVoiceCall();
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
            >
              <Headphones className="h-3.5 w-3.5" />
              {labels.testCall}
            </button>
            <button
              type="button"
              onClick={() => {
                persistHide();
                onStartSetup();
              }}
              className="col-span-2 inline-flex items-center justify-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
            >
              <Link2 className="h-3.5 w-3.5" />
              {labels.guestLink}
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
  );

  if (modal && expanded) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <button
          type="button"
          className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
          aria-label={labels.close}
          onClick={persistHide}
        />
        <div className="relative z-10">{panel}</div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3 pointer-events-none">
      {expanded ? panel : null}

      <div className="pointer-events-auto group relative">
        <div className="absolute bottom-full right-0 mb-3 hidden group-hover:block w-56">
          <div className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 shadow-xl">
            {labels.tooltip}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setModal(false);
            setExpanded((value) => !value);
          }}
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
