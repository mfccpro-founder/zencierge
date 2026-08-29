"use client";

import { useEffect, useRef, useState, type ElementType } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Key,
  ListChecks,
  PhoneCall,
  Power,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

const DISMISS_KEY = "zencierge.conciergeTour.dismissed";
const SESSION_KEY = "zencierge.conciergeTour.session";

type ConciergeModule = {
  step: number;
  route: string;
  badge: string;
  title: string;
  icon: ElementType;
  fullScript: string;
  checklist: string[];
};

const MASTER_CONCIERGE_MODULES: ConciergeModule[] = [
  {
    step: 1,
    route: "/dashboard/properties",
    badge: "Hardware Sync",
    title: "Autonomous Perimeter & Smart Access",
    icon: Key,
    fullScript:
      "Let us establish your automated perimeter. Zencierge connects with Yale, Schlage, and August smart locks to generate unique, time-expiring codes for every guest booking window. This prevents unauthorized early check-ins and auto-revokes codes immediately upon departure.",
    checklist: [
      "Sync lock codes with Airbnb window",
      "Enforce anti-early check-in security",
      "Automated code revocation",
    ],
  },
  {
    step: 2,
    route: "/dashboard/voice-agent",
    badge: "AI Telephony",
    title: "24/7 Voice Concierge & Nightline",
    icon: PhoneCall,
    fullScript:
      "We assign a dedicated local phone number to your listing. When guests call at 2:00 AM about Wi-Fi passwords, parking rules, or AC overrides, our AI bilingually trained voice engine resolves the issue under 5 seconds, only escalating genuine emergencies to you.",
    checklist: [
      "Dedicated local 24/7 inbound number",
      "Bilingual (EN/ES) troubleshooting",
      "Emergency human escalation rules",
    ],
  },
  {
    step: 3,
    route: "/dashboard/housekeeping",
    badge: "Quality Control",
    title: "AI Cleaner Photo Inspection",
    icon: Camera,
    fullScript:
      "Eliminate WhatsApp turnover chaos. Your cleaners receive a friction-free mobile web link. Our Computer Vision AI audits cleanliness across 12 mandatory room angles, detects missing consumable levels, and releases their payout only when verified.",
    checklist: [
      "App-free mobile link for cleaning staff",
      "AI visual audit for stains and hair",
      "Auto-escrow payout release",
    ],
  },
  {
    step: 4,
    route: "/dashboard/dispute-dossier",
    badge: "Asset Protection",
    title: "AirCover Dispute Vault & Evidence PDF",
    icon: ShieldAlert,
    fullScript:
      "Never lose another false refund claim. Every turnover photo is cryptographically stamped with UTC time and GPS location. If a guest damages something, 1-click generates a certified PDF evidence binder ready for Airbnb support.",
    checklist: [
      "Immutable UTC/GPS photo stamping",
      "Certified PDF evidence binder engine",
      "Instant damage claim proof",
    ],
  },
  {
    step: 5,
    route: "/dashboard/financials",
    badge: "Profit Engine",
    title: "True-Net NOI Ledger",
    icon: TrendingUp,
    fullScript:
      "Legacy PMS tools mislead you with gross revenue. Zencierge automatically syncs dynamic utility costs, cleaner escrow payouts, and supply restocks against booking income, giving you your true Net Operating Income per listing.",
    checklist: [
      "Real-time deduction of utilities & fees",
      "True Net Profit clarity per booking",
      "Smart expense sentinel alerts",
    ],
  },
];

function pickEnglishVoice(voices: SpeechSynthesisVoice[]) {
  return (
    voices.find(
      (voice) =>
        voice.lang.toLowerCase().includes("en") &&
        /samantha|google|natural|us|neural|aria/i.test(voice.name),
    ) ||
    voices.find((voice) => voice.lang === "en-US") ||
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ||
    null
  );
}

const shell =
  "relative z-10 w-full max-w-full overflow-hidden rounded-xl border border-sky-400/40 bg-slate-950 text-white shadow-lg";

