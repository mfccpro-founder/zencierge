"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CreditCard,
  Landmark,
  Play,
  Square,
  TrendingDown,
  Wallet,
  CalendarClock,
} from "lucide-react";
import { getDemoFinancePayload } from "@/lib/finance-demo";
import type {
  AlertLevel,
  CreditUtilizationCard,
  DailyBriefing,
  FinanceOverviewResponse,
  FinancialOverview,
  UpcomingDueItem,
} from "@/lib/finance-types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function money(value: number) {
  return usd.format(value);
}

function badgeStyles(level: AlertLevel) {
  if (level === "OK") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (level === "WARNING") return "bg-amber-500/15 text-amber-300 border-amber-500/40";
  return "bg-rose-500/15 text-rose-300 border-rose-500/40";
}

function utilBarColor(percent: number, alert = false) {
  if (alert || percent > 30) return percent >= 50 ? "bg-rose-500" : "bg-orange-500";
  return "bg-emerald-500";
}

async function speakBriefing(text: string, audio: HTMLAudioElement) {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, 4000), language: "es", voice: "nova", speed: 0.98 }),
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audio.src = url;
      await audio.play();
      return;
    }
  } catch {
    /* browser TTS fallback */
  }
  window.speechSynthesis.cancel();
  await new Promise<void>((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-US";
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    window.speechSynthesis.speak(utter);
  });
}

