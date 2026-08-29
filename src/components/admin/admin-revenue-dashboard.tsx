"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  CreditCard,
  MousePointerClick,
  RefreshCw,
  Users,
  Wallet,
} from "lucide-react";
import type { AdminHostRow, AdminRevenueSnapshot, HostFilter, SquareSubStatus } from "@/lib/admin-revenue-store";
import { ZENCIERGE_PLANS } from "@/lib/zencierge-plans";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function statusChip(status: SquareSubStatus) {
  if (status === "ACTIVE") return "border-emerald-800 bg-emerald-700 text-white";
  if (status === "PAST_DUE") return "border-amber-800 bg-amber-600 text-white";
  if (status === "TRIAL") return "border-sky-800 bg-sky-700 text-white";
  return "border-slate-800 bg-slate-700 text-white";
}

function matchesFilter(host: AdminHostRow, filter: HostFilter) {
  if (filter === "all") return true;
  if (filter === "active") return host.status === "ACTIVE";
  if (filter === "pending") return host.status === "PAST_DUE" || host.status === "TRIAL";
  return host.status === "CANCELED";
}

export function AdminRevenueDashboard() {
  const [data, setData] = useState<AdminRevenueSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<HostFilter>("all");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/revenue", { signal: AbortSignal.timeout(15000) });
      if (res.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent("/admin/revenue")}`;
        return;
      }
      if (res.status === 403) {
        setError("This account is not a superadmin.");
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`Could not load revenue snapshot (HTTP ${res.status})`);
      setData((await res.json()) as AdminRevenueSnapshot);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "TimeoutError") {
        setError("Revenue API timed out after 15s — try Refresh.");
      } else {
        setError(cause instanceof Error ? cause.message : "Load failed");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, []);

  const hosts = useMemo(
    () => (data?.hosts ?? []).filter((host) => matchesFilter(host, filter)),
    [data, filter],
  );

  if (loading && !data) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-24 rounded-3xl bg-slate-200" />
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-28 rounded-2xl bg-slate-200" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return <p className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>;
  }

  if (!data) return null;
  const { metrics } = data;

  const successCharges = data.charges.filter((charge) => charge.status === "SUCCESS");
  const grossUsd = successCharges.reduce((sum, charge) => sum + charge.amountUsd, 0);
  const squareFeesUsd = successCharges.reduce((sum, charge) => sum + charge.amountUsd * 0.029 + 0.3, 0);
  const breakdown = {
    grossUsd,
    squareFeesUsd,
    netUsd: grossUsd - squareFeesUsd,
    successCount: successCharges.length,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-700">Founder Billing Hub</p>
          <h2 className="mt-1 text-xl font-bold text-slate-900">MRR, Auto-Pay &amp; dunning</h2>
          <p className="mt-1 text-xs text-slate-500">Hidden from hosts. Square Auto-Pay subscribers and past-due recovery.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Wallet className="h-4 w-4" />} label="MRR" value={usd.format(metrics.mrr)} hint="Active host subscriptions" />
        <Kpi
          icon={<Users className="h-4 w-4" />}
          label="Auto-Pay subscribers"
          value={`${metrics.subscribedActive} active`}
          hint={`${metrics.trials} trials · ${metrics.subscribedInactive} inactive / canceled`}
        />
        <Kpi
          icon={<MousePointerClick className="h-4 w-4" />}
          label="Plan conversion"
          value={`${metrics.conversionPct}%`}
          hint={`${metrics.upgradeClicks} Upgrade clicks → ${metrics.paidSubscriptions} paid Square subs`}
        />
        <Kpi
          icon={<Ban className="h-4 w-4" />}
          label="Churn / failed"
          value={`${metrics.churnThisMonth} / ${metrics.failedPaymentsThisMonth}`}
          hint="Cancellations this month / failed Square charges"
          warn={metrics.failedPaymentsThisMonth > 0}
        />
      </section>

      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-800" />
          <h3 className="text-sm font-semibold text-slate-900">Dunning alerts</h3>
        </div>
        <p className="mb-3 text-xs font-medium text-slate-800">
          Hosts in PAST_DUE — Auto-Pay failed. Retry or pause access before the next billing cycle.
        </p>
        <ul className="space-y-2 text-sm">
          {data.hosts.filter((host) => host.status === "PAST_DUE").length === 0 ? (
            <li className="font-medium text-slate-900">No past-due subscribers right now.</li>
          ) : (
            data.hosts
              .filter((host) => host.status === "PAST_DUE")
              .map((host) => (
                <li
                  key={host.id}
                  className="flex flex-wrap justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 font-medium text-slate-900"
                >
                  <span>
                    {host.name} · {host.email}
                  </span>
                  <span className="tabular-nums">
                    {ZENCIERGE_PLANS[host.planId].name} · {usd.format(host.monthlyUsd)}/mo
                  </span>
                </li>
              ))
          )}
        </ul>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-900">Revenue breakdown · collected charges</h3>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Gross revenue</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{usd.format(breakdown.grossUsd)}</p>
            <p className="text-[11px] text-slate-500">{breakdown.successCount} successful Square charges</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Square fees (2.9% + 30¢)</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-700">-{usd.format(breakdown.squareFeesUsd)}</p>
            <p className="text-[11px] text-slate-500">Estimated processing cost</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Net profit</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{usd.format(breakdown.netUsd)}</p>
            <p className="text-[11px] text-slate-500">Gross minus estimated Square fees</p>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-semibold text-slate-900">Plan overflow / funnel</h3>
        </div>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {data.planClicks.map((row) => (
            <div key={row.planId} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold text-slate-900">
                {row.name} · {usd.format(row.monthlyUsd)}/mo
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">{row.clicks}</p>
              <p className="text-[11px] text-slate-500">Upgrade clicks</p>
            </div>
          ))}
        </div>
        <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
          {data.funnel.map((event) => (
            <li
              key={event.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <span className="text-slate-600">
                <span className="font-semibold text-slate-900">{event.type.replaceAll("_", " ")}</span>
                {" · "}
                {ZENCIERGE_PLANS[event.planId].name}
                {event.email ? ` · ${event.email}` : ""}
              </span>
              <span className="tabular-nums text-slate-700">
                {event.source} · {new Date(event.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Hosts & Square billing</h3>
            <p className="text-[11px] text-slate-500">Customer IDs, plan, last successful charge</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", "All"],
                ["active", "Active"],
                ["pending", "Pending"],
                ["canceled", "Canceled"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                  filter === id
                    ? "border-slate-300 bg-slate-100 text-slate-900"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-300 bg-slate-100 text-[10px] font-semibold uppercase tracking-wider text-slate-900">
              <tr>
                <th className="px-4 py-3">Host / email</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Square status</th>
                <th className="px-4 py-3">Monthly</th>
                <th className="px-4 py-3">Last payment</th>
                <th className="px-4 py-3">Properties</th>
                <th className="px-4 py-3">Square customer ID</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => (
                <tr key={host.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{host.name}</p>
                    <p className="text-slate-700">{host.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-900">{ZENCIERGE_PLANS[host.planId].name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusChip(host.status)}`}>
                      {host.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-900">{usd.format(host.monthlyUsd)}/mo</td>
                  <td className="px-4 py-3 text-slate-900">
                    {host.lastPaymentAt ? new Date(host.lastPaymentAt).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-900">{host.activeProperties}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-700">{host.squareCustomerId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-sky-600" />
          <h3 className="text-sm font-semibold text-slate-900">Square webhook · live charges</h3>
        </div>
        <ul className="space-y-2">
          {data.charges.map((charge) => (
            <li
              key={charge.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs"
            >
              <div className="flex items-center gap-2">
                {charge.status === "FAILED" ? (
                  <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                )}
                <span className="font-semibold text-slate-900">{usd.format(charge.amountUsd)}</span>
                <span className="text-slate-700">{charge.email ?? "Unknown payer"}</span>
                <span className="font-mono text-[10px] text-slate-700">{charge.squarePaymentId}</span>
              </div>
              <span className={charge.status === "SUCCESS" ? "text-emerald-700" : charge.status === "FAILED" ? "text-rose-700" : "text-amber-700"}>
                {charge.status} · {new Date(charge.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Kpi({
  icon,
  label,
  value,
  hint,
  warn,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-slate-500">
        <p className="text-[11px] font-semibold uppercase tracking-wide">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-2xl font-bold ${warn ? "text-rose-700" : "text-slate-900"}`}>{value}</p>
      <p className="mt-1 text-[11px] text-slate-500">{hint}</p>
    </div>
  );
}