export function InteractiveConciergeTour() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [ready, setReady] = useState(false);
  const mutedRef = useRef(false);
  const voicesListenerBound = useRef(false);
  const router = useRouter();
  const pathname = usePathname() || "/dashboard";

  const currentModule = MASTER_CONCIERGE_MODULES[currentStepIndex] ?? MASTER_CONCIERGE_MODULES[0];
  const StepIcon = currentModule.icon;

  useEffect(() => {
    if (window.localStorage.getItem(DISMISS_KEY) === "1") {
      setIsOpen(false);
      setReady(true);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { hasStarted?: boolean; currentStepIndex?: number };
        if (saved.hasStarted) setHasStarted(true);
        if (typeof saved.currentStepIndex === "number") setCurrentStepIndex(saved.currentStepIndex);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!isOpen) {
      window.sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ hasStarted, currentStepIndex }));
  }, [ready, isOpen, hasStarted, currentStepIndex]);

  mutedRef.current = isMuted;

  const speakText = (text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (mutedRef.current || !text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    const englishVoice = pickEnglishVoice(window.speechSynthesis.getVoices());
    if (englishVoice) utterance.voice = englishVoice;
    window.speechSynthesis.speak(utterance);
  };

  const initSpeechSynthesis = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    window.speechSynthesis.cancel();
    if (!voicesListenerBound.current) {
      voicesListenerBound.current = true;
      window.speechSynthesis.addEventListener("voiceschanged", () => {
        window.speechSynthesis.getVoices();
      });
    }
  };

  const navigateToStep = (index: number) => {
    const next = MASTER_CONCIERGE_MODULES[index];
    if (!next) return;
    setCurrentStepIndex(index);
    router.push(next.route);
    speakText(next.fullScript);
  };

  const startMasterclass = () => {
    window.localStorage.removeItem(DISMISS_KEY);
    setIsMuted(false);
    mutedRef.current = false;
    initSpeechSynthesis();
    setHasStarted(true);
    setIsOpen(true);
    router.push(MASTER_CONCIERGE_MODULES[0].route);
    speakText(MASTER_CONCIERGE_MODULES[0].fullScript);
  };

  const handleNext = () => {
    if (currentStepIndex < MASTER_CONCIERGE_MODULES.length - 1) {
      navigateToStep(currentStepIndex + 1);
      return;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsOpen(false);
    window.localStorage.setItem(DISMISS_KEY, "1");
  };

  const toggleMute = () => {
    if (!isMuted) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      mutedRef.current = true;
      setIsMuted(true);
      return;
    }
    mutedRef.current = false;
    setIsMuted(false);
    speakText(currentModule.fullScript);
  };

  const close = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsOpen(false);
    setHasStarted(false);
    window.localStorage.setItem(DISMISS_KEY, "1");
  };

  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  if (!pathname.startsWith("/dashboard")) return null;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setHasStarted(false);
          setIsOpen(true);
          window.localStorage.removeItem(DISMISS_KEY);
        }}
        className="fixed bottom-4 right-4 z-20 inline-flex items-center gap-2 rounded-xl border border-sky-400/40 bg-slate-950 px-3 py-2 text-xs font-bold text-white shadow-lg"
      >
        <Sparkles className="h-3.5 w-3.5 text-sky-400" />
        Hospitality masterclass
      </button>
    );
  }

  if (!hasStarted) {
    return (
      <aside aria-label="Hospitality Masterclass" className={shell}>
        <div className="flex max-w-full items-start gap-3 px-3 py-2.5">
          <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold leading-tight">Welcome to Zencierge OS</h3>
            <p className="mt-0.5 text-[11px] leading-snug text-slate-300">
              Hospitality Masterclass — five short modules with optional voice guidance.
            </p>
          </div>
          <button
            type="button"
            onClick={startMasterclass}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-sky-400 px-3 py-1.5 text-[11px] font-black text-slate-950 hover:bg-sky-300"
          >
            <Power className="h-3.5 w-3.5" /> Start
          </button>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Dismiss masterclass"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside aria-label="Interactive Concierge Masterclass" className={shell}>
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-black tracking-tight text-white">
            zen<span className="text-sky-400">cierge</span>
            <span className="ml-2 text-[9px] font-bold uppercase text-slate-400">Hospitality Masterclass</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => setShowChecklist(!showChecklist)}
            className={`rounded-md p-1 ${showChecklist ? "bg-sky-500/20 text-sky-400" : "text-slate-400 hover:text-white"}`}
            title="Toggle checklist"
          >
            <ListChecks className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={toggleMute}
            className="rounded-md p-1 text-slate-400 hover:text-white"
            title={isMuted ? "Unmute audio" : "Mute audio"}
          >
            {isMuted ? <VolumeX className="h-4 w-4 text-rose-400" /> : <Volume2 className="h-4 w-4 text-emerald-400" />}
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
            aria-label="Dismiss masterclass"
            title="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 rounded border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-400">
            <StepIcon className="h-3 w-3" /> {currentModule.badge}
          </span>
          <span className="text-[10px] font-medium text-slate-400">
            Module {currentModule.step} of {MASTER_CONCIERGE_MODULES.length}
          </span>
        </div>
        <h4 className="text-xs font-bold text-white">{currentModule.title}</h4>
        <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-slate-300">{currentModule.fullScript}</p>
        {showChecklist ? (
          <div className="mt-2 space-y-1 border-t border-slate-800/80 pt-2">
            {currentModule.checklist.map((item) => (
              <div key={item} className="flex items-start gap-1.5 text-[10px] text-slate-300">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                <span>{item}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-3 py-2">
        <div className="flex items-center gap-1">
          {MASTER_CONCIERGE_MODULES.map((mod, i) => (
            <button
              key={mod.step}
              type="button"
              onClick={() => navigateToStep(i)}
              className={`h-1.5 rounded-full transition-all ${i === currentStepIndex ? "w-5 bg-sky-400" : "w-1.5 bg-slate-700"}`}
              title={`Module ${i + 1}`}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={handleNext}
          className="inline-flex items-center gap-1 rounded-lg bg-sky-400 px-2.5 py-1 text-[11px] font-extrabold text-slate-950 hover:bg-sky-300"
        >
          {currentStepIndex === MASTER_CONCIERGE_MODULES.length - 1 ? "Finish" : "Next"}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </aside>
  );
}

export default InteractiveConciergeTour;
