"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import type { ZenciergePlanId } from "@/lib/zencierge-plans";
import {
  Banknote,
  CalendarDays,
  Check,
  Headphones,
  Loader2,
  Phone,
  ShieldCheck,
} from "lucide-react";

const plans = [
  {
    id: "starter",
    name: "Starter",
    monthly: 29,
    blurb: "One US listing, bilingual voice line, iCal sync.",
    popular: false,
    features: [
      "1 property · Dedicated Local US Phone Line (Any Area Code)",
      "AI handbook (Wi-Fi, locks, parking)",
      "Airbnb + Vrbo Quick Connect",
      "Guest call transcripts",
    ],
  },
  {
    id: "pro",
    name: "Pro Superhost",
    monthly: 79,
    popular: true,
    blurb: "Up to 4 units, owner statements, overnight coverage.",
    features: [
      "Up to 4 US listings · Dedicated local lines",
      "24/7 routing + host emergency transfer",
      "Monthly owner payouts & 18% co-host math",
      "Live Voice Tester + Neural / HD TTS",
    ],
  },
  {
    id: "agency",
    name: "Co-Host Agency",
    monthly: 199,
    blurb: "Portfolio ops for co-hosts running multiple owners.",
    popular: false,
    features: [
      "Unlimited listings nationwide",
      "Multi-owner statements & export",
      "Priority SIP lines · team inbox",
      "White-label guest greeting",
    ],
  },
] as const;

const testimonials = [
  {
    quote:
      "Guests used to text me at 1 a.m. for the Collins Wi-Fi. Elena on the 305 line handles it before I unlock my phone.",
    name: "Camila Reyes",
    role: "Superhost · Miami Beach Loft",
  },
  {
    quote:
      "Quick Connect blocked a Vrbo overlap the same afternoon we went live. Brickell garage codes now go out on every inbound call.",
    name: "Andre Walsh",
    role: "Co-host · Brickell Modern Suite",
  },
];

