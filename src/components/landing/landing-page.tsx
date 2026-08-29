"use client";

import Link from "next/link";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  PhoneCall,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { ZenciergeLogo } from "@/components/brand/zencierge-logo";
import { PricingCards } from "@/components/pricing/pricing-cards";

export function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-100 selection:bg-sky-500 selection:text-slate-950">
      <nav className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/70 backdrop-blur-md">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-3">
            <ZenciergeLogo className="h-12 w-auto" priority />
          </Link>

          <div className="hidden items-center gap-8 text-sm font-semibold text-slate-300 md:flex">
            <a href="#features" className="transition-colors hover:text-white">
              Why Zencierge
            </a>
            <a href="#comparison" className="transition-colors hover:text-white">
              Vs Traditional PMS
            </a>
            <a href="#pricing" className="transition-colors hover:text-white">
              Pricing & Free Trial
            </a>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-xs font-bold text-slate-300 transition-colors hover:text-white"
            >
              Host Login
            </Link>
            <a
              href="#pricing"
              className="rounded-lg bg-sky-400 px-5 py-2.5 text-xs font-extrabold text-slate-950 shadow-lg shadow-sky-400/20 transition-all hover:-translate-y-0.5 hover:bg-sky-300"
            >
              Start Free Trial
            </a>
          </div>
        </div>
      </nav>

      <section className="relative overflow-hidden border-b border-slate-800 px-6 pb-20 pt-24">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500/10 blur-[140px]" />

        <div className="relative z-10 mx-auto max-w-5xl text-center">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-sky-400">
            <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            Beyond Traditional PMS • The Autonomous Short-Term Rental OS
          </div>

          <h1 className="mb-6 text-4xl font-black leading-[1.1] tracking-tight text-white md:text-6xl lg:text-7xl">
            Replace your co-host. <br />
            <span className="bg-gradient-to-r from-sky-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">
              Put your STR on Autopilot.
            </span>
          </h1>

          <p className="mx-auto mb-10 max-w-3xl text-base leading-relaxed text-slate-400 md:text-xl">
            Zencierge is the only platform that answers 2 AM guest phone calls bilingually, audits turnovers using
            computer vision, and safeguards your AirCover claims with immutable photo proofs. Traditional PMS tools
            are just synchronized calendars; Zencierge is your autonomous co-host.
          </p>

          <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="#pricing"
              className="flex w-full transform items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-emerald-400 px-8 py-4 text-sm font-black text-slate-950 shadow-xl shadow-sky-500/25 transition-all hover:-translate-y-0.5 hover:from-sky-300 hover:to-emerald-300 sm:w-auto"
            >
              Choose Your Premium Plan <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#features"
              className="w-full rounded-xl border border-slate-800 bg-slate-900 px-8 py-4 text-sm font-bold text-slate-200 transition-colors hover:bg-slate-800 sm:w-auto"
            >
              See Unique Features
            </a>
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-8 text-xs font-medium text-slate-500">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> No Commission Fees (Ever)
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> 14-Day Free Trial
            </span>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Cancel Anytime in 1-Click
            </span>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 py-20">
        <div className="mx-auto mb-16 max-w-3xl text-center">
          <h2 className="mb-3 text-xs font-extrabold uppercase tracking-widest text-sky-400">
            Why Zencierge Is Different
          </h2>
          <p className="text-3xl font-black text-white md:text-4xl">Features no other company offers.</p>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-8 transition-all hover:border-sky-500/50">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-sky-500/20 bg-sky-500/10 text-sky-400">
              <PhoneCall className="h-6 w-6" />
            </div>
            <h3 className="mb-3 text-xl font-bold text-white">24/7 AI Voice Phone Reception</h3>
            <p className="mb-4 text-sm leading-relaxed text-slate-400">
              Stop answering 2 AM check-in calls. Zencierge provisions a dedicated local phone number that answers
              calls in English &amp; Spanish, verifies door codes, and troubleshoots Wi-Fi instantly.
            </p>
            <div className="inline-block rounded-lg bg-sky-500/10 px-3 py-1.5 text-xs font-bold text-sky-400">
              Zero-latency bilingual support
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-8 transition-all hover:border-emerald-500/50">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
              <Camera className="h-6 w-6" />
            </div>
            <h3 className="mb-3 text-xl font-bold text-white">AirCover Defense &amp; Vision AI</h3>
            <p className="mb-4 text-sm leading-relaxed text-slate-400">
              Cleaners upload photos through a friction-free mobile link. Our Computer Vision AI audits cleanliness,
              detects missing amenities, and timestamps proofs to win Airbnb damage disputes in 1 click.
            </p>
            <div className="inline-block rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-400">
              Certified PDF evidence binder
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/60 p-8 transition-all hover:border-indigo-500/50">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl border border-indigo-500/20 bg-indigo-500/10 text-indigo-400">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h3 className="mb-3 text-xl font-bold text-white">True-Net Financial Clarity</h3>
            <p className="mb-4 text-sm leading-relaxed text-slate-400">
              Traditional PMS mislead you with gross revenue. Zencierge deducts utility bills, cleaning contractor
              payouts, supplies, and platform commission in real-time so you know your true take-home profit.
            </p>
            <div className="inline-block rounded-lg bg-indigo-500/10 px-3 py-1.5 text-xs font-bold text-indigo-400">
              Real Net Operating Income per listing
            </div>
          </div>
        </div>
      </section>

      <section id="comparison" className="mx-auto max-w-5xl px-6 py-20">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <h2 className="mb-3 text-xs font-extrabold uppercase tracking-widest text-emerald-400">Head to Head</h2>
          <p className="text-3xl font-black text-white">The only truly autonomous solution</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
          <table className="w-full text-left text-xs md:text-sm">
            <thead className="border-b border-slate-800 bg-slate-950/80 font-bold uppercase tracking-wider text-slate-400">
              <tr>
                <th className="p-5">Capability</th>
                <th className="p-5 text-slate-500">Legacy PMS (Guesty, Hostaway)</th>
                <th className="bg-sky-500/10 p-5 font-black text-sky-400">Zencierge OS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-medium">
              <CompareRow capability="Guest Phone Support" legacy="Chatbot / SMS only" ours="Dedicated 24/7 AI Voice Line" />
              <CompareRow
                capability="Turnover Quality Control"
                legacy="Basic text checklists"
                ours="Computer Vision photo auditing"
              />
              <CompareRow
                capability="Damage & Dispute Vault"
                legacy="Manual proof gathering"
                ours="1-Click certified PDF binder engine"
              />
              <CompareRow
                capability="Pricing Model"
                legacy="% of revenue or high per-unit fees"
                ours="Predictable Flat Tiers (from $49)"
              />
            </tbody>
          </table>
        </div>
      </section>

      <section id="pricing" className="relative mx-auto max-w-7xl border-t border-slate-800 px-6 py-24">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[400px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[100px]" />

        <div className="relative z-10 mx-auto mb-16 max-w-3xl text-center">
          <h2 className="mb-3 flex items-center justify-center gap-2 text-xs font-extrabold uppercase tracking-widest text-emerald-400">
            <ShieldCheck className="h-4 w-4" />
            Pricing &amp; Free Trial
          </h2>
          <p className="text-4xl font-black text-white md:text-5xl">Start 14 days free. No credit card required.</p>
          <p className="mx-auto mt-4 max-w-xl text-sm text-slate-400">
            Full Host Command Center access from day one. Pick a plan, create your account, and cancel anytime.
          </p>
        </div>

        <div className="relative z-10 mx-auto w-full max-w-6xl px-4">
          <PricingCards tone="dark" cta="trial" />
        </div>
      </section>

      <footer className="border-t border-slate-800/80 px-6 py-12 text-center text-xs text-slate-500">
        <p>© 2026 Zencierge.net • All rights reserved. Built for autonomous hospitality. No co-host required.</p>
      </footer>
    </div>
  );
}

export default LandingPage;

function CompareRow({ capability, legacy, ours }: { capability: string; legacy: string; ours: string }) {
  return (
    <tr>
      <td className="p-5 font-bold text-white">{capability}</td>
      <td className="p-5 text-slate-400">
        <span className="inline-flex items-center gap-2">
          <XCircle className="h-4 w-4 shrink-0 text-rose-500" /> {legacy}
        </span>
      </td>
      <td className="bg-sky-500/5 p-5 font-bold text-emerald-400">
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" /> {ours}
        </span>
      </td>
    </tr>
  );
}
