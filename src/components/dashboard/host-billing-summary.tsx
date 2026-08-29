"use client";

import { useEffect, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { useSubscriptionTier } from "@/hooks/use-subscription-tier";
import { startSquareCheckout } from "@/lib/start-square-checkout";
import { trackUpgradeClick } from "@/lib/track-upgrade";
import { PlanFeatureList } from "@/components/pricing/pricing-cards";
import {
  ZENCIERGE_PLAN_IDS,
  ZENCIERGE_PLANS,
  parsePlanId,
  type ZenciergePlanId,
} from "@/lib/zencierge-plans";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function HostBillingSummary() {
  const tier = useSubscriptionTier();
  const [busy, setBusy] = useState<"change" | "pay" | null>(null);
  const [changing, setChanging] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<ZenciergePlanId>(tier.planId);

  useEffect(() => {
    if (!tier.loading) setPendingPlan(tier.planId);
  }, [tier.loading, tier.planId]);

  const statusLabel =
    tier.status === "trial"
      ? "Active (14-day trial)"
      : tier.status === "active"
        ? "Active"
        : tier.status === "inactive"
          ? "Inactive"
          : tier.status;

  const checkout = async (planId: ZenciergePlanId, kind: "change" | "pay") => {
    if (busy) return;
    setBusy(kind);
    trackUpgradeClick(planId, "settings");
    try {
      await startSquareCheckout({ kind: "host_subscription", planId, billing: "monthly" });
    } catch (cause) {
      setBusy(null);
      window.alert(cause instanceof Error ? cause.message : "Checkout failed");
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" id="billing">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Billing & subscriptions</h3>
          <p className="mt-0.5 text-xs text-slate-500">Active plan summary. Full pricing is on the public site and at sign-up.</p>
        </div>
      </div>

      <p className="mt-5 text-base font-semibold text-slate-900">
        Current Plan: {tier.loading ? "…" : tier.planName} — {tier.loading ? "…" : statusLabel}
      </p>
      {!tier.loading ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <PlanFeatureList planId={tier.planId} tone="light" />
        </div>
      ) : null}
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Renewal / trial end</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">
            {tier.currentPeriodEnd ? new Date(tier.currentPeriodEnd).toLocaleDateString() : "—"}
          </dd>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <dt className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Next payment</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">
            {tier.status === "trial"
              ? "None during trial"
              : `${usd.format(tier.monthlyUsd)} / month${tier.currentPeriodEnd ? ` · ${new Date(tier.currentPeriodEnd).toLocaleDateString()}` : ""}`}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setChanging((open) => !open)}
          className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-800 hover:border-emerald-500 hover:text-slate-950"
        >
          Change Plan
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void checkout(tier.planId, "pay")}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-800 hover:border-emerald-500 disabled:opacity-60"
        >
          {busy === "pay" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Manage Payment Method
        </button>
      </div>

      {changing ? (
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="min-w-[12rem] flex-1 text-xs font-semibold text-slate-700">
            New plan
            <select
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900"
              value={pendingPlan}
              onChange={(event) => setPendingPlan(parsePlanId(event.target.value) ?? tier.planId)}
            >
              {ZENCIERGE_PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {ZENCIERGE_PLANS[id].name} · {usd.format(ZENCIERGE_PLANS[id].monthlyUsd)}/mo
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy !== null || pendingPlan === tier.planId}
            onClick={() => void checkout(pendingPlan, "change")}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {busy === "change" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Confirm change
          </button>
          <div className="w-full pt-2">
            <PlanFeatureList planId={pendingPlan} tone="light" />
          </div>
        </div>
      ) : null}

      {tier.payments.length > 0 ? (
        <ul className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
          {tier.payments.slice(0, 5).map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-3 py-2 text-xs">
              <span className="text-slate-700">
                {usd.format(Number(payment.amount_usd))}
                {payment.plan_id && ZENCIERGE_PLANS[payment.plan_id as keyof typeof ZENCIERGE_PLANS]
                  ? ` · ${ZENCIERGE_PLANS[payment.plan_id as keyof typeof ZENCIERGE_PLANS].name}`
                  : ""}
              </span>
              <span className={payment.status === "succeeded" ? "text-emerald-700" : "text-rose-600"}>
                {payment.status}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-slate-500">No Square charges on file yet.</p>
      )}
    </section>
  );
}
