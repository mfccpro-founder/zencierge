"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { trackUpgradeClick } from "@/lib/track-upgrade";
import { ZENCIERGE_PLAN_IDS, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

const ACCENT: Record<ZenciergePlanId, string> = {
  starter: "text-slate-400",
  pro: "text-sky-400",
  portfolio: "text-sky-400",
  agency: "text-indigo-400",
};

export function PlanFeatureList({
  planId,
  tone = "dark",
}: {
  planId: ZenciergePlanId;
  tone?: "dark" | "light";
}) {
  const plan = ZENCIERGE_PLANS[planId];
  const muted = tone === "light" ? "text-slate-600" : "text-slate-400";
  const item = tone === "light" ? "text-slate-800" : "text-slate-300";
  const check = tone === "light" ? "text-emerald-600" : "text-emerald-400";

  return (
    <ul className={`space-y-2 text-xs ${item}`}>
      {plan.includesPrior ? <li className={`font-semibold ${muted}`}>{plan.includesPrior}</li> : null}
      {plan.features.map((feature) => (
        <li key={feature} className="flex items-start gap-2">
          <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${check}`} />
          <span className="min-w-0 break-words leading-snug">{feature}</span>
        </li>
      ))}
    </ul>
  );
}

export function PricingCards({
  tone = "dark",
  selectedPlanId,
  onSelectPlan,
  cta = "trial",
}: {
  tone?: "dark" | "light";
  selectedPlanId?: ZenciergePlanId;
  onSelectPlan?: (id: ZenciergePlanId) => void;
  cta?: "trial" | "none";
}) {
  const dark = tone === "dark";

  return (
    <div className="mx-auto w-full max-w-6xl grid grid-cols-1 gap-6 px-4 md:grid-cols-2 lg:grid-cols-4">
      {ZENCIERGE_PLAN_IDS.map((id) => {
        const plan = ZENCIERGE_PLANS[id];
        const selected = selectedPlanId === id;
        const featured = Boolean(plan.featured);
        const card = dark
          ? featured
            ? "relative border-2 border-sky-400 bg-slate-900 shadow-2xl shadow-sky-500/15"
            : "border border-slate-800 bg-slate-900/60 hover:border-slate-700"
          : featured
            ? "relative border-2 border-sky-500 bg-white shadow-lg"
            : "border border-slate-200 bg-white hover:border-slate-300";

        const inner = (
          <>
            {featured ? (
              <div
                className={`absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-[10px] font-black uppercase tracking-widest shadow-md ${
                  dark ? "bg-sky-400 text-slate-950" : "bg-sky-600 text-white"
                }`}
              >
                Most Popular
              </div>
            ) : null}
            {cta === "trial" ? (
              <p
                className={`mb-4 rounded-lg border px-2.5 py-1.5 text-center text-[10px] font-bold leading-snug ${
                  dark
                    ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                14-Day Free Trial — No Credit Card Required to Start
              </p>
            ) : null}
            <div className="flex flex-1 flex-col">
              <div className={`mb-1 text-sm font-bold uppercase tracking-wider ${dark ? ACCENT[id] : "text-slate-500"}`}>
                {plan.name}
              </div>
              <div className="mb-4 flex items-baseline gap-1">
                <span className={`text-4xl font-black ${dark ? "text-white" : "text-slate-900"}`}>${plan.monthlyUsd}</span>
                <span className={`text-xs ${dark ? "text-slate-400" : "text-slate-500"}`}>/mo</span>
              </div>
              <p className={`mb-6 text-xs leading-relaxed ${dark ? "text-slate-400" : "text-slate-600"}`}>{plan.blurb}</p>
              <div className={`mb-8 border-t pt-5 ${dark ? "border-slate-800/80" : "border-slate-200"}`}>
                <PlanFeatureList planId={id} tone={tone} />
              </div>
            </div>
            {cta === "trial" && !onSelectPlan ? (
              <Link
                href={`/signup?plan=${id}`}
                onClick={() => trackUpgradeClick(id, "landing")}
                className={`mt-auto inline-flex w-full items-center justify-center rounded-xl py-3 text-xs font-black transition-all ${
                  featured
                    ? "bg-gradient-to-r from-emerald-400 to-sky-400 text-slate-950 shadow-lg shadow-emerald-400/20 hover:from-emerald-300 hover:to-sky-300"
                    : dark
                      ? "border border-white/10 bg-slate-950 font-bold text-white hover:border-emerald-400/40"
                      : "border border-slate-300 bg-slate-900 font-bold text-white hover:bg-slate-800"
                }`}
              >
                Start 14-Day Free Trial
              </Link>
            ) : null}
          </>
        );

        if (onSelectPlan) {
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectPlan(id)}
              className={`flex min-w-0 flex-col overflow-hidden rounded-3xl p-6 text-left transition-all ${card} ${
                selected ? "ring-2 ring-emerald-400" : ""
              }`}
            >
              {inner}
            </button>
          );
        }

        return (
          <article key={id} className={`flex min-w-0 flex-col justify-between overflow-hidden rounded-3xl p-6 transition-all ${card}`}>
            {inner}
          </article>
        );
      })}
    </div>
  );
}