export function CentroFinanceDashboard() {
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [overview, setOverview] = useState<FinancialOverview | null>(null);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [listening, setListening] = useState(false);
  const [paidIds, setPaidIds] = useState<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onEnd = () => setListening(false);
    audio.addEventListener("ended", onEnd);
    return () => {
      audio.removeEventListener("ended", onEnd);
      audio.pause();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const userId = process.env.NEXT_PUBLIC_FINANCE_USER_ID?.trim();
        const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
        const res = await fetch(`/api/finance/overview${qs}`);
        if (res.ok) {
          const data = (await res.json()) as FinanceOverviewResponse;
          if (!cancelled) {
            setOverview(data.overview);
            setBriefing(data.briefing);
            setDemo(Boolean(data.demo));
            setLoading(false);
          }
          return;
        }
      } catch {
        /* fall through to demo */
      }
      const sample = getDemoFinancePayload();
      if (!cancelled) {
        setOverview(sample.overview);
        setBriefing(sample.briefing);
        setDemo(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const stopVoice = useCallback(() => {
    audioRef.current?.pause();
    window.speechSynthesis.cancel();
    setListening(false);
  }, []);

  const playBriefing = async () => {
    if (!briefing) return;
    if (listening) {
      stopVoice();
      return;
    }
    setListening(true);
    const audio = audioRef.current;
    if (!audio) {
      setListening(false);
      return;
    }
    try {
      await speakBriefing(briefing.summaryText, audio);
    } catch {
      /* ignore */
    } finally {
      if (audio.paused) setListening(false);
    }
  };

  const markPaid = async (item: UpcomingDueItem) => {
    setPaidIds((ids) => [...ids, item.id]);
    if (demo) return;
    try {
      await fetch("/api/finance/paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, kind: item.kind }),
      });
    } catch {
      /* keep optimistic UI */
    }
  };

  if (loading || !overview || !briefing) {
    return <DashboardSkeleton />;
  }

  const dues = overview.upcomingDue.filter((item) => !paidIds.includes(item.id));
  const util = overview.overallCreditUtilizationPercent;

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-400">
              Mi Centro Financiero
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{briefing.greeting.replace(/\.$/, "")} 👋</h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Daily money command center</p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${badgeStyles(briefing.alertLevel)}`}
          >
            {briefing.alertLevel === "CRITICAL" ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
            {briefing.alertLevel}
          </span>
        </header>

        {demo ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
            Showing sample household data. Connect Postgres and set NEXT_PUBLIC_FINANCE_USER_ID to load your accounts.
          </p>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Hero briefing</p>
              <h2 className="mt-1 text-lg font-semibold">Daily Briefing</h2>
            </div>
            <button
              type="button"
              onClick={() => void playBriefing()}
              className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
            >
              {listening ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {listening ? "Detener" : "▶ Escuchar Resumen Diario"}
            </button>
          </div>
          <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">{briefing.summaryText}</p>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            icon={<Wallet className="h-4 w-4" />}
            label="Dinero Disponible / Líquido Total"
            hint="Checking + Savings"
            value={money(overview.liquidNetWorth)}
          />
          <KpiCard
            icon={<TrendingDown className="h-4 w-4" />}
            label="Deuda Total"
            hint="Tarjetas + Préstamos"
            value={money(overview.totalDebt)}
          />
          <KpiCard
            icon={<Landmark className="h-4 w-4" />}
            label="Flujo de Caja Restante del Mes"
            hint="Líquido − gastos pendientes"
            value={money(overview.availableCashFlow)}
            warn={overview.availableCashFlow < 0}
          />
          <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <CreditCard className="h-4 w-4" />
              <p className="text-[11px] font-semibold uppercase tracking-wide">Utilización General de Crédito</p>
            </div>
            <p className="mt-3 text-2xl font-bold tabular-nums">
              {util == null ? "—" : `${util.toFixed(1)}%`}
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${utilBarColor(util ?? 0)}`}
                style={{ width: `${Math.min(100, util ?? 0)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Target under 30%</p>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <h3 className="text-sm font-semibold">Tarjetas de Crédito & Salud de Deuda</h3>
            <p className="mt-1 text-xs text-slate-500">Utilization above 30% is highlighted</p>
            <ul className="mt-4 space-y-3">
              {overview.cardUtilizations.map((card) => (
                <CardRow key={card.accountId} card={card} />
              ))}
            </ul>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-emerald-500" />
              <h3 className="text-sm font-semibold">Próximos Vencimientos · 7 días</h3>
            </div>
            {dues.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">No pending dues in the next week.</p>
            ) : (
              <ul className="mt-4 space-y-2.5">
                {dues.map((item) => (
                  <li
                    key={`${item.kind}-${item.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-800 dark:bg-slate-950/80"
                  >
                    <div>
                      <p className="text-sm font-semibold">{item.title}</p>
                      <p className="text-[11px] text-slate-500">
                        {item.kind === "credit_card" ? "Card due date" : "Recurring bill"} · {item.dueDate} · in {item.daysUntil}d
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold tabular-nums">
                        {item.amount == null ? "—" : money(item.amount)}
                      </p>
                      <button
                        type="button"
                        onClick={() => void markPaid(item)}
                        className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Marcar como pagado
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  hint,
  value,
  warn,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon}
        <p className="text-[11px] font-semibold uppercase tracking-wide leading-tight">{label}</p>
      </div>
      <p className={`mt-3 text-2xl font-bold tabular-nums ${warn ? "text-rose-500" : ""}`}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}

function CardRow({ card }: { card: CreditUtilizationCard }) {
  return (
    <li
      className={`rounded-2xl border px-3 py-3 ${
        card.overThirtyPercent
          ? "border-orange-500/50 bg-orange-500/10 dark:border-rose-500/40 dark:bg-rose-950/30"
          : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{card.name}</p>
          <p className="text-[11px] text-slate-500">
            {money(card.balance)} of {money(card.creditLimit)}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
            card.overThirtyPercent ? "bg-orange-500 text-slate-950" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
          }`}
        >
          {card.utilizationPercent.toFixed(1)}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={`h-full rounded-full ${utilBarColor(card.utilizationPercent, card.overThirtyPercent)}`}
          style={{ width: `${Math.min(100, card.utilizationPercent)}%` }}
        />
      </div>
      {card.overThirtyPercent ? (
        <p className="mt-1.5 text-[11px] font-medium text-orange-700 dark:text-rose-300">
          Over 30% utilization — this can pressure your credit score.
        </p>
      ) : null}
    </li>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-full bg-slate-50 p-6 dark:bg-slate-950">
      <div className="mx-auto max-w-6xl animate-pulse space-y-4">
        <div className="h-8 w-64 rounded-lg bg-slate-200 dark:bg-slate-800" />
        <div className="h-36 rounded-3xl bg-slate-200 dark:bg-slate-800" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="h-64 rounded-3xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-64 rounded-3xl bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    </div>
  );
}
