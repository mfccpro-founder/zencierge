"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  COMPLIMENTARY_MONTH_PRESETS,
  complimentaryDaysRemaining,
  isComplimentaryWindowOpen,
} from "@/lib/complimentary-access-core";
import { ZENCIERGE_PLAN_IDS, ZENCIERGE_PLANS, type ZenciergePlanId } from "@/lib/zencierge-plans";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

type Props = {
  userId: string;
  email: string;
  currentPlanId: ZenciergePlanId;
  complimentaryStartsAt: string | null;
  complimentaryEndsAt: string | null;
  squareSubscriptionId: string | null;
  rawStatus: string;
};

export function BackOfficeComplimentaryPanel({
  userId,
  email,
  currentPlanId,
  complimentaryStartsAt,
  complimentaryEndsAt,
  squareSubscriptionId,
  rawStatus,
}: Props) {
  const router = useRouter();
  const active = isComplimentaryWindowOpen(complimentaryEndsAt);
  const [months, setMonths] = useState<(typeof COMPLIMENTARY_MONTH_PRESETS)[number]>(6);
  const [planId, setPlanId] = useState<ZenciergePlanId>(currentPlanId);
  const [customEndsAt, setCustomEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "grant" | "extend" | "end") {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const confirmText =
        action === "end"
          ? `End complimentary access for ${email}?`
          : action === "extend"
            ? `Extend complimentary access for ${email}?`
            : `Grant ${months}-month Complimentary Beta Partner (${ZENCIERGE_PLANS[planId].name}) to ${email}? Square will not be modified.`;
      if (!window.confirm(confirmText)) {
        setBusy(false);
        return;
      }

      const response = await fetch(`/api/backoffice/customers/${userId}/complimentary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          email,
          planId,
          months: customEndsAt.trim() ? undefined : months,
          customEndsAt: customEndsAt.trim()
            ? new Date(customEndsAt.trim()).toISOString()
            : undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Request failed");
        return;
      }
      setMessage(
        action === "end"
          ? "Complimentary access ended."
          : action === "extend"
            ? "Complimentary access extended."
            : "Complimentary access granted.",
      );
      setCustomEndsAt("");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  const squareRisk =
    Boolean(squareSubscriptionId?.trim()) &&
    (rawStatus === "active" || rawStatus === "past_due");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
        Complimentary Beta Partner
      </h2>
      <p className="mt-1 text-xs text-slate-500">
        Founder-only. Grants selected-plan access at $0 without creating a Square charge. Distinct from the
        public 14-day trial. Active/past-due Square subscriptions are blocked until resolved in Square.
      </p>

      <dl className="mt-4 grid grid-cols-1 gap-2 text-sm text-slate-900 sm:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Access type</dt>
          <dd className="font-semibold">Complimentary Beta Partner</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Status</dt>
          <dd className="font-semibold">{active ? "Active" : complimentaryEndsAt ? "Expired" : "Not granted"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Days remaining</dt>
          <dd>{active ? complimentaryDaysRemaining(complimentaryEndsAt) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Plan</dt>
          <dd>{ZENCIERGE_PLANS[planId].name}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Start</dt>
          <dd>{formatDate(complimentaryStartsAt)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">End</dt>
          <dd>{formatDate(complimentaryEndsAt)}</dd>
        </div>
      </dl>

      {squareRisk ? (
        <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Square subscription is <strong>{rawStatus}</strong>. Grant/extend is blocked until that Square
          subscription is canceled or no longer chargeable. This UI will not modify Square.
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-slate-700">
          Duration preset
          <select
            value={months}
            onChange={(event) => setMonths(Number(event.target.value) as (typeof COMPLIMENTARY_MONTH_PRESETS)[number])}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900"
            disabled={busy}
          >
            {COMPLIMENTARY_MONTH_PRESETS.map((value) => (
              <option key={value} value={value}>
                {value} month{value === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Plan
          <select
            value={planId}
            onChange={(event) => setPlanId(event.target.value as ZenciergePlanId)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900"
            disabled={busy}
          >
            {ZENCIERGE_PLAN_IDS.map((id) => (
              <option key={id} value={id}>
                {ZENCIERGE_PLANS[id].name} (${ZENCIERGE_PLANS[id].monthlyUsd}/mo catalog)
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700 sm:col-span-2">
          Custom expiration (optional)
          <input
            type="datetime-local"
            value={customEndsAt}
            onChange={(event) => setCustomEndsAt(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-slate-900"
            disabled={busy}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || squareRisk}
          onClick={() => void run("grant")}
          className="rounded-xl border border-emerald-800 bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-40"
        >
          Grant complimentary
        </button>
        <button
          type="button"
          disabled={busy || squareRisk || !active}
          onClick={() => void run("extend")}
          className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          Extend
        </button>
        <button
          type="button"
          disabled={busy || !active}
          onClick={() => void run("end")}
          className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-800 hover:bg-rose-50 disabled:opacity-40"
        >
          End complimentary
        </button>
      </div>

      {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}
      {message ? <p className="mt-3 text-sm font-medium text-emerald-800">{message}</p> : null}
    </section>
  );
}