export function LandingPage() {
  const [annual, setAnnual] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState<ZenciergePlanId | null>(null);

  const subscribeWithSquare = async (planId: ZenciergePlanId) => {
    if (isRedirecting) return;
    setIsRedirecting(planId);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          billing: annual ? "annual" : "monthly",
        }),
      });
      const data = (await response.json()) as { url?: string; error?: string };
      const checkoutUrl = data.url?.trim() ?? "";
      if (
        !response.ok ||
        !/^https?:\/\//i.test(checkoutUrl) ||
        checkoutUrl.includes("/dashboard")
      ) {
        throw new Error(data.error ?? "Could not start Square checkout");
      }
      window.location.href = checkoutUrl;
    } catch (cause) {
      setIsRedirecting(null);
      window.alert(cause instanceof Error ? cause.message : "Checkout failed");
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/20 text-sm font-bold text-emerald-400">
              Z
            </span>
            <span className="text-sm font-semibold tracking-tight">Zencierge</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-slate-400 sm:flex">
            <a href="#product" className="hover:text-white">
              Product
            </a>
            <a href="#pricing" className="hover:text-white">
              Pricing
            </a>
            <Link href="/login" className="hover:text-white">
              Dashboard
            </Link>
          </nav>
          <Link
            href="/login"
            className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400"
          >
            Iniciar sesión
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-400">
          Host OS · Nationwide
        </p>
        <h1 className="mx-auto mt-4 max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl sm:leading-tight">
          24/7 AI Voice Receptionist for Airbnb &amp; Vrbo Hosts Across the US
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-400">
          A bilingual concierge answers on your dedicated local US line (any area code), reads the
          unit handbook, and keeps Airbnb and Vrbo blocked so you never double-book a night.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Badge>Zero Double-Bookings</Badge>
          <Badge>Dedicated Local US Numbers</Badge>
          <Badge>Bilingual EN/ES</Badge>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#pricing"
            className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400"
          >
            Start Free Trial
          </a>
          <Link
            href="/login"
            className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Iniciar sesión
          </Link>
        </div>
      </section>

      <section id="product" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-4 md:grid-cols-3">
          <ValueCard
            icon={<Headphones className="h-5 w-5 text-emerald-400" />}
            title="Voice Concierge"
            body="Resolves Wi-Fi, parking, and lock codes in seconds — in English or Spanish — then escalates leaks and lockouts to you."
          />
          <ValueCard
            icon={<CalendarDays className="h-5 w-5 text-sky-400" />}
            title="Smart Calendar Sync"
            body="One-click Quick Connect for Airbnb and Vrbo iCal. Auto-detect, test the feed, stay live with zero overlapping nights."
          />
          <ValueCard
            icon={<Banknote className="h-5 w-5 text-amber-400" />}
            title="Co-Host Financials"
            body="Automatic owner statements: 18% admin fee, cleaning, net payouts, and export for listings in any US state."
          />
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 pb-20">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-bold text-white">Simple pricing for hosts nationwide</h2>
          <div className="flex items-center gap-3 rounded-full border border-slate-800 bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => setAnnual(false)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                !annual ? "bg-emerald-500 text-slate-950" : "text-slate-400"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setAnnual(true)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold ${
                annual ? "bg-emerald-500 text-slate-950" : "text-slate-400"
              }`}
            >
              Annual
              <span className="ml-1 text-[10px] font-medium opacity-80">2 months free</span>
            </button>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((plan) => {
            const price = annual ? Math.round((plan.monthly * 10) / 12) : plan.monthly;
            return (
              <article
                key={plan.id}
                className={`flex flex-col rounded-2xl border p-6 ${
                  plan.popular
                    ? "border-emerald-500/40 bg-emerald-500/10 shadow-lg shadow-emerald-500/10"
                    : "border-slate-800 bg-slate-900/50"
                }`}
              >
                {plan.popular ? (
                  <span className="mb-3 w-fit rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-950">
                    Most Popular
                  </span>
                ) : (
                  <span className="mb-3 h-5" />
                )}
                <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
                <p className="mt-1 text-xs text-slate-400">{plan.blurb}</p>
                <p className="mt-4 text-3xl font-extrabold text-white">
                  ${price}
                  <span className="text-sm font-medium text-slate-500">/mo</span>
                </p>
                {annual ? (
                  <p className="text-[11px] text-slate-500">Billed ${plan.monthly * 10}/year</p>
                ) : (
                  <p className="text-[11px] text-slate-500">Billed monthly</p>
                )}
                <ul className="mt-5 flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-xs text-slate-300">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={isRedirecting !== null}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void subscribeWithSquare(plan.id);
                  }}
                  className={`mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-center text-xs font-bold disabled:cursor-wait disabled:opacity-70 ${
                    plan.popular
                      ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                      : "border border-slate-700 text-slate-200 hover:bg-slate-800"
                  }`}
                >
                  {isRedirecting === plan.id ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                      Cargando Square...
                    </>
                  ) : (
                    "Subscribe with Square"
                  )}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <h2 className="mb-6 text-center text-2xl font-bold text-white">Hosts already on the line</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {testimonials.map((item) => (
            <blockquote
              key={item.name}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6"
            >
              <p className="text-sm leading-relaxed text-slate-300">&ldquo;{item.quote}&rdquo;</p>
              <footer className="mt-4">
                <p className="text-sm font-semibold text-white">{item.name}</p>
                <p className="text-xs text-slate-500">{item.role}</p>
              </footer>
            </blockquote>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="rounded-3xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/10 to-slate-900 px-8 py-12 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15">
            <Phone className="h-4 w-4 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold text-white">Put a nationwide receptionist on every listing</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
            Open the live Host Command Center — your US listings, a dedicated local line, and the
            calendar already synced.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-emerald-400"
          >
            <ShieldCheck className="h-4 w-4" />
            Enter the dashboard
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800/80">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">Zencierge · AI host OS for US short-term rentals</p>
          <nav className="flex flex-wrap gap-4 text-xs text-slate-400">
            <a href="#product" className="hover:text-white">
              Product
            </a>
            <a href="#pricing" className="hover:text-white">
              Pricing
            </a>
            <Link href="/login" className="hover:text-white">
              Dashboard
            </Link>
            <Link href="/signup" className="hover:text-white">
              Crear cuenta
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-[11px] font-medium text-slate-300">
      {children}
    </span>
  );
}

function ValueCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 text-left">
      <div className="mb-3">{icon}</div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">{body}</p>
    </article>
  );
}
